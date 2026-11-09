# Phase 1 — DISCOVER: API vs MCP, by doing

**Carried over:** nothing yet. An empty map and five fictional systems.

## Procedure
1. `apps add ChatOps`, then `wire --raw`. Five lines appear: one hand-built
   integration per service, each with its own auth, SDK, docs and error handling.
2. `apps add OpsBot`, `wire --raw`. The count doubles: **2 × 5 = 10**.
3. `wire --mcp`. One MCP server sits *in front of* the five APIs (one adapter per API,
   written once). Each app speaks MCP once. Count: **2 + 5 = 7**.
4. `quiz`, then `answer b`.
5. `discover`. The client sends `tools/list`, and the model picks
   `integrations.meraki.get_devices` from names, descriptions and schemas alone.

## Judgment
- **MCP does not replace APIs.** The Meraki API is still the Meraki API. MCP is a
  translator and discovery layer on top of it.
- **The model never calls the API.** It returns a tool choice. The *app* sends
  `tools/call` to the MCP server, and the *server* calls the API with the key it holds.
- **Be honest about the math.** With one app, MCP is more pieces (6 vs 5). It pays off
  as apps × services grows: 10 apps is 15 vs 50.
- **Discovery is not free.** All 17 tool descriptions cost roughly 1.3k tokens (the
  game's compact schemas) to 2.8k tokens (the real FastMCP `tools/list` payload),
  carried into every turn.

## Debrief numbers
| apps | raw (apps × 5) | MCP (apps + 5) |
|---|---|---|
| 1 | 5 | 6 |
| 2 | 10 | 7 |
| 3 | 15 | 8 |
| 10 | 50 | 15 |
