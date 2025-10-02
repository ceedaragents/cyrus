import type React from "react";
import type { ReactNode } from "react";

declare module "ink" {
	type Key = {
		uuid?: string;
		upArrow?: boolean;
		downArrow?: boolean;
		leftArrow?: boolean;
		rightArrow?: boolean;
		return?: boolean;
		escape?: boolean;
		ctrl?: boolean;
		meta?: boolean;
		shift?: boolean;
		[key: string]: boolean | string | undefined;
	};

	type InputHandler = (input: string, key: Key) => void;

	export interface UseInputOptions {
		isActive?: boolean;
	}

	export function useInput(
		handler: InputHandler,
		options?: UseInputOptions,
	): void;

	export interface UseAppResult {
		exit: (error?: Error | number) => void;
	}

	export function useApp(): UseAppResult;

	export interface UseStdoutResult {
		stdout?: NodeJS.WriteStream;
		write: (data: string) => void;
	}

	export function useStdout(): UseStdoutResult;

	export interface BoxProps {
		children?: ReactNode;
		[key: string]: unknown;
	}
	export const Box: React.FC<BoxProps>;

	export interface TextProps {
		children?: ReactNode;
		color?: string;
		backgroundColor?: string;
		bold?: boolean;
		dimColor?: boolean;
		italics?: boolean;
		underline?: boolean;
		strikethrough?: boolean;
		wrap?:
			| "wrap"
			| "truncate"
			| "truncate-start"
			| "truncate-middle"
			| "truncate-end"
			| "clip";
		[key: string]: unknown;
	}
	export const Text: React.FC<TextProps>;

	export interface RenderOptions {
		stdout?: NodeJS.WriteStream;
		stdin?: NodeJS.ReadStream;
		stderr?: NodeJS.WriteStream;
		debug?: boolean;
		exitOnCtrlC?: boolean;
		patchConsole?: boolean;
	}

	export interface InkApp {
		rerender: (node: ReactNode) => void;
		unmount: () => void;
		waitUntilExit: () => Promise<void>;
		cleanup: () => void;
		clear: () => void;
	}

	export function render(tree: ReactNode, stdout: NodeJS.WriteStream): InkApp;
	export function render(tree: ReactNode, options?: RenderOptions): InkApp;
}

declare module "ink-select-input" {
	export interface SelectItem<T = unknown> {
		label: string;
		value: T;
		key?: string;
	}

	export interface SelectInputProps<T = unknown> {
		items: SelectItem<T>[];
		initialIndex?: number;
		itemComponent?: React.ComponentType<{
			item: SelectItem<T>;
			isSelected: boolean;
		}>;
		scrollUpLabel?: string;
		scrollDownLabel?: string;
		onHighlight?: (item: SelectItem<T>) => void;
		onSelect?: (item: SelectItem<T>) => void;
		[key: string]: unknown;
	}

	export default class SelectInput<T = unknown> extends React.Component<
		SelectInputProps<T>
	> {}
}

declare module "ink-text-input" {
	export interface TextInputProps {
		value: string;
		onChange: (value: string) => void;
		onSubmit?: (value: string) => void;
		placeholder?: string;
		focus?: boolean;
		mask?: string | ((value: string) => string);
		showCursor?: boolean;
		highlightPastedText?: boolean;
		[key: string]: unknown;
	}

	export default class TextInput extends React.Component<TextInputProps> {}
}
