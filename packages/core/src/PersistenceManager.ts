import { readFile, writeFile, mkdir } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import type { CyrusAgentSession, CyrusAgentSessionEntry, } from './CyrusAgentSession.js'


// Serialized versions with Date fields as strings
export type SerializedCyrusAgentSession = CyrusAgentSession
// extends Omit<CyrusAgentSession, 'createdAt' | 'updatedAt'> {
//   createdAt: string
//   updatedAt: string
// }

export type SerializedCyrusAgentSessionEntry = CyrusAgentSessionEntry
// extends Omit<CyrusAgentSessionEntry, 'metadata'> {
//   metadata?: Omit<CyrusAgentSessionEntry['metadata'], 'timestamp'> & {
//     timestamp?: string
//   }
// }

/**
 * Serializable EdgeWorker state for persistence
 */
export interface SerializableEdgeWorkerState {
  // Agent Session state - keyed by repository ID, since that's how we construct AgentSessionManagers
  agentSessions?: Record<string, Record<string, SerializedCyrusAgentSession>>
  agentSessionEntries?: Record<string, Record<string, SerializedCyrusAgentSessionEntry[]>>
}

/**
 * Manages persistence of critical mappings to survive restarts
 */
export class PersistenceManager {
  private persistencePath: string

  constructor(persistencePath?: string) {
    this.persistencePath = persistencePath || join(homedir(), '.cyrus', 'state')
  }

  /**
   * Get the full path to the single EdgeWorker state file
   */
  private getEdgeWorkerStateFilePath(): string {
    return join(this.persistencePath, 'edge-worker-state.json')
  }

  /**
   * Ensure the persistence directory exists
   */
  private async ensurePersistenceDirectory(): Promise<void> {
    await mkdir(this.persistencePath, { recursive: true })
  }

  /**
   * Save EdgeWorker state to disk (single file for all repositories)
   */
  async saveEdgeWorkerState(state: SerializableEdgeWorkerState): Promise<void> {
    try {
      await this.ensurePersistenceDirectory()
      const stateFile = this.getEdgeWorkerStateFilePath()
      const stateData = {
        version: '2.0',
        savedAt: new Date().toISOString(),
        state
      }
      await writeFile(stateFile, JSON.stringify(stateData, null, 2), 'utf8')
    } catch (error) {
      console.error(`Failed to save EdgeWorker state:`, error)
      throw error
    }
  }

  /**
   * Load EdgeWorker state from disk (single file for all repositories)
   */
  async loadEdgeWorkerState(): Promise<SerializableEdgeWorkerState | null> {
    try {
      const stateFile = this.getEdgeWorkerStateFilePath()
      if (!existsSync(stateFile)) {
        return null
      }

      const stateData = JSON.parse(await readFile(stateFile, 'utf8'))
      
      // Validate state structure
      if (!stateData.state || stateData.version !== '2.0') {
        console.warn(`Invalid or outdated state file, ignoring`)
        return null
      }

      return stateData.state
    } catch (error) {
      console.error(`Failed to load EdgeWorker state:`, error)
      return null
    }
  }

  /**
   * Check if EdgeWorker state file exists
   */
  hasStateFile(): boolean {
    return existsSync(this.getEdgeWorkerStateFilePath())
  }

  /**
   * Delete EdgeWorker state file
   */
  async deleteStateFile(): Promise<void> {
    try {
      const stateFile = this.getEdgeWorkerStateFilePath()
      if (existsSync(stateFile)) {
        await writeFile(stateFile, '', 'utf8') // Clear file instead of deleting
      }
    } catch (error) {
      console.error(`Failed to delete EdgeWorker state file:`, error)
    }
  }

  /**
   * Convert Map to Record for serialization
   */
  static mapToRecord<T>(map: Map<string, T>): Record<string, T> {
    return Object.fromEntries(map.entries())
  }

  /**
   * Convert Record to Map for deserialization
   */
  static recordToMap<T>(record: Record<string, T>): Map<string, T> {
    return new Map(Object.entries(record))
  }

  /**
   * Convert Set to Array for serialization
   */
  static setToArray<T>(set: Set<T>): T[] {
    return Array.from(set)
  }

  /**
   * Convert Array to Set for deserialization
   */
  static arrayToSet<T>(array: T[]): Set<T> {
    return new Set(array)
  }
}