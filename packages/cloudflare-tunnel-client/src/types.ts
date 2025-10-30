/**
 * Event emitted by CloudflareTunnelClient
 */
export interface CloudflareTunnelClientEvents {
	connect: () => void;
	connected: (connection: any) => void; // Emitted for each of the 4 tunnel connections
	disconnect: (reason: string) => void;
	error: (error: Error) => void;
	ready: (tunnelUrl: string) => void;
}
