#!/usr/bin/env node

/**
 * Test script to verify Cyrus CLI accepts auth keys with 'cysk' prefix
 *
 * This generates test auth keys matching the new format from cyrus-hosted:
 * - Prefix: 'cysk' (4 characters)
 * - Random part: ~43 characters of URL-safe base64
 * - Total length: ~47 characters
 */

import { randomBytes } from 'node:crypto';

/**
 * Generate a test auth key with 'cysk' prefix
 */
function generateTestAuthKey() {
  // Generate 32 random bytes (same as the cyrus-hosted implementation)
  const bytes = randomBytes(32);

  // Convert to URL-safe base64
  const randomPart = bytes
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  // Add 'cysk' prefix
  const authKey = `cysk${randomPart}`;

  return authKey;
}

/**
 * Generate multiple test keys for verification
 */
function generateTestKeys(count = 5) {
  console.log('🔑 Generating test auth keys with "cysk" prefix\n');
  console.log('Format: cysk + ~43 chars of URL-safe base64');
  console.log('Total length: ~47 characters\n');
  console.log('─'.repeat(60));

  const keys = [];
  for (let i = 0; i < count; i++) {
    const key = generateTestAuthKey();
    keys.push(key);

    console.log(`\nTest Key ${i + 1}:`);
    console.log(`  Value:  ${key}`);
    console.log(`  Length: ${key.length} chars`);
    console.log(`  Prefix: ${key.substring(0, 4)}`);
    console.log(`  Format: ${/^cysk[A-Za-z0-9_-]+$/.test(key) ? '✓ Valid' : '✗ Invalid'}`);
  }

  console.log('\n' + '─'.repeat(60));
  console.log('\n✅ All keys generated successfully!\n');
  console.log('To test with the CLI, run:');
  console.log(`  cyrus auth ${keys[0]}\n`);
  console.log('Note: This will fail authentication (invalid key),');
  console.log('but it verifies the CLI accepts the format.\n');

  return keys;
}

// Run the generator
const keys = generateTestKeys(5);

// Export for testing
export { generateTestAuthKey, generateTestKeys };
