/* Agent0067 — state: lab_state document, game progress, event bus, bridge.
 *
 * lab  = the same JSON document the Python server keeps in lab_state/state.json
 * game = player progress (phases, shell, keys). localStorage only, no account.
 *
 * The bridge is OFF by default. When the player turns it on (menu), the page
 * talks to THEIR local server at http://127.0.0.1:8067 — real MCP JSON-RPC at
 * /mcp plus /lab/state so canvas and server share one lab_state. Nothing else
 * is ever fetched except this site's own files.
 */
(function () {
  'use strict';
  const A67 = (window.A67 = window.A67 || {});
  const LS_LAB = 'agent0067.lab.v1';
  const LS_GAME = 'agent0067.game.v1';
  const { Lab, KEY_ENV, KEY_RE, clone } = window.LabTools;

  // ------------------------------------------------------------ event bus
  const handlers = {};
  A67.on = (ev, fn) => { (handlers[ev] = handlers[ev] || []).push(fn); };
  A67.emit = (ev, data) => { (handlers[ev] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(ev, e); } }); };

  const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
  const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode: play on */ } };
  const lsDel = (k) => { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } };

  function defaultGame() {
    return {
      v: 1, phase: 1, unlocked: 1, done: {}, phaseDone: {}, freePlay: false, crt: true, seenBrief: {},
      keys: {}, revoked: [], leaks: 0,
      shell: {
        cwd: '~/agent0067', env: {}, venvCreated: false, venvActive: false, pipUpgraded: false,
        venvPkgs: { pip: '25.1.1', setuptools: '80.9.0' },
        files: {}, tools: [], server: { running: false, transport: null, tools: 0 },
        gitStaged: [], commits: 0, lastCommitOk: null, flags: {},
      },
      board: { apps: [], raw: [], mcp: false, quiz: null, discovered: false },
      client: { connected: false, asked: [], via: null },
      ship: { quiz: null, deployed: false },
      bridge: { on: false, url: 'http://127.0.0.1:8067' },
      deviceConfigured: false,
      stuck: {},
    };
  }

  const store = (A67.store = {
    seed: null, lab: null, game: null, labApi: null,
    bridge: { live: false, syncedRev: -1, timer: null, pushTimer: null, keys: null, lastError: '' },

    async init() {
      const res = await fetch('../lab_state/seed.json', { cache: 'no-cache' });
      if (!res.ok) throw new Error('seed.json HTTP ' + res.status);
      this.seed = await res.json();
      const savedLab = lsGet(LS_LAB);
      const savedGame = lsGet(LS_GAME);
      try { this.lab = savedLab ? JSON.parse(savedLab) : clone(this.seed); } catch (e) { this.lab = clone(this.seed); }
      try { this.game = Object.assign(defaultGame(), savedGame ? JSON.parse(savedGame) : {}); } catch (e) { this.game = defaultGame(); }
      this.game.shell = Object.assign(defaultGame().shell, this.game.shell);
      this.makeLab();
      if (this.game.bridge.on) this.startBridge();
    },

    makeLab() {
      this.labApi = new Lab(this.lab, this.serverEnv());
      this.labApi.onCommit = () => { this.saveLab(); A67.emit('lab', this.lab); this.queuePush(); };
    },

    /* What the (simulated) MCP server process can read: exported vars + .env.
     * Revoked keys (pasted into a prompt) stop working until rotated. */
    serverEnv() {
      const env = {};
      const dot = this.dotenv();
      for (const name of Object.values(KEY_ENV)) {
        const v = this.game.shell.env[name] || dot[name] || '';
        if (v && !this.game.revoked.includes(v)) env[name] = v;
      }
      return env;
    },
    refreshEnv() { if (this.labApi) this.labApi.env = this.serverEnv(); },

    dotenv() {
      const out = {};
      const txt = this.game.shell.files['.env'] || '';
      for (const line of txt.split('\n')) {
        const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([^"'\s#]*)["']?/.exec(line);
        if (m) out[m[1]] = m[2];
      }
      return out;
    },

    /** keys the server would accept right now, per system */
    keyStatus() {
      const env = this.serverEnv();
      const out = {};
      for (const [sys, name] of Object.entries(KEY_ENV)) {
        const v = env[name];
        out[sys] = !!(v && KEY_RE.test(v) && this.game.keys[sys] === v);
      }
      return out;
    },

    saveLab() { lsSet(LS_LAB, JSON.stringify(this.lab)); },
    saveGame() { lsSet(LS_GAME, JSON.stringify(this.game)); A67.emit('game', this.game); },

    replaceLab(doc) {
      this.lab = doc;
      this.makeLab();
      this.saveLab();
      A67.emit('lab', this.lab);
    },
    resetLab() {
      this.replaceLab(clone(this.seed));
      if (this.bridge.live) this.bridgeFetch('/lab/reset', { method: 'POST' }).then(() => this.pull(true));
    },
    resetAll() {
      lsDel(LS_LAB); lsDel(LS_GAME);
      this.game = defaultGame();
      this.replaceLab(clone(this.seed));
      this.saveGame();
    },

    // ---------------------------------------------------------- bridge
    async bridgeFetch(path, opts) {
      const url = this.game.bridge.url.replace(/\/$/, '') + path;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 2500);
      try {
        return await fetch(url, Object.assign({ signal: ctl.signal, headers: { 'Content-Type': 'application/json' } }, opts || {}));
      } finally { clearTimeout(t); }
    },
    startBridge() {
      this.stopBridge();
      const tick = async () => {
        try {
          const r = await this.bridgeFetch('/lab/health');
          const h = await r.json();
          const wasLive = this.bridge.live;
          this.bridge.live = true;
          this.bridge.keys = h.keys;
          this.bridge.lastError = '';
          if (!wasLive) {
            A67.emit('bridge', true);
            // first contact: newer document wins
            const sr = await this.bridgeFetch('/lab/state');
            const remote = await sr.json();
            if ((remote.updated_at || '') > (this.lab.updated_at || '')) this.adopt(remote);
            else await this.push();
          } else if (h.rev > this.bridge.syncedRev) {
            await this.pull();
          }
        } catch (e) {
          if (this.bridge.live) A67.emit('bridge', false);
          this.bridge.live = false;
          this.bridge.lastError = String(e && e.message || e);
        }
      };
      tick();
      this.bridge.timer = setInterval(tick, 2500);
    },
    stopBridge() {
      if (this.bridge.timer) clearInterval(this.bridge.timer);
      this.bridge.timer = null;
      if (this.bridge.live) { this.bridge.live = false; A67.emit('bridge', false); }
    },
    adopt(remote) {
      this.bridge.syncedRev = remote.rev;
      this.replaceLab(remote);
      A67.emit('synced', remote.rev);
    },
    async pull(force) {
      const r = await this.bridgeFetch('/lab/state');
      const remote = await r.json();
      if (force || remote.rev > this.bridge.syncedRev) this.adopt(remote);
    },
    queuePush() {
      if (!this.bridge.live) return;
      clearTimeout(this.bridge.pushTimer);
      this.bridge.pushTimer = setTimeout(() => this.push().catch(() => {}), 250);
    },
    async push() {
      const r = await this.bridgeFetch('/lab/state', { method: 'PUT', body: JSON.stringify(this.lab) });
      const j = await r.json();
      if (j.ok) { this.lab.rev = j.rev; this.bridge.syncedRev = j.rev; this.saveLab(); }
    },

    /* Real MCP JSON-RPC against the local FastMCP server (stateless HTTP). */
    async rpc(method, params) {
      const body = { jsonrpc: '2.0', id: Date.now(), method };
      if (params) body.params = params;
      const r = await this.bridgeFetch('/mcp', {
        method: 'POST', body: JSON.stringify(body),
        headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message || 'JSON-RPC error');
      return { request: body, response: j };
    },
  });

  /** Execute a tool as the APP does: locally (browser kernel) or via the real server. */
  A67.exec = async function (name, args) {
    if (store.bridge.live) {
      const { request, response } = await store.rpc('tools/call', { name, arguments: args || {} });
      const res = response.result || {};
      let data = res.structuredContent;
      if (!data && res.content && res.content[0]) { try { data = JSON.parse(res.content[0].text); } catch (e) { data = { ok: false, error: 'tool_error', message: res.content[0].text }; } }
      await store.pull().catch(() => {});
      return { data: data || {}, via: 'local FastMCP server', request };
    }
    store.refreshEnv();
    const data = store.labApi.call(name, args || {});
    return { data, via: 'browser kernel (simulated server)', request: { jsonrpc: '2.0', method: 'tools/call', params: { name, arguments: args || {} } } };
  };

  /** Mask every FAKE key (and anything that looks like a key) in text. */
  A67.mask = function (text) {
    let t = String(text);
    t = t.replace(/FAKE-[A-Z]+-[0-9a-f]{32}/g, (k) => '...' + k.slice(-4));
    t = t.replace(/\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g, (k) => '...' + k.slice(-4));
    return t;
  };
  A67.looksLikeKey = (text) => /FAKE-[A-Z]+-[0-9a-f]{16,}/.test(text) || /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/.test(text) ||
    /\b[A-Za-z0-9]{40}\b/.test(text);
})();
