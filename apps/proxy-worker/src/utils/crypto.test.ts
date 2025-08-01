import { TokenEncryption } from "./crypto";
import type { OAuthToken } from "../types";
import { describe, it, expect } from "vitest";

describe("TokenEncryption", () => {
  const crypto = new TokenEncryption("test-encryption-key-32-chars-long");

  it("should encrypt and decrypt tokens correctly", async () => {
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

    const encrypted = await crypto.encryptToken(originalToken);
    const decrypted = await crypto.decryptToken(encrypted);
    expect(decrypted.accessToken).toBe(originalToken.accessToken);
  });

  it("should hash tokens correctly", async () => {
    const hash1 = await crypto.hashToken("test-token");
    const hash2 = await crypto.hashToken("test-token");
    const hash3 = await crypto.hashToken("different-token");
    expect(hash1).toBe(hash2);
    expect(hash1).not.toBe(hash3);
  });
});
