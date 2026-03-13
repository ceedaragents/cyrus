import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createLogger, type ILogger } from "../logging/index.js";
import type {
	EventSource,
	StoredEvent,
	SubscriptionEvent,
	SubscriptionEventType,
} from "./types.js";

/**
 * Disk-based event store for persisting full event payloads.
 *
 * Events are stored as individual JSON files in a directory structure:
 *   {storePath}/events/{eventId}.json
 *
 * This allows agents to receive a compressed summary of an event and then
 * look up the full payload by event ID when needed.
 */
export class EventStore {
	private storePath: string;
	private logger: ILogger;

	constructor(storePath: string, logger?: ILogger) {
		this.storePath = join(storePath, "events");
		this.logger = logger ?? createLogger({ component: "EventStore" });
	}

	/**
	 * Store an event and return a SubscriptionEvent with a unique ID.
	 */
	async storeEvent(
		eventType: SubscriptionEventType,
		source: EventSource,
		payload: Record<string, unknown>,
		filterableProperties: Record<string, string | string[] | boolean>,
	): Promise<SubscriptionEvent> {
		const id = randomUUID();
		const event: SubscriptionEvent = {
			id,
			eventType,
			source,
			payload,
			filterableProperties,
		};

		const storedEvent: StoredEvent = {
			id,
			eventType,
			source,
			payload,
			receivedAt: Date.now(),
		};

		try {
			await this.ensureStoreDirectory();
			const filePath = this.getEventFilePath(id);
			await writeFile(filePath, JSON.stringify(storedEvent, null, 2), "utf8");
			this.logger.debug(`Stored event ${id} (${eventType} from ${source})`);
		} catch (error) {
			this.logger.error(`Failed to store event ${id}:`, error);
		}

		return event;
	}

	/**
	 * Look up a full event payload by event ID.
	 */
	async lookupEvent(eventId: string): Promise<StoredEvent | null> {
		try {
			const filePath = this.getEventFilePath(eventId);
			if (!existsSync(filePath)) {
				return null;
			}
			const data = await readFile(filePath, "utf8");
			return JSON.parse(data) as StoredEvent;
		} catch (error) {
			this.logger.error(`Failed to lookup event ${eventId}:`, error);
			return null;
		}
	}

	/**
	 * Clean up events older than the specified max age.
	 */
	async cleanup(maxAgeMs: number): Promise<number> {
		try {
			if (!existsSync(this.storePath)) {
				return 0;
			}

			const files = await readdir(this.storePath);
			const cutoff = Date.now() - maxAgeMs;
			let removed = 0;

			for (const file of files) {
				if (!file.endsWith(".json")) continue;

				try {
					const filePath = join(this.storePath, file);
					const data = await readFile(filePath, "utf8");
					const event = JSON.parse(data) as StoredEvent;

					if (event.receivedAt < cutoff) {
						await unlink(filePath);
						removed++;
					}
				} catch {
					// Skip malformed files
				}
			}

			if (removed > 0) {
				this.logger.info(`Cleaned up ${removed} old events`);
			}
			return removed;
		} catch (error) {
			this.logger.error("Failed to cleanup events:", error);
			return 0;
		}
	}

	private getEventFilePath(eventId: string): string {
		return join(this.storePath, `${eventId}.json`);
	}

	private async ensureStoreDirectory(): Promise<void> {
		await mkdir(this.storePath, { recursive: true });
	}
}
