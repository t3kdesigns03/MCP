# Phase 5 — CLIENT: discover, ask, approve, verify

**Carried over:** your topology, five attached systems, 17 tools on a running server,
keys server-side.

## Procedure
1. `client connect`: `initialize`, then `tools/list`. Read the token estimate.
2. `ask "which sites are down?"`. The model picks `integrations.meraki.get_networks`.
   (In the browser the "model" is a transparent keyword router, not an LLM, and the game
   says so.) The app executes the call, and the server uses its key.
3. Run verification. Each check is a chain of real tool calls, and its pass/fail is
   stored in `lab_state.verification` and shown on the VERIFY board:
   - `verify ping PC-01 CLOUD-01` runs `lab.device.run_command ping`
   - `verify alert CORE-SW` runs `send test-trap`, then `monitoring.get_alerts`
   - `ask "open a case for the dockside outage"` → `y` (or `verify case`)
   - `ask "allocate an ip for the label printer"` → `y` (or `verify allocate`)
   - `verify config CORE-SW` runs `meraki.update_config`, then `device.inspect` (the vlan changes on the map)

## Do it for real
```bash
python mcp_server/client_demo.py      # real MCP client over stdio: discovery + a call
python mcp_server/server.py --http    # 127.0.0.1:8067/mcp + /lab bridge
```
With the HTTP server running and the game served from localhost, open
**menu › Local server bridge › TURN ON**. Then `client connect`, `ask` and `verify`
send real MCP JSON-RPC to your Python server, and canvas changes land in
`lab_state/state.json`, where `lab.topology.get` reads them. Any other MCP client that
writes (for example `ipam.allocate` with `node_id`) shows up on the canvas within a poll.

## Judgment
- The token count on connect is paid on every turn. Fewer, sharper tools beat many vague ones.
- Read the preview before you type `y`.
- When a key is missing, the fix is on the **server** (`.env`), never in the chat.
