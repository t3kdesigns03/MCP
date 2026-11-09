# Phase 2 — KEYS: get them, store them server-side, never commit them

**Carried over:** the same five systems from DISCOVER, and the rule that the model never
holds a key.

## Procedure (mirrors the real process exactly; the keys are FAKE)
1. `cat .gitignore`: `.env` is already ignored. It was there before the first key existed.
2. **SYSTEMS › Meraki › Settings › GENERATE FAKE KEY**, then **COPY**. The full key is
   shown once.
3. In the terminal: `echo "MERAKI_API_KEY=<paste>" >> .env` (or `export MERAKI_API_KEY=<paste>`).
4. Repeat for `EMAIL_API_KEY`, `MONITORING_API_KEY`, `SALESFORCE_API_KEY`, `IPAM_API_KEY`.
5. `env` shows every key masked (`...4f2a`). `git status` does not list `.env`.

Lab keys look like `FAKE-MERAKI-<32 hex>`. Both the game and `mcp_server/server.py`
reject anything else, so a real key can't be used by accident.

## Judgment
- Keys belong to the **server process**: `.env` or its environment. The client config
  and the prompt never contain them.
- Put `.env` in `.gitignore` *before* the first key exists.
- **Leaks fail loudly.** Paste a key into `ask "..."` and the game revokes it on the
  spot, so you have to rotate it. `git add -f .env` followed by `git commit` is blocked
  by a secret scan. Rotating is the fix; deleting the message is not.
- Masking output is defence in depth. In real Python, `print(os.getenv(...))` shows the
  whole key, which is exactly why you never paste that output anywhere.

## For real, in this repo
```bash
cp .env.example .env              # fill with FAKE keys from the game
python scripts/check_no_keys.py   # fails if a key-shaped string is tracked by git
```
