import http from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { cfg } from './config.ts';
import * as scanner from './scanner.ts';
import { buildSummary, buildSessionList, buildSessionDetail, buildTimeseries } from './aggregate.ts';

const TYPES: Record<string, string> = {
  '.ts': 'text/javascript; charset=utf-8', '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.map': 'application/json',
};
const clients = new Set<ServerResponse>();
scanner.onChange((ev) => { const msg = `data: ${JSON.stringify(ev)}\n\n`; for (const c of clients) c.write(msg); });
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000).unref();

const ready = scanner.start();

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

// Browser code is TypeScript: types are stripped on the fly (no build step), cached per file mtime.
const tsCache = new Map<string, { mtimeMs: number; js: string }>();
async function transpiled(full: string): Promise<string> {
  const { mtimeMs } = await fsp.stat(full);
  const hit = tsCache.get(full);
  if (hit && hit.mtimeMs === mtimeMs) return hit.js;
  const js = stripTypeScriptTypes(await fsp.readFile(full, 'utf8'));
  tsCache.set(full, { mtimeMs, js });
  return js;
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  let rel: string;
  try { rel = decodeURIComponent(pathname); } catch { return notFound(res); }
  if (rel === '/') rel = '/index.html';
  if (rel.includes('\0') || rel.split('/').some((p) => p.startsWith('.'))) return notFound(res);
  const full = path.resolve(cfg.publicDir, '.' + rel);
  if (!full.startsWith(path.resolve(cfg.publicDir) + path.sep)) return notFound(res);
  try {
    const ext = path.extname(full);
    const data = ext === '.ts' ? await transpiled(full) : await fsp.readFile(full);
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch { notFound(res); }
}
function notFound(res: ServerResponse): void { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); }

async function handler(req: IncomingMessage, res: ServerResponse): Promise<ServerResponse | void> {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
  let u: URL;
  try { u = new URL(req.url.replace(/^\/{2,}/, '/'), 'http://localhost'); }
  catch { res.writeHead(400, { 'Content-Type': 'text/plain' }); return res.end('Bad request'); }
  const p = u.pathname;
  try {
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${JSON.stringify({ type: 'hello', scannedAt: scanner.meta.lastScan })}\n\n`);
      clients.add(res);
      req.on('close', () => clients.delete(res));
      return;
    }
    if (p.startsWith('/api/')) {
      await ready;
      const st = scanner.state;
      if (p === '/api/summary') return json(res, 200, buildSummary(st, scanner.meta));
      if (p === '/api/sessions') {
        const limit = Math.min(Math.max(parseInt(u.searchParams.get('limit'), 10) || 200, 1), 5000);
        const sort = u.searchParams.get('sort') || 'last';
        return json(res, 200, buildSessionList(st, { limit, sort }));
      }
      const m = p.match(/^\/api\/sessions\/([\w-]+)$/);
      if (m) {
        const d = buildSessionDetail(st, m[1]);
        return d ? json(res, 200, d) : json(res, 404, { error: 'unknown session' });
      }
      if (p === '/api/timeseries') {
        const q = u.searchParams;
        const r = buildTimeseries(st, { window: q.get('window') || '7d', bucket: q.get('bucket') || undefined, model: q.get('model') || undefined, session: q.get('session') || undefined, scope: q.get('scope') || 'all' });
        return json(res, r.error ? 400 : 200, r);
      }
      if (p === '/api/history') {
        const limit = Math.min(Math.max(parseInt(u.searchParams.get('limit'), 10) || 100, 1), 1000);
        return json(res, 200, st.hist.entries.slice(-limit).reverse());
      }
      return json(res, 404, { error: 'not found' });
    }
    await serveStatic(res, p);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'internal error' }); else res.end();
  }
}

const PID_FILE = fileURLToPath(new URL('../.claude-stats.pid', import.meta.url));
let server: Server | null = null;
function cleanupPid() { try { if (fs.readFileSync(PID_FILE, 'utf8').trim() === String(process.pid)) fs.unlinkSync(PID_FILE); } catch { /* ignore */ } }
process.on('exit', cleanupPid);
function shutdown(sig: string): void {
  console.log(`[${sig}] shutting down`);
  scanner.stop();
  setTimeout(() => process.exit(0), 3000).unref();
  for (const c of clients) { try { c.end(); } catch { /* ignore */ } }
  clients.clear();
  if (server) { server.close(() => process.exit(0)); server.closeAllConnections?.(); } else process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

function listen(host: string, canFallback: boolean): void {
  const srv = http.createServer(handler);
  srv.once('error', (e: NodeJS.ErrnoException) => {
    if (e.code === 'EADDRNOTAVAIL' && canFallback) {
      console.error(`\n[bind] ${host} is not assigned to any interface (EADDRNOTAVAIL).`);
      console.error('[bind] On macOS add the loopback alias with:\n\n    sudo ifconfig lo0 alias 127.0.1.1 up\n');
      console.error('[bind] Falling back to 127.0.0.1 on the same port.\n');
      return listen('127.0.0.1', false);
    }
    if (e.code === 'EADDRINUSE') console.error(`[bind] ${host}:${cfg.port} is already in use. Change PORT in .env or stop the other process.`);
    else console.error('[bind] failed:', e.message);
    process.exit(1);
  });
  srv.listen(cfg.port, host, () => {
    server = srv;
    try { fs.writeFileSync(PID_FILE, String(process.pid)); } catch (e) { console.error('[pid] could not write pid file:', e.message); }
    console.log(`claude-stats reading ${cfg.claudeHome}`);
    console.log(`claude-stats listening on http://${host}:${cfg.port}`);
  });
}
listen(cfg.host, cfg.host !== '127.0.0.1');
