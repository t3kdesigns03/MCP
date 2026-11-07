# Agent0067 — Build the MCP Server

A browser game that teaches, by doing, how to build an MCP server. You are a network
engineer putting a **Python FastMCP server** in front of five simulated systems (Email,
Meraki, Monitoring, Salesforce, IPAM), so an AI client can discover and call tools
instead of being handed raw API keys and docs.

> **Everything is fictional.** Neon Harbor Freight, its sites, people, `10.67.0.0/16`
> addresses, `*.example` domains and every key are fake. The game makes no network
> calls to real services, and the server only accepts keys shaped `FAKE-<SYSTEM>-<32 hex>`.

## Play
```bash
python -m http.server 8068
# open http://localhost:8068/visual/
```
Works at 390px (phone) and on desktop. Progress lives in `localStorage`; no account.
(Opening `visual/index.html` straight from disk won't work, because browsers block
`fetch()` on `file://`. The page tells you this if you try.)

Six phases, unlocked in order: **DISCOVER → KEYS → SCAFFOLD → TOOLS → CLIENT → SHIP**.
Guides: [`guides/`](guides/00-overview.md).

## The real MCP server
```bash
python -m venv .venv
source .venv/bin/activate                  # Windows: .venv\Scripts\activate
pip install -r mcp_server/requirements.txt
cp .env.example .env                       # paste FAKE keys generated in the game

fastmcp run mcp_server/server.py           # stdio (what MCP clients launch)
fastmcp list mcp_server/server.py          # discovery: 17 tools
python mcp_server/client_demo.py           # a real client: initialize → tools/list → tools/call
python mcp_server/server.py --http         # 127.0.0.1:8067/mcp + /lab bridge for the game
```
With `--http` running, open the game's **menu › Local server bridge › TURN ON**. Canvas
changes land in `lab_state/state.json` (read by `lab.topology.get`), and the in-game client
speaks real MCP JSON-RPC to your server.

### Tools (17)
`lab.topology.get` · `lab.topology.add_node` · `lab.topology.connect` · `lab.device.list` ·
`lab.device.inspect` · `lab.device.run_command` · `integrations.email.list` ·
`integrations.email.send`* · `integrations.meraki.get_networks` ·
`integrations.meraki.get_devices` · `integrations.meraki.update_config`* ·
`integrations.monitoring.get_alerts` · `integrations.monitoring.get_metrics` ·
`integrations.salesforce.query` · `integrations.salesforce.create_case`* ·
`integrations.ipam.get_subnets` · `integrations.ipam.allocate`*

\* write: returns a preview with `status: confirmation_required` until called with `confirm=true`.

## Tests
```bash
.venv/Scripts/python -m unittest discover -s tests -v    # macOS/Linux: .venv/bin/python
python scripts/check_no_keys.py                           # secret scan of tracked files
```
- `tests/test_server.py` drives the real FastMCP server over the MCP protocol: discovery,
  all five systems, keys server-side.
- `tests/test_parity.py` runs 58 scripted calls through the Python tools and the browser
  mirror (`visual/js/tools.js`, via Node) and diffs every result.

CI (`.github/workflows/ci.yml`) runs the secret scan, a JS syntax check and both test
files on every push to `main` and every pull request.

## Layout
```text
visual/            game: index.html, css/, js/ (tools, state, canvas, terminal, phases, panels, app)
assets/icons/      classic Win98-style device icons (+ source/ renders; scripts/make_icons.py)
mcp_server/        server.py (FastMCP), lab.py (state + 17 tools), client_demo.py
lab_state/         seed.json (tracked) · state.json (runtime, ignored)
guides/            one guide per phase
tests/             protocol tests + JS/Python parity
scripts/           make_icons.py, check_no_keys.py
```

## Deploy
Netlify serves the static game (`netlify.toml`, no build step, no functions). The Python
MCP server is **not** part of that deploy; see [guides/06-ship.md](guides/06-ship.md).
Nothing in this repo has been deployed.
