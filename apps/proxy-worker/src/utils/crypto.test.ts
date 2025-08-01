import type { OAuthToken } from "../types";
import { TokenEncryption } from "./crypto";

// Simple test to verify encryption/decryption works
async function testEncryption() {
	console.log("Testing token encryption...");

	const crypto = new TokenEncryption("test-encryption-key-32-chars-long");

	const originalToken: OAuthToken = {
		accessToken: "lin_api_test123456789",
		refreshToken: "lin_ref_test987654321",
		expiresAt: Date.now() + 3600000,
		obtainedAt: Date.now(),
		scope: ["read", "write"],
		tokenType: "Bearer",
		userId: "user123",
		userEmail: "test@example.com",
		workspaceName: "Test Workspace",
	};

	// Encrypt
	const encrypted = await crypto.encryptToken(originalToken);
	console.log("Encrypted:", {
		...encrypted,
		accessToken: `${encrypted.accessToken.substring(0, 20)}...`,
		refreshToken: `${encrypted.refreshToken?.substring(0, 20)}...`,
	});

	// Decrypt
	const decrypted = await crypto.decryptToken(encrypted);
	console.log("Decrypted:", {
		...decrypted,
		accessToken: `${decrypted.accessToken.substring(0, 20)}...`,
		refreshToken: `${decrypted.refreshToken?.substring(0, 20)}...`,
	});

	// Verify
	if (decrypted.accessToken === originalToken.accessToken) {
		console.log("✅ Encryption/decryption working correctly!");
	} else {
		console.error("❌ Encryption/decryption failed!");
	}

	// Test hashing
	const hash1 = await crypto.hashToken("test-token");
	const hash2 = await crypto.hashToken("test-token");
	const hash3 = await crypto.hashToken("different-token");

	console.log("Hash consistency:", hash1 === hash2 ? "✅" : "❌");
	console.log("Hash uniqueness:", hash1 !== hash3 ? "✅" : "❌");
}

// Run test if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
	testEncryption().catch(console.error);
}
