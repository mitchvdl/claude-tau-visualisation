# claude-tau-visualisation

A local dashboard for [Claude Code](https://claude.com/claude-code) usage, with an optional 3D "Tau" view of the same data. It shows tokens per model, cache usage, sessions, sub-agents, projects, prompts and estimated cost.

- **Stats dashboard** at `/`: tables, charts, per-session drawer, light/dark theme.
- **Tau 3D** at `/tau3d.html`: the same data as a breathing neon core. Each ring is a session, the outer dial is a 12-hour clock of calls, and bursts of new activity ripple through the scene.

Zero npm dependencies. Everything is read locally and served on loopback only.

## Install

Requires Node.js 22 or newer.

```
git clone git@github.com:mitchvdl/claude-tau-visualisation.git
cd claude-tau-visualisation
cp .env.example .env     # optional, defaults to ~/.claude
npm start
```

Open http://127.0.0.1:4477. Stop with `npm stop`; `npm run restart` stops and starts.

To read another Claude home, set `CLAUDE_HOME` in `.env` (e.g. `~/.claude-private`) and restart.

## Switching views

| Where | Key | Goes to |
|-------|-----|---------|
| Stats dashboard | `G` | Tau 3D |
| Tau 3D | `G` or `B` | Stats dashboard |

The header link "TAU 3D" does the same as `G`. Press `?` in the 3D view for all controls.

## Tau 3D controls

`1-5` / `Tab` mode (Core, Memory, Neural, Pulse, Models), `←/→` select a session ring, `Enter` details, `I` cycle issues, `X` simulate a data burst, `L` feed window, `Space` freeze, `H` HUD, `V` voice line, `C` palette (tau / ice / violet / navy), `F` fullscreen, `R` refresh, `Esc` close. Mouse: hover/click rings, wheel zooms.

The core and rings breathe slowly; the outer rings are built from small rectangular blocks, the inner ones from rounded segments. The 3D view uses three.js 0.170.0 (vendored in `public/vendor/three/`, MIT), no CDN at runtime.

## What it reads

Under `CLAUDE_HOME` only: `projects/**/*.jsonl` (including `subagents/`), `projects/*/sessions-index.json`, `history.jsonl`, `stats-cache.json`, `settings.json` and the status files `sessions/*.json` (only pid, session id, cwd, kind, name, status, waitingFor, statusUpdatedAt are kept). Credentials and `sessions/*.key` are never opened. Prompts are shown in the UI (first 300 chars), so do not expose the port beyond localhost.

## Cost

Costs are estimates at list API prices (`src/pricing.js`), i.e. what usage would cost on the API, not a subscription bill.

## API

`/api/summary`, `/api/sessions`, `/api/sessions/:id`, `/api/history`, `/api/timeseries?window=today|7d|30d|all&bucket=1m|5m|1h|6h|1d&model=a,b&session=<id>&scope=all|main|agents`, plus an SSE stream for live updates.

## macOS: custom loopback address

To bind to 127.0.1.1 instead, add the alias first: `sudo ifconfig lo0 alias 127.0.1.1 up` (not persistent across reboots), then set `HOST=127.0.1.1`.

## License

[MIT](LICENSE). three.js is MIT-licensed too, see `public/vendor/three/LICENSE`.
