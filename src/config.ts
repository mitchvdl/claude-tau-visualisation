import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from './types.ts';

try {
  process.loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url)));
} catch {
  /* no .env: defaults */
}

function expand(p: string | undefined): string | undefined {
  if (!p) return p;
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}
function int(v: string | undefined, d: number): number {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : d;
}

export const cfg: Config = {
  claudeHome: path.resolve(expand(process.env.CLAUDE_HOME) || path.join(os.homedir(), '.claude')),
  host: process.env.HOST || '127.0.0.1',
  port: int(process.env.PORT, 4477),
  refreshMs: int(process.env.REFRESH_MS, 5000),
  activeWindowMin: int(process.env.ACTIVE_WINDOW_MIN, 10),
  waitIdleSec: int(process.env.WAIT_IDLE_SEC, 45),
  publicDir: fileURLToPath(new URL('../public/', import.meta.url)),
};
