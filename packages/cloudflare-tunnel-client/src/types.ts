/**
 * Event emitted by CloudflareTunnelClient
 */
export interface CloudflareTunnelClientEvents {
	connect: () => void;
	disconnect: (reason: string) => void;
	error: (error: Error) => void;
	ready: (tunnelUrl: string) => void;
}
