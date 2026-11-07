"""A real MCP client talking to the real server over stdio (Phase 5, CLIENT).

    python mcp_server/client_demo.py

It does exactly what an AI app does: start the server, initialize, discover
tools (tools/list), then call the one a model would pick. The "model" here
is a printed decision, not an LLM: this script never sees an API key or URL,
only tool names, descriptions and schemas. Keys stay in the server's env.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
from pathlib import Path

from fastmcp import Client
from fastmcp.client.transports import StdioTransport

HERE = Path(__file__).resolve().parent


async def main() -> None:
    # stdio servers do NOT inherit your shell env by default. The server reads
    # keys from its own .env; we only forward the lab's own variables here.
    passthrough = {k: v for k, v in os.environ.items() if k.endswith("_API_KEY") or k == "AGENT0067_STATE"}
    transport = StdioTransport(command=sys.executable, args=[str(HERE / "server.py")], cwd=str(HERE.parent), env=passthrough)
    async with Client(transport) as client:
        tools = await client.list_tools()
        listing = [{"name": t.name, "description": (t.description or "").split("\n")[0]} for t in tools]
        payload = json.dumps([t.model_dump(mode="json", exclude_none=True) for t in tools])
        print(f"tools/list -> {len(tools)} tools, ~{len(payload) // 4} tokens of context just to describe them")
        for t in listing:
            print(f"  {t['name']:<40} {t['description'][:70]}")
        question = "Which sites are down?"
        pick = "integrations.meraki.get_networks"
        print(f"\nuser  : {question}\nmodel : picks {pick} (from the list above; it never sees a key or URL)")
        r = await client.call_tool(pick, {}, raise_on_error=False)
        data = r.structured_content or {}
        if not data.get("ok"):
            print(f"app   : server said {data.get('error')}: {data.get('message')}")
            return
        down = [n["name"] for n in data["networks"] if n["status"] == "down"]
        degraded = [n["name"] for n in data["networks"] if n["status"] == "degraded"]
        print(f"app   : executed via MCP server (key {data['auth']['key']} stayed server-side)")
        print(f"answer: down = {down}, degraded = {degraded}")


if __name__ == "__main__":
    asyncio.run(main())
