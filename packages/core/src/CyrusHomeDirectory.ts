import { homedir } from "node:os";
import { resolve } from "node:path";

let cyrusHomeOverride: string | undefined;

/**
 * Sets the Cyrus home directory override.
 * This should be called once at application startup if a custom directory is specified.
 * @param customHome - The custom home directory path, or undefined to use default
 */
export function setCyrusHome(customHome: string | undefined): void {
    cyrusHomeOverride = customHome ? resolve(customHome) : undefined;
}

/**
 * Gets the Cyrus home directory.
 * Returns the custom directory if set, otherwise defaults to ~/.cyrus
 * @returns The absolute path to the Cyrus home directory
 */
export function getCyrusHome(): string {
    if (cyrusHomeOverride) {
        return cyrusHomeOverride;
    }
    
    // Check environment variable as a fallback
    const envHome = process.env.CYRUS_HOME;
    if (envHome) {
        return resolve(envHome);
    }
    
    // Default to ~/.cyrus
    return resolve(homedir(), ".cyrus");
}

/**
 * Gets the path to the Cyrus configuration file.
 * @returns The absolute path to the config.json file
 */
export function getCyrusConfigPath(): string {
    return resolve(getCyrusHome(), "config.json");
}

/**
 * Gets the path to the Cyrus workspaces directory.
 * @returns The absolute path to the workspaces directory
 */
export function getCyrusWorkspacesPath(): string {
    return resolve(getCyrusHome(), "workspaces");
}

/**
 * Gets the path to the Cyrus logs directory.
 * @returns The absolute path to the logs directory
 */
export function getCyrusLogsPath(): string {
    return resolve(getCyrusHome(), "logs");
}

/**
 * Gets the path to the Cyrus state directory.
 * @returns The absolute path to the state directory
 */
export function getCyrusStatePath(): string {
    return resolve(getCyrusHome(), "state");
}

/**
 * Gets the path to a workspace-specific attachments directory.
 * @param workspaceName - The name of the workspace
 * @returns The absolute path to the workspace attachments directory
 */
export function getCyrusAttachmentsPath(workspaceName: string): string {
    return resolve(getCyrusHome(), workspaceName, "attachments");
}