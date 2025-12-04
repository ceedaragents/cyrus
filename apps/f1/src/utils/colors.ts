/**
 * ANSI color codes for terminal output
 * No external dependencies - using raw ANSI escape codes
 */

export const colors = {
	reset: "\x1b[0m",
	bright: "\x1b[1m",
	dim: "\x1b[2m",

	// Foreground colors
	black: "\x1b[30m",
	red: "\x1b[31m",
	green: "\x1b[32m",
	yellow: "\x1b[33m",
	blue: "\x1b[34m",
	magenta: "\x1b[35m",
	cyan: "\x1b[36m",
	white: "\x1b[37m",
	gray: "\x1b[90m",

	// Background colors
	bgBlack: "\x1b[40m",
	bgRed: "\x1b[41m",
	bgGreen: "\x1b[42m",
	bgYellow: "\x1b[43m",
	bgBlue: "\x1b[44m",
	bgMagenta: "\x1b[45m",
	bgCyan: "\x1b[46m",
	bgWhite: "\x1b[47m",
} as const;

/**
 * Helper functions for colored output
 */
export function success(text: string): string {
	return `${colors.green}✓${colors.reset} ${text}`;
}

export function error(text: string): string {
	return `${colors.red}✗${colors.reset} ${text}`;
}

export function warning(text: string): string {
	return `${colors.yellow}⚠${colors.reset} ${text}`;
}

export function info(text: string): string {
	return `${colors.cyan}ℹ${colors.reset} ${text}`;
}

export function bold(text: string): string {
	return `${colors.bright}${text}${colors.reset}`;
}

export function dim(text: string): string {
	return `${colors.dim}${text}${colors.reset}`;
}

export function green(text: string): string {
	return `${colors.green}${text}${colors.reset}`;
}

export function red(text: string): string {
	return `${colors.red}${text}${colors.reset}`;
}

export function yellow(text: string): string {
	return `${colors.yellow}${text}${colors.reset}`;
}

export function cyan(text: string): string {
	return `${colors.cyan}${text}${colors.reset}`;
}

export function gray(text: string): string {
	return `${colors.gray}${text}${colors.reset}`;
}
