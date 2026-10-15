import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const PID_FILE = fileURLToPath(new URL('../.claude-stats.pid', import.meta.url));
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ESRCH') return false; throw e; }
};

async function main(): Promise<void> {
  let raw: string;
  try { raw = fs.readFileSync(PID_FILE, 'utf8').trim(); } catch { console.log('not running'); return; }
  const pid = parseInt(raw, 10);
  if (!Number.isInteger(pid) || pid <= 0 || !alive(pid)) {
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    console.log('not running (removed stale pid file)');
    return;
  }
  process.kill(pid, 'SIGTERM');
  for (let i = 0; i < 50; i++) {
    await sleep(100);
    if (!alive(pid)) { try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ } console.log(`stopped (pid ${pid})`); return; }
  }
  process.kill(pid, 'SIGKILL');
  try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
  console.log(`did not exit within 5s, sent SIGKILL (pid ${pid})`);
}
main().catch((e: NodeJS.ErrnoException) => { console.error('stop failed:', e.code || e.message); process.exit(1); });
