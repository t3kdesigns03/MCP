# Phase 3 — SCAFFOLD: a real FastMCP server, first tool

**Carried over:** five FAKE keys in `.env` (git-ignored), the five systems.

## Procedure (in the game, then for real)
```bash
python --version                      # 3.10+
python -m venv .venv
source .venv/bin/activate             # Windows: .venv\Scripts\activate
pip install fastmcp python-dotenv     # repo: pip install -r mcp_server/requirements.txt
```
In the game, `scaffold server.py`, then `tool add lab.topology.get`, then `y`. The code
it writes is the same shape as `mcp_server/server.py`:
```python
from dotenv import load_dotenv
from fastmcp import FastMCP
load_dotenv()                          # keys live on the server
mcp = FastMCP("agent0067-lab")

@mcp.tool(name="lab.topology.get", annotations={"readOnlyHint": True})
def topology_get() -> dict:
    """Return the lab topology: nodes and cabled edges."""
    return lab.topology_get()

if __name__ == "__main__":
    mcp.run()                          # stdio
```
Then:
```bash
fastmcp run mcp_server/server.py      # or: python mcp_server/server.py
fastmcp list mcp_server/server.py     # discovery from the CLI: 17 tools
```

## Judgment
- Use one venv per project, so the server runs on the versions you pinned.
- Make the first tool read-only, so you prove the plumbing before anything can change state.
- stdio is the default transport. The client launches the server and talks over
  stdin/stdout, so **logs go to stderr**: stdout is the protocol.
- stdio servers don't reliably inherit your shell's environment from every client.
  Load keys from the server's own `.env`.
