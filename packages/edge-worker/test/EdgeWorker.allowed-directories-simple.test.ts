import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("EdgeWorker - Directory Restrictions Issue", () => {
	it("FAILING TEST: EdgeWorker only allows attachments directory, not workspace directory", () => {
		// Read the actual EdgeWorker.ts source code
		const edgeWorkerPath = join(process.cwd(), "src", "EdgeWorker.ts");
		const sourceCode = readFileSync(edgeWorkerPath, "utf-8");
		
		// Find the lines where allowedDirectories is set
		const lines = sourceCode.split("\n");
		
		// Line 680: in createLinearAgentSession
		const line680 = lines[679]; // 0-indexed
		expect(line680).toContain("const allowedDirectories: string[] = [attachmentsDir];");
		
		// Line 1105: in handleUserPostedAgentActivity
		const line1105 = lines[1104]; // 0-indexed
		expect(line1105).toContain("const allowedDirectories = [attachmentsDir];");
		
		// PROBLEM: Neither includes session.workspace.path
		// This causes Claude Code to be unable to edit repository files
		
		// The fix should change these lines to:
		// const allowedDirectories: string[] = [attachmentsDir, session.workspace.path];
		
		// This test demonstrates that workspace path is NOT included
		expect(line680).not.toContain("session.workspace.path");
		expect(line1105).not.toContain("session.workspace.path");
		
		console.log("\n=== ISSUE CONFIRMED ===");
		console.log("Line 680 only includes attachmentsDir:", line680.trim());
		console.log("Line 1105 only includes attachmentsDir:", line1105.trim());
		console.log("\nThis prevents Claude Code from editing files in the repository workspace.");
		console.log("The fix should add session.workspace.path to both arrays.");
	});
	
	it("DOCUMENTATION: What the fix should look like", () => {
		// After the fix, the lines should be:
		
		// Line 680 in createLinearAgentSession:
		const expectedLine680 = "const allowedDirectories: string[] = [attachmentsDir, session.workspace.path];";
		
		// Line 1105 in handleUserPostedAgentActivity:
		const expectedLine1105 = "const allowedDirectories = [attachmentsDir, session.workspace.path];";
		
		console.log("\n=== EXPECTED FIX ===");
		console.log("Line 680 should be:", expectedLine680);
		console.log("Line 1105 should be:", expectedLine1105);
		console.log("\nThis will allow Claude Code to edit files in the repository workspace.");
		
		// This test just documents the fix, it always passes
		expect(true).toBe(true);
	});
});