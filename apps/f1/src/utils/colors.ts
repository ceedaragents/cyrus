/**
 * ANSI color codes for terminal output
 */
const colors = {
	reset: "\x1b[0m",
	bold: "\x1b[1m",
	dim: "\x1b[2m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	cyan: "\x1b[36m",
	gray: "\x1b[90m",
};

/**
 * Color utility functions
 */
export const c = {
	error: (text: string): string => `${colors.red}${text}${colors.reset}`,
	success: (text: string): string => `${colors.green}${text}${colors.reset}`,
	warning: (text: string): string => `${colors.yellow}${text}${colors.reset}`,
	info: (text: string): string => `${colors.cyan}${text}${colors.reset}`,
	dim: (text: string): string => `${colors.dim}${text}${colors.reset}`,
	bold: (text: string): string => `${colors.bold}${text}${colors.reset}`,
	command: (text: string): string => `${colors.cyan}${text}${colors.reset}`,
	param: (text: string): string => `${colors.yellow}${text}${colors.reset}`,
	value: (text: string): string => `${colors.green}${text}${colors.reset}`,
	url: (text: string): string =>
		`${colors.blue}${colors.dim}${text}${colors.reset}`,
};
