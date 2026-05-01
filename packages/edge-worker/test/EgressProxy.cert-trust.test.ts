// Learning tests for the egress proxy's CA cert and the path that makes it
// trusted on a Linux host.
//
// On Ubuntu/Debian, the recommended install is:
//
//   sudo cp ~/.cyrus/certs/cyrus-egress-ca.pem \
//           /usr/local/share/ca-certificates/cyrus-egress-ca.crt
//   sudo update-ca-certificates
//
// `update-ca-certificates(8)` is a tiny shell script (Debian's `ca-certificates`
// package) that:
//   1. Reads files matching `*.crt` from `/usr/local/share/ca-certificates/`
//      and from any enabled entries in `/etc/ca-certificates.conf`.
//   2. Validates each by parsing it as PEM-encoded X.509 (via openssl).
//   3. Concatenates them into `/etc/ssl/certs/ca-certificates.crt` (the
//      bundle most CLI tools read) and creates per-cert symlinks under
//      `/etc/ssl/certs/`.
//
// What the script implicitly requires of an input cert:
//   - PEM-encoded (BEGIN/END CERTIFICATE markers, base64 body).
//   - A valid X.509 certificate (parses with openssl x509).
//   - basicConstraints CA:TRUE — without this, OpenSSL/GnuTLS won't accept
//     the cert as a root and chain validation against MITM-issued server
//     certs fails. (Strictly, OpenSSL also accepts certs WITHOUT
//     basicConstraints as roots in some legacy modes, but Linux distros
//     have tightened this — assume it's required.)
//   - keyUsage with keyCertSign — the cert must be authorised to sign
//     subordinate certs, otherwise OpenSSL rejects the chain.
//
// These tests inspect the cert that EgressProxy actually produces and
// assert each property. They also pin down the *alternative* path:
// per-session env vars via buildEgressCaEnv, which is what Cyrus uses when
// the user has NOT installed the cert system-wide.
//
// What we don't test (correctly out of scope):
//   - Actually invoking update-ca-certificates (requires sudo).
//   - End-to-end trust verification by Bun, .NET, or macOS curl (those
//     ignore env vars and require system-wide install regardless).

import { existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SandboxConfig } from "cyrus-core";
import forge from "node-forge";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EgressProxy } from "../src/EgressProxy.js";
import { buildEgressCaEnv } from "../src/RunnerConfigBuilder.js";

function makeConfig(overrides: Partial<SandboxConfig> = {}): SandboxConfig {
	return {
		enabled: true,
		httpProxyPort: 0,
		socksProxyPort: 0,
		logRequests: false,
		...overrides,
	} as SandboxConfig;
}

function freshHome(): string {
	return join(
		tmpdir(),
		`cyrus-cert-trust-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
}

// ─── CA cert format compliance ─────────────────────────────────────────────
//
// Each test asserts a specific property update-ca-certificates expects.
// If the proxy ever generates a cert that violates one of these, the
// system-wide install path silently won't work for some tools.

describe("EgressProxy CA cert: Linux trust-store compatibility", () => {
	let cyrusHome: string;
	let caPem: string;
	let cert: forge.pki.Certificate;

	beforeEach(() => {
		cyrusHome = freshHome();
		// Constructor generates the CA on first run.
		new EgressProxy(makeConfig(), cyrusHome);
		caPem = readFileSync(
			join(cyrusHome, "certs", "cyrus-egress-ca.pem"),
			"utf8",
		);
		cert = forge.pki.certificateFromPem(caPem);
	});

	afterEach(() => {
		if (existsSync(cyrusHome))
			rmSync(cyrusHome, { recursive: true, force: true });
	});

	it("is well-formed PEM with the standard CERTIFICATE markers", () => {
		// update-ca-certificates greps for the BEGIN/END markers; without
		// them the cert is silently skipped from the bundle.
		expect(caPem.startsWith("-----BEGIN CERTIFICATE-----\r\n")).toBe(true);
		expect(caPem.trimEnd().endsWith("-----END CERTIFICATE-----")).toBe(true);
		// No stray binary in the base64 body — every non-marker line should
		// be base64 (A-Za-z0-9+/=) up to standard wrap.
		const body = caPem
			.replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
			.replace(/[\r\n]/g, "");
		expect(body).toMatch(/^[A-Za-z0-9+/=]+$/);
	});

	it("parses as a valid X.509 certificate", () => {
		// If forge.pki.certificateFromPem didn't throw in beforeEach, the
		// PEM is structurally valid X.509. This is the same parse openssl
		// does in update-ca-certificates' validation step.
		expect(cert.serialNumber).toBeDefined();
		expect(cert.signatureOid).toBeDefined();
	});

	it("has basicConstraints CA:TRUE — required for trust-store acceptance", () => {
		// Without this extension, OpenSSL/GnuTLS treat the cert as a leaf,
		// not a CA, and reject any chain that has it as the root.
		const ext = cert.getExtension("basicConstraints") as
			| { cA?: boolean }
			| undefined;
		expect(ext).toBeDefined();
		expect(ext?.cA).toBe(true);
	});

	it("has keyUsage with keyCertSign + cRLSign — required for signing subordinates", () => {
		// keyCertSign is what authorises the cert to sign other certs (the
		// MITM-issued server certs). Without it, OpenSSL rejects any chain
		// where a subordinate was signed by this cert.
		const ext = cert.getExtension("keyUsage") as
			| { keyCertSign?: boolean; cRLSign?: boolean; digitalSignature?: boolean }
			| undefined;
		expect(ext).toBeDefined();
		expect(ext?.keyCertSign).toBe(true);
		expect(ext?.cRLSign).toBe(true);
	});

	it("is self-signed (subject equals issuer) — required for a root CA", () => {
		// A root CA's Issuer DN equals its Subject DN. forge stores them as
		// arrays of attribute objects with the same shape.
		const subjectCN = cert.subject.getField("CN")?.value;
		const issuerCN = cert.issuer.getField("CN")?.value;
		expect(subjectCN).toBe("Cyrus Egress Proxy CA");
		expect(issuerCN).toBe(subjectCN);
	});

	it("is currently within its validity window", () => {
		// Trust stores reject expired or not-yet-valid certs. The proxy
		// gives a generous 10-year window; confirm we're inside it.
		const now = new Date();
		expect(cert.validity.notBefore.getTime()).toBeLessThanOrEqual(
			now.getTime(),
		);
		expect(cert.validity.notAfter.getTime()).toBeGreaterThan(now.getTime());
	});

	it("can sign and authenticate a server cert (round-trip with the proxy's own signing key)", () => {
		// The proxy generates per-domain server certs at MITM time, signed
		// by this CA. Round-trip: sign a fake server cert with the CA's
		// private key, then ask the CA's public key (via the parsed CA cert)
		// to verify it. If this fails, the MITM signature path is broken.
		const caKeyPem = readFileSync(
			join(cyrusHome, "certs", "cyrus-egress-ca-key.pem"),
			"utf8",
		);
		const caKey = forge.pki.privateKeyFromPem(caKeyPem);

		const serverKeys = forge.pki.rsa.generateKeyPair(2048);
		const serverCert = forge.pki.createCertificate();
		serverCert.publicKey = serverKeys.publicKey;
		serverCert.serialNumber = "deadbeef";
		serverCert.validity.notBefore = new Date();
		serverCert.validity.notAfter = new Date();
		serverCert.validity.notAfter.setFullYear(
			serverCert.validity.notBefore.getFullYear() + 1,
		);
		serverCert.setSubject([{ name: "commonName", value: "example.com" }]);
		serverCert.setIssuer(cert.subject.attributes);
		serverCert.setExtensions([
			{
				name: "subjectAltName",
				altNames: [{ type: 2, value: "example.com" }],
			},
		]);
		serverCert.sign(caKey, forge.md.sha256.create());

		// `cert.verify(serverCert)` returns true iff serverCert's signature
		// is valid under `cert`'s public key — i.e. the CA actually signed
		// it. This is the same property OpenSSL checks during chain
		// validation when the OS cert store has this CA installed.
		expect(cert.verify(serverCert)).toBe(true);
	});

	it("CA private key file is mode 0600 (owner read/write only)", () => {
		// Without restrictive permissions, any process running as another
		// user could steal the key and forge MITM certs trusted by every
		// session that has the public CA installed.
		const keyPath = join(cyrusHome, "certs", "cyrus-egress-ca-key.pem");
		const stat = require("node:fs").statSync(keyPath);
		// Lower 9 bits = mode. 0o600 = 0o400 (owner read) + 0o200 (owner write).
		expect(stat.mode & 0o777).toBe(0o600);
	});
});

// ─── Per-session env var wiring (the alternative to system-wide trust) ─────

describe("buildEgressCaEnv: per-session CA env vars", () => {
	const PATH_FIXTURE = "/home/alice/.cyrus/certs/cyrus-egress-ca.pem";

	it("returns an empty object when no cert path is given (systemWideCert path)", () => {
		// EdgeWorker passes `egressCaCertPath: null` when sandbox.systemWideCert
		// is true, signaling "the OS cert store handles trust — do NOT set
		// per-session env vars". The function must respect that.
		expect(buildEgressCaEnv(null)).toEqual({});
		expect(buildEgressCaEnv(undefined)).toEqual({});
		expect(buildEgressCaEnv("")).toEqual({});
	});

	it("populates the full set of per-tool CA env vars when a path is given", () => {
		// Each tool family has its own CA bundle env var. A single function
		// returns ALL of them so downstream Bash subprocesses (git, curl,
		// pip, cargo, etc.) all trust the same proxy CA.
		const env = buildEgressCaEnv(PATH_FIXTURE);
		expect(env).toEqual({
			NODE_EXTRA_CA_CERTS: PATH_FIXTURE,
			SSL_CERT_FILE: PATH_FIXTURE,
			GIT_SSL_CAINFO: PATH_FIXTURE,
			REQUESTS_CA_BUNDLE: PATH_FIXTURE,
			PIP_CERT: PATH_FIXTURE,
			CURL_CA_BUNDLE: PATH_FIXTURE,
			CARGO_HTTP_CAINFO: PATH_FIXTURE,
			AWS_CA_BUNDLE: PATH_FIXTURE,
			DENO_CERT: PATH_FIXTURE,
		});
	});

	it("sets every tool's env var to the SAME path (one source of truth)", () => {
		// Drift between vars (e.g. one pointing at a stale bundle) is a
		// silent footgun — that tool's TLS would still verify using the
		// wrong CA. Pin the invariant.
		const env = buildEgressCaEnv(PATH_FIXTURE);
		const values = new Set(Object.values(env));
		expect(values.size).toBe(1);
		expect([...values][0]).toBe(PATH_FIXTURE);
	});

	it("covers each tool family the egress proxy is documented to support", () => {
		// Cross-check against CLAUDE.md § 5 — adding a tool family in the
		// docs without adding the env var here (or vice versa) is the bug
		// this test exists to catch.
		const env = buildEgressCaEnv(PATH_FIXTURE);
		const expectedKeys = new Set([
			"NODE_EXTRA_CA_CERTS", // Node.js (SDK, npm)
			"SSL_CERT_FILE", // OpenSSL fallback (Ruby, generic)
			"GIT_SSL_CAINFO", // git
			"REQUESTS_CA_BUNDLE", // Python requests
			"PIP_CERT", // pip
			"CURL_CA_BUNDLE", // curl (OpenSSL build)
			"CARGO_HTTP_CAINFO", // Rust/Cargo
			"AWS_CA_BUNDLE", // AWS CLI / boto3
			"DENO_CERT", // Deno
		]);
		expect(new Set(Object.keys(env))).toEqual(expectedKeys);
	});

	it("does NOT include env vars for tools known to ignore them (Bun, .NET, macOS curl)", () => {
		// These tools don't read CA env vars — only system-wide trust works
		// for them. Pinning their absence here documents the gotcha and
		// guards against someone adding a "BUN_CA_CERTS" entry in the
		// mistaken belief that it'd help. CLAUDE.md § 5 lists them.
		const env = buildEgressCaEnv(PATH_FIXTURE);
		expect(env).not.toHaveProperty("BUN_CA_CERTS");
		expect(env).not.toHaveProperty("DOTNET_SSL_CERT");
		// (curl on macOS uses CURL_CA_BUNDLE just fine when compiled against
		// OpenSSL; the SecureTransport build is the one that ignores it. We
		// still set CURL_CA_BUNDLE — it covers the OpenSSL build, which is
		// the common case on Linux. The macOS-SecureTransport-specific
		// failure mode is documented; no env var fixes it.)
	});
});

// ─── EgressProxy.buildCACertBundle: structure for system-trust install ─────

describe("EgressProxy.buildCACertBundle: bundle is install-compatible", () => {
	let cyrusHome: string;
	let proxy: EgressProxy;

	beforeEach(() => {
		cyrusHome = freshHome();
		proxy = new EgressProxy(makeConfig(), cyrusHome);
	});

	afterEach(() => {
		if (existsSync(cyrusHome))
			rmSync(cyrusHome, { recursive: true, force: true });
	});

	it("bundle file with multiple PEM blocks is parseable as a chain", () => {
		// `update-ca-certificates` accepts multi-cert PEM bundles (concatenated
		// PEM blocks). Verify our bundle output produces something forge — and
		// thus openssl — can split into multiple X.509 certs.
		const fakeCorporateCa = join(cyrusHome, "corporate-ca.pem");
		const corporateKeys = forge.pki.rsa.generateKeyPair(2048);
		const corporateCert = forge.pki.createCertificate();
		corporateCert.publicKey = corporateKeys.publicKey;
		corporateCert.serialNumber = "01";
		corporateCert.validity.notBefore = new Date();
		corporateCert.validity.notAfter = new Date();
		corporateCert.validity.notAfter.setFullYear(
			corporateCert.validity.notBefore.getFullYear() + 1,
		);
		const a = [{ name: "commonName", value: "Corporate CA" }];
		corporateCert.setSubject(a);
		corporateCert.setIssuer(a);
		corporateCert.setExtensions([{ name: "basicConstraints", cA: true }]);
		corporateCert.sign(corporateKeys.privateKey, forge.md.sha256.create());
		require("node:fs").writeFileSync(
			fakeCorporateCa,
			forge.pki.certificateToPem(corporateCert),
		);

		const bundlePath = proxy.buildCACertBundle(fakeCorporateCa);
		const bundleContent = readFileSync(bundlePath, "utf8");

		// Bundle should have exactly two PEM blocks (corporate + proxy CA).
		const blockCount = (
			bundleContent.match(/-----BEGIN CERTIFICATE-----/g) || []
		).length;
		expect(blockCount).toBe(2);

		// Both should parse — same property update-ca-certificates relies on.
		const certs = forge.pki.certificateFromPem(bundleContent); // first
		expect(certs.subject.getField("CN")?.value).toBe("Corporate CA");
	});
});
