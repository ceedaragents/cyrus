/**
 * A simple calculator class that performs basic arithmetic operations.
 */
export class Calculator {
  /**
   * Multiplies two numbers.
   * @param a - The first number
   * @param b - The second number
   * @returns The product of a and b
   */
  multiply(a: number, b: number): number {
    return a * b;
  }

  /**
   * Divides two numbers.
   * @param a - The dividend
   * @param b - The divisor
   * @returns The quotient of a divided by b
   * @throws {Error} If divisor (b) is zero
   */
  divide(a: number, b: number): number {
    if (b === 0) {
      throw new Error("Division by zero is not allowed");
    }
    return a / b;
  }

  /**
   * Calculates the remainder of dividing two numbers (modulo operation).
   * @param a - The dividend
   * @param b - The divisor
   * @returns The remainder of a divided by b
   * @throws {Error} If divisor (b) is zero
   */
  modulo(a: number, b: number): number {
    if (b === 0) {
      throw new Error("Modulo by zero is not allowed");
    }
    return a % b;
  }
}
