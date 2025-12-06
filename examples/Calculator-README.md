# Calculator Implementation

## Overview

A TypeScript Calculator class with basic arithmetic operations: add, subtract, multiply, and divide.

## Features

### Methods

- `add(a: number, b: number): number` - Adds two numbers
- `subtract(a: number, b: number): number` - Subtracts b from a
- `multiply(a: number, b: number): number` - Multiplies two numbers
- `divide(a: number, b: number): number` - Divides a by b (throws error on division by zero)

### Key Features

- Full TypeScript type safety
- Comprehensive error handling (division by zero protection)
- Well-documented with JSDoc comments
- Extensive test coverage (23 passing tests)

## Usage

```typescript
import { Calculator } from './Calculator';

const calc = new Calculator();

// Addition
calc.add(5, 3); // Returns 8

// Subtraction
calc.subtract(10, 4); // Returns 6

// Multiplication
calc.multiply(3, 4); // Returns 12

// Division
calc.divide(20, 4); // Returns 5
calc.divide(10, 0); // Throws Error: "Division by zero is not allowed"
```

## Testing

Run tests with:
```bash
npx vitest run Calculator.test.ts
```

Test coverage includes:
- Positive and negative numbers
- Zero handling
- Decimal operations
- Division by zero error handling
- Large numbers
- Edge cases

All 23 tests passing ✓

## Implementation Details

- **File**: `Calculator.ts:28-30` - multiply() method implementation
- **File**: `Calculator.ts:39-44` - divide() method implementation with zero-division protection
- Follows existing code patterns with proper TypeScript typing
- No external dependencies
