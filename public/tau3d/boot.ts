import { CFG, H, S } from './shared.ts';
import { $, params } from './dom.ts';
import { fmtTok } from './util.ts';
import { data } from './data.ts';

/* ============================================================ boot screen: terminal-style start-up, also replayed (shorter, see-through) when a lost link is restored */
const el = $('boot'), pre = $('bootText'), bar = $('bootBar');
let run = 0, skip = false;
export const booting = (): boolean => el.classList.contains('on');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const dots = (label: string, value: string) => `[ OK ] ${label} ${'.'.repeat(Math.max(3, 28 - label.length))} ${value}`;
async function typeLine(text: string, cls?: string) {
  const d = document.createElement('div'); if (cls) d.className = cls; pre.append(d);
  for (let i = 0; i <= text.length && !skip; i += 2) { d.textContent = text.slice(0, i); await sleep(11); }
  d.textContent = text;
}
async function waitData(maxMs: number) { const t0 = performance.now(); while (!data.summary && performance.now() - t0 < maxMs && !skip) await sleep(100); }

export async function playBoot(kind: 'boot' | 'relink', offlineSec = 0, force = false): Promise<void> {
  if (!CFG.bootScreen && !force) return;
  const me = ++run; skip = false; pre.textContent = ''; bar.style.width = '0%'; el.classList.toggle('relink', kind === 'relink'); el.classList.add('on');
  const sm = () => data.summary, t = () => (sm() && sm().totals) || ({} as Record<string, number>);
  const steps: [string, () => string][] = kind === 'boot'
    ? [['memory bus', () => 'online'], ['reading memory', () => S.privacy ? '~/***' : (sm() && sm().config && sm().config.claudeHome || '-').replace(/^\/Users\/[^/]+/, '~')], ['sessions indexed', () => String(t().sessions ?? '-')],
       ['tokens held', () => fmtTok(t().total)], ['sub-minds awake', () => String(sm() ? sm().activeAgents || 0 : '-')], ['clock sync', () => new Date().toLocaleTimeString([], { hour12: false })]]
    : [['carrier lock', () => 'acquired'], ['resync memory', () => `${t().sessions ?? '-'} sessions`], ['flush stale frames', () => 'done']];
  await typeLine(kind === 'boot' ? 'TAU // MEMORY CORE' : 'SIGNAL REACQUIRED', 'h'); if (kind === 'boot') await typeLine('waking...', 'dim');
  for (let i = 0; i < steps.length && me === run; i++) {
    if (i === 1 || (kind === 'relink' && i === 1)) await waitData(6000); // lines that quote data wait for the first response
    await typeLine(dots(steps[i][0], steps[i][1]())); bar.style.width = Math.round(((i + 1) / steps.length) * 100) + '%'; if (!skip) await sleep(60 + Math.random() * 140);
  }
  if (me !== run) return;
  await typeLine(kind === 'boot' ? 'LINK ESTABLISHED' : `LINK RESTORED · offline ${mmss(offlineSec)}`, 'ok');
  if (!skip) await sleep(kind === 'boot' ? 520 : 380);
  if (me !== run) return;
  el.classList.remove('on'); H.shock(); S.flash = Math.max(S.flash, kind === 'boot' ? 0.7 : 0.4);
}
const skipBoot = (e: Event) => { if (booting()) { skip = true; if (e.type === 'keydown') e.stopPropagation(); } };
addEventListener('keydown', skipBoot, true); el.addEventListener('click', () => { skip = true; });
Object.assign(H, { playBoot });
// first load: boot unless it is a screenshot run (?shot=1) or switched off (?boot=0); ?boot=1 forces it
const bp = params.get('boot');
if (bp === 'relink') void playBoot('relink', 42, true); // ?boot=relink previews the reconnect version
else if (bp === '1' || (bp !== '0' && params.get('shot') !== '1')) void playBoot('boot', 0, bp === '1');
