import type { EncryptedOAuthToken, OAuthToken } from "../types";

export class TokenEncryption {
	private encryptionKey: CryptoKey | null = null;

	constructor(private secretKey: string) {}

	/**
	 * Get or create the encryption key
	 */
	private async getEncryptionKey(): Promise<CryptoKey> {
		if (!this.encryptionKey) {
			const encoder = new TextEncoder();
			const keyData = encoder.encode(
				this.secretKey.padEnd(32, "0").slice(0, 32),
			);

			this.encryptionKey = await crypto.subtle.importKey(
				"raw",
				keyData,
				{ name: "AES-GCM" },
				false,
				["encrypt", "decrypt"],
			);
		}
		return this.encryptionKey;
	}

	/**
	 * Encrypt an OAuth token
	 */
	async encryptToken(token: OAuthToken): Promise<EncryptedOAuthToken> {
		const key = await this.getEncryptionKey();
		const iv = crypto.getRandomValues(new Uint8Array(12));
		const encoder = new TextEncoder();

		// Encrypt access token
		const accessTokenData = encoder.encode(token.accessToken);
		const encryptedAccessToken = await crypto.subtle.encrypt(
			{ name: "AES-GCM", iv },
			key,
			accessTokenData,
		);

		// Encrypt refresh token if present
		let encryptedRefreshToken: ArrayBuffer | undefined;
		if (token.refreshToken) {
			const refreshTokenData = encoder.encode(token.refreshToken);
			encryptedRefreshToken = await crypto.subtle.encrypt(
				{ name: "AES-GCM", iv },
				key,
				refreshTokenData,
			);
		}

		return {
			...token,
			accessToken: this.arrayBufferToBase64(encryptedAccessToken),
			refreshToken: encryptedRefreshToken
				? this.arrayBufferToBase64(encryptedRefreshToken)
				: undefined,
			iv: this.arrayBufferToBase64(iv),
		};
	}

	/**
	 * Decrypt an OAuth token
	 */
	async decryptToken(encrypted: EncryptedOAuthToken): Promise<OAuthToken> {
		const key = await this.getEncryptionKey();
		const iv = this.base64ToArrayBuffer(encrypted.iv);
		const decoder = new TextDecoder();

		// Decrypt access token
		const encryptedAccessToken = this.base64ToArrayBuffer(
			encrypted.accessToken,
		);
		const decryptedAccessToken = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv },
			key,
			encryptedAccessToken,
		);

		// Decrypt refresh token if present
		let refreshToken: string | undefined;
		if (encrypted.refreshToken) {
			const encryptedRefreshToken = this.base64ToArrayBuffer(
				encrypted.refreshToken,
			);
			const decryptedRefreshToken = await crypto.subtle.decrypt(
				{ name: "AES-GCM", iv },
				key,
				encryptedRefreshToken,
			);
			refreshToken = decoder.decode(decryptedRefreshToken);
		}

		return {
			...encrypted,
			accessToken: decoder.decode(decryptedAccessToken),
			refreshToken,
		};
	}

	/**
	 * Hash a token for storage (one-way)
	 */
	async hashToken(token: string): Promise<string> {
		const encoder = new TextEncoder();
		const data = encoder.encode(token);
		const hashBuffer = await crypto.subtle.digest("SHA-256", data);
		return this.arrayBufferToHex(hashBuffer);
	}

	/**
	 * Convert ArrayBuffer to base64
	 */
	private arrayBufferToBase64(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		const binary = String.fromCharCode(...bytes);
		return btoa(binary);
	}

	/**
	 * Convert base64 to ArrayBuffer
	 */
	private base64ToArrayBuffer(base64: string): ArrayBuffer {
		const binary = atob(base64);
		const bytes = new Uint8Array(binary.length);
		for (let i = 0; i < binary.length; i++) {
			bytes[i] = binary.charCodeAt(i);
		}
		return bytes.buffer;
	}

	/**
	 * Convert ArrayBuffer to hex string
	 */
	private arrayBufferToHex(buffer: ArrayBuffer): string {
		const bytes = new Uint8Array(buffer);
		return Array.from(bytes)
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");
	}
}

/**
 * Generate a secure random secret for webhook signing
 */
export function generateSecureSecret(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(32));
	return Array.from(bytes)
		.map((b) => b.toString(16).padStart(2, "0"))
		.join("");
}
