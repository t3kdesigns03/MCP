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
Netlify hosts the **static** game. The MCP server is a **Python** process.

What we found when this was re-checked (Nov 9, 2026):
- Netlify's own MCP-server guidance builds a remote MCP server as **one Netlify Function in
  TypeScript** (`@modelcontextprotocol/sdk`, Web-standard Streamable HTTP transport,
  stateless, bearer auth, keys as secret env vars). Python is not offered as a Functions
  runtime there.
- Python on Netlify is a **build-time** language (configurable Python version in builds),
  not a deployed request handler. Community threads about Python functions agree.

So the supported routes, in order:
1. Run `mcp_server/server.py` **locally over stdio** (what MCP desktop clients launch).
2. If it must be remote and must stay on Netlify: **port the tools to a TypeScript Netlify
   Function** at `/mcp` (the tool names and `lab_state` shape stay the same; state must move
   to a durable store such as Netlify Blobs because function instances share no memory).
3. Or host the Python server on a platform that really runs Python, and keep Netlify for the
   static game.

**Re-check Netlify's runtime docs on the day you ship.** Docs change.
Never deploy a fake endpoint.

## Not done in V1 (by design)
- No real deploy. Production deploys, merges and pushes need the repo owner's explicit approval.
- No hosted MCP endpoint.

## Judgment
- Docs change, so verify runtime support at ship time.
- Anything shipped to the browser is public. Keys never go there.
- The secret scan runs on every commit, not just the first.
