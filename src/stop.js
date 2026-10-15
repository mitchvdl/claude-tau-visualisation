import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const PID_FILE = fileURLToPath(new URL('../.claude-stats.pid', import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try { process.kill(pid, 0); return true; } catch (e) { if (e.code === 'ESRCH') return false; throw e; }
};

async function main() {
  let raw;
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
main().catch((e) => { console.error('stop failed:', e.code || e.message); process.exit(1); });
