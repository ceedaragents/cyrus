import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type {
	ApiResponse,
	DeleteSkillPayload,
	SkillInfo,
	UpdateSkillPayload,
} from "../types.js";

const USER_SKILLS_DIR = "user-skills-plugin/skills";

/**
 * Handle creating or updating a user skill.
 * Writes a SKILL.md file to ~/.cyrus/user-skills-plugin/skills/<name>/SKILL.md
 */
export async function handleUpdateSkill(
	payload: UpdateSkillPayload,
	cyrusHome: string,
): Promise<ApiResponse> {
	try {
		if (!payload.name || typeof payload.name !== "string") {
			return {
				success: false,
				error: "Skill name is required",
				details: "The name field must be a non-empty string.",
			};
		}

		if (!payload.description || typeof payload.description !== "string") {
			return {
				success: false,
				error: "Skill description is required",
				details: "The description field must be a non-empty string.",
			};
		}

		if (!payload.content || typeof payload.content !== "string") {
			return {
				success: false,
				error: "Skill content is required",
				details: "The content field must be a non-empty string.",
			};
		}

		// Sanitize skill name — only allow alphanumeric, hyphens, underscores
		const sanitizedName = payload.name
			.toLowerCase()
			.replace(/[^a-z0-9_-]/g, "-");
		if (sanitizedName !== payload.name) {
			return {
				success: false,
				error: "Invalid skill name",
				details:
					"Skill names may only contain lowercase letters, numbers, hyphens, and underscores.",
			};
		}

		const skillDir = join(cyrusHome, USER_SKILLS_DIR, sanitizedName);
		const skillPath = join(skillDir, "SKILL.md");

		// Build SKILL.md with YAML frontmatter
		const skillContent = [
			"---",
			`name: ${payload.name}`,
			`description: ${payload.description}`,
			"---",
			"",
			payload.content,
		].join("\n");

		await mkdir(skillDir, { recursive: true });
		await writeFile(skillPath, skillContent, "utf-8");

		return {
			success: true,
			message: `Skill "${payload.name}" saved successfully`,
			data: {
				name: payload.name,
				path: skillPath,
			},
		};
	} catch (error) {
		return {
			success: false,
			error: "Failed to save skill",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Handle deleting a user skill.
 * Removes the skill directory from ~/.cyrus/user-skills-plugin/skills/<name>/
 */
export async function handleDeleteSkill(
	payload: DeleteSkillPayload,
	cyrusHome: string,
): Promise<ApiResponse> {
	try {
		if (!payload.name || typeof payload.name !== "string") {
			return {
				success: false,
				error: "Skill name is required",
				details: "The name field must be a non-empty string.",
			};
		}

		const skillDir = join(cyrusHome, USER_SKILLS_DIR, payload.name);

		try {
			await rm(skillDir, { recursive: true });
		} catch (error: any) {
			if (error.code === "ENOENT") {
				return {
					success: false,
					error: `Skill "${payload.name}" not found`,
					details: `No skill directory exists at ${skillDir}`,
				};
			}
			throw error;
		}

		return {
			success: true,
			message: `Skill "${payload.name}" deleted successfully`,
			data: { name: payload.name },
		};
	} catch (error) {
		return {
			success: false,
			error: "Failed to delete skill",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Handle listing all user skills.
 * Reads skill directories from ~/.cyrus/user-skills-plugin/skills/
 * and returns name + description from each SKILL.md frontmatter.
 */
export async function handleListSkills(
	_payload: Record<string, never>,
	cyrusHome: string,
): Promise<ApiResponse> {
	try {
		const skillsDir = join(cyrusHome, USER_SKILLS_DIR);

		let entries: Dirent[];
		try {
			entries = (await readdir(skillsDir, { withFileTypes: true })) as Dirent[];
		} catch (error: any) {
			if (error.code === "ENOENT") {
				return {
					success: true,
					message: "No user skills configured",
					data: { skills: [] },
				};
			}
			throw error;
		}

		const skills: SkillInfo[] = [];
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;

			const skillPath = join(skillsDir, entry.name, "SKILL.md");
			try {
				const content = await readFile(skillPath, "utf-8");
				const description = parseFrontmatterField(content, "description") || "";
				skills.push({ name: entry.name, description });
			} catch {
				// SKILL.md missing or unreadable — include with empty description
				skills.push({ name: entry.name, description: "" });
			}
		}

		return {
			success: true,
			message: `Found ${skills.length} user skill(s)`,
			data: { skills },
		};
	} catch (error) {
		return {
			success: false,
			error: "Failed to list skills",
			details: error instanceof Error ? error.message : String(error),
		};
	}
}

/**
 * Extract a field value from YAML frontmatter.
 */
function parseFrontmatterField(
	content: string,
	field: string,
): string | undefined {
	const match = content.match(
		new RegExp(`^---[\\s\\S]*?^${field}:\\s*(.+)$[\\s\\S]*?^---`, "m"),
	);
	return match?.[1]?.trim();
}
