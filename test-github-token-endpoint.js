#!/usr/bin/env node

/**
 * Test script for GitHub token endpoint
 * 
 * Usage:
 * 1. Start the CLI with MANAGE_GH_AUTH=true:
 *    MANAGE_GH_AUTH=true pnpm start
 * 
 * 2. In another terminal, run this test:
 *    node test-github-token-endpoint.js <github-token>
 */

const http = require('http');

const token = process.argv[2];
const port = process.env.CYRUS_SERVER_PORT || 3456;

if (!token) {
  console.error('Usage: node test-github-token-endpoint.js <github-token>');
  process.exit(1);
}

const data = JSON.stringify({ token });

const options = {
  hostname: 'localhost',
  port: port,
  path: '/github-token',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

console.log(`Sending GitHub token to http://localhost:${port}/github-token...`);

const req = http.request(options, res => {
  let responseData = '';

  res.on('data', chunk => {
    responseData += chunk;
  });

  res.on('end', () => {
    console.log(`Response status: ${res.statusCode}`);
    console.log('Response:', responseData);
    
    if (res.statusCode === 200) {
      console.log('✅ GitHub token endpoint test successful!');
    } else {
      console.log('❌ GitHub token endpoint test failed');
    }
  });
});

req.on('error', error => {
  console.error('Error:', error);
});

req.write(data);
req.end();