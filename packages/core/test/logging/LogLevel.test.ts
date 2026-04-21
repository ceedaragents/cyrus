import { SeverityNumber } from "@opentelemetry/api-logs";
import { describe, expect, it } from "vitest";
import { LogLevel } from "../../src/logging/LogLevel.js";

describe("LogLevel", () => {
	it("orders levels by severity via compare()", () => {
		expect(LogLevel.DEBUG.compare(LogLevel.INFO)).toBeLessThan(0);
		expect(LogLevel.INFO.compare(LogLevel.INFO)).toBe(0);
		expect(LogLevel.ERROR.compare(LogLevel.WARN)).toBeGreaterThan(0);
		expect(LogLevel.SILENT.compare(LogLevel.ERROR)).toBeGreaterThan(0);
	});

	it("exposes stable ordinals", () => {
		expect(LogLevel.DEBUG.ordinal()).toBe(0);
		expect(LogLevel.INFO.ordinal()).toBe(1);
		expect(LogLevel.WARN.ordinal()).toBe(2);
		expect(LogLevel.ERROR.ordinal()).toBe(3);
		expect(LogLevel.SILENT.ordinal()).toBe(4);
	});

	it("maps to OTel SeverityNumber", () => {
		expect(LogLevel.DEBUG.toOtelSeverity()).toBe(SeverityNumber.DEBUG);
		expect(LogLevel.INFO.toOtelSeverity()).toBe(SeverityNumber.INFO);
		expect(LogLevel.WARN.toOtelSeverity()).toBe(SeverityNumber.WARN);
		expect(LogLevel.ERROR.toOtelSeverity()).toBe(SeverityNumber.ERROR);
		expect(LogLevel.SILENT.toOtelSeverity()).toBe(SeverityNumber.UNSPECIFIED);
	});

	it("maps to OTel severity text", () => {
		expect(LogLevel.INFO.toOtelSeverityText()).toBe("INFO");
		expect(LogLevel.SILENT.toOtelSeverityText()).toBe("UNSPECIFIED");
	});

	it("parses case-insensitive level names", () => {
		expect(LogLevel.parse("debug")).toBe(LogLevel.DEBUG);
		expect(LogLevel.parse("Info")).toBe(LogLevel.INFO);
		expect(LogLevel.parse("WARN")).toBe(LogLevel.WARN);
	});

	it("returns undefined for unknown level names", () => {
		expect(LogLevel.parse(undefined)).toBeUndefined();
		expect(LogLevel.parse("")).toBeUndefined();
		expect(LogLevel.parse("trace")).toBeUndefined();
	});
});
