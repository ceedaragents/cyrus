export class Calculator {
	/**
	 * Adds two numbers together
	 * @param a First number
	 * @param b Second number
	 * @returns Sum of a and b
	 */
	add(a: number, b: number): number {
		return a + b;
	}

	/**
	 * Subtracts b from a
	 * @param a First number
	 * @param b Second number
	 * @returns Difference of a and b
	 */
	subtract(a: number, b: number): number {
		return a - b;
	}

	/**
	 * Multiplies two numbers together
	 * @param a First number
	 * @param b Second number
	 * @returns Product of a and b
	 */
	multiply(a: number, b: number): number {
		return a * b;
	}

	/**
	 * Divides a by b
	 * @param a Numerator
	 * @param b Denominator
	 * @returns Quotient of a and b
	 * @throws Error if b is zero
	 */
	divide(a: number, b: number): number {
		if (b === 0) {
			throw new Error("Division by zero is not allowed");
		}
		return a / b;
	}
}
