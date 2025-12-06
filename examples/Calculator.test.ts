import { beforeEach, describe, expect, it } from "vitest";
import { Calculator } from "./Calculator";

describe("Calculator", () => {
	let calculator: Calculator;

	beforeEach(() => {
		calculator = new Calculator();
	});

	describe("add", () => {
		it("should add two positive numbers", () => {
			expect(calculator.add(2, 3)).toBe(5);
		});

		it("should add negative numbers", () => {
			expect(calculator.add(-2, -3)).toBe(-5);
		});

		it("should add positive and negative numbers", () => {
			expect(calculator.add(5, -3)).toBe(2);
		});

		it("should handle zero", () => {
			expect(calculator.add(0, 5)).toBe(5);
			expect(calculator.add(5, 0)).toBe(5);
		});

		it("should handle decimals", () => {
			expect(calculator.add(1.5, 2.3)).toBeCloseTo(3.8);
		});
	});

	describe("subtract", () => {
		it("should subtract two positive numbers", () => {
			expect(calculator.subtract(5, 3)).toBe(2);
		});

		it("should subtract negative numbers", () => {
			expect(calculator.subtract(-5, -3)).toBe(-2);
		});

		it("should handle zero", () => {
			expect(calculator.subtract(5, 0)).toBe(5);
			expect(calculator.subtract(0, 5)).toBe(-5);
		});

		it("should handle decimals", () => {
			expect(calculator.subtract(5.5, 2.3)).toBeCloseTo(3.2);
		});
	});

	describe("multiply", () => {
		it("should multiply two positive numbers", () => {
			expect(calculator.multiply(3, 4)).toBe(12);
		});

		it("should multiply negative numbers", () => {
			expect(calculator.multiply(-3, -4)).toBe(12);
		});

		it("should multiply positive and negative numbers", () => {
			expect(calculator.multiply(3, -4)).toBe(-12);
			expect(calculator.multiply(-3, 4)).toBe(-12);
		});

		it("should handle multiplication by zero", () => {
			expect(calculator.multiply(5, 0)).toBe(0);
			expect(calculator.multiply(0, 5)).toBe(0);
		});

		it("should handle decimals", () => {
			expect(calculator.multiply(2.5, 4)).toBe(10);
			expect(calculator.multiply(1.5, 2.5)).toBeCloseTo(3.75);
		});

		it("should handle large numbers", () => {
			expect(calculator.multiply(1000, 1000)).toBe(1000000);
		});
	});

	describe("divide", () => {
		it("should divide two positive numbers", () => {
			expect(calculator.divide(12, 3)).toBe(4);
		});

		it("should divide negative numbers", () => {
			expect(calculator.divide(-12, -3)).toBe(4);
		});

		it("should divide positive and negative numbers", () => {
			expect(calculator.divide(12, -3)).toBe(-4);
			expect(calculator.divide(-12, 3)).toBe(-4);
		});

		it("should handle division resulting in decimals", () => {
			expect(calculator.divide(5, 2)).toBe(2.5);
			expect(calculator.divide(7, 3)).toBeCloseTo(2.333, 3);
		});

		it("should divide zero by a number", () => {
			expect(calculator.divide(0, 5)).toBe(0);
		});

		it("should throw error when dividing by zero", () => {
			expect(() => calculator.divide(5, 0)).toThrow(
				"Division by zero is not allowed",
			);
		});

		it("should throw error when dividing zero by zero", () => {
			expect(() => calculator.divide(0, 0)).toThrow(
				"Division by zero is not allowed",
			);
		});

		it("should handle division with decimals", () => {
			expect(calculator.divide(7.5, 2.5)).toBe(3);
			expect(calculator.divide(10.5, 3)).toBe(3.5);
		});
	});
});
