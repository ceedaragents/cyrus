import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
	createServer as createHttpServer,
	request as httpRequest,
} from "node:http";
import {
	createServer as createHttpsServer,
	request as httpsRequest,
} from "node:https";
import type { Socket } from "node:net";
import {
	createServer as createNetServer,
	connect as netConnect,
} from "node:net";
import { join } from "node:path";
import type { NetworkPolicy, SandboxConfig } from "cyrus-core";
import { createLogger, type ILogger } from "cyrus-core";
import forge from "node-forge";

/**
 * Resolved transform rules for a matched domain.
 * Contains headers to inject/override on the outgoing request.
 */
interface ResolvedTransform {
	headers: Record<string, string>;
}

/**
 * EgressProxy provides an HTTP/HTTPS forward proxy for Claude Code sandbox
 * network egress control.
 *
 * Scope: Claude Code's sandbox.network proxy only intercepts traffic from
 * Bash tool subprocesses (git, gh, npm, curl, etc.). Claude's own inference
 * API calls, MCP server traffic, and built-in file tools (Read/Edit/Write)
 * are NOT routed through this proxy.
 * @see https://code.claude.com/docs/en/sandboxing#network-isolation
 *
 * Capabilities:
 * - Domain-based allow/deny filtering for subprocess traffic
 * - TLS termination (MITM) for domains with header transform rules
 * - Per-domain header injection (credentials brokering)
 * - Request logging
 *
 * Architecture follows the Vercel Sandbox Firewall pattern:
 * @see https://vercel.com/docs/vercel-sandbox/concepts/firewall
 *
 * TLS termination is selective — only domains with transform rules get intercepted.
 * A per-instance CA certificate is generated and must be trusted by the client
 * via NODE_EXTRA_CA_CERTS.
 */
export class EgressProxy {
	private httpServer: ReturnType<typeof createHttpServer> | null = null;
	private socksServer: ReturnType<typeof createNetServer> | null = null;
	private httpProxyPort: number;
	private socksProxyPort: number;
	private networkPolicy: NetworkPolicy | undefined;
	private logRequests: boolean;
	private logger: ILogger;

	/** CA key pair and certificate for on-the-fly cert generation */
	private caKey: forge.pki.rsa.KeyPair | null = null;
	private caCert: forge.pki.Certificate | null = null;
	private caKeyPem: string = "";
	private caCertPem: string = "";

	/** Path where the CA cert PEM is written for NODE_EXTRA_CA_CERTS */
	private caCertPath: string = "";

	/** Cache of generated server certificates keyed by hostname */
	private certCache = new Map<string, { key: string; cert: string }>();

	/** Set of domains that require TLS termination (have transform rules) */
	private tlsTerminationDomains = new Set<string>();

	/** Merged header transforms keyed by domain pattern */
	private domainTransforms = new Map<string, Record<string, string>>();

	/** Set of allowed domain patterns (if policy specifies allow rules) */
	private allowedDomains = new Set<string>();

	private isRunning = false;

	constructor(config: SandboxConfig, cyrusHome: string, logger?: ILogger) {
		this.httpProxyPort = config.httpProxyPort ?? 9080;
		this.socksProxyPort = config.socksProxyPort ?? 9081;
		this.networkPolicy = config.networkPolicy;
		this.logRequests = config.logRequests ?? true;
		this.logger = logger ?? createLogger({ component: "EgressProxy" });

		// Generate CA cert and store path
		const certsDir = join(cyrusHome, "certs");
		this.caCertPath = join(certsDir, "cyrus-egress-ca.pem");
		this.generateCA(certsDir);

		// Parse policy into fast-lookup structures
		this.parsePolicy();
	}

	/**
	 * Get the path to the CA certificate PEM file.
	 * This should be set as NODE_EXTRA_CA_CERTS for child processes.
	 */
	getCACertPath(): string {
		return this.caCertPath;
	}

	/**
	 * Get configured HTTP proxy port.
	 */
	getHttpProxyPort(): number {
		return this.httpProxyPort;
	}

	/**
	 * Get configured SOCKS proxy port.
	 */
	getSocksProxyPort(): number {
		return this.socksProxyPort;
	}

	/**
	 * Start the egress proxy servers.
	 */
	async start(): Promise<void> {
		if (this.isRunning) return;

		await this.startHttpProxy();
		await this.startSocksProxy();
		this.isRunning = true;

		this.logger.info(
			`Egress proxy started (HTTP: ${this.httpProxyPort}, SOCKS: ${this.socksProxyPort})`,
		);
	}

	/**
	 * Stop the egress proxy servers.
	 */
	async stop(): Promise<void> {
		if (!this.isRunning) return;

		const stops: Promise<void>[] = [];

		if (this.httpServer) {
			stops.push(
				new Promise<void>((resolve) => {
					this.httpServer!.close(() => resolve());
				}),
			);
		}

		if (this.socksServer) {
			stops.push(
				new Promise<void>((resolve) => {
					this.socksServer!.close(() => resolve());
				}),
			);
		}

		await Promise.all(stops);
		this.isRunning = false;
		this.logger.info("Egress proxy stopped");
	}

	/**
	 * Update the network policy at runtime without restarting.
	 */
	updateNetworkPolicy(policy: NetworkPolicy): void {
		this.networkPolicy = policy;
		this.tlsTerminationDomains.clear();
		this.domainTransforms.clear();
		this.allowedDomains.clear();
		this.parsePolicy();
		this.logger.info("Network policy updated");
	}

	// ---------------------------------------------------------------------------
	// CA Certificate Generation
	// ---------------------------------------------------------------------------

	private generateCA(certsDir: string): void {
		// Reuse existing CA if present
		const caKeyPath = join(certsDir, "cyrus-egress-ca-key.pem");
		if (existsSync(this.caCertPath) && existsSync(caKeyPath)) {
			this.caCertPem = readFileSync(this.caCertPath, "utf8");
			this.caKeyPem = readFileSync(caKeyPath, "utf8");
			this.caCert = forge.pki.certificateFromPem(this.caCertPem);
			this.caKey = {
				publicKey: this.caCert.publicKey as forge.pki.rsa.PublicKey,
				privateKey: forge.pki.privateKeyFromPem(this.caKeyPem),
			};
			this.logger.debug("Loaded existing CA certificate");
			return;
		}

		if (!existsSync(certsDir)) {
			mkdirSync(certsDir, { recursive: true });
		}

		this.logger.info(
			"Generating CA certificate for egress proxy TLS termination...",
		);
		const keys = forge.pki.rsa.generateKeyPair(2048);
		const cert = forge.pki.createCertificate();

		cert.publicKey = keys.publicKey;
		cert.serialNumber = "01";
		cert.validity.notBefore = new Date();
		cert.validity.notAfter = new Date();
		cert.validity.notAfter.setFullYear(
			cert.validity.notBefore.getFullYear() + 10,
		);

		const attrs = [
			{ name: "commonName", value: "Cyrus Egress Proxy CA" },
			{ name: "organizationName", value: "Cyrus" },
		];
		cert.setSubject(attrs);
		cert.setIssuer(attrs);
		cert.setExtensions([
			{ name: "basicConstraints", cA: true },
			{
				name: "keyUsage",
				keyCertSign: true,
				digitalSignature: true,
				cRLSign: true,
			},
		]);

		cert.sign(keys.privateKey, forge.md.sha256.create());

		this.caKey = keys;
		this.caCert = cert;
		this.caCertPem = forge.pki.certificateToPem(cert);
		this.caKeyPem = forge.pki.privateKeyToPem(keys.privateKey);

		writeFileSync(this.caCertPath, this.caCertPem);
		writeFileSync(caKeyPath, this.caKeyPem, { mode: 0o600 });
		this.logger.info(`CA certificate written to ${this.caCertPath}`);
	}

	// ---------------------------------------------------------------------------
	// On-the-fly Server Certificate Generation
	// ---------------------------------------------------------------------------

	private generateServerCert(hostname: string): { key: string; cert: string } {
		const cached = this.certCache.get(hostname);
		if (cached) return cached;

		const keys = forge.pki.rsa.generateKeyPair(2048);
		const cert = forge.pki.createCertificate();

		cert.publicKey = keys.publicKey;
		cert.serialNumber = String(Date.now());
		cert.validity.notBefore = new Date();
		cert.validity.notAfter = new Date();
		cert.validity.notAfter.setFullYear(
			cert.validity.notBefore.getFullYear() + 1,
		);

		cert.setSubject([{ name: "commonName", value: hostname }]);
		cert.setIssuer(this.caCert!.subject.attributes);
		cert.setExtensions([
			{
				name: "subjectAltName",
				altNames: [{ type: 2, value: hostname }], // DNS
			},
		]);

		cert.sign(this.caKey!.privateKey, forge.md.sha256.create());

		const result = {
			key: forge.pki.privateKeyToPem(keys.privateKey),
			cert: forge.pki.certificateToPem(cert),
		};
		this.certCache.set(hostname, result);
		return result;
	}

	// ---------------------------------------------------------------------------
	// Policy Parsing
	// ---------------------------------------------------------------------------

	private parsePolicy(): void {
		if (!this.networkPolicy?.allow) return;

		const allow = this.networkPolicy.allow;
		for (const domain of Object.keys(allow)) {
			const rules = allow[domain]!;
			this.allowedDomains.add(domain);

			// Merge all transform headers for this domain
			const mergedHeaders: Record<string, string> = {};
			let hasTransforms = false;

			for (const rule of rules) {
				if (rule.transform) {
					for (const t of rule.transform) {
						Object.assign(mergedHeaders, t.headers);
						hasTransforms = true;
					}
				}
			}

			if (hasTransforms) {
				this.tlsTerminationDomains.add(domain);
				this.domainTransforms.set(domain, mergedHeaders);
			}
		}
	}

	// ---------------------------------------------------------------------------
	// Domain Matching
	// ---------------------------------------------------------------------------

	/**
	 * Check if a hostname is allowed by the network policy.
	 *
	 * Three modes (matching Vercel Sandbox Firewall):
	 * - allow-all: no networkPolicy or no allow rules → all traffic passes
	 * - deny-all: networkPolicy with empty allow → all traffic blocked
	 * - user-defined: networkPolicy with allow rules → deny-all default,
	 *   only listed domains pass
	 *
	 * Only Bash-spawned subprocess traffic reaches this proxy (git, gh,
	 * npm, curl, etc.). Claude's inference API and MCP traffic bypass it.
	 */
	private isDomainAllowed(hostname: string): boolean {
		// allow-all: no policy or no allow rules
		if (!this.networkPolicy?.allow || this.allowedDomains.size === 0) {
			return true;
		}

		// user-defined: deny-all default, check explicit allow list
		return this.matchDomain(hostname) !== null;
	}

	/**
	 * Match a hostname against policy domain patterns.
	 * Returns the matching pattern or null.
	 */
	private matchDomain(hostname: string): string | null {
		// Exact match
		if (this.allowedDomains.has(hostname)) return hostname;

		// Wildcard matching
		for (const pattern of this.allowedDomains) {
			if (this.matchesPattern(hostname, pattern)) return pattern;
		}

		return null;
	}

	/**
	 * Match hostname against a domain pattern.
	 * Supports:
	 * - Leading wildcard: *.example.com matches sub.example.com but NOT example.com
	 * - Mid-segment wildcard: www.*.com matches www.foo.com
	 */
	private matchesPattern(hostname: string, pattern: string): boolean {
		if (pattern.startsWith("*.")) {
			const suffix = pattern.slice(1); // ".example.com"
			return hostname.endsWith(suffix) && hostname !== pattern.slice(2);
		}

		if (pattern.includes("*")) {
			const regex = new RegExp(
				`^${pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+")}$`,
			);
			return regex.test(hostname);
		}

		return false;
	}

	/**
	 * Get the resolved transforms for a domain, if any.
	 */
	private getTransformsForDomain(hostname: string): ResolvedTransform | null {
		const pattern = this.matchDomain(hostname);
		if (!pattern) return null;

		const headers = this.domainTransforms.get(pattern);
		if (!headers) return null;

		return { headers };
	}

	/**
	 * Check if a domain requires TLS termination (has transform rules).
	 */
	private requiresTlsTermination(hostname: string): boolean {
		const pattern = this.matchDomain(hostname);
		if (!pattern) return false;
		return this.tlsTerminationDomains.has(pattern);
	}

	// ---------------------------------------------------------------------------
	// HTTP Proxy (handles both HTTP requests and HTTPS CONNECT tunnels)
	// ---------------------------------------------------------------------------

	private async startHttpProxy(): Promise<void> {
		this.httpServer = createHttpServer((req, res) => {
			this.handleHttpRequest(req, res);
		});

		// Handle CONNECT method for HTTPS tunneling
		this.httpServer.on("connect", (req, clientSocket: Socket, head) => {
			this.handleConnect(req, clientSocket, head);
		});

		return new Promise<void>((resolve, reject) => {
			this.httpServer!.listen(this.httpProxyPort, "127.0.0.1", () => {
				this.logger.debug(
					`HTTP proxy listening on 127.0.0.1:${this.httpProxyPort}`,
				);
				resolve();
			});
			this.httpServer!.on("error", reject);
		});
	}

	/**
	 * Handle plain HTTP proxy requests (non-CONNECT).
	 */
	private handleHttpRequest(
		clientReq: IncomingMessage,
		clientRes: ServerResponse,
	): void {
		const url = clientReq.url;
		if (!url) {
			clientRes.writeHead(400);
			clientRes.end("Bad Request");
			return;
		}

		let parsedUrl: URL;
		try {
			parsedUrl = new URL(url);
		} catch {
			clientRes.writeHead(400);
			clientRes.end("Invalid URL");
			return;
		}

		const hostname = parsedUrl.hostname;

		if (!this.isDomainAllowed(hostname)) {
			if (this.logRequests) {
				this.logger.warn(
					`[BLOCKED] HTTP ${clientReq.method} ${hostname}${parsedUrl.pathname}`,
				);
			}
			clientRes.writeHead(403);
			clientRes.end("Forbidden by egress policy");
			return;
		}

		if (this.logRequests) {
			this.logger.info(
				`[PROXY] HTTP ${clientReq.method} ${hostname}${parsedUrl.pathname}`,
			);
		}

		// Apply header transforms
		const transforms = this.getTransformsForDomain(hostname);
		const headers = { ...clientReq.headers };
		delete headers["proxy-connection"];
		if (transforms) {
			Object.assign(headers, transforms.headers);
		}

		const options = {
			hostname: parsedUrl.hostname,
			port: Number(parsedUrl.port) || 80,
			path: parsedUrl.pathname + parsedUrl.search,
			method: clientReq.method,
			headers,
		};

		const proxyReq = httpRequest(options, (proxyRes) => {
			clientRes.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
			proxyRes.pipe(clientRes);
		});

		proxyReq.on("error", (err) => {
			this.logger.error(`HTTP proxy error for ${hostname}:`, err);
			clientRes.writeHead(502);
			clientRes.end("Bad Gateway");
		});

		clientReq.pipe(proxyReq);
	}

	/**
	 * Handle HTTPS CONNECT tunneling.
	 * For domains with transform rules: TLS-terminate, modify headers, re-encrypt.
	 * For other allowed domains: TCP passthrough.
	 */
	private handleConnect(
		req: IncomingMessage,
		clientSocket: Socket,
		head: Buffer,
	): void {
		const parts = (req.url || "").split(":");
		const hostname = parts[0] || "";
		const port = Number(parts[1]) || 443;

		if (!hostname || !this.isDomainAllowed(hostname)) {
			if (this.logRequests) {
				this.logger.warn(`[BLOCKED] CONNECT ${hostname}:${port}`);
			}
			clientSocket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
			clientSocket.destroy();
			return;
		}

		if (this.requiresTlsTermination(hostname)) {
			// TLS termination: MITM to inject headers
			this.handleTlsTermination(hostname, port, clientSocket, head);
		} else {
			// Passthrough: direct TCP tunnel
			if (this.logRequests) {
				this.logger.info(`[TUNNEL] CONNECT ${hostname}:${port}`);
			}
			this.handleTcpTunnel(hostname, port, clientSocket, head);
		}
	}

	/**
	 * Direct TCP tunnel (no TLS termination).
	 */
	private handleTcpTunnel(
		hostname: string,
		port: number,
		clientSocket: Socket,
		head: Buffer,
	): void {
		const serverSocket = netConnect(port, hostname, () => {
			clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
			if (head.length > 0) {
				serverSocket.write(head);
			}
			serverSocket.pipe(clientSocket);
			clientSocket.pipe(serverSocket);
		});

		serverSocket.on("error", (err) => {
			this.logger.error(`Tunnel error for ${hostname}:${port}:`, err);
			clientSocket.destroy();
		});

		clientSocket.on("error", () => {
			serverSocket.destroy();
		});
	}

	/**
	 * TLS termination for domains with transform rules.
	 * Spins up a local HTTPS server on an ephemeral port, bridges
	 * the client socket to it, then forwards decrypted HTTP upstream
	 * with injected headers.
	 */
	private handleTlsTermination(
		hostname: string,
		port: number,
		clientSocket: Socket,
		head: Buffer,
	): void {
		const serverCert = this.generateServerCert(hostname);

		// Create a real HTTPS server with the generated cert to terminate TLS
		const localServer = createHttpsServer(
			{ key: serverCert.key, cert: serverCert.cert },
			(req, res) => {
				const transforms = this.getTransformsForDomain(hostname);

				if (this.logRequests) {
					this.logger.info(
						`[MITM] ${req.method} https://${hostname}${req.url}` +
							(transforms
								? ` (transforms: ${Object.keys(transforms.headers).join(", ")})`
								: ""),
					);
				}

				const headers = { ...req.headers };
				delete headers["proxy-connection"];
				headers.host = hostname + (port !== 443 ? `:${port}` : "");

				if (transforms) {
					Object.assign(headers, transforms.headers);
				}

				const upstreamReq = httpsRequest(
					{
						hostname,
						port,
						path: req.url,
						method: req.method,
						headers,
						rejectUnauthorized: true,
					},
					(upstreamRes) => {
						res.writeHead(upstreamRes.statusCode || 502, upstreamRes.headers);
						upstreamRes.pipe(res);
					},
				);

				upstreamReq.on("error", (err: Error) => {
					this.logger.error(`MITM upstream error for ${hostname}:`, err);
					if (!res.headersSent) {
						res.writeHead(502);
						res.end("Bad Gateway");
					}
				});

				req.pipe(upstreamReq);
			},
		);

		localServer.on("tlsClientError", (err: Error) => {
			this.logger.error(`TLS handshake error for ${hostname}:`, err.message);
		});

		localServer.listen(0, "127.0.0.1", () => {
			const addr = localServer.address();
			if (!addr || typeof addr === "string") {
				clientSocket.destroy();
				localServer.close();
				return;
			}

			// Tell client the tunnel is established
			clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");

			// Bridge client socket to our local HTTPS server
			const bridge = netConnect(addr.port, "127.0.0.1", () => {
				if (head.length > 0) {
					bridge.write(head);
				}
				bridge.pipe(clientSocket);
				clientSocket.pipe(bridge);
			});

			bridge.on("error", () => clientSocket.destroy());
			clientSocket.on("error", () => bridge.destroy());
			clientSocket.on("close", () => {
				bridge.destroy();
				localServer.close();
			});
		});

		localServer.on("error", (err: Error) => {
			this.logger.error(`TLS termination server error for ${hostname}:`, err);
			clientSocket.destroy();
		});
	}

	// ---------------------------------------------------------------------------
	// SOCKS5 Proxy (minimal implementation for Claude Code compatibility)
	// ---------------------------------------------------------------------------

	private async startSocksProxy(): Promise<void> {
		this.socksServer = createNetServer((socket) => {
			this.handleSocksConnection(socket);
		});

		return new Promise<void>((resolve, reject) => {
			this.socksServer!.listen(this.socksProxyPort, "127.0.0.1", () => {
				this.logger.debug(
					`SOCKS5 proxy listening on 127.0.0.1:${this.socksProxyPort}`,
				);
				resolve();
			});
			this.socksServer!.on("error", reject);
		});
	}

	/**
	 * Handle SOCKS5 connection.
	 * Implements the SOCKS5 handshake (RFC 1928) with no-auth only,
	 * then tunnels the connection like CONNECT.
	 */
	private handleSocksConnection(socket: Socket): void {
		let state: "greeting" | "request" = "greeting";

		socket.once("data", (data) => {
			if (state !== "greeting") return;

			// SOCKS5 greeting: VER=0x05, NMETHODS, METHODS[]
			if (data[0] !== 0x05) {
				socket.destroy();
				return;
			}

			// Reply: VER=0x05, METHOD=0x00 (no auth)
			socket.write(Buffer.from([0x05, 0x00]));
			state = "request";

			socket.once("data", (reqData) => {
				if (state !== "request") return;

				// SOCKS5 request: VER CMD RSV ATYP DST.ADDR DST.PORT
				const ver = reqData[0];
				const cmd = reqData[1];
				const atyp = reqData[3];

				if (ver !== 0x05 || cmd !== 0x01) {
					// Only support CONNECT
					// Reply with command not supported
					const reply = Buffer.from([0x05, 0x07, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
					socket.write(reply);
					socket.destroy();
					return;
				}

				let hostname: string;
				let portOffset: number;

				if (atyp === 0x01) {
					// IPv4
					hostname = `${reqData[4]}.${reqData[5]}.${reqData[6]}.${reqData[7]}`;
					portOffset = 8;
				} else if (atyp === 0x03) {
					// Domain name
					const domainLen = reqData[4] ?? 0;
					hostname = reqData.subarray(5, 5 + domainLen).toString("ascii");
					portOffset = 5 + domainLen;
				} else if (atyp === 0x04) {
					// IPv6 - not commonly used, basic support
					const parts: string[] = [];
					for (let i = 0; i < 16; i += 2) {
						parts.push(reqData.readUInt16BE(4 + i).toString(16));
					}
					hostname = parts.join(":");
					portOffset = 20;
				} else {
					socket.destroy();
					return;
				}

				const port = reqData.readUInt16BE(portOffset);

				if (!this.isDomainAllowed(hostname)) {
					if (this.logRequests) {
						this.logger.warn(`[BLOCKED] SOCKS5 ${hostname}:${port}`);
					}
					// Reply with connection not allowed
					const reply = Buffer.from([0x05, 0x02, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
					socket.write(reply);
					socket.destroy();
					return;
				}

				if (this.logRequests) {
					this.logger.info(`[SOCKS5] ${hostname}:${port}`);
				}

				// Connect to target
				const target = netConnect(port, hostname, () => {
					// Success reply
					const reply = Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
					socket.write(reply);

					target.pipe(socket);
					socket.pipe(target);
				});

				target.on("error", (err) => {
					this.logger.error(
						`SOCKS5 target connection error for ${hostname}:${port}:`,
						err,
					);
					// Reply with general failure
					const reply = Buffer.from([0x05, 0x01, 0x00, 0x01, 0, 0, 0, 0, 0, 0]);
					socket.write(reply);
					socket.destroy();
				});

				socket.on("error", () => {
					target.destroy();
				});
			});
		});

		socket.on("error", () => {
			socket.destroy();
		});
	}
}
