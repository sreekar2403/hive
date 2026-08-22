import { Config, createDefaultConfig } from './config';
import { HiveServer } from './server';
import { OpenCodeHarness, ClaudeCodeHarness, PiHarness } from './harnesses';

async function main() {
  // Load configuration
  const config: Config = createDefaultConfig();

  // Initialize harnesses
  const harnesses = new Map<string, any>();

  const opencodeHarness = new OpenCodeHarness();
  if (await opencodeHarness.isAvailable()) {
    harnesses.set('opencode', opencodeHarness);
    console.log('OpenCode harness available');
  }

  const claudeHarness = new ClaudeCodeHarness();
  if (await claudeHarness.isAvailable()) {
    harnesses.set('claude-code', claudeHarness);
    console.log('Claude Code harness available');
  }

  const piHarness = new PiHarness();
  if (await piHarness.isAvailable()) {
    harnesses.set('pi', piHarness);
    console.log('Pi harness available');
  }

  if (harnesses.size === 0) {
    console.error('No harnesses available. Please install opencode, claude-code, or pi.');
    process.exit(1);
  }

  // Start server
  const server = new HiveServer(config, harnesses);
  await server.start();

  console.log(`Hive started with ${harnesses.size} harnesses: ${Array.from(harnesses.keys()).join(', ')}`);

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('Shutting down...');
    server.stop();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    console.log('Shutting down...');
    server.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('Failed to start Hive:', err);
  process.exit(1);
});
