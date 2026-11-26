import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  DEFAULT_HOST,
  DEFAULT_HTTP_PORT,
  DEFAULT_TRACE_BUFFER_SIZE,
  DEFAULT_WS_PORT,
} from '@antigravity-bridge/protocol';

export interface ServerConfig {
  host: string;
  httpPort: number;
  wsPort: number;
  commandTimeoutMs: number;
  traceBufferSize: number;
  quiet?: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const httpPort = env.HTTP_PORT !== undefined ? Number(env.HTTP_PORT) : DEFAULT_HTTP_PORT;
  const wsPort = env.WS_PORT !== undefined ? Number(env.WS_PORT) : DEFAULT_WS_PORT;
  const commandTimeoutMs =
    env.COMMAND_TIMEOUT_MS !== undefined
      ? Number(env.COMMAND_TIMEOUT_MS)
      : DEFAULT_COMMAND_TIMEOUT_MS;
  const traceBufferSize =
    env.TRACE_BUFFER_SIZE !== undefined ? Number(env.TRACE_BUFFER_SIZE) : DEFAULT_TRACE_BUFFER_SIZE;

  return {
    host: env.HOST || DEFAULT_HOST,
    httpPort: Number.isFinite(httpPort) ? httpPort : DEFAULT_HTTP_PORT,
    wsPort: Number.isFinite(wsPort) ? wsPort : DEFAULT_WS_PORT,
    commandTimeoutMs:
      Number.isFinite(commandTimeoutMs) && commandTimeoutMs > 0
        ? commandTimeoutMs
        : DEFAULT_COMMAND_TIMEOUT_MS,
    traceBufferSize:
      Number.isFinite(traceBufferSize) && traceBufferSize > 0
        ? traceBufferSize
        : DEFAULT_TRACE_BUFFER_SIZE,
    quiet: env.QUIET === '1' || env.NODE_ENV === 'test',
  };
}
