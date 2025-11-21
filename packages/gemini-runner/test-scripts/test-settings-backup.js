#!/usr/bin/env node
/**
 * Test script for settings.json backup/restore mechanism
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
	deleteGeminiSettings,
	setupGeminiSettings,
	writeGeminiSettings,
} from "../dist/settingsGenerator.js";

const SETTINGS_PATH = join(homedir(), ".gemini", "settings.json");
const BACKUP_PATH = join(homedir(), ".gemini", "settings.json.backup");

function readSettings() {
	if (!existsSync(SETTINGS_PATH)) {
		return null;
	}
	return JSON.parse(readFileSync(SETTINGS_PATH, "utf-8"));
}

function readBackup() {
	if (!existsSync(BACKUP_PATH)) {
		return null;
	}
	return JSON.parse(readFileSync(BACKUP_PATH, "utf-8"));
}

console.log("Testing settings.json backup/restore mechanism\n");

// Test 1: No existing settings
console.log("Test 1: No existing settings.json");
deleteGeminiSettings();
const cleanup1 = setupGeminiSettings(true);
const settings1 = readSettings();
console.log("  Settings created:", settings1);
console.log("  maxSessionTurns:", settings1?.model?.maxSessionTurns);
console.log("  Expected: 1");
cleanup1();
const settingsAfterCleanup1 = readSettings();
console.log("  After cleanup:", settingsAfterCleanup1);
console.log("  ✓ Test 1 passed\n");

// Test 2: Existing settings (should backup and restore)
console.log("Test 2: Existing settings.json");
writeGeminiSettings(999);
const originalSettings = readSettings();
console.log("  Original settings:", originalSettings);
const cleanup2 = setupGeminiSettings(true);
const settings2 = readSettings();
console.log("  Modified settings:", settings2);
console.log("  maxSessionTurns:", settings2?.model?.maxSessionTurns);
console.log("  Expected: 1");
const backup = readBackup();
console.log("  Backup exists:", backup !== null);
cleanup2();
const settingsAfterCleanup2 = readSettings();
console.log("  After cleanup:", settingsAfterCleanup2);
console.log(
	"  Restored maxSessionTurns:",
	settingsAfterCleanup2?.model?.maxSessionTurns,
);
console.log("  Expected: 999");
console.log("  ✓ Test 2 passed\n");

// Test 3: Multi-turn mode (maxSessionTurns = -1)
console.log("Test 3: Multi-turn mode");
const cleanup3 = setupGeminiSettings(false);
const settings3 = readSettings();
console.log("  Settings:", settings3);
console.log("  maxSessionTurns:", settings3?.model?.maxSessionTurns);
console.log("  Expected: -1");
cleanup3();
console.log("  ✓ Test 3 passed\n");

// Cleanup
deleteGeminiSettings();
console.log("All tests passed! ✓");
