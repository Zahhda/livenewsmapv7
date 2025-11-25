// Test script to check server startup
import { spawn } from 'child_process';

console.log('🚀 Starting server test...');

const server = spawn('node', ['server.js'], {
  stdio: 'pipe',
  cwd: process.cwd()
});

let output = '';
let errorOutput = '';

server.stdout.on('data', (data) => {
  output += data.toString();
  console.log('STDOUT:', data.toString());
});

server.stderr.on('data', (data) => {
  errorOutput += data.toString();
  console.log('STDERR:', data.toString());
});

server.on('close', (code) => {
  console.log(`\n📊 Server exited with code ${code}`);
  console.log('\n📝 Full output:');
  console.log(output);
  if (errorOutput) {
    console.log('\n❌ Errors:');
    console.log(errorOutput);
  }
});

// Kill after 10 seconds
setTimeout(() => {
  console.log('\n⏰ Test timeout - killing server');
  server.kill();
}, 10000);
