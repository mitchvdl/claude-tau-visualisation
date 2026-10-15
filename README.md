# claude-tau-visualisation

A local dashboard for [Claude Code](https://claude.com/claude-code) usage, with an optional 3D "Tau" view of the same data. It shows tokens per model, cache usage, sessions, sub-agents, projects, prompts and estimated cost.

- **Stats dashboard** at `/`: tables, charts, per-session drawer, light/dark theme.
- **Tau 3D** at `/tau3d.html`: the same data as a breathing neon core. Each ring is a session, the outer dial is a 12-hour clock of calls, and bursts of new activity ripple through the scene.

Zero npm dependencies. Everything is read locally and served on loopback only.

## Install

Requires Node.js 22.18 or newer. The code is TypeScript; Node strips the types at runtime (server) and on the fly when serving files to the browser, so there is no build step.

```
git clone git@github.com:mitchvdl/claude-tau-visualisation.git
cd claude-tau-visualisation
cp .env.example .env     # optional, defaults to ~/.claude
npm start
```

Open http://127.0.0.1:4477. Stop with `npm stop`; `npm run restart` stops and starts.

To read another Claude home, set `CLAUDE_HOME` in `.env` (e.g. `~/.claude-private`) and restart.

## Switching views

The dashboard header has a **Stats | 3D** switch. Press `G` on the dashboard to open Tau 3D as a full-screen layer on the same page (the URL becomes `/#3d`, so it can be bookmarked); press `G` or `B` in the 3D view to go back. `/tau3d.html` still works as a standalone page. Closing the layer unloads the 3D scene, so it uses no GPU while you look at the stats.

## Tau 3D controls

`1-5` / `Tab` mode (Core, Memory, Neural, Pulse, Models), `←/→` select a session ring, `Enter` details, `I` cycle issues, `X` simulate a data burst, `L` feed window, `Space` freeze, `H` HUD, `V` voice line, `C` palette (tau / ice / violet / navy / spectrum, which fades slowly through all colours), `F` fullscreen, `R` refresh, `Esc` close. Mouse: hover/click rings, wheel zooms.

Mode, palette, HUD, voice and the pulse window are remembered in `localStorage` (`tau3d.settings`); URL params such as `?mode=` and `?pal=` override them. The outer dial is an analog clock: the dot with the comet tail is the seconds (one lap per minute), the short bright stripe inside the dial is the minutes, and the long stripe outside is the hour, gliding through its hour wedge (stripe length = calls in that hour; the other 11 stripes are the previous hours). Hover the dot for hh:mm:ss. The core and rings breathe slowly; the outer rings are built from small rectangular blocks, the inner ones from rounded segments. The 3D view uses three.js 0.170.0 (vendored in `public/vendor/three/`, MIT), no CDN at runtime.

### Resuming a session

The session drawer (dashboard) and the detail panel (3D, `Enter`) show the full session id with **Copy ID** and **Copy resume command** buttons. The latter copies `cd '<project dir>' && claude --resume <id>`.

### Agent box and settings

When a sub-agent is running, a faded box in the bottom-right corner (mirroring the feed) shows the newest agent's type, model, description and the prompt it was given, with its recent output text drifting slowly upward behind a fade. It lingers ~25 s after the agent finishes. `?demo=agent` shows a fake one.

Press `O` (or `,`) for the settings panel: palette, spectrum lap time, bloom, breathing, bar width and where the rectangular bars start, motion speed, camera drift, frame rate, HUD / voice / feed toggles and the agent box (on/off, output text, opacity, scroll speed). Everything is saved in this browser and `Reset to defaults` restores the look.

## What it reads

Under `CLAUDE_HOME` only: `projects/**/*.jsonl` (including `subagents/`), `projects/*/sessions-index.json`, `history.jsonl`, `stats-cache.json`, `settings.json` and the status files `sessions/*.json` (only pid, session id, cwd, kind, name, status, waitingFor, statusUpdatedAt are kept). Credentials and `sessions/*.key` are never opened. Prompts are shown in the UI (first 300 chars), and the API also returns each sub-agent's first prompt (600 chars) and the last ~1,500 characters of its output text for the agent box, so do not expose the port beyond localhost.

## Cost

Costs are estimates at list API prices (`src/pricing.js`), i.e. what usage would cost on the API, not a subscription bill.

## API

`/api/summary`, `/api/sessions`, `/api/sessions/:id`, `/api/history`, `/api/timeseries?window=today|7d|30d|all&bucket=1m|5m|1h|6h|1d&model=a,b&session=<id>&scope=all|main|agents`, plus an SSE stream for live updates.

## macOS: custom loopback address

To bind to 127.0.1.1 instead, add the alias first: `sudo ifconfig lo0 alias 127.0.1.1 up` (not persistent across reboots), then set `HOST=127.0.1.1`.

## Development

- `npm run typecheck` runs `tsc --noEmit` (needs `npm install` for the dev-only type packages).
- `src/` is the server (`types.ts` holds the shared API shapes), `public/app.ts` the dashboard, `public/tau3d/*.ts` the 3D view split into modules (`shared.ts` holds the mutable view state `S` and the late-bound function registry `H`).
- Only erasable TypeScript is allowed (no `enum`, `namespace`, parameter properties).

## License

[MIT](LICENSE). three.js is MIT-licensed too, see `public/vendor/three/LICENSE`.
