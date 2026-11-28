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
  workflowsFile?: string;
  dashboardDir?: string;
  quiet?: boolean;
  authToken?: string;
  wsRequireToken?: boolean;
  allowedDomains?: string[];
  blockedDomains?: string[];
  allowFileUrls?: boolean;
  rateLimitPerMin?: number;
  trustProxy?: boolean;
  allowedOrigins?: string[];
}

function parseDomainList(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const patterns = raw
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item.length > 0);
  return patterns.length > 0 ? patterns : undefined;
}

function parseOriginList(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const origins = raw
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, '').toLowerCase())
    .filter((item) => item.length > 0);
  return origins.length > 0 ? origins : undefined;
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
  const workflowsFile = env.AGB_WORKFLOWS_FILE?.trim() || undefined;
  const dashboardDir = env.AGB_DASHBOARD_DIR?.trim() || undefined;
  const authToken = env.AGB_AUTH_TOKEN?.trim() || undefined;
  const wsRequireToken = env.AGB_WS_REQUIRE_TOKEN === 'true';
  const allowedDomains = parseDomainList(env.AGB_ALLOWED_DOMAINS);
  const blockedDomains = parseDomainList(env.AGB_BLOCKED_DOMAINS);
  const allowFileUrls = env.AGB_ALLOW_FILE_URLS === 'true';
  const rawRateLimit = Number(env.AGB_RATE_LIMIT_PER_MIN);
  const rateLimitPerMin =
    Number.isFinite(rawRateLimit) && rawRateLimit > 0 ? Math.floor(rawRateLimit) : 600;
  const trustProxy = env.AGB_TRUST_PROXY === 'true';
  const allowedOrigins = parseOriginList(env.AGB_ALLOWED_ORIGINS);

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
    workflowsFile,
    dashboardDir,
    quiet: env.QUIET === '1' || env.NODE_ENV === 'test',
    authToken,
    wsRequireToken,
    allowedDomains,
    blockedDomains,
    allowFileUrls,
    rateLimitPerMin,
    trustProxy,
    allowedOrigins,
  };
}
