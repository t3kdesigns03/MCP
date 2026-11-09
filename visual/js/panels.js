/* Agent0067 — UI panels: toast, inspector, the five simulated system
 * dashboards (with their API-key settings), verification board, briefings. */
(function () {
  'use strict';
  const A67 = window.A67;
  const { Lab, KEY_ENV, ATTACH_RULES, maskKey, SYSTEMS } = window.LabTools;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  A67.esc = esc;

  const SYS_TITLE = { email: 'Email', meraki: 'Meraki', monitoring: 'Monitoring', salesforce: 'Salesforce', ipam: 'IPAM' };
  const SYS_BLURB = {
    email: 'NOC mailbox at neonharbor.example (fake domain).',
    meraki: 'Cloud-managed branch gear for four fake sites.',
    monitoring: 'SNMP/ICMP alerting and basic metrics (Entuity/SolarWinds style).',
    salesforce: 'Customer accounts and support cases.',
    ipam: 'Subnets and address allocations in 10.67.0.0/16.',
  };

  // The vendor dashboards read their own data; they don't need the player's key.
  const DASH_ENV = Object.fromEntries(Object.entries(KEY_ENV).map(([s, e]) => [e, `FAKE-${s.toUpperCase()}-${'0'.repeat(32)}`]));
  const dash = () => new Lab(A67.store.lab, DASH_ENV);

  const fresh = new Map(); // id -> time, for highlighting rows a tool just changed
  A67.on('tool', (e) => {
    const d = e && e.data;
    if (!d || !d.ok) return;
    const ids = [d.message && d.message.id, d.case && d.case.CaseNumber, d.allocation && d.allocation.ip, d.alert && d.alert.id, d.serial, d.lab_node];
    ids.filter(Boolean).forEach((id) => fresh.set(String(id), Date.now()));
  });
  A67.toast = (m, bad) => A67.ui.toast(m, bad);
  const isFresh = (id) => { const t = fresh.get(String(id)); return t && Date.now() - t < 120000; };

  const ui = (A67.ui = {
    toast(msg, bad) {
      const t = document.getElementById('toast');
      t.textContent = msg;
      t.className = 'show' + (bad ? ' bad' : '');
      clearTimeout(this._tt);
      this._tt = setTimeout(() => { t.className = ''; }, 2400);
    },

    /** Canvas actions ARE tool calls. Run locally and echo the call in the terminal. */
    canvasTool(name, args) {
      const res = A67.store.labApi.call(name, args);
      A67.term && A67.term.echoTool(name, args, res, 'canvas');
      A67.emit('tool', { name, args, data: res, source: 'canvas' });
      if (!res.ok) this.toast(res.message, true);
      else if (name === 'lab.topology.connect') this.toast(`cabled ${res.edge.a}:${res.edge.a_port} ⇄ ${res.edge.b}:${res.edge.b_port}`);
      else if (name === 'lab.topology.add_node') this.toast(`placed ${res.node.label}`);
      return res;
    },
    removeNode(id) {
      const n = A67.store.labApi._node(id);
      if (!n) return;
      A67.store.labApi.removeNode(id);
      A67.canvas.select(null);
      this.toast(`removed ${n.label}`);
      A67.emit('tool', { name: 'lab.remove', data: { ok: true } });
    },
    attach(id, system, on) {
      const lab = A67.store.labApi;
      const r = on ? lab.attach(id, system) : lab.detach(id, system);
      if (!r.ok) this.toast(r.message, true);
      else this.toast(`${system} ${on ? 'attached to' : 'detached from'} ${lab._node(id).label}`);
      A67.term && A67.term.print(`[canvas] ${on ? 'attach' : 'detach'} ${system} ${id}${r.ok ? '' : '  -> ' + r.message}`, r.ok ? 'dim' : 'err');
      A67.emit('tool', { name: 'lab.attach', data: r });
      return r;
    },

    // ---------------------------------------------------------- sheet
    openSheet(title, tabs, active, render) {
      const sheet = document.getElementById('sheet');
      document.getElementById('sheet-title').textContent = title;
      const tabsEl = document.getElementById('sheet-tabs');
      tabsEl.innerHTML = '';
      this._sheet = { tabs, active, render };
      (tabs || []).forEach((t) => {
        const b = document.createElement('button');
        b.textContent = t.label;
        b.className = t.id === active ? 'active' : '';
        b.onclick = () => { this._sheet.active = t.id; this.renderSheet(); };
        tabsEl.appendChild(b);
      });
      tabsEl.hidden = !tabs || !tabs.length;
      sheet.hidden = false;
      this.renderSheet();
    },
    renderSheet() {
      const s = this._sheet;
      if (!s || document.getElementById('sheet').hidden) return;
      [...document.getElementById('sheet-tabs').children].forEach((b, i) => { b.className = s.tabs[i].id === s.active ? 'active' : ''; });
      const body = document.getElementById('sheet-body');
      const y = body.scrollTop;
      body.innerHTML = s.render(s.active);
      body.scrollTop = y;
      body.querySelectorAll('[data-act]').forEach((el) => el.addEventListener('click', (e) => this.sheetAct(e.currentTarget)));
    },
    closeSheet() { document.getElementById('sheet').hidden = true; this._sheet = null; },

    sheetAct(el) {
      const act = el.dataset.act;
      const g = A67.store.game;
      if (act === 'genkey') {
        const sys = el.dataset.sys;
        const bytes = new Uint8Array(16);
        crypto.getRandomValues(bytes);
        const key = `FAKE-${sys.toUpperCase()}-${[...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')}`;
        if (g.keys[sys]) g.revoked.push(g.keys[sys]); // rotation: the old key dies
        g.keys[sys] = key;
        g.shell.flags['shown_' + sys] = key;
        A67.store.saveGame();
        A67.store.refreshEnv();
        A67.term && A67.term.print(`[${sys} settings] new FAKE key generated (${maskKey(key)}). Copy it from the panel.`, 'dim');
        this.renderSheet();
      } else if (act === 'copykey') {
        const key = g.shell.flags['shown_' + el.dataset.sys];
        const done = () => { this.toast('copied — now paste it into the terminal (.env or export)'); };
        if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(key).then(done, () => this.toast('select the key text and copy it manually', true));
        else {
          const ta = document.createElement('textarea'); ta.value = key; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) { this.toast('select the key text and copy it manually', true); }
          ta.remove();
        }
      } else if (act === 'hidekey') {
        delete g.shell.flags['shown_' + el.dataset.sys];
        A67.store.saveGame();
        this.renderSheet();
      } else if (act === 'attach') {
        this.attach(el.dataset.node, el.dataset.sys, el.dataset.on === '1');
        this.renderSheet();
      } else if (act === 'console') {
        this.closeSheet();
        A67.term.openDevice(el.dataset.node);
      } else if (act === 'remove') {
        this.closeSheet();
        this.removeNode(el.dataset.node);
      } else if (act === 'run') {
        this.closeSheet();
        A67.term.run(el.dataset.cmd, true);
      } else if (act === 'system') {
        this.systems(el.dataset.sys);
      }
    },

    // ---------------------------------------------------------- systems
    systems(active) {
      const tabs = SYSTEMS.map((s) => ({ id: s, label: SYS_TITLE[s].toUpperCase() }));
      this.openSheet('SIMULATED SYSTEMS', tabs, active || 'meraki', (id) => this.renderSystem(id));
    },
    renderSystem(sys) {
      const st = A67.store, g = st.game, L = dash();
      const ks = st.keyStatus()[sys];
      // like a real dashboard: the full key is shown once, until it's stored where the server reads it
      if (ks && g.shell.flags['shown_' + sys]) { delete g.shell.flags['shown_' + sys]; A67.store.saveGame(); }
      const shown = g.shell.flags['shown_' + sys];
      let html = `<div class="fake-banner">FICTIONAL SYSTEM — ${esc(SYS_BLURB[sys])} No real service is contacted.</div>`;
      html += `<h3 style="color:var(--cyan);font-size:12px;margin:6px 0">SETTINGS › API ACCESS</h3>`;
      if (shown) {
        html += `<div class="keybox"><div class="k" style="color:var(--mag)">NEW FAKE KEY — shown once. Copy it now.</div><code>${esc(shown)}</code>
          <div class="row-actions"><button class="btn small" data-act="copykey" data-sys="${sys}">COPY</button>
          <button class="btn small" data-act="hidekey" data-sys="${sys}">I'VE STORED IT — HIDE</button></div>
          <p style="font-size:12px;color:var(--muted)">Next: in the terminal, <code>echo "${KEY_ENV[sys]}=&lt;paste&gt;" &gt;&gt; .env</code> or <code>export ${KEY_ENV[sys]}=&lt;paste&gt;</code>. Never paste it into a chat or prompt.</p></div>`;
      } else {
        html += `<p>Key: <b>${g.keys[sys] ? esc(maskKey(g.keys[sys])) : 'none generated'}</b> · server has it: <span class="tag ${ks ? 'pass' : 'fail'}">${ks ? 'YES' : 'NO'}</span></p>
          <div class="row-actions"><button class="btn small ${g.keys[sys] ? 'warn' : ''}" data-act="genkey" data-sys="${sys}">${g.keys[sys] ? 'ROTATE KEY' : 'GENERATE FAKE KEY'}</button></div>`;
      }
      html += '<h3 style="color:var(--cyan);font-size:12px;margin:14px 0 6px">DATA</h3>';
      if (sys === 'email') {
        const r = L.email_list({ folder: 'all', limit: 100 });
        html += `<p>Mailbox <b>${esc(r.mailbox)}</b> · ${r.count} messages</p><table><tr><th>folder</th><th>from → to</th><th>subject</th><th>at</th></tr>`;
        for (const m of r.messages) html += `<tr class="${isFresh(m.id) ? 'fresh' : ''}"><td><span class="tag ${m.folder === 'sent' ? 'info' : 'warning'}">${m.folder}</span></td><td>${esc(m.from)} → ${esc(m.to)}</td><td>${esc(m.subject)}</td><td>${esc(m.at.slice(5, 16))}</td></tr>`;
        html += '</table>';
      } else if (sys === 'meraki') {
        const n = L.meraki_get_networks(), d = L.meraki_get_devices({});
        html += `<p>Org <b>${esc(n.org.name)}</b></p><table><tr><th>network</th><th>status</th><th>devices</th></tr>`;
        for (const x of n.networks) html += `<tr><td>${esc(x.name)}<br><small>${esc(x.id)}</small></td><td><span class="tag ${x.status}">${x.status}</span></td><td>${x.devices} (${x.offline} offline)</td></tr>`;
        html += '</table><h3 style="font-size:12px;color:var(--cyan);margin:12px 0 6px">DEVICES</h3><table><tr><th>name</th><th>serial</th><th>status</th><th>config</th></tr>';
        for (const x of d.devices) {
          html += `<tr class="${isFresh(x.serial) || isFresh(x.lab_node) ? 'fresh' : ''}"><td>${esc(x.name)}${x.lab_node ? ' <span class="tag info">LAB</span>' : ''}<br><small>${esc(x.model)}</small></td><td><small>${esc(x.serial)}</small></td><td><span class="tag ${x.status}">${x.status}</span></td><td><small>vlan ${esc(x.config.access_vlan)} · uplink ${x.config.uplink_enabled ? 'on' : 'off'}${x.config.notes ? ' · ' + esc(x.config.notes) : ''}</small></td></tr>`;
        }
        html += '</table>';
      } else if (sys === 'monitoring') {
        const a = L.monitoring_get_alerts({ status: 'all' }), m = L.monitoring_get_metrics({});
        html += `<table><tr><th>sev</th><th>source</th><th>message</th><th>status</th></tr>`;
        for (const x of a.alerts) html += `<tr class="${isFresh(x.id) ? 'fresh' : ''}"><td><span class="tag ${x.severity}">${x.severity}</span></td><td>${esc(x.source)}<br><small>${esc(x.id)} · ${esc(x.site)}</small></td><td>${esc(x.message)}</td><td><span class="tag ${x.status}">${x.status}</span></td></tr>`;
        html += '</table><h3 style="font-size:12px;color:var(--cyan);margin:12px 0 6px">METRICS</h3><table><tr><th>device</th><th>cpu</th><th>mem</th><th>lat</th><th>util</th></tr>';
        for (const x of m.metrics) html += `<tr><td>${esc(x.device)} <small>${x.source}</small></td>${x.reachable ? `<td>${x.cpu_pct}%</td><td>${x.mem_pct}%</td><td>${x.latency_ms}ms</td><td>${x.if_util_pct}%</td>` : '<td colspan="4"><span class="tag down">unreachable</span></td>'}</tr>`;
        html += '</table>';
      } else if (sys === 'salesforce') {
        const c = L.salesforce_query({ soql: 'SELECT CaseNumber, Subject, Status, Priority, AccountId, Device FROM Case ORDER BY CaseNumber DESC' });
        const acc = L.salesforce_query({ soql: 'SELECT Id, Name, Site, Tier FROM Account' });
        const name = Object.fromEntries(acc.records.map((r) => [r.Id, r.Name]));
        html += `<table><tr><th>case</th><th>subject</th><th>status</th><th>account</th></tr>`;
        for (const x of c.records) html += `<tr class="${isFresh(x.CaseNumber) ? 'fresh' : ''}"><td>${esc(x.CaseNumber)}<br><small>${esc(x.Priority)}</small></td><td>${esc(x.Subject)}${x.Device ? `<br><small>${esc(x.Device)}</small>` : ''}</td><td><span class="tag ${x.Status}">${esc(x.Status)}</span></td><td><small>${esc(name[x.AccountId] || '—')}</small></td></tr>`;
        html += '</table><h3 style="font-size:12px;color:var(--cyan);margin:12px 0 6px">ACCOUNTS</h3><table><tr><th>name</th><th>site</th><th>tier</th></tr>';
        for (const x of acc.records) html += `<tr><td>${esc(x.Name)}<br><small>${esc(x.Id)}</small></td><td>${esc(x.Site)}</td><td>${esc(x.Tier)}</td></tr>`;
        html += '</table>';
      } else if (sys === 'ipam') {
        const r = L.ipam_get_subnets({});
        for (const sn of r.subnets) {
          const pct = Math.round((sn.used / Math.max(1, sn.usable)) * 100);
          html += `<div style="margin:10px 0"><b>${esc(sn.cidr)}</b> <small>${esc(sn.id)} · vlan ${sn.vlan} · ${esc(sn.site)}</small><br><small>${esc(sn.description)}</small>
            <div style="height:6px;background:#111;border:1px solid var(--line);margin:4px 0"><div style="height:100%;width:${Math.max(2, pct)}%;background:var(--neon)"></div></div>
            <small>${sn.used} used / ${sn.free} free</small><table>`;
          for (const a of sn.allocations) html += `<tr class="${isFresh(a.ip) ? 'fresh' : ''}"><td>${esc(a.ip)}</td><td>${esc(a.hostname)}${a.node ? ' <span class="tag info">' + esc(a.node) + '</span>' : ''}</td><td><span class="tag ${a.kind === 'host' ? 'pass' : 'info'}">${esc(a.kind)}</span></td></tr>`;
          html += '</table></div>';
        }
      }
      return html;
    },

    // ---------------------------------------------------------- inspector
    inspect(id) {
      const n = A67.store.labApi._node(id);
      if (!n) return;
      A67.canvas.select(n.id);
      A67.term && A67.term.print(`[canvas] double-click ${n.label} -> lab.device.inspect {"device_id":"${n.id}"}`, 'dim');
      this.openSheet(`INSPECT ${n.label}`, null, null, () => this.renderInspect(n.id));
    },
    renderInspect(id) {
      const lab = A67.store.labApi;
      const r = lab.device_inspect({ device_id: id });
      if (!r.ok) return `<p>${esc(r.message)}</p>`;
      const n = r.device, c = n.config;
      let html = `<div class="inspect-head"><img alt="" src="../assets/icons/${n.type}.png"><div><b style="color:var(--neon)">${esc(n.label)}</b><br><small>${esc(n.id)} · ${n.type} · <span class="tag ${n.status === 'up' ? 'up' : 'down'}">${n.status}</span></small></div></div>`;
      html += `<dl class="kv"><dt>hostname</dt><dd>${esc(c.hostname)}</dd><dt>mgmt ip</dt><dd>${esc(c.mgmt_ip || '— (allocate one in IPAM)')}</dd>
        <dt>access vlan</dt><dd>${esc(c.access_vlan)}</dd><dt>config rev</dt><dd>${esc(c.config_rev)}</dd>
        <dt>meraki serial</dt><dd>${n.integrations.includes('meraki') ? esc(n.meraki_serial) : '— (attach Meraki)'}</dd>
        <dt>neighbors</dt><dd>${r.neighbors.map((x) => esc(x.label)).join(', ') || '— (cable it)'}</dd>
        <dt>interfaces</dt><dd>${c.interfaces.map((i) => `${esc(i.name)}${i.ip ? ' ' + esc(i.ip) : ''} → ${esc(i.peer)} <span class="tag ${i.status === 'up' ? 'up' : 'down'}">${i.status}</span>`).join('<br>') || '—'}</dd>
        <dt>metrics</dt><dd>${r.metrics.reachable ? `cpu ${r.metrics.cpu_pct}% · mem ${r.metrics.mem_pct}% · ${r.metrics.latency_ms}ms` : 'unreachable'}</dd>
        <dt>alerts</dt><dd>${r.alerts.map((a) => `<span class="tag ${a.severity}">${esc(a.id)}</span> ${esc(a.message)}`).join('<br>') || 'none'}</dd></dl>`;
      html += '<h3 style="font-size:12px;color:var(--cyan);margin:14px 0 4px">ATTACH SIMULATED SYSTEMS</h3><div class="chips">';
      for (const s of SYSTEMS) {
        const on = n.integrations.includes(s);
        const fits = ATTACH_RULES[s].includes(n.type);
        html += `<button class="chip ${on ? 'on' : ''} ${fits ? '' : 'no'}" data-act="attach" data-node="${n.id}" data-sys="${s}" data-on="${on ? 0 : 1}" title="${fits ? '' : 'does not fit a ' + n.type}">${on ? '✓ ' : '+ '}${SYS_TITLE[s]}</button>`;
      }
      html += '</div><p style="font-size:11px;color:var(--muted)">Judgment: Meraki manages switches/routers/firewalls; Email lives on a server; Salesforce is SaaS, so it hangs off the cloud.</p>';
      html += `<div class="row-actions"><button class="btn small" data-act="console" data-node="${n.id}">OPEN CONSOLE</button>
        <button class="btn small" data-act="run" data-cmd="mcp call lab.device.inspect {&quot;device_id&quot;:&quot;${n.id}&quot;}">INSPECT VIA TOOL</button>
        <button class="btn small danger" data-act="remove" data-node="${n.id}">REMOVE</button></div>`;
      return html;
    },

    // ---------------------------------------------------------- verification board
    renderVerify() {
      const v = A67.store.lab.verification || {};
      const rows = [
        ['ping', 'Ping between two devices', 'verify ping <a> <b>', 'lab.device.run_command'],
        ['alert', 'Alert generation (test trap)', 'verify alert <device>', 'lab.device.run_command → monitoring.get_alerts'],
        ['case', 'Case creation', 'verify case', 'salesforce.create_case → salesforce.query'],
        ['allocate', 'IP allocation', 'verify allocate', 'ipam.allocate → ipam.get_subnets'],
        ['config', 'Config push', 'verify config <device>', 'meraki.update_config → device.inspect'],
      ];
      let html = '<h2>VERIFICATION</h2><p style="font-size:12px;color:var(--muted)">Each check is a real sequence of tool calls. Results are stored in lab_state.verification — an AI client calling the same tools updates this board too.</p>';
      for (const [k, title, cmd, tools] of rows) {
        const r = v[k] || { status: 'pending' };
        html += `<div class="vrow"><span class="vbadge ${r.status}">${r.status.toUpperCase()}</span><div>${title}<small>${esc(r.detail || tools)}</small></div><button class="btn small" data-verify="${esc(cmd)}">RUN</button></div>`;
      }
      html += '<button class="btn next-btn" data-verify="verify all">RUN ALL</button>';
      const el = document.getElementById('verify');
      el.innerHTML = html;
      el.querySelectorAll('[data-verify]').forEach((b) => b.addEventListener('click', () => {
        const cmd = b.dataset.verify;
        A67.app.showPane('term');
        if (cmd.includes('<')) { A67.term.prefill(cmd.replace(/ <.*$/, ' ')); } else A67.term.run(cmd, true);
      }));
    },

    // ---------------------------------------------------------- briefing modal
    brief(html, label, onGo) {
      document.getElementById('brief-body').innerHTML = html;
      const go = document.getElementById('brief-go');
      go.textContent = label || 'START';
      document.getElementById('brief').hidden = false;
      go.onclick = () => { document.getElementById('brief').hidden = true; if (onGo) onGo(); };
      go.focus();
    },
  });
})();
