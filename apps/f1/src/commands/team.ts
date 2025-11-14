import { rpc } from "../client/RPCClient.js";
import { c } from "../utils/colors.js";
import { printJSON } from "../utils/formatter.js";

/**
 * Fetch all labels
 */
export async function fetchLabels(): Promise<void> {
	const result = await rpc("fetchLabels", {});

	if (result.success) {
		console.log(c.success("\n✅ Success\n"));
		printJSON(result.data);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}

/**
 * Fetch all members
 */
export async function fetchMembers(): Promise<void> {
	const result = await rpc("fetchMembers", {});

	if (result.success) {
		console.log(c.success("\n✅ Success\n"));
		printJSON(result.data);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}

/**
 * Create label options
 */
export interface CreateLabelOptions {
	name: string;
	color?: string;
}

/**
 * Create a new label
 */
export async function createLabel(options: CreateLabelOptions): Promise<void> {
	const result = await rpc("createLabel", {
		name: options.name,
		options: options.color ? { color: options.color } : {},
	});

	if (result.success) {
		console.log(c.success("\n✅ Success\n"));
		printJSON(result.data);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}

/**
 * Create member options
 */
export interface CreateMemberOptions {
	name: string;
	email?: string;
}

/**
 * Create a new team member
 */
export async function createMember(
	options: CreateMemberOptions,
): Promise<void> {
	const result = await rpc("createMember", {
		name: options.name,
		options: options.email ? { email: options.email } : {},
	});

	if (result.success) {
		console.log(c.success("\n✅ Success\n"));
		printJSON(result.data);
		console.log();
	} else {
		console.error(c.error(`\n❌ Error: ${result.error}\n`));
		process.exit(1);
	}
}
