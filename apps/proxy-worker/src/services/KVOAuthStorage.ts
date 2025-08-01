import type { EncryptedOAuthToken, OAuthToken } from "../types";
import { TokenEncryption } from "../utils/crypto";

export interface OAuthTokenStorage {
	saveToken(workspaceId: string, tokenData: OAuthToken): Promise<void>;
	getToken(workspaceId: string): Promise<OAuthToken | null>;
	deleteToken(workspaceId: string): Promise<void>;
	refreshToken?(workspaceId: string): Promise<OAuthToken>;
}

export class KVOAuthStorage implements OAuthTokenStorage {
	private crypto: TokenEncryption;

	constructor(
		private kv: KVNamespace,
		encryptionKey: string,
	) {
		this.crypto = new TokenEncryption(encryptionKey);
	}

	/**
	 * Save an OAuth token to KV
	 */
	async saveToken(workspaceId: string, tokenData: OAuthToken): Promise<void> {
		// Encrypt sensitive data
		const encrypted = await this.crypto.encryptToken(tokenData);

		// Calculate TTL based on expiration
		const ttl = tokenData.expiresAt
			? Math.max(1, Math.floor((tokenData.expiresAt - Date.now()) / 1000))
			: undefined;

		// Store in KV
		await this.kv.put(`oauth:token:${workspaceId}`, JSON.stringify(encrypted), {
			expirationTtl: ttl,
		});
	}

	/**
	 * Get an OAuth token from KV
	 */
	async getToken(workspaceId: string): Promise<OAuthToken | null> {
		const data = await this.kv.get(`oauth:token:${workspaceId}`);
		if (!data) return null;

		try {
			const encrypted: EncryptedOAuthToken = JSON.parse(data);
			return await this.crypto.decryptToken(encrypted);
		} catch (error) {
			console.error("Failed to decrypt token:", error);
			// Token might be corrupted, delete it
			await this.deleteToken(workspaceId);
			return null;
		}
	}

	/**
	 * Delete an OAuth token
	 */
	async deleteToken(workspaceId: string): Promise<void> {
		await this.kv.delete(`oauth:token:${workspaceId}`);
	}

	/**
	 * Refresh an OAuth token (to be implemented with Linear API)
	 */
	async refreshToken(workspaceId: string): Promise<OAuthToken> {
		const currentToken = await this.getToken(workspaceId);
		if (!currentToken) {
			throw new Error("No token found to refresh");
		}

		if (!currentToken.refreshToken) {
			throw new Error("No refresh token available");
		}

		// TODO: Implement actual refresh logic with Linear API
		// For now, throw an error
		throw new Error("Token refresh not yet implemented");
	}
}
