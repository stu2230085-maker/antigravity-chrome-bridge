import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

export function resolveDashboardDistDir(explicitDir?: string): string {
  if (explicitDir && explicitDir.trim().length > 0) {
    return resolve(explicitDir.trim());
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(here, '../../../dashboard/dist'),
    resolve(here, '../../dashboard/dist'),
    resolve(process.cwd(), 'apps/dashboard/dist'),
  ];

  for (const candidate of candidates) {
    if (existsSync(resolve(candidate, 'index.html'))) {
      return candidate;
    }
  }

  return candidates[0] as string;
}

export function readDashboardAsset(
  dashboardDir: string,
  requestPath: string,
): { content: Buffer; contentType: string } | null {
  const normalizedSubPath = requestPath
    .replace(/^\/ui\/?/, '')
    .split('?')[0]
    ?.replace(/^\/+/, '');
  const relativeTarget =
    !normalizedSubPath || normalizedSubPath.length === 0 ? 'index.html' : normalizedSubPath;

  const rootDir = resolve(dashboardDir);
  const candidate = resolve(rootDir, relativeTarget);
  if (candidate !== rootDir && !candidate.startsWith(`${rootDir}${sep}`)) {
    return null;
  }

  let fileToServe = candidate;
  if (!existsSync(fileToServe) || statSync(fileToServe).isDirectory()) {
    // Fallback to index.html for SPA subpaths without file extension
    if (!relativeTarget.includes('.')) {
      fileToServe = resolve(rootDir, 'index.html');
    } else {
      return null;
    }
  }

  if (!existsSync(fileToServe) || statSync(fileToServe).isDirectory()) {
    return null;
  }

  const ext = extname(fileToServe).toLowerCase();
  const contentType = MIME_TYPES[ext] ?? 'application/octet-stream';
  return {
    content: readFileSync(fileToServe),
    contentType,
  };
}
