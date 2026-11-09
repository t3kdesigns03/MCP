/* Agent0067 — bootstrap + layout. Order matters: state first, THEN the canvas
 * sizes and draws (the skeleton drew before its nodes existed — see README). */
(function () {
  'use strict';
  const A67 = window.A67;
  const $ = (s) => document.querySelector(s);

  const app = (A67.app = {
    pane: 'term',

    async boot() {
      try {
        await A67.store.init();
      } catch (e) {
        const box = $('#boot-error');
        box.hidden = false;
        box.innerHTML = `<h2>Agent0067 can't load its seed data</h2><p>${A67.esc(String(e.message || e))}</p>
          <p>Browsers block <code>fetch()</code> on <code>file://</code> pages. Serve the repo over HTTP instead:</p>
          <pre><code>python -m http.server 8068</code></pre><p>then open <code>http://localhost:8068/visual/</code></p>`;
        return;
      }
      this.applyPrefs();
      A67.canvas.init();
      A67.term.init();
      this.wire();
      this.renderPhasebar();
      A67.ui.renderVerify();
      A67.phases.evaluate();
      this.showPane(window.innerWidth >= 900 ? 'term' : 'term');
      A67.on('lab', () => { A67.ui.renderVerify(); A67.ui.renderSheet(); });
      A67.on('game', () => this.renderPhasebar());
      A67.on('bridge', (live) => {
        A67.term.print(live ? `bridge LIVE → ${A67.store.game.bridge.url} — canvas and the Python server now share lab_state; tool calls go over real MCP.` : 'bridge offline — back to the browser kernel.', live ? 'ok' : 'warn');
        A67.canvas.redraw();
      });
      A67.on('synced', () => A67.canvas.redraw());
      if (!A67.store.game.seenBrief[A67.store.game.phase]) A67.phases.showBrief();
    },

    applyPrefs() {
      document.body.classList.toggle('no-crt', !A67.store.game.crt);
      $('#crt-state').textContent = A67.store.game.crt ? 'on' : 'off';
      $('#btn-free').setAttribute('aria-pressed', String(!!A67.store.game.freePlay));
    },

    wire() {
      $('#btn-systems').onclick = () => A67.ui.systems();
      $('#btn-free').onclick = () => this.setFree(!A67.store.game.freePlay);
      $('#btn-menu').onclick = (e) => { e.stopPropagation(); $('#menu').hidden = !$('#menu').hidden; };
      document.addEventListener('click', (e) => { if (!$('#menu').hidden && !e.target.closest('#menu')) $('#menu').hidden = true; });
      $('#menu').addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        $('#menu').hidden = true;
        const act = b.dataset.act;
        const g = A67.store.game;
        if (act === 'crt') { g.crt = !g.crt; A67.store.saveGame(); this.applyPrefs(); }
        if (act === 'export') this.exportState();
        if (act === 'bridge') this.bridgeDialog();
        if (act === 'reset-lab' && confirm('Reset the lab map and system data to the seed? Your phase progress is kept.')) { A67.store.resetLab(); A67.ui.toast('lab reset'); }
        if (act === 'reset-all' && confirm('Erase ALL progress, keys and the lab? This cannot be undone.')) { A67.store.resetAll(); location.reload(); }
      });
      $('#sheet-close').onclick = () => A67.ui.closeSheet();
      $('#sheet').addEventListener('click', (e) => { if (e.target.id === 'sheet') A67.ui.closeSheet(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { A67.ui.closeSheet(); $('#menu').hidden = true; } });
      document.querySelectorAll('#lower-tabs button').forEach((b) => { b.onclick = () => this.showPane(b.dataset.pane); });
      document.querySelectorAll('#side-tabs button').forEach((b) => { b.onclick = () => this.showSide(b.dataset.side); });

      // Phones: keep the terminal input above the on-screen keyboard.
      const vv = window.visualViewport;
      const fitViewport = () => {
        const h = vv ? vv.height : window.innerHeight;
        document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
        const kb = vv && window.innerWidth < 900 && (window.innerHeight - vv.height) > 120 && document.activeElement === $('#term-in');
        document.body.classList.toggle('kb', !!kb);
        if (vv) window.scrollTo(0, 0);
        const out = $('#term-out');
        out.scrollTop = out.scrollHeight;
      };
      if (vv) { vv.addEventListener('resize', fitViewport); vv.addEventListener('scroll', fitViewport); }
      window.addEventListener('resize', fitViewport);
      $('#term-in').addEventListener('focus', () => setTimeout(fitViewport, 50));
      $('#term-in').addEventListener('blur', () => setTimeout(fitViewport, 50));
      fitViewport();
    },

    showPane(p) {
      this.pane = p;
      const mobile = window.innerWidth < 900;
      document.querySelectorAll('#lower-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.pane === p)));
      $('#term').classList.toggle('m-hide', mobile && p !== 'term');
      $('#side').classList.toggle('m-hide', mobile && p === 'term');
      if (p === 'guide' || p === 'verify') this.showSide(p);
    },
    showSide(s) {
      document.querySelectorAll('#side-tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.side === s)));
      $('#guide').hidden = s !== 'guide';
      $('#verify').hidden = s !== 'verify';
      if (s === 'verify') A67.ui.renderVerify();
    },

    renderPhasebar() {
      const g = A67.store.game;
      const bar = $('#phasebar');
      bar.innerHTML = '';
      for (const ph of A67.phases.list) {
        const b = document.createElement('button');
        const locked = ph.n > g.unlocked;
        b.className = 'phase-chip' + (g.phaseDone[ph.n] ? ' done' : '') + (ph.n === g.phase && !g.freePlay ? ' current' : '') + (locked ? ' locked' : '');
        b.innerHTML = `<b>${g.phaseDone[ph.n] ? '✓' : locked ? '🔒' : ph.n}</b>${ph.name}`;
        b.title = locked ? `Locked — finish phase ${ph.n - 1}` : ph.goal;
        b.disabled = locked;
        b.onclick = () => { if (g.freePlay) this.setFree(false); A67.phases.goto(ph.n); this.showPane('guide'); };
        bar.appendChild(b);
      }
    },

    setFree(on) {
      A67.store.game.freePlay = !!on;
      A67.store.saveGame();
      this.applyPrefs();
      this.renderPhasebar();
      A67.phases.evaluate();
      A67.term.print(on ? 'FREE PLAY on — no grading. Build anything.' : 'Guided build resumed.', 'info');
      A67.ui.toast(on ? 'FREE PLAY' : `PHASE ${A67.store.game.phase}`);
    },

    exportState() {
      const blob = new Blob([JSON.stringify(A67.store.lab, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'state.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      A67.term.print('exported lab_state as state.json — drop it in lab_state/ and the Python server will load it.', 'dim');
    },

    bridge(arg) {
      const g = A67.store.game;
      if (arg === 'on') { g.bridge.on = true; A67.store.saveGame(); A67.store.startBridge(); return A67.term.print(`bridge: connecting to ${g.bridge.url} … (start it with: python mcp_server/server.py --http)`, 'info'); }
      if (arg === 'off') { g.bridge.on = false; A67.store.saveGame(); A67.store.stopBridge(); return A67.term.print('bridge off — browser kernel only.', 'dim'); }
      const b = A67.store.bridge;
      A67.term.print(`bridge: ${g.bridge.on ? 'enabled' : 'disabled'} · ${b.live ? 'LIVE' : 'not connected'} · ${g.bridge.url}${b.lastError && g.bridge.on ? ' · last error: ' + b.lastError : ''}`, 'dim');
      if (b.keys) A67.term.print('server keys: ' + Object.entries(b.keys).map(([k, v]) => `${k}=${v}`).join(' '), 'dim');
    },
    bridgeDialog() {
      const g = A67.store.game;
      A67.ui.openSheet('LOCAL SERVER BRIDGE', null, null, () => `
        <p>Off by default. When on, this page talks to <b>your own</b> Python MCP server on this machine — real MCP JSON-RPC at <code>/mcp</code>, and <code>/lab/state</code> so the canvas and <code>lab_state/state.json</code> stay in sync. Nothing else is contacted.</p>
        <pre class="code">python mcp_server/server.py --http      # listens on 127.0.0.1:8067</pre>
        <p>Status: <span class="tag ${A67.store.bridge.live ? 'pass' : 'fail'}">${A67.store.bridge.live ? 'LIVE' : 'NOT CONNECTED'}</span> · ${A67.esc(g.bridge.url)}</p>
        <p style="font-size:12px;color:var(--muted)">Works when this page is served from localhost (e.g. <code>python -m http.server 8068</code>). The server only accepts localhost origins.</p>
        <div class="row-actions"><button class="btn small ${g.bridge.on ? 'danger' : 'primary'}" data-act="run" data-cmd="bridge ${g.bridge.on ? 'off' : 'on'}">${g.bridge.on ? 'TURN OFF' : 'TURN ON'}</button></div>`);
    },
  });

  window.addEventListener('DOMContentLoaded', () => app.boot());
})();
