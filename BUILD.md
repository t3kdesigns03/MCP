# Agent0067 — V1 build notes

Hackers-style neon lab, a modern guided flow, classic Win98 device icons, and a real
FastMCP execution layer in front of five simulated systems. The front end is static
(Netlify-ready). The MCP server is local Python.

## V1 status
| Area | State |
|---|---|
| Skeleton TDZ bug (`resize()` → `draw()` before `let nodes`) | **fixed**: state loads first, then `canvas.init()` sizes and draws |
| Visual | canvas with real icons for all 6 device types, drag-place, port-drag cabling, CABLE mode, move, pan/zoom/pinch, double-click/double-tap inspect, CRT scanlines toggle |
| Experience | 6 sequential phases, graded objectives, hints, procedure + judgment tips, briefings that say what carried over, debriefs, Free Play |
| Terminal | CLiDK-style console: `?`/`help`, TAB, history, device tabs with `>` `#` `(config)#` `(config-if)#`, simulated python/pip/venv/mcp/fastmcp/git/netlify |
| Control plane | `mcp_server/server.py`: real FastMCP 4 server, 17 tools, stdio + streamable HTTP, keys from env/.env, writes behind `confirm=true` |
| Simulated systems | Email, Meraki, Monitoring, Salesforce, IPAM, each with a dashboard panel, an API-key settings page and seeded fake data |
| Verification | ping, alert, case, allocation, config push, each pass/fail in `lab_state.verification` and on the VERIFY board |
| Deploy | **not done**: `netlify.toml` is ready; nothing deployed |

## Architecture
```text
visual/js/tools.js     17 tools in JS (browser kernel), mirror of mcp_server/lab.py
visual/js/state.js     lab_state + progress (localStorage), optional bridge to the local server
visual/js/canvas.js    topology map
visual/js/terminal.js  kernel shell, device consoles, simulated toolchain, MCP client, verify
visual/js/phases.js    six phases, objectives, hints, debriefs
visual/js/panels.js    system dashboards, key settings, inspector, verify board
mcp_server/lab.py      LabStore (file-backed lab_state) + the 17 tool implementations
mcp_server/server.py   FastMCP wiring, annotations, http bridge routes (/lab/health, /lab/state, /lab/reset)
lab_state/seed.json    the one seed both sides load
```

### Why two implementations of the tools?
The static site must work on Netlify with no backend, so the browser runs a JS copy of the
tools. The real server runs the Python originals. `tests/test_parity.py` diffs 58 scripted
calls across both, so they can't drift. With the bridge on, the browser stops using its
copy and calls the Python server over real MCP JSON-RPC.

### Tool names
Dotted names (`integrations.meraki.get_devices`) are kept exactly as specified. The MCP
spec allows `.` in tool names. Some LLM APIs only accept `[A-Za-z0-9_-]`, and most MCP
hosts normalise names before handing them to a model. If a host rejects the dots, map
`.` → `_` in that host's config. The server names stay the same.

## Icons
`scripts/make_icons.py` builds `assets/icons/*.png`:
- `pc`, `switch` (10BASE-T hub), `server` are cut from the pixel-art renders in
  `assets/icons/source/` (background flood-filled to alpha)
- `router`, `firewall`, `cloud` had no source art in the repo, so they are drawn pixel
  by pixel in the same beige Win98 palette

## Deployment (not performed)
Netlify, static: publish `.`, `/` → `/visual/`, no build, no functions. Re-checked Nov 9,
2026: Netlify's own guidance hosts a remote MCP server as a **TypeScript** Netlify Function
(MCP SDK, Streamable HTTP, stateless); Python runs only at build time. So the Python server
runs locally (stdio) first; a hosted endpoint means porting the tools to a TS function or a
Python-capable host. Re-check at ship time; see `guides/06-ship.md`.
