export const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
} as const;

export interface Logger {
  info: (msg: string) => void;
  success: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  ws: (msg: string) => void;
  http: (msg: string) => void;
}

function timestamp(): string {
  return new Date().toISOString().replace('T', ' ').substring(0, 19);
}

export function createLogger(quiet = false): Logger {
  const write = (color: string, label: string, message: string): void => {
    if (quiet) return;
    console.log(
      `${colors.dim}[${timestamp()}]${colors.reset} ${color}[${label}]${colors.reset} ${message}`,
    );
  };

  return {
    info: (msg) => write(colors.cyan, 'INFO', msg),
    success: (msg) => write(colors.green, ' OK ', msg),
    warn: (msg) => write(colors.yellow, 'WARN', msg),
    error: (msg) => write(colors.red, ' ERR', msg),
    ws: (msg) => write(colors.magenta, ' WS ', msg),
    http: (msg) => write(colors.blue, 'HTTP', msg),
  };
}
