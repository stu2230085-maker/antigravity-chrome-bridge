#!/usr/bin/env node
import { DEFAULT_HOST, DEFAULT_HTTP_PORT } from '@antigravity-bridge/protocol';
import { AntigravityBridgeClient } from '@antigravity-bridge/sdk';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpBridgeServer } from './server.js';

async function main(): Promise<void> {
  const baseUrl = process.env.AGB_URL ?? `http://${DEFAULT_HOST}:${DEFAULT_HTTP_PORT}`;
  const sessionId = process.env.AGB_SESSION;
  const authToken = process.env.AGB_TOKEN;

  const client = new AntigravityBridgeClient({
    baseUrl,
    sessionId,
    authToken,
  });

  const server = createMcpBridgeServer(client);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('agb-mcp fatal error:', err);
  process.exit(1);
});
