/* Agent0067 — topology canvas. Classic Win98 icons on a neon grid.
 *
 * Mouse + touch via Pointer Events:
 *   drag a palette icon onto the grid  -> lab.topology.add_node
 *   tap a palette icon, tap the grid   -> same (phone friendly)
 *   drag a node                        -> move it
 *   drag from a node's port dot        -> cable it (lab.topology.connect)
 *   CABLE mode: drag node -> node      -> cable it (no port dot needed)
 *   double-click / double-tap a node   -> inspect
 *   drag empty space                   -> pan, wheel / pinch -> zoom
 */
(function () {
  'use strict';
  const A67 = window.A67;
  const TYPES = [
    { type: 'pc', name: 'PC' }, { type: 'switch', name: 'SWITCH' }, { type: 'router', name: 'ROUTER' },
    { type: 'server', name: 'SERVER' }, { type: 'firewall', name: 'FIREWALL' }, { type: 'cloud', name: 'CLOUD' },
  ];
  const SYS_COLOR = { email: '#ffb000', meraki: '#00e5ff', monitoring: '#ff2bd6', salesforce: '#5fa8ff', ipam: '#00ff9f' };
  const SYS_ABBR = { email: 'E', meraki: 'M', monitoring: 'Mo', salesforce: 'S', ipam: 'I' };
  const ICON = 58;   // world units
  const HIT = 36;

  const C = (A67.canvas = {
    el: null, ctx: null, dpr: 1, w: 0, h: 0,
    view: { s: 1, ox: 0, oy: 0 },
    icons: {}, selected: null, hover: null, cableMode: false, armed: null,
    drag: null, pointers: new Map(), pulses: [], lastTap: { id: null, t: 0 }, dirty: true,

    init() {
      this.el = document.getElementById('lab-canvas');
      this.ctx = this.el.getContext('2d');
      for (const t of TYPES) {
        const img = new Image();
        img.onload = () => this.redraw();
        img.src = `../assets/icons/${t.type}.png`;
        this.icons[t.type] = img;
      }
      this.buildPalette();
      this.bind();
      // FIX (skeleton bug): size + first draw only AFTER state and icons exist.
      new ResizeObserver(() => this.resize()).observe(this.el.parentElement);
      this.resize();
      A67.on('lab', () => { this.redraw(); this.updateEmpty(); });
      A67.on('tool', (e) => this.pulseFor(e));
      this.updateEmpty();
      requestAnimationFrame(() => this.fit(true));
      this.loop();
    },

    get nodes() { return A67.store.lab.nodes; },
    get edges() { return A67.store.lab.edges; },

    resize() {
      const r = this.el.parentElement.getBoundingClientRect();
      this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
      this.el.width = Math.round(this.w * this.dpr);
      this.el.height = Math.round(this.h * this.dpr);
      this.redraw();
    },
    redraw() { this.dirty = true; },
    updateEmpty() {
      const e = document.getElementById('map-empty');
      if (e) e.hidden = this.nodes.length > 0;
    },

    toWorld(sx, sy) { return { x: (sx - this.view.ox) / this.view.s, y: (sy - this.view.oy) / this.view.s }; },
    toScreen(wx, wy) { return { x: wx * this.view.s + this.view.ox, y: wy * this.view.s + this.view.oy }; },
    local(e) { const r = this.el.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; },

    hitNode(sx, sy) {
      const p = this.toWorld(sx, sy);
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const n = this.nodes[i];
        if (Math.abs(n.x - p.x) < HIT && Math.abs(n.y - p.y) < HIT + 6) return n;
      }
      return null;
    },
    portPos(n) { return { x: n.x + ICON / 2 + 2, y: n.y - ICON / 2 + 4 }; },
    hitPort(sx, sy) {
      const p = this.toWorld(sx, sy);
      const r = 14 / this.view.s;
      for (let i = this.nodes.length - 1; i >= 0; i--) {
        const q = this.portPos(this.nodes[i]);
        if (Math.hypot(q.x - p.x, q.y - p.y) < Math.max(r, 12)) return this.nodes[i];
      }
      return null;
    },

    fit(initial) {
      const ns = this.nodes;
      const padTop = this.w < 900 ? 72 : 20;
      const padLeft = this.w >= 900 ? 84 : 20;
      if (!ns.length) { this.view = { s: this.w < 500 ? 0.8 : 1, ox: padLeft, oy: padTop }; this.redraw(); return; }
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of ns) { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y); }
      x0 -= 60; x1 += 60; y0 -= 60; y1 += 70;
      const aw = this.w - padLeft - 16, ah = this.h - padTop - 58;
      const s = Math.max(0.35, Math.min(1.25, Math.min(aw / (x1 - x0), ah / (y1 - y0))));
      this.view.s = s;
      this.view.ox = padLeft + (aw - (x1 - x0) * s) / 2 - x0 * s;
      this.view.oy = padTop + (ah - (y1 - y0) * s) / 2 - y0 * s;
      this.redraw();
      if (!initial) A67.toast && A67.toast('view fit to topology');
    },
    ensureVisible(n) {
      const p = this.toScreen(n.x, n.y);
      if (p.x < 30 || p.y < 60 || p.x > this.w - 30 || p.y > this.h - 30) this.fit(true);
    },

    // ---------------------------------------------------------- palette
    buildPalette() {
      const pal = document.getElementById('palette');
      pal.innerHTML = '';
      for (const t of TYPES) {
        const b = document.createElement('div');
        b.className = 'pal-item';
        b.dataset.type = t.type;
        b.setAttribute('role', 'button');
        b.setAttribute('tabindex', '0');
        b.setAttribute('aria-label', `Place ${t.name}`);
        b.innerHTML = `<img alt="" src="../assets/icons/${t.type}.png"><span>${t.name}</span>`;
        pal.appendChild(b);
        b.addEventListener('pointerdown', (e) => this.palDown(e, t.type, b));
        b.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.placeAt(t.type, null); } });
      }
      document.getElementById('tool-cable').addEventListener('click', (e) => {
        this.cableMode = !this.cableMode;
        e.currentTarget.setAttribute('aria-pressed', String(this.cableMode));
        A67.toast(this.cableMode ? 'CABLE mode: drag from one device to another' : 'MOVE mode');
      });
      document.getElementById('tool-fit').addEventListener('click', () => this.fit());
    },
    palDown(e, type, el) {
      e.preventDefault();
      const ghost = el.cloneNode(true);
      ghost.style.cssText = 'position:fixed;z-index:60;pointer-events:none;opacity:.85;left:0;top:0;';
      let moved = false;
      const sx = e.clientX, sy = e.clientY;
      const move = (ev) => {
        if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) { moved = true; document.body.appendChild(ghost); }
        if (moved) ghost.style.transform = `translate(${ev.clientX - 26}px, ${ev.clientY - 27}px)`;
      };
      const up = (ev) => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        ghost.remove();
        if (!moved) { this.arm(type, el); return; }
        const r = this.el.getBoundingClientRect();
        if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
          this.placeAt(type, this.toWorld(ev.clientX - r.left, ev.clientY - r.top));
        }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    },
    arm(type, el) {
      document.querySelectorAll('.pal-item').forEach((x) => x.classList.remove('armed'));
      if (this.armed === type) { this.armed = null; A67.toast('placement cancelled'); return; }
      this.armed = type;
      el.classList.add('armed');
      A67.toast(`tap the grid to place a ${type.toUpperCase()}`);
    },
    disarm() { this.armed = null; document.querySelectorAll('.pal-item').forEach((x) => x.classList.remove('armed')); },
    placeAt(type, world) {
      const args = { type };
      if (world) { args.x = Math.round(world.x); args.y = Math.round(world.y); }
      const r = A67.ui.canvasTool('lab.topology.add_node', args);
      if (r && r.ok) { this.select(r.node.id); this.ensureVisible(r.node); }
    },

    // ---------------------------------------------------------- pointer
    bind() {
      const el = this.el;
      el.addEventListener('pointerdown', (e) => this.down(e));
      el.addEventListener('pointermove', (e) => this.move(e));
      el.addEventListener('pointerup', (e) => this.up(e));
      el.addEventListener('pointercancel', (e) => this.up(e, true));
      el.addEventListener('pointerleave', () => { if (this.hover) { this.hover = null; this.redraw(); } });
      el.addEventListener('dblclick', (e) => { const p = this.local(e); const n = this.hitNode(p.x, p.y); if (n) A67.ui.inspect(n.id); });
      el.addEventListener('wheel', (e) => { e.preventDefault(); const p = this.local(e); this.zoomAt(p.x, p.y, e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
      window.addEventListener('keydown', (e) => {
        if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && this.selected) { A67.ui.removeNode(this.selected); }
        if (e.key === 'Escape') { this.disarm(); this.select(null); }
      });
    },
    zoomAt(sx, sy, f) {
      const w = this.toWorld(sx, sy);
      this.view.s = Math.max(0.3, Math.min(2.2, this.view.s * f));
      this.view.ox = sx - w.x * this.view.s;
      this.view.oy = sy - w.y * this.view.s;
      this.redraw();
    },
    down(e) {
      this.el.setPointerCapture(e.pointerId);
      const p = this.local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.drag = { kind: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), s: this.view.s };
        return;
      }
      if (this.armed) {
        const hit = this.hitNode(p.x, p.y);
        if (!hit) { const t = this.armed; this.disarm(); this.placeAt(t, this.toWorld(p.x, p.y)); this.drag = null; return; }
      }
      const port = this.hitPort(p.x, p.y);
      const n = this.hitNode(p.x, p.y);
      if (port || (n && this.cableMode)) {
        const from = port || n;
        this.drag = { kind: 'cable', from, at: p, moved: false };
      } else if (n) {
        const w = this.toWorld(p.x, p.y);
        this.drag = { kind: 'move', node: n, dx: w.x - n.x, dy: w.y - n.y, start: p, moved: false };
      } else {
        this.drag = { kind: 'pan', start: p, ox: this.view.ox, oy: this.view.oy, moved: false };
      }
      this.redraw();
    },
    move(e) {
      const p = this.local(e);
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
      const d = this.drag;
      if (!d) {
        const h = this.hitNode(p.x, p.y) || this.hitPort(p.x, p.y);
        const id = h ? h.id : null;
        if (id !== this.hover) { this.hover = id; this.redraw(); }
        this.el.style.cursor = this.hitPort(p.x, p.y) ? 'crosshair' : h ? (this.cableMode ? 'crosshair' : 'grab') : 'default';
        return;
      }
      if (d.kind === 'pinch' && this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const target = Math.max(0.3, Math.min(2.2, d.s * dist / d.d));
        this.zoomAt(mid.x, mid.y, target / this.view.s);
        return;
      }
      if (d.kind === 'move') {
        if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 5) return;
        d.moved = true;
        const w = this.toWorld(p.x, p.y);
        A67.store.labApi.moveNode(d.node.id, w.x - d.dx, w.y - d.dy);
      } else if (d.kind === 'pan') {
        if (!d.moved && Math.hypot(p.x - d.start.x, p.y - d.start.y) < 5) return;
        d.moved = true;
        this.view.ox = d.ox + (p.x - d.start.x);
        this.view.oy = d.oy + (p.y - d.start.y);
      } else if (d.kind === 'cable') {
        d.at = p; d.moved = true;
        const h = this.hitNode(p.x, p.y);
        this.hover = h && h.id !== d.from.id ? h.id : null;
      }
      this.redraw();
    },
    up(e, cancelled) {
      const p = this.local(e);
      this.pointers.delete(e.pointerId);
      const d = this.drag;
      this.drag = null;
      if (!d || cancelled) { this.redraw(); return; }
      if (d.kind === 'pinch') { this.redraw(); return; }
      if (d.kind === 'cable') {
        const to = this.hitNode(p.x, p.y);
        if (to && to.id !== d.from.id) A67.ui.canvasTool('lab.topology.connect', { a: d.from.id, b: to.id });
        else if (!d.moved) this.tapNode(d.from, e.pointerType);
        this.hover = null;
      } else if (d.kind === 'move') {
        if (d.moved) { A67.store.labApi._commit(); } else this.tapNode(d.node, e.pointerType);
      } else if (d.kind === 'pan' && !d.moved) {
        this.select(null);
      }
      this.redraw();
    },
    tapNode(n, pointerType) {
      const now = performance.now();
      // mouse gets the native dblclick event; touch/pen need double-tap detection
      if (pointerType !== 'mouse' && this.lastTap.id === n.id && now - this.lastTap.t < 350) { this.lastTap = { id: null, t: 0 }; A67.ui.inspect(n.id); return; }
      this.lastTap = { id: n.id, t: now };
      this.select(n.id);
    },
    select(id) {
      if (this.selected === id) return;
      this.selected = id;
      A67.emit('select', id);
      this.redraw();
    },

    pulseFor(evt) {
      const ids = new Set();
      const d = evt && evt.data;
      if (!d) return;
      const scan = (o) => {
        if (!o || typeof o !== 'object') return;
        if (Array.isArray(o)) { o.forEach(scan); return; }
        for (const k of ['id', 'lab_node', 'device', 'node', 'a', 'b']) if (typeof o[k] === 'string') ids.add(o[k]);
        for (const v of Object.values(o)) if (v && typeof v === 'object') scan(v);
      };
      scan(d);
      for (const n of this.nodes) if (ids.has(n.id) || ids.has(n.label)) this.pulses.push({ id: n.id, t0: performance.now(), ok: d.ok !== false });
      this.redraw();
    },

    // ---------------------------------------------------------- render
    loop() {
      const step = () => {
        const now = performance.now();
        this.pulses = this.pulses.filter((p) => now - p.t0 < 900);
        if (this.dirty || this.pulses.length) { this.draw(now); this.dirty = false; }
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    },
    draw(now) {
      const ctx = this.ctx, s = this.view.s;
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.w, this.h);
      // grid (world aligned)
      const g = 40 * s;
      if (g > 6) {
        ctx.strokeStyle = 'rgba(0,255,159,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = ((this.view.ox % g) + g) % g; x < this.w; x += g) { ctx.moveTo(x, 0); ctx.lineTo(x, this.h); }
        for (let y = ((this.view.oy % g) + g) % g; y < this.h; y += g) { ctx.moveTo(0, y); ctx.lineTo(this.w, y); }
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(this.view.ox, this.view.oy);
      ctx.scale(s, s);
      const byId = Object.fromEntries(this.nodes.map((n) => [n.id, n]));
      // edges
      for (const e of this.edges) {
        const a = byId[e.a], b = byId[e.b];
        if (!a || !b) continue;
        const down = a.status === 'down' || b.status === 'down';
        ctx.save();
        ctx.strokeStyle = down ? '#ff3b5c' : '#00e5ff';
        ctx.shadowColor = ctx.strokeStyle;
        ctx.shadowBlur = 10;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.restore();
        if (s > 0.6) {
          ctx.fillStyle = 'rgba(0,229,255,.75)';
          ctx.font = '9px monospace';
          ctx.textAlign = 'center';
          const t = 0.22;
          ctx.fillText(e.a_port, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t - 4);
          ctx.fillText(e.b_port, b.x + (a.x - b.x) * t, b.y + (a.y - b.y) * t - 4);
        }
      }
      // rubber-band cable
      if (this.drag && this.drag.kind === 'cable') {
        const from = this.drag.from;
        const to = this.toWorld(this.drag.at.x, this.drag.at.y);
        ctx.save();
        ctx.setLineDash([6, 5]);
        ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 2; ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(to.x, to.y); ctx.stroke();
        ctx.restore();
      }
      // nodes
      for (const n of this.nodes) this.drawNode(ctx, n, now);
      ctx.restore();
      this.drawHud();
    },
    drawNode(ctx, n, now) {
      const sel = this.selected === n.id, hov = this.hover === n.id;
      const x = n.x, y = n.y, half = ICON / 2;
      if (sel || hov) {
        ctx.save();
        ctx.strokeStyle = sel ? '#ff2bd6' : 'rgba(0,255,159,.7)';
        ctx.setLineDash(sel ? [5, 4] : []);
        ctx.lineWidth = 1.5;
        ctx.shadowColor = ctx.strokeStyle; ctx.shadowBlur = 10;
        ctx.strokeRect(x - half - 6, y - half - 6, ICON + 12, ICON + 12);
        ctx.restore();
      }
      for (const p of this.pulses) {
        if (p.id !== n.id) continue;
        const k = (now - p.t0) / 900;
        ctx.save();
        ctx.strokeStyle = p.ok ? `rgba(0,255,159,${1 - k})` : `rgba(255,59,92,${1 - k})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(x, y, half + 4 + k * 26, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
      }
      const img = this.icons[n.type];
      ctx.imageSmoothingEnabled = false;
      if (img && img.complete && img.naturalWidth) ctx.drawImage(img, x - half, y - half, ICON, ICON);
      if (n.status === 'down') {
        ctx.save(); ctx.strokeStyle = '#ff3b5c'; ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(x - 18, y - 18); ctx.lineTo(x + 18, y + 18); ctx.moveTo(x + 18, y - 18); ctx.lineTo(x - 18, y + 18); ctx.stroke();
        ctx.restore();
      }
      // label + ip
      ctx.textAlign = 'center';
      ctx.font = 'bold 12px monospace';
      ctx.fillStyle = '#000';
      ctx.fillText(n.label, x + 1, y + half + 14);
      ctx.fillStyle = sel ? '#ff2bd6' : '#00ff9f';
      ctx.fillText(n.label, x, y + half + 13);
      const cfg = n.config || {};
      const sub = [cfg.mgmt_ip, cfg.access_vlan && cfg.access_vlan !== 1 ? `vlan ${cfg.access_vlan}` : ''].filter(Boolean).join(' · ');
      if (sub) { ctx.font = '10px monospace'; ctx.fillStyle = '#9fe8ff'; ctx.fillText(sub, x, y + half + 26); }
      // integration chips
      const ints = n.integrations || [];
      if (ints.length) {
        ctx.font = 'bold 9px monospace';
        const widths = ints.map((k) => ctx.measureText(SYS_ABBR[k]).width + 8);
        let cx = x - widths.reduce((a, b) => a + b + 2, -2) / 2;
        ints.forEach((k, i) => {
          ctx.fillStyle = 'rgba(0,0,0,.85)';
          ctx.fillRect(cx, y - half - 14, widths[i], 12);
          ctx.strokeStyle = SYS_COLOR[k]; ctx.lineWidth = 1;
          ctx.strokeRect(cx + 0.5, y - half - 13.5, widths[i] - 1, 11);
          ctx.fillStyle = SYS_COLOR[k];
          ctx.textAlign = 'left';
          ctx.fillText(SYS_ABBR[k], cx + 4, y - half - 5);
          cx += widths[i] + 2;
        });
        ctx.textAlign = 'center';
      }
      // port handle
      if (sel || hov || this.cableMode) {
        const pp = this.portPos(n);
        ctx.save();
        ctx.fillStyle = '#000'; ctx.strokeStyle = '#ff2bd6'; ctx.lineWidth = 2; ctx.shadowColor = '#ff2bd6'; ctx.shadowBlur = 6;
        ctx.beginPath(); ctx.arc(pp.x, pp.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    },
    drawHud() {
      const hud = document.getElementById('hud');
      if (!hud) return;
      const st = A67.store;
      const b = st.bridge.live ? '<span class="live">BRIDGE LIVE</span>' : '<span class="off">browser kernel</span>';
      hud.innerHTML = `${st.lab.nodes.length} nodes · ${st.lab.edges.length} links · rev ${st.lab.rev || 0} · ${b}`;
    },
  });
})();
