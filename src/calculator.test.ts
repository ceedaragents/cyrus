import { describe, it, expect } from "vitest";
import { Calculator } from "./calculator";

describe("Calculator", () => {
  const calculator = new Calculator();

  describe("multiply", () => {
    it("should multiply two positive numbers", () => {
      expect(calculator.multiply(5, 3)).toBe(15);
    });

    it("should multiply positive and negative numbers", () => {
      expect(calculator.multiply(5, -3)).toBe(-15);
    });

    it("should multiply two negative numbers", () => {
      expect(calculator.multiply(-5, -3)).toBe(15);
    });

    it("should return zero when multiplying by zero", () => {
      expect(calculator.multiply(5, 0)).toBe(0);
      expect(calculator.multiply(0, 5)).toBe(0);
    });

    it("should handle decimal numbers", () => {
      expect(calculator.multiply(2.5, 4)).toBe(10);
      expect(calculator.multiply(1.5, 2.5)).toBe(3.75);
    });
  });

  describe("divide", () => {
    it("should divide two positive numbers", () => {
      expect(calculator.divide(15, 3)).toBe(5);
    });

    it("should divide positive and negative numbers", () => {
      expect(calculator.divide(15, -3)).toBe(-5);
    });

    it("should divide two negative numbers", () => {
      expect(calculator.divide(-15, -3)).toBe(5);
    });

    it("should handle decimal results", () => {
      expect(calculator.divide(10, 4)).toBe(2.5);
    });

    it("should handle decimal numbers", () => {
      expect(calculator.divide(7.5, 2.5)).toBe(3);
    });

    it("should throw error when dividing by zero", () => {
      expect(() => calculator.divide(5, 0)).toThrow("Division by zero is not allowed");
    });
  });

  describe("modulo", () => {
    it("should calculate remainder of two positive numbers", () => {
      expect(calculator.modulo(10, 3)).toBe(1);
    });

    it("should return zero when dividend is divisible by divisor", () => {
      expect(calculator.modulo(15, 5)).toBe(0);
    });

    it("should handle negative dividend", () => {
      expect(calculator.modulo(-10, 3)).toBe(-1);
    });

    it("should handle negative divisor", () => {
      expect(calculator.modulo(10, -3)).toBe(1);
    });

    it("should handle decimal numbers", () => {
      expect(calculator.modulo(10.5, 3)).toBe(1.5);
    });

    it("should throw error when modulo by zero", () => {
      expect(() => calculator.modulo(5, 0)).toThrow("Modulo by zero is not allowed");
    });
  });
});
