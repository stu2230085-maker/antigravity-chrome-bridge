import type { AddressInfo } from 'node:net';
import { serve } from '@hono/node-server';
import type { Hono } from 'hono';
import { WebSocketServer } from 'ws';
import { loadConfig, type ServerConfig } from './config.js';
import { createLogger, type Logger } from './logger.js';
import { createApiApp } from './routes/api.js';
import { SessionManager } from './services/session-manager.js';
import { TraceStore } from './services/trace-store.js';
import { attachWsHub } from './ws/ws-hub.js';

export type NodeHttpServer = ReturnType<typeof serve>;

export interface BridgeSystem {
  app: Hono;
  httpServer: NodeHttpServer;
  wss: WebSocketServer;
  sessionManager: SessionManager;
  traceStore: TraceStore;
  config: ServerConfig;
  logger: Logger;
  start: () => Promise<{ httpPort: number; wsPort: number }>;
  stop: () => Promise<void>;
}

export function createBridgeSystem(partialConfig: Partial<ServerConfig> = {}): BridgeSystem {
  const baseConfig = loadConfig();
  const config: ServerConfig = {
    ...baseConfig,
    ...partialConfig,
  };

  const logger = createLogger(config.quiet);
  const traceStore = new TraceStore(config.traceBufferSize);
  const sessionManager = new SessionManager(config.commandTimeoutMs, traceStore, logger);
  const app = createApiApp(sessionManager, traceStore, logger);

  let httpServer: NodeHttpServer | undefined;
  let wss: WebSocketServer | undefined;
  let started = false;

  // Create WebSocketServer lazily inside start() or immediately?
  // Exposing wss on BridgeSystem before start or binding on start:
  // If port 0 is passed, binding inside start() avoids listening twice while still creating wss cleanly.
  wss = new WebSocketServer({ noServer: true });

  // Use a separate WSS bound to wsPort during start()
  let boundWss: WebSocketServer | undefined;

  // Actually create real WebSocketServer only when start() runs so dynamic port 0 works cleanly
  const start = async (): Promise<{ httpPort: number; wsPort: number }> => {
    if (started && httpServer && boundWss) {
      const httpAddr = httpServer.address() as AddressInfo;
      const wsAddr = boundWss.address() as AddressInfo;
      return { httpPort: httpAddr.port, wsPort: wsAddr.port };
    }

    boundWss = await new Promise<WebSocketServer>((resolve, reject) => {
      const server = new WebSocketServer({ host: config.host, port: config.wsPort });
      const onError = (err: Error): void => {
        server.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = (): void => {
        server.removeListener('error', onError);
        resolve(server);
      };
      server.once('error', onError);
      server.once('listening', onListening);
    });

    attachWsHub(boundWss, sessionManager, logger);
    system.wss = boundWss;

    const wsAddr = boundWss.address() as AddressInfo;
    logger.success(`WebSocket server listening on ws://${config.host}:${wsAddr.port}`);

    httpServer = await new Promise<NodeHttpServer>((resolve, reject) => {
      const srv = serve({
        fetch: app.fetch,
        hostname: config.host,
        port: config.httpPort,
      });
      const onError = (err: Error): void => {
        srv.removeListener('listening', onListening);
        reject(err);
      };
      const onListening = (): void => {
        srv.removeListener('error', onError);
        resolve(srv);
      };
      srv.once('error', onError);
      srv.once('listening', onListening);
    });

    system.httpServer = httpServer;
    const httpAddr = httpServer.address() as AddressInfo;
    logger.success(`HTTP API server listening on http://${config.host}:${httpAddr.port}`);

    started = true;
    return {
      httpPort: httpAddr.port,
      wsPort: wsAddr.port,
    };
  };

  const stop = async (): Promise<void> => {
    sessionManager.rejectAllPending('Server shutting down');

    if (boundWss) {
      for (const client of boundWss.clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => {
        boundWss?.close(() => resolve());
      });
      boundWss = undefined;
    }

    if (wss) {
      await new Promise<void>((resolve) => {
        wss?.close(() => resolve());
      });
    }

    if (httpServer) {
      await new Promise<void>((resolve) => {
        httpServer?.close(() => resolve());
      });
      httpServer = undefined;
    }

    started = false;
  };

  const system: BridgeSystem = {
    app,
    httpServer: undefined as unknown as NodeHttpServer,
    wss,
    sessionManager,
    traceStore,
    config,
    logger,
    start,
    stop,
  };

  return system;
}
