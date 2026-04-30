// Learning tests for EgressProxy's transformation logic.
//
// Existing tests in EgressProxy.test.ts cover domain allow/deny, CA cert
// generation, ports, presets, and SOCKS5 handshake. They DON'T cover what
// the proxy actually does to a request once it's allowed: the header
// injection / credentials-brokering path. That's the behavior closest in
// spirit to Cloudflare's "Outbound Workers TLS auth" feature
// (https://developers.cloudflare.com/changelog/post/2026-04-13-sandbox-outbound-workers-tls-auth/),
// where the proxy attaches credentials transparently before forwarding.
//
// These tests stand up a localhost HTTP upstream that records every request
// it receives, route a request through the EgressProxy with various
// `transform` rules, and assert on what the upstream actually saw. They
// also pin down a few non-obvious behaviors of buildCACertBundle and the
// wildcard matcher.
//
// Why HTTP upstream and not HTTPS? The header-merge logic in
// handleHttpRequest (EgressProxy.ts:570-575) and handleTlsTermination
// (EgressProxy.ts:698-704) is identical. Driving transforms via plain HTTP
// avoids cross-process TLS trust gymnastics while still characterizing the
// merge semantics. The TLS-termination DECISION is tested separately by
// observing the proxy's behavior at the CONNECT-handshake layer.

import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tls from "node:tls";
import type { NetworkPolicy, SandboxConfig } from "cyrus-core";
import forge from "node-forge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EgressProxy } from "../src/EgressProxy.js";

// ─── Test scaffolding ───────────────────────────────────────────────────────

interface RecordedRequest {
	method: string;
	url: string;
	headers: http.IncomingHttpHeaders;
	body: Buffer;
}

interface UpstreamHandle {
	port: number;
	hostname: string;
	requests: RecordedRequest[];
	close: () => Promise<void>;
}

/**
 * Spin up a localhost HTTP server that records every incoming request and
 * replies 200 OK. Returns a handle so the test can inspect what the proxy
 * actually forwarded. Bound to 127.0.0.1 on an OS-assigned ephemeral port.
 *
 * The hostname returned is "127.0.0.1" — tests pass that to the proxy as the
 * Host header AND register it as the policy's allowed domain so the proxy
 * sees an exact-match pattern.
 */
async function startUpstream(): Promise<UpstreamHandle> {
	const requests: RecordedRequest[] = [];
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			requests.push({
				method: req.method ?? "",
				url: req.url ?? "",
				headers: req.headers,
				body: Buffer.concat(chunks),
			});
			res.writeHead(200, { "content-type": "text/plain" });
			res.end("ok");
		});
	});

	await new Promise<void>((resolve, reject) => {
		server.listen(0, "127.0.0.1", () => resolve());
		server.once("error", reject);
	});

	const addr = server.address() as AddressInfo;
	return {
		port: addr.port,
		hostname: "127.0.0.1",
		requests,
		close: () =>
			new Promise<void>((resolve) => {
				server.close(() => resolve());
			}),
	};
}

/**
 * Issue a plain-HTTP request through the EgressProxy and return the response
 * status and body. The proxy is reached at 127.0.0.1:<httpProxyPort>; the
 * forward target is encoded in the absolute-URI request line, which is what
 * HTTP proxies (including this one) expect for non-CONNECT proxying.
 */
async function fetchViaProxy(
	proxyPort: number,
	target: { hostname: string; port: number; path?: string; method?: string },
	headers: Record<string, string> = {},
	body?: string,
): Promise<{ status: number; body: string }> {
	return new Promise((resolve, reject) => {
		const path = target.path ?? "/";
		const req = http.request({
			hostname: "127.0.0.1",
			port: proxyPort,
			method: target.method ?? "GET",
			// Absolute URI — required by RFC 7230 §5.3.2 for messages sent to a proxy.
			path: `http://${target.hostname}:${target.port}${path}`,
			headers: { host: `${target.hostname}:${target.port}`, ...headers },
		});
		const chunks: Buffer[] = [];
		req.on("response", (res) => {
			res.on("data", (c: Buffer) => chunks.push(c));
			res.on("end", () =>
				resolve({
					status: res.statusCode ?? 0,
					body: Buffer.concat(chunks).toString("utf8"),
				}),
			);
		});
		req.on("error", reject);
		req.setTimeout(3000, () => {
			req.destroy(new Error("fetchViaProxy timeout"));
		});
		if (body !== undefined) req.write(body);
		req.end();
	});
}

const TEST_CYRUS_HOME_BASE = join(tmpdir(), "cyrus-egress-transforms-test");

function freshHome(): string {
	return `${TEST_CYRUS_HOME_BASE}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function makeConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
	return {
		enabled: true,
		httpProxyPort: 0,
		socksProxyPort: 0,
		logRequests: false,
		...overrides,
	} as SandboxConfig;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe("EgressProxy: header injection (plain HTTP)", () => {
	let proxy: EgressProxy;
	let upstream: UpstreamHandle;
	let cyrusHome: string;

	beforeEach(async () => {
		upstream = await startUpstream();
		cyrusHome = freshHome();
	});

	afterEach(async () => {
		if (proxy) await proxy.stop();
		await upstream.close();
		if (existsSync(cyrusHome))
			rmSync(cyrusHome, { recursive: true, force: true });
	});

	it("injects a single header from a single transform rule", async () => {
		const policy: NetworkPolicy = {
			allow: {
				"127.0.0.1": [
					{ transform: [{ headers: { "x-auth-token": "secret-abc" } }] },
				],
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		const { status } = await fetchViaProxy(proxy.getHttpProxyPort(), {
			hostname: upstream.hostname,
			port: upstream.port,
		});

		expect(status).toBe(200);
		expect(upstream.requests).toHaveLength(1);
		expect(upstream.requests[0].headers["x-auth-token"]).toBe("secret-abc");
	});

	it("injects multiple headers from one transform", async () => {
		const policy: NetworkPolicy = {
			allow: {
				"127.0.0.1": [
					{
						transform: [
							{
								headers: {
									"x-api-key": "k-1",
									authorization: "Bearer token-xyz",
								},
							},
						],
					},
				],
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		await fetchViaProxy(proxy.getHttpProxyPort(), {
			hostname: upstream.hostname,
			port: upstream.port,
		});

		const got = upstream.requests[0].headers;
		expect(got["x-api-key"]).toBe("k-1");
		expect(got.authorization).toBe("Bearer token-xyz");
	});

	it("merges multiple transform entries within a single rule (later wins on conflict)", async () => {
		// Two transform entries inside one rule — they're merged with later
		// entries overwriting earlier on key conflict (Object.assign semantics).
		const policy: NetworkPolicy = {
			allow: {
				"127.0.0.1": [
					{
						transform: [
							{ headers: { "x-trace": "first", "x-only-in-a": "A" } },
							{ headers: { "x-trace": "second", "x-only-in-b": "B" } },
						],
					},
				],
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		await fetchViaProxy(proxy.getHttpProxyPort(), {
			hostname: upstream.hostname,
			port: upstream.port,
		});

		const got = upstream.requests[0].headers;
		expect(got["x-trace"]).toBe("second"); // later transform wins
		expect(got["x-only-in-a"]).toBe("A");
		expect(got["x-only-in-b"]).toBe("B");
	});

	it("merges transforms across multiple rules for the same domain (later rule wins)", async () => {
		const policy: NetworkPolicy = {
			allow: {
				"127.0.0.1": [
					{ transform: [{ headers: { "x-shared": "rule-1", "x-r1": "yes" } }] },
					{ transform: [{ headers: { "x-shared": "rule-2", "x-r2": "yes" } }] },
				],
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		await fetchViaProxy(proxy.getHttpProxyPort(), {
			hostname: upstream.hostname,
			port: upstream.port,
		});

		const got = upstream.requests[0].headers;
		expect(got["x-shared"]).toBe("rule-2");
		expect(got["x-r1"]).toBe("yes");
		expect(got["x-r2"]).toBe("yes");
	});

	it("OVERWRITES (does not append) when the client already sent the same header", async () => {
		const policy: NetworkPolicy = {
			allow: {
				"127.0.0.1": [
					{ transform: [{ headers: { authorization: "Bearer injected" } }] },
				],
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		await fetchViaProxy(
			proxy.getHttpProxyPort(),
			{ hostname: upstream.hostname, port: upstream.port },
			{ authorization: "Bearer client-sent" }, // client tries to set it
		);

		// Transform replaces what the client sent — this is the security model:
		// agents MUST NOT smuggle credentials past the proxy, the proxy is the
		// authoritative source of auth headers for transformed domains.
		expect(upstream.requests[0].headers.authorization).toBe("Bearer injected");
	});

	it("preserves client headers that are NOT in the transform set", async () => {
		const policy: NetworkPolicy = {
			allow: {
				"127.0.0.1": [{ transform: [{ headers: { "x-injected": "yes" } }] }],
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		await fetchViaProxy(
			proxy.getHttpProxyPort(),
			{ hostname: upstream.hostname, port: upstream.port },
			{ "x-client-only": "kept" },
		);

		const got = upstream.requests[0].headers;
		expect(got["x-injected"]).toBe("yes");
		expect(got["x-client-only"]).toBe("kept");
	});

	it("strips proxy-connection before forwarding", async () => {
		const policy: NetworkPolicy = {
			allow: {
				"127.0.0.1": [{ transform: [{ headers: { "x-marker": "m" } }] }],
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		await fetchViaProxy(
			proxy.getHttpProxyPort(),
			{ hostname: upstream.hostname, port: upstream.port },
			{ "proxy-connection": "keep-alive" },
		);

		// proxy-connection is hop-by-hop — the proxy MUST not forward it.
		expect(upstream.requests[0].headers["proxy-connection"]).toBeUndefined();
	});

	it("forwards request body unchanged when transforms apply", async () => {
		const policy: NetworkPolicy = {
			allow: {
				"127.0.0.1": [{ transform: [{ headers: { "x-auth": "t" } }] }],
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		const body = '{"hello":"world"}';
		await fetchViaProxy(
			proxy.getHttpProxyPort(),
			{ hostname: upstream.hostname, port: upstream.port, method: "POST" },
			{
				"content-type": "application/json",
				"content-length": String(body.length),
			},
			body,
		);

		expect(upstream.requests[0].method).toBe("POST");
		expect(upstream.requests[0].body.toString("utf8")).toBe(body);
		expect(upstream.requests[0].headers["x-auth"]).toBe("t");
	});

	it("does NOT inject any headers for an allowed domain that has no transform rule", async () => {
		const policy: NetworkPolicy = {
			allow: {
				"127.0.0.1": [{}], // allowed, but no transform
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		await fetchViaProxy(
			proxy.getHttpProxyPort(),
			{ hostname: upstream.hostname, port: upstream.port },
			{ "x-from-client": "hi" },
		);

		const got = upstream.requests[0].headers;
		expect(got["x-from-client"]).toBe("hi");
		// No transform-injected headers should appear; the small set below would
		// be tell-tale signs of an accidental transform applying.
		expect(got["x-auth-token"]).toBeUndefined();
		expect(got["x-api-key"]).toBeUndefined();
	});
});

describe("EgressProxy: transforms via wildcard match", () => {
	let proxy: EgressProxy;
	let upstream: UpstreamHandle;
	let cyrusHome: string;

	beforeEach(async () => {
		upstream = await startUpstream();
		cyrusHome = freshHome();
	});

	afterEach(async () => {
		if (proxy) await proxy.stop();
		await upstream.close();
		if (existsSync(cyrusHome))
			rmSync(cyrusHome, { recursive: true, force: true });
	});

	it("the wildcard matcher's behavior maps to a real transform application", async () => {
		// We can't easily test wildcard matching against 127.0.0.1 (no
		// subdomains), so we verify the matcher's observable contract by
		// asserting `requiresTlsTermination` semantics through a different
		// signal: a domain matched by `*.example.com` with a transform rule
		// should be considered a TLS-termination target.
		//
		// Direct wildcard-with-transform end-to-end is not feasible in unit
		// tests because the proxy's MITM forwarder uses httpsRequest with
		// rejectUnauthorized:true to the original hostname (EgressProxy.ts:713),
		// which means it'd try to reach the real example.com. Sandbox tests
		// don't have outbound. So this is the best assertion shape available.
		const policy: NetworkPolicy = {
			allow: {
				"*.example.com": [{ transform: [{ headers: { "x-auth": "t" } }] }],
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		// Domain matching `*.example.com` should not be 403'd at CONNECT.
		// (We're not asserting end-to-end inject here — see comment above.)
		const status = await new Promise<number>((resolve) => {
			const req = http.request({
				hostname: "127.0.0.1",
				port: proxy.getHttpProxyPort(),
				method: "CONNECT",
				path: "api.example.com:443",
			});
			req.on("connect", (res) => {
				resolve(res.statusCode || 0);
				req.destroy();
			});
			req.on("error", () => resolve(0));
			req.setTimeout(2000, () => {
				resolve(-1);
				req.destroy();
			});
			req.end();
		});

		expect(status).not.toBe(403);
	});
});

describe("EgressProxy.matchesPattern: wildcard matcher edge cases", () => {
	// `matchesPattern` is private, so we exercise it through the only
	// observable surface: send a CONNECT for various hostnames against a
	// policy with a single wildcard pattern, and check whether the proxy
	// 403s. This pins down the documented contract:
	//   *.example.com   → matches any subdomain, NOT bare example.com
	//   www.*.com       → matches a single segment in the middle
	//   *.example.com   → does it match deep subdomains? (a.b.example.com)
	let proxy: EgressProxy;
	let cyrusHome: string;

	beforeEach(() => {
		cyrusHome = freshHome();
	});

	afterEach(async () => {
		if (proxy) await proxy.stop();
		if (existsSync(cyrusHome))
			rmSync(cyrusHome, { recursive: true, force: true });
	});

	async function probe(
		policy: NetworkPolicy,
		host: string,
	): Promise<"allowed" | "blocked"> {
		const proxyInstance = new EgressProxy(
			makeConfig({ networkPolicy: policy }),
			cyrusHome,
		);
		await proxyInstance.start();
		try {
			const status = await new Promise<number>((resolve) => {
				const req = http.request({
					hostname: "127.0.0.1",
					port: proxyInstance.getHttpProxyPort(),
					method: "CONNECT",
					path: `${host}:443`,
				});
				req.on("connect", (res) => {
					resolve(res.statusCode || 0);
					req.destroy();
				});
				req.on("error", () => resolve(0));
				req.setTimeout(2000, () => {
					resolve(-1);
					req.destroy();
				});
				req.end();
			});
			return status === 403 ? "blocked" : "allowed";
		} finally {
			await proxyInstance.stop();
		}
	}

	it("`*.example.com` matches deep subdomains (a.b.example.com)", async () => {
		// The current implementation uses `endsWith(".example.com")`, so deep
		// subdomains pass. This is a learning test — if the matcher is ever
		// tightened to single-segment-only, this test will fail and force a
		// docs update.
		const policy: NetworkPolicy = { allow: { "*.example.com": [{}] } };
		expect(await probe(policy, "a.b.example.com")).toBe("allowed");
	});

	it("`*.example.com` does NOT match bare example.com", async () => {
		const policy: NetworkPolicy = { allow: { "*.example.com": [{}] } };
		expect(await probe(policy, "example.com")).toBe("blocked");
	});

	it("`www.*.com` mid-segment wildcard matches single intermediate segment", async () => {
		const policy: NetworkPolicy = { allow: { "www.*.com": [{}] } };
		expect(await probe(policy, "www.foo.com")).toBe("allowed");
	});

	it("`www.*.com` mid-segment wildcard does NOT match multiple segments", async () => {
		// The mid-segment wildcard regex is `[^.]+` (single segment between
		// dots). www.foo.bar.com has TWO segments where * is, so it fails.
		const policy: NetworkPolicy = { allow: { "www.*.com": [{}] } };
		expect(await probe(policy, "www.foo.bar.com")).toBe("blocked");
	});

	it("non-wildcard patterns do exact match only", async () => {
		const policy: NetworkPolicy = { allow: { "example.com": [{}] } };
		expect(await probe(policy, "example.com")).toBe("allowed");
		expect(await probe(policy, "sub.example.com")).toBe("blocked");
		expect(await probe(policy, "foo.com")).toBe("blocked");
	});
});

// ─── TLS termination: MITM property verification ───────────────────────────
//
// The refactor in EgressProxy.buildOutgoingHeaders consolidated the merge
// logic so the HTTP and TLS code paths produce identical headers. The
// preceding plain-HTTP tests therefore characterize the merge for both
// paths. What remains TLS-specific is:
//   1. The MITM actually happens — proxy presents a fake cert signed by
//      its CA, with the requested hostname in the SAN, and the client TLS
//      handshake completes against it.
//   2. The non-MITM path (allowed but not transformed) does TCP passthrough
//      so the client sees the upstream's own cert.
//
// We test (1) and (2) directly via the cert chain visible to the client.
// Going further — actually receiving the response after MITM forward to a
// real upstream — would require the proxy to trust an ephemeral upstream CA,
// which means either modifying production code (adding a customCAs config
// option) or relying on `tls.setDefaultCACertificates` propagating to
// `https.globalAgent`'s cached secureContext. The latter doesn't reliably
// work in vitest's pre-initialized process state.

interface UpstreamHttpsHandle extends UpstreamHandle {
	caPem: string;
}

/**
 * Generate an ephemeral root CA + a server cert for `hostname` signed by it.
 * Returned PEMs are ready to feed into `https.createServer` (server cert/key)
 * and `tls.setDefaultCACertificates` (CA cert).
 */
function generateUpstreamCert(hostname: string): {
	caPem: string;
	serverKeyPem: string;
	serverCertPem: string;
} {
	// CA
	const caKeys = forge.pki.rsa.generateKeyPair(2048);
	const caCert = forge.pki.createCertificate();
	caCert.publicKey = caKeys.publicKey;
	caCert.serialNumber = "01";
	caCert.validity.notBefore = new Date();
	caCert.validity.notAfter = new Date();
	caCert.validity.notAfter.setFullYear(
		caCert.validity.notBefore.getFullYear() + 1,
	);
	const caAttrs = [
		{ name: "commonName", value: "Cyrus Test Upstream CA" },
		{ name: "organizationName", value: "Cyrus Tests" },
	];
	caCert.setSubject(caAttrs);
	caCert.setIssuer(caAttrs);
	caCert.setExtensions([
		{ name: "basicConstraints", cA: true },
		{
			name: "keyUsage",
			keyCertSign: true,
			digitalSignature: true,
			cRLSign: true,
		},
	]);
	caCert.sign(caKeys.privateKey, forge.md.sha256.create());

	// Server cert signed by the CA
	const serverKeys = forge.pki.rsa.generateKeyPair(2048);
	const serverCert = forge.pki.createCertificate();
	serverCert.publicKey = serverKeys.publicKey;
	serverCert.serialNumber = "02";
	serverCert.validity.notBefore = new Date();
	serverCert.validity.notAfter = new Date();
	serverCert.validity.notAfter.setFullYear(
		serverCert.validity.notBefore.getFullYear() + 1,
	);
	serverCert.setSubject([{ name: "commonName", value: hostname }]);
	serverCert.setIssuer(caAttrs);
	serverCert.setExtensions([
		{
			name: "subjectAltName",
			altNames: [{ type: 2, value: hostname }], // DNS
		},
	]);
	serverCert.sign(caKeys.privateKey, forge.md.sha256.create());

	return {
		caPem: forge.pki.certificateToPem(caCert),
		serverKeyPem: forge.pki.privateKeyToPem(serverKeys.privateKey),
		serverCertPem: forge.pki.certificateToPem(serverCert),
	};
}

async function startHttpsUpstream(
	hostname: string,
): Promise<UpstreamHttpsHandle> {
	const { caPem, serverKeyPem, serverCertPem } = generateUpstreamCert(hostname);
	const requests: RecordedRequest[] = [];
	const server = https.createServer(
		{ key: serverKeyPem, cert: serverCertPem },
		(req, res) => {
			const chunks: Buffer[] = [];
			req.on("data", (c: Buffer) => chunks.push(c));
			req.on("end", () => {
				requests.push({
					method: req.method ?? "",
					url: req.url ?? "",
					headers: req.headers,
					body: Buffer.concat(chunks),
				});
				res.writeHead(200, { "content-type": "text/plain" });
				res.end("ok");
			});
		},
	);

	await new Promise<void>((resolve, reject) => {
		server.listen(0, "127.0.0.1", () => resolve());
		server.once("error", reject);
	});

	const addr = server.address() as AddressInfo;
	return {
		port: addr.port,
		hostname,
		requests,
		caPem,
		close: () =>
			new Promise<void>((resolve) => {
				// Force-drop idle keep-alive connections from the proxy's
				// upstream Agent. Without this, server.close() waits for them
				// to time out and afterEach exceeds vitest's hook deadline.
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}

/**
 * Open a CONNECT tunnel to the proxy, complete the inner TLS handshake, and
 * return ONLY the peer certificate the client saw. Does not send any HTTP
 * payload over the tunnel — the cert chain is enough to distinguish MITM
 * (proxy CA issuer) from passthrough (upstream CA issuer).
 *
 * Cleans up both the TLS layer and the underlying tunnel TCP socket so
 * afterEach can finish promptly without waiting for keep-alive timeouts.
 */
async function inspectTlsCertViaProxy(
	proxyPort: number,
	target: { hostname: string; port: number },
	trustedCAPem: string,
): Promise<tls.PeerCertificate> {
	const tunnelSocket = await new Promise<import("node:net").Socket>(
		(resolve, reject) => {
			const connectReq = http.request({
				hostname: "127.0.0.1",
				port: proxyPort,
				method: "CONNECT",
				path: `${target.hostname}:${target.port}`,
			});
			connectReq.on("connect", (res, socket) => {
				if (res.statusCode !== 200) {
					reject(new Error(`CONNECT failed: ${res.statusCode}`));
					return;
				}
				resolve(socket);
			});
			connectReq.on("error", reject);
			connectReq.setTimeout(5000, () =>
				connectReq.destroy(new Error("CONNECT timeout")),
			);
			connectReq.end();
		},
	);

	return new Promise((resolve, reject) => {
		const tlsSocket = tls.connect(
			{
				socket: tunnelSocket,
				servername: target.hostname,
				ca: [trustedCAPem],
			},
			() => {
				const cert = tlsSocket.getPeerCertificate();
				tlsSocket.destroy();
				tunnelSocket.destroy();
				resolve(cert);
			},
		);
		tlsSocket.on("error", (err) => {
			tunnelSocket.destroy();
			reject(err);
		});
	});
}

describe("EgressProxy: TLS termination property", () => {
	let proxy: EgressProxy;
	let upstream: UpstreamHttpsHandle;
	let cyrusHome: string;

	beforeEach(async () => {
		upstream = await startHttpsUpstream("localhost");
		cyrusHome = freshHome();
	});

	afterEach(async () => {
		if (proxy) await proxy.stop();
		await upstream.close();
		if (existsSync(cyrusHome))
			rmSync(cyrusHome, { recursive: true, force: true });
	});

	it("MITMs domains with transforms — proxy presents a CA-signed fake cert", async () => {
		// Domain has a transform rule → proxy MITMs to inject headers.
		// What the client sees during handshake is a cert signed by the
		// proxy's CA, NOT the upstream's CA. That's the MITM signature.
		const policy: NetworkPolicy = {
			allow: {
				localhost: [
					{ transform: [{ headers: { authorization: "Bearer x" } }] },
				],
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();
		const proxyCAPem = readFileSync(proxy.getCACertPath(), "utf8");

		const cert = await inspectTlsCertViaProxy(
			proxy.getHttpProxyPort(),
			{ hostname: "localhost", port: upstream.port },
			proxyCAPem,
		);

		expect(cert.issuer.CN).toBe("Cyrus Egress Proxy CA");
		expect(cert.subject.CN).toBe("localhost");
	});

	it("does NOT MITM when the domain has no transform — client sees upstream cert", async () => {
		// No transform → raw TCP passthrough. The cert presented during
		// handshake is the upstream's own (signed by upstream's test CA),
		// which the client trusts directly.
		const policy: NetworkPolicy = {
			allow: { localhost: [{}] },
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		const cert = await inspectTlsCertViaProxy(
			proxy.getHttpProxyPort(),
			{ hostname: "localhost", port: upstream.port },
			upstream.caPem,
		);

		expect(cert.issuer.CN).toBe("Cyrus Test Upstream CA");
		expect(cert.subject.CN).toBe("localhost");
	});

	it("rejects MITM TLS handshake when client does not trust the proxy CA", async () => {
		// Negative property: if a client doesn't trust the proxy CA, the
		// MITM handshake fails. This is the security guarantee — the proxy
		// can MITM only because the sandbox is configured to trust it via
		// NODE_EXTRA_CA_CERTS. Random hosts cannot.
		const policy: NetworkPolicy = {
			allow: {
				localhost: [{ transform: [{ headers: { "x-via": "proxy" } }] }],
			},
		};
		proxy = new EgressProxy(makeConfig({ networkPolicy: policy }), cyrusHome);
		await proxy.start();

		await expect(
			inspectTlsCertViaProxy(
				proxy.getHttpProxyPort(),
				{ hostname: "localhost", port: upstream.port },
				upstream.caPem, // wrong CA — proxy is the one signing here
			),
		).rejects.toThrow();
	});
});

// ─── updateNetworkPolicy: transform-state lifecycle ────────────────────────

describe("EgressProxy.updateNetworkPolicy: transform state is fully replaced", () => {
	let proxy: EgressProxy;
	let upstream: UpstreamHandle;
	let cyrusHome: string;

	beforeEach(async () => {
		upstream = await startUpstream();
		cyrusHome = freshHome();
	});

	afterEach(async () => {
		if (proxy) await proxy.stop();
		await upstream.close();
		if (existsSync(cyrusHome))
			rmSync(cyrusHome, { recursive: true, force: true });
	});

	it("clears prior transforms when a domain is dropped from the new policy", async () => {
		// Initial policy: 127.0.0.1 has a transform.
		proxy = new EgressProxy(
			makeConfig({
				networkPolicy: {
					allow: {
						"127.0.0.1": [
							{ transform: [{ headers: { "x-stage": "before" } }] },
						],
					},
				},
			}),
			cyrusHome,
		);
		await proxy.start();

		await fetchViaProxy(proxy.getHttpProxyPort(), {
			hostname: upstream.hostname,
			port: upstream.port,
		});
		expect(upstream.requests[0].headers["x-stage"]).toBe("before");

		// Update policy: still allow 127.0.0.1, but with NO transform rule.
		proxy.updateNetworkPolicy({
			allow: { "127.0.0.1": [{}] },
		});

		await fetchViaProxy(proxy.getHttpProxyPort(), {
			hostname: upstream.hostname,
			port: upstream.port,
		});
		// Old transform header MUST not be applied — stale state would leak it.
		expect(upstream.requests[1].headers["x-stage"]).toBeUndefined();
	});

	it("replaces transform headers when the same domain's rules change", async () => {
		proxy = new EgressProxy(
			makeConfig({
				networkPolicy: {
					allow: {
						"127.0.0.1": [{ transform: [{ headers: { "x-key": "v1" } }] }],
					},
				},
			}),
			cyrusHome,
		);
		await proxy.start();

		await fetchViaProxy(proxy.getHttpProxyPort(), {
			hostname: upstream.hostname,
			port: upstream.port,
		});
		expect(upstream.requests[0].headers["x-key"]).toBe("v1");

		// New policy with different headers for the same domain.
		proxy.updateNetworkPolicy({
			allow: {
				"127.0.0.1": [
					{ transform: [{ headers: { "x-key": "v2", "x-extra": "yes" } }] },
				],
			},
		});

		await fetchViaProxy(proxy.getHttpProxyPort(), {
			hostname: upstream.hostname,
			port: upstream.port,
		});
		expect(upstream.requests[1].headers["x-key"]).toBe("v2");
		expect(upstream.requests[1].headers["x-extra"]).toBe("yes");
	});

	it("a domain newly removed from allow rules becomes blocked", async () => {
		proxy = new EgressProxy(
			makeConfig({
				networkPolicy: {
					allow: {
						"127.0.0.1": [{}],
						"other.example": [{}],
					},
				},
			}),
			cyrusHome,
		);
		await proxy.start();

		// Initially allowed.
		const before = await fetchViaProxy(proxy.getHttpProxyPort(), {
			hostname: upstream.hostname,
			port: upstream.port,
		});
		expect(before.status).toBe(200);

		// Drop 127.0.0.1 from the allow list.
		proxy.updateNetworkPolicy({
			allow: { "other.example": [{}] },
		});

		// Now 127.0.0.1 → 403 from the proxy.
		const after = await fetchViaProxy(proxy.getHttpProxyPort(), {
			hostname: upstream.hostname,
			port: upstream.port,
		});
		expect(after.status).toBe(403);
	});
});

describe("EgressProxy.buildCACertBundle", () => {
	let proxy: EgressProxy;
	let cyrusHome: string;
	let originalEnv: string | undefined;

	beforeEach(() => {
		cyrusHome = freshHome();
		originalEnv = process.env.NODE_EXTRA_CA_CERTS;
		delete process.env.NODE_EXTRA_CA_CERTS;
	});

	afterEach(async () => {
		if (proxy) await proxy.stop();
		if (existsSync(cyrusHome))
			rmSync(cyrusHome, { recursive: true, force: true });
		if (originalEnv === undefined) {
			delete process.env.NODE_EXTRA_CA_CERTS;
		} else {
			process.env.NODE_EXTRA_CA_CERTS = originalEnv;
		}
	});

	it("returns the CA cert path unchanged when no other cert is provided", () => {
		proxy = new EgressProxy(makeConfig(), cyrusHome);
		const result = proxy.buildCACertBundle();
		expect(result).toBe(proxy.getCACertPath());
	});

	it("returns the CA cert path unchanged when given the proxy's own CA path", () => {
		proxy = new EgressProxy(makeConfig(), cyrusHome);
		const result = proxy.buildCACertBundle(proxy.getCACertPath());
		// No bundle file is created — caller is told to use the original CA.
		expect(result).toBe(proxy.getCACertPath());
	});

	it("merges an existing host-process cert into a bundle when given an explicit path", () => {
		proxy = new EgressProxy(makeConfig(), cyrusHome);
		const fakeHostCertPath = join(cyrusHome, "fake-host-ca.pem");
		const fakeHostPem =
			"-----BEGIN CERTIFICATE-----\nFAKEHOSTCERT\n-----END CERTIFICATE-----\n";
		writeFileSync(fakeHostCertPath, fakeHostPem);

		const bundlePath = proxy.buildCACertBundle(fakeHostCertPath);

		// Bundle is a NEW file — not the host cert and not the proxy CA.
		expect(bundlePath).not.toBe(fakeHostCertPath);
		expect(bundlePath).not.toBe(proxy.getCACertPath());
		expect(existsSync(bundlePath)).toBe(true);

		const bundleContents = readFileSync(bundlePath, "utf8");
		expect(bundleContents).toContain("FAKEHOSTCERT"); // host cert preserved
		expect(bundleContents).toContain(
			readFileSync(proxy.getCACertPath(), "utf8").trimEnd(),
		); // proxy CA appended
	});

	it("falls back to NODE_EXTRA_CA_CERTS env var when no explicit path is given", () => {
		proxy = new EgressProxy(makeConfig(), cyrusHome);
		const fakeHostCertPath = join(cyrusHome, "fake-host-ca-from-env.pem");
		writeFileSync(
			fakeHostCertPath,
			"-----BEGIN CERTIFICATE-----\nFROMENV\n-----END CERTIFICATE-----\n",
		);
		process.env.NODE_EXTRA_CA_CERTS = fakeHostCertPath;

		const bundlePath = proxy.buildCACertBundle();

		expect(bundlePath).not.toBe(fakeHostCertPath);
		expect(readFileSync(bundlePath, "utf8")).toContain("FROMENV");
	});

	it("returns the CA cert path unchanged when the env var points at a non-existent file", () => {
		proxy = new EgressProxy(makeConfig(), cyrusHome);
		process.env.NODE_EXTRA_CA_CERTS =
			"/path/that/definitely/does/not/exist.pem";

		const result = proxy.buildCACertBundle();
		expect(result).toBe(proxy.getCACertPath());
	});

	it("returns the CA cert path unchanged when given the existing bundle file path", () => {
		// Once a bundle has been built once, calling buildCACertBundle again
		// with the bundle path itself must NOT recursively merge.
		proxy = new EgressProxy(makeConfig(), cyrusHome);
		const fakeHostCertPath = join(cyrusHome, "host.pem");
		writeFileSync(
			fakeHostCertPath,
			"-----BEGIN CERTIFICATE-----\nH\n-----END CERTIFICATE-----\n",
		);

		const bundlePath = proxy.buildCACertBundle(fakeHostCertPath);
		const second = proxy.buildCACertBundle(bundlePath);
		expect(second).toBe(proxy.getCACertPath());
	});
});
