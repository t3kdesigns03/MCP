# Agent0067 — guide overview

You are a network engineer at **Neon Harbor Freight (FICTIONAL)**. You will build a
Python MCP server that lets an AI client query five simulated systems through
discoverable tools, instead of handing the AI raw API keys and docs.

Every guide is written Skills-style: a **procedure** (what to do, in order) and
**judgment** (why, and when you would do it differently). The game shows the same
tips at each stage; these files are the long form.

| Phase | Guide | You build |
|---|---|---|
| 1 DISCOVER | [01-discover.md](01-discover.md) | the API-vs-MCP integration count, the "who calls the API?" check, discovery |
| 2 KEYS | [02-keys.md](02-keys.md) | five FAKE keys stored server-side, `.env` ignored, masked output |
| 3 SCAFFOLD | [03-scaffold.md](03-scaffold.md) | venv, FastMCP, `server.py`, first tool, `fastmcp run` |
| 4 TOOLS | [04-tools.md](04-tools.md) | topology → device config → integrations → all 17 tools |
| 5 CLIENT | [05-client.md](05-client.md) | a client that discovers tools, asks, approves writes, verifies |
| 6 SHIP | [06-ship.md](06-ship.md) | static deploy plan, MCP server runtime decision, clean commit |

Also: [first-topology.md](first-topology.md) — the short canvas walkthrough.

## One scenario, carried through
Same fictional company, same five systems (Email, Meraki, Monitoring, Salesforce,
IPAM), same keys, all six phases. Every phase briefing says what carried over.

## The two warnings (from the KodeKloud "MCP vs API" video)
1. **Discovery costs context.** Every tool's name, description and schema is put in
   the model's context. The game shows the token estimate every time you connect.
2. **Keys live on the server.** Never with the model, never with the client, never
   in a prompt, never in git.

## Run it
```bash
python -m http.server 8068          # then open http://localhost:8068/visual/
```
Nothing in the game makes a real network call. The optional bridge talks only to
your own server on 127.0.0.1 (see 05-client.md).
