import { readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildHomeDirectoryDisallowedTools } from "../src/home-directory-restrictions.js";

// ─── Filesystem DSL ──────────────────────────────────────────────────────────
//
// Define a fake home directory tree using dir() and file():
//
//   mockHome("/home/alice", {
//     ".ssh": dir({ "id_rsa": file() }),
//     ".cyrus": dir({ "worktrees": dir({ "ENG-1": dir({ "repo": dir() }) }) }),
//     ".gitconfig": file(),
//   });

type FsEntry = { kind: "dir"; children: FsTree } | { kind: "file" };
type FsTree = Record<string, FsEntry>;

function dir(children: FsTree = {}): FsEntry {
	return { kind: "dir", children };
}
function file(): FsEntry {
	return { kind: "file" };
}

function mockHome(home: string, tree: FsTree): void {
	const dirs = new Map<string, string[]>();
	const files = new Set<string>();

	function populate(path: string, entry: FsEntry): void {
		if (entry.kind === "file") {
			files.add(path);
		} else {
			dirs.set(path, Object.keys(entry.children));
			for (const [name, child] of Object.entries(entry.children)) {
				populate(`${path}/${name}`, child);
			}
		}
	}

	dirs.set(home, Object.keys(tree));
	for (const [name, child] of Object.entries(tree)) {
		populate(`${home}/${name}`, child);
	}

	vi.mocked(homedir).mockReturnValue(home);
	vi.mocked(readdirSync).mockImplementation((path: unknown) => {
		const contents = dirs.get(String(path));
		if (!contents)
			throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
		return contents as ReturnType<typeof readdirSync>;
	});
	vi.mocked(statSync).mockImplementation((path: unknown) => {
		const p = String(path);
		if (dirs.has(p))
			return { isDirectory: () => true } as ReturnType<typeof statSync>;
		if (files.has(p))
			return { isDirectory: () => false } as ReturnType<typeof statSync>;
		throw Object.assign(new Error(`ENOENT: ${p}`), { code: "ENOENT" });
	});
}

vi.mock("node:fs", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:fs")>();
	return { ...actual, readdirSync: vi.fn(), statSync: vi.fn() };
});

vi.mock("node:os", async (importOriginal) => {
	const actual = await importOriginal<typeof import("node:os")>();
	return { ...actual, homedir: vi.fn() };
});

// ─── Assertion DSL ────────────────────────────────────────────────────────────
//
// Check that paths relative to home are denied or allowed:
//
//   check(denied, HOME)
//     .denies(".ssh")          // → Read(//home/alice/.ssh/**) is in the list
//     .allows(".cyrus");       // → nothing matching .cyrus is in the list

class Assertions {
	constructor(
		private readonly denied: string[],
		private readonly home: string,
	) {}

	private isDenied(relPath: string): boolean {
		const abs = `${this.home}/${relPath}`;
		return this.denied.some(
			(r) => r === `Read(/${abs})` || r === `Read(/${abs}/**)`,
		);
	}

	denies(relPath: string): this {
		expect(this.isDenied(relPath), `"${relPath}" should be denied`).toBe(true);
		return this;
	}

	allows(relPath: string): this {
		expect(this.isDenied(relPath), `"${relPath}" should not be denied`).toBe(
			false,
		);
		return this;
	}
}

function check(denied: string[], home: string): Assertions {
	return new Assertions(denied, home);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

const HOME = "/home/alice";

afterEach(() => {
	vi.clearAllMocks();
});

describe("single cwd", () => {
	it("denies everything in home that is not an ancestor of cwd", () => {
		mockHome(HOME, {
			".ssh": dir({ id_rsa: file() }),
			".aws": dir({ credentials: file() }),
			".gitconfig": file(),
			Documents: dir(),
			".cyrus": dir({
				worktrees: dir({
					"ENG-1": dir({ repo: dir() }),
				}),
			}),
		});

		const denied = buildHomeDirectoryDisallowedTools(
			`${HOME}/.cyrus/worktrees/ENG-1/repo`,
		);

		check(denied, HOME)
			.denies(".ssh") // sibling of .cyrus — sensitive credentials
			.denies(".aws") // sibling of .cyrus — sensitive credentials
			.denies(".gitconfig") // sibling of .cyrus — a file, not a dir
			.denies("Documents") // sibling of .cyrus — unrelated dir
			.allows(".cyrus") // ancestor of cwd — must be traversable
			.allows(".cyrus/worktrees") // ancestor of cwd
			.allows(".cyrus/worktrees/ENG-1") // ancestor of cwd
			.allows(".cyrus/worktrees/ENG-1/repo"); // the cwd itself
	});

	it("denies siblings at every level of the path, not just at home", () => {
		mockHome(HOME, {
			".cyrus": dir({
				worktrees: dir({
					"ENG-1": dir({ repo: dir() }),
					"ENG-2": dir({ repo: dir() }), // sibling of the target worktree
				}),
				certs: dir(), // sibling of worktrees
				logs: dir(), // sibling of worktrees
			}),
			".gitconfig": file(),
		});

		const denied = buildHomeDirectoryDisallowedTools(
			`${HOME}/.cyrus/worktrees/ENG-1/repo`,
		);

		check(denied, HOME)
			.denies(".gitconfig")
			.denies(".cyrus/certs") // inside .cyrus but not on path to cwd
			.denies(".cyrus/logs") // inside .cyrus but not on path to cwd
			.denies(".cyrus/worktrees/ENG-2") // different worktree — should stay private
			.allows(".cyrus")
			.allows(".cyrus/worktrees")
			.allows(".cyrus/worktrees/ENG-1")
			.allows(".cyrus/worktrees/ENG-1/repo");
	});

	it("returns empty when cwd is outside home", () => {
		mockHome(HOME, { ".ssh": dir() });

		expect(buildHomeDirectoryDisallowedTools("/tmp/some-repo")).toEqual([]);
	});
});

describe("with allowedDirectories (attachments dir, repo paths, etc.)", () => {
	it("allows the attachments dir even though it is a sibling of the worktrees dir", () => {
		// In production the layout is:
		//   ~/.cyrus/worktrees/ENG-1/repo   ← cwd (the worktree)
		//   ~/.cyrus/ENG-1/attachments      ← where ticket attachments are stored
		// Without passing allowedDirectories, the attachments dir would be denied
		// because .cyrus/ENG-1 is a sibling of .cyrus/worktrees.
		mockHome(HOME, {
			".ssh": dir({ id_rsa: file() }),
			".cyrus": dir({
				worktrees: dir({
					"ENG-1": dir({ repo: dir() }),
				}),
				"ENG-1": dir({ attachments: dir() }),
				certs: dir(),
			}),
		});

		const cwd = `${HOME}/.cyrus/worktrees/ENG-1/repo`;
		const attachments = `${HOME}/.cyrus/ENG-1/attachments`;

		const denied = buildHomeDirectoryDisallowedTools(cwd, [attachments]);

		check(denied, HOME)
			.denies(".ssh")
			.denies(".cyrus/certs") // still denied — not needed by any allowed path
			.allows(".cyrus/worktrees/ENG-1/repo") // cwd
			.allows(".cyrus/ENG-1") // ancestor of attachments dir
			.allows(".cyrus/ENG-1/attachments"); // the attachments dir itself
	});

	it("allows multiple disjoint additional paths within home", () => {
		mockHome(HOME, {
			".ssh": dir(),
			".aws": dir(),
			repos: dir({
				"project-a": dir(),
				"project-b": dir(),
				"project-c": dir(), // not in any allowed path
			}),
			".cyrus": dir({
				"ENG-1": dir({ attachments: dir() }),
			}),
		});

		const denied = buildHomeDirectoryDisallowedTools(
			`${HOME}/repos/project-a`,
			[`${HOME}/.cyrus/ENG-1/attachments`, `${HOME}/repos/project-b`],
		);

		check(denied, HOME)
			.denies(".ssh")
			.denies(".aws")
			.denies("repos/project-c") // not in any allowed path
			.allows("repos/project-a") // cwd
			.allows("repos/project-b") // explicit allowed path
			.allows(".cyrus/ENG-1/attachments"); // explicit allowed path
	});

	it("ignores additional paths outside home — they have no effect on the output", () => {
		mockHome(HOME, {
			".ssh": dir(),
			".cyrus": dir({
				worktrees: dir({ "ENG-1": dir({ repo: dir() }) }),
			}),
		});

		const denied = buildHomeDirectoryDisallowedTools(
			`${HOME}/.cyrus/worktrees/ENG-1/repo`,
			[
				"/tmp/outside-home", // lives outside home, irrelevant
			],
		);

		check(denied, HOME).denies(".ssh").allows(".cyrus/worktrees/ENG-1/repo");
	});
});
