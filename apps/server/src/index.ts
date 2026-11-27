import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadConfig } from './config.js';
import { colors } from './logger.js';
import { createBridgeSystem } from './server.js';

export { loadConfig, type ServerConfig } from './config.js';
export {
  createCsrfAndOriginMiddleware,
  isAllowedOrigin,
  type PolicyCheckResult,
  type SecurityConfig,
  validateCommandPolicy,
  validateUrlPolicy,
} from './middleware/security.js';
export { type BridgeSystem, createBridgeSystem } from './server.js';

function printBanner(host: string, httpPort: number, wsPort: number): void {
  console.log('');
  console.log(
    `${colors.bgBlue}${colors.white}${colors.bright}                                                  ${colors.reset}`,
  );
  console.log(
    `${colors.bgBlue}${colors.white}${colors.bright}    Antigravity Chrome Bridge Server v2.0         ${colors.reset}`,
  );
  console.log(
    `${colors.bgBlue}${colors.white}${colors.bright}                                                  ${colors.reset}`,
  );
  console.log('');
  console.log(
    `  ${colors.cyan}HTTP API${colors.reset}    →  ${colors.bright}http://${host}:${httpPort}${colors.reset}`,
  );
  console.log(
    `  ${colors.magenta}WebSocket${colors.reset}   →  ${colors.bright}ws://${host}:${wsPort}${colors.reset}`,
  );
  console.log(
    `  ${colors.green}Dashboard${colors.reset}   →  ${colors.bright}http://localhost:${httpPort}/ui${colors.reset}`,
  );
  console.log(
    `  ${colors.blue}API Docs${colors.reset}    →  ${colors.bright}http://localhost:${httpPort}/docs${colors.reset}`,
  );
  console.log('');
  console.log(`  ${colors.dim}Endpoints:${colors.reset}`);
  console.log(
    `    ${colors.green}POST${colors.reset} /command            — Send command to extension`,
  );
  console.log(
    `    ${colors.green}GET ${colors.reset} /status             — Check extension connection`,
  );
  console.log(`    ${colors.green}GET ${colors.reset} /health             — Server health check`);
  console.log(
    `    ${colors.green}GET ${colors.reset} /api/v2/sessions    — List connected sessions`,
  );
  console.log(`    ${colors.green}GET ${colors.reset} /api/v2/traces      — Recent command traces`);
  console.log(`    ${colors.green}GET ${colors.reset} /api/v2/workflows   — List saved workflows`);
  console.log(`    ${colors.green}GET ${colors.reset} /api/v2/events      — Live SSE event stream`);
  console.log('');
  console.log(
    `  ${colors.dim}Waiting for Chrome extension to connect on ws://${host}:${wsPort}...${colors.reset}`,
  );
  console.log('');
}

async function main(): Promise<void> {
  const config = loadConfig({ ...process.env, QUIET: process.env.QUIET ?? '0' });
  const bridge = createBridgeSystem({ ...config, quiet: false });

  const { httpPort, wsPort } = await bridge.start();
  printBanner(config.host, httpPort, wsPort);

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    bridge.logger.warn('Shutting down bridge server...');

    const forceTimer = setTimeout(() => {
      bridge.logger.error('Forced exit after timeout');
      process.exit(1);
    }, 5000);
    forceTimer.unref();

    try {
      await bridge.stop();
      bridge.logger.info('Bridge server closed cleanly');
      process.exit(0);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      bridge.logger.error(`Error during shutdown: ${message}`);
      process.exit(1);
    }
  };

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMainModule()) {
  void main();
}
