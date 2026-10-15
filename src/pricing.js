// ESTIMATE ONLY: USD per 1M tokens at list API prices. If you are on a
// subscription this is "what it would have cost on the API", not a bill.
// [prefix, input, output, cacheRead]
const RAW = [
  ['claude-fable-5-1', 10, 50, 0.25],
  ['claude-fable-5', 10, 50, 1.0],
  ['claude-opus-5-5', 4, 20, 0.2],
  ['claude-opus-5', 5, 25, 0.5],
  ['claude-opus-4-8', 5, 25, 0.5],
  ['claude-opus-4-7', 5, 25, 0.5],
  ['claude-opus-4-6', 5, 25, 0.5],
  ['claude-opus-4-5', 5, 25, 0.5],
  ['claude-sonnet-5-5', 2, 10, 0.2],
  ['claude-sonnet-5', 2, 10, 0.2],
  ['claude-sonnet-4-6', 3, 15, 0.3],
  ['claude-sonnet-4-5', 3, 15, 0.3],
  ['claude-haiku-5-5', 0.1, 0.5, 0.01],
  ['claude-haiku-4-5', 1, 5, 0.1],
];
// longest prefix first so claude-opus-5-5 wins over claude-opus-5
const TABLE = RAW.map(([p, i, o, r]) => ({ p, in: i, out: o, cr: r })).sort((a, b) => b.p.length - a.p.length);
const cache = new Map();

export function priceFor(model) {
  const key = String(model || '');
  if (cache.has(key)) return cache.get(key);
  const m = key.replace(/-\d{8}$/, '');
  let found = null;
  for (const t of TABLE) {
    if (m.startsWith(t.p) && !/\d/.test(m.charAt(t.p.length) || '')) { found = t; break; }
  }
  cache.set(key, found);
  return found;
}

/** tokens: {input, cw5, cw1, cr, out}. Returns {cost, unknown}. */
export function costOf(model, t) {
  const p = priceFor(model);
  if (!p) return { cost: 0, unknown: true };
  const cost = (t.input * p.in + t.out * p.out + t.cr * p.cr + t.cw5 * p.in * 1.25 + t.cw1 * p.in * 2) / 1e6;
  return { cost, unknown: false };
}
