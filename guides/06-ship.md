# Phase 6 — SHIP: static game on Netlify, MCP server on a real runtime

**Carried over:** a verified lab, the 17-tool server, the client session, the same keys.

## Procedure (simulated in the game; nothing deploys)
1. `verify all`: five green checks in one run.
2. `cat netlify.toml`: publish `.`, `/` redirects to `/visual/`, no functions.
3. `netlify deploy` is a dry run. It lists what *would* upload (the static game) and what
   would not (`.env`, `.venv/`, `mcp_server/`). `--prod` is blocked.
4. `answer b`: local Python first, then a runtime that really runs Python.
5. `git add .`, then `git commit -m "ship v1"`. The secret scan must pass.

## The MCP server runtime: check, don't assume
Netlify hosts the **static** game. The MCP server is a **Python** process. When this was
written (Nov 2026) we couldn't find current Netlify docs listing Python as a deployed
Functions runtime. Community answers list JavaScript/TypeScript and Go, and say Python
runs only during builds. **Re-check Netlify's runtime docs when you ship.** Until a
supported route is confirmed:
- run the server **locally over stdio** (what MCP desktop clients expect), or
- host it on a platform with a real Python runtime, or
- port the tools to a supported Functions language.

Never deploy a fake endpoint.

## Not done in V1 (by design)
- No real deploy. Production deploys, merges and pushes need the repo owner's explicit approval.
- No hosted MCP endpoint.

## Judgment
- Docs change, so verify runtime support at ship time.
- Anything shipped to the browser is public. Keys never go there.
- The secret scan runs on every commit, not just the first.
