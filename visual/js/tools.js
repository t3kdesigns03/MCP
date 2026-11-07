/* Agent0067 — browser mirror of mcp_server/lab.py.
 *
 * The static game runs these 17 tools in the browser so it works on Netlify
 * with no backend. The real FastMCP server runs the Python originals.
 * tests/test_parity.py drives both with the same script and diffs results.
 * Everything is FAKE. Nothing here makes a network request.
 */
(function (root) {
  'use strict';

  const NODE_TYPES = ['pc', 'switch', 'router', 'server', 'firewall', 'cloud'];
  const TYPE_PREFIX = { pc: 'pc', switch: 'sw', router: 'rtr', server: 'srv', firewall: 'fw', cloud: 'cld' };
  const TYPE_LABEL = { pc: 'PC', switch: 'SW', router: 'RTR', server: 'SRV', firewall: 'FW', cloud: 'CLOUD' };
  const MAX_LINKS = { pc: 1, server: 2, switch: 8, router: 8, firewall: 8, cloud: 8 };
  const ATTACH_RULES = {
    meraki: ['switch', 'router', 'firewall'],
    monitoring: ['pc', 'switch', 'router', 'server', 'firewall'],
    ipam: ['pc', 'switch', 'router', 'server', 'firewall'],
    email: ['server'],
    salesforce: ['cloud'],
  };
  const SYSTEMS = ['email', 'meraki', 'monitoring', 'salesforce', 'ipam'];
  const KEY_ENV = {
    email: 'EMAIL_API_KEY', meraki: 'MERAKI_API_KEY', monitoring: 'MONITORING_API_KEY',
    salesforce: 'SALESFORCE_API_KEY', ipam: 'IPAM_API_KEY',
  };
  const KEY_RE = /^FAKE-[A-Z]+-[0-9a-f]{32}$/;
  const MERAKI_MODEL = { switch: 'MS120-8 (sim)', router: 'MX67 (sim)', firewall: 'MX68 (sim)' };
  const TOOL_NAMES = [
    'lab.topology.get', 'lab.topology.add_node', 'lab.topology.connect',
    'lab.device.list', 'lab.device.inspect', 'lab.device.run_command',
    'integrations.email.list', 'integrations.email.send',
    'integrations.meraki.get_networks', 'integrations.meraki.get_devices', 'integrations.meraki.update_config',
    'integrations.monitoring.get_alerts', 'integrations.monitoring.get_metrics',
    'integrations.salesforce.query', 'integrations.salesforce.create_case',
    'integrations.ipam.get_subnets', 'integrations.ipam.allocate',
  ];
  const WRITE_TOOLS = ['integrations.email.send', 'integrations.meraki.update_config',
    'integrations.salesforce.create_case', 'integrations.ipam.allocate'];

  const utcnow = () => new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
  const maskKey = (v) => (v ? '...' + v.slice(-4) : '(unset)');
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const pad = (s, n) => { s = String(s); return s.length >= n ? s : s + ' '.repeat(n - s.length); };

  function fnv1a(text) {
    const bytes = typeof TextEncoder !== 'undefined' ? new TextEncoder().encode(text) : Buffer.from(text, 'utf8');
    let h = 0x811c9dc5;
    for (const b of bytes) { h ^= b; h = Math.imul(h, 0x01000193) >>> 0; }
    return h >>> 0;
  }

  function err(code, message, extra) {
    return Object.assign({ ok: false, error: code, message }, extra || {});
  }

  // --- tiny IPv4 helpers (python's ipaddress, just what we need) ---
  const ip2n = (ip) => ip.split('.').reduce((a, o) => (a * 256) + Number(o), 0);
  const n2ip = (n) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
  function cidrInfo(cidr) {
    const [ip, bits] = cidr.split('/');
    const size = 2 ** (32 - Number(bits));
    const net = Math.floor(ip2n(ip) / size) * size;
    return { net, size };
  }
  function cidrHosts(cidr) {
    const { net, size } = cidrInfo(cidr);
    const out = [];
    for (let i = 1; i < size - 1; i++) out.push(n2ip(net + i));
    return out;
  }

  class Lab {
    constructor(state, env, clock) {
      this.state = state;          // shared lab_state document
      this.env = env || {};        // where the "server" reads keys from
      this.clock = clock || utcnow;
      this.onCommit = null;        // canvas re-render / persistence hook
    }
    get s() { return this.state; }
    _begin() { return this.state; }
    _commit() {
      this.state.rev = (this.state.rev || 0) + 1;
      this.state.updated_at = this.clock();
      if (this.onCommit) this.onCommit(this.state);
    }
    _node(ref) {
      if (!ref) return null;
      const r = String(ref).toLowerCase();
      return this.s.nodes.find((n) => n.id.toLowerCase() === r || n.label.toLowerCase() === r ||
        (n.config.hostname || '').toLowerCase() === r) || null;
    }
    _neighbors(id) {
      const out = [];
      for (const e of this.s.edges) { if (e.a === id) out.push(e.b); else if (e.b === id) out.push(e.a); }
      return out;
    }
    _event(kind, detail) {
      const c = this.s.counters;
      c.event = (c.event || 0) + 1;
      this.s.events = this.s.events || [];
      this.s.events.push(Object.assign({ id: c.event, kind, at: this.clock() }, detail));
      this.s.events = this.s.events.slice(-50);
    }
    _verify(key, passed, detail) {
      this.s.verification = this.s.verification || {};
      this.s.verification[key] = { status: passed ? 'pass' : 'fail', detail, at: this.clock() };
    }
    auth(system) {
      const envName = KEY_ENV[system];
      const value = this.env[envName] || '';
      if (!value) {
        return err('missing_api_key', `${envName} is not set on the MCP server.`, {
          env: envName,
          hint: `Generate a FAKE key in the ${system} settings panel, then \`export ${envName}=...\` ` +
            'or add it to .env. Never paste it into a chat or prompt.',
        });
      }
      if (!KEY_RE.test(value)) {
        return err('rejected_api_key', `${envName} does not look like a lab key. This lab only accepts ` +
          'FAKE-<SYSTEM>-<32 hex> keys; a real key must never be used here.', { env: envName });
      }
      return { ok: true, env: envName, key: maskKey(value) };
    }
    _gate(system) { const a = this.auth(system); return a.ok ? null : a; }
    static _confirmNeeded(tool, preview) {
      return {
        ok: false, status: 'confirmation_required', tool, preview,
        message: 'This is a write. Show the preview to the user and re-call with confirm=true only after they approve.',
      };
    }
    _merakiDevices() {
      const devs = clone(this.s.integrations.meraki.devices);
      for (const n of this.s.nodes) {
        if ((n.integrations || []).includes('meraki')) {
          devs.push({
            serial: n.meraki_serial, name: n.label, model: MERAKI_MODEL[n.type] || 'sim',
            network_id: 'N_FAKE_HQ', status: (n.status || 'up') === 'up' ? 'online' : 'offline',
            lan_ip: n.config.mgmt_ip || '', last_seen: this.clock(),
            config: { access_vlan: n.config.access_vlan, uplink_enabled: n.config.uplink_enabled, notes: n.config.notes },
            lab_node: n.id,
          });
        }
      }
      return devs;
    }
    _metricsFor(name, status) {
      const h = fnv1a(name);
      if (status === 'offline' || status === 'down') {
        return { reachable: false, cpu_pct: null, mem_pct: null, latency_ms: null, if_util_pct: null };
      }
      return {
        reachable: true,
        cpu_pct: 6 + h % 55,
        mem_pct: 28 + (h >>> 8) % 52,
        latency_ms: 1 + (h >>> 16) % 24,
        if_util_pct: (h >>> 4) % 71,
      };
    }

    // ---- lab/topology
    topology_get() {
      this._begin();
      return {
        ok: true,
        rev: this.s.rev || 0,
        nodes: this.s.nodes.map((n) => ({ id: n.id, label: n.label, type: n.type, x: n.x, y: n.y, status: n.status, integrations: n.integrations })),
        edges: this.s.edges.map((e) => ({ a: e.a, b: e.b, a_port: e.a_port, b_port: e.b_port })),
        counts: { nodes: this.s.nodes.length, edges: this.s.edges.length },
      };
    }
    topology_add_node({ type, label = null, x = null, y = null, integrations = null } = {}) {
      this._begin();
      const t = String(type || '').toLowerCase();
      if (!NODE_TYPES.includes(t)) return err('bad_type', `Unknown device type '${type}'.`, { allowed: NODE_TYPES.slice() });
      const c = this.s.counters;
      c[t] = (c[t] || 0) + 1;
      let n = c[t];
      let id = `${TYPE_PREFIX[t]}${n}`;
      while (this._node(id)) { c[t] += 1; n = c[t]; id = `${TYPE_PREFIX[t]}${n}`; }
      const lbl = (label || `${TYPE_LABEL[t]}-${String(n).padStart(2, '0')}`).trim().slice(0, 24);
      if (this._node(lbl)) return err('duplicate_label', `A node named '${lbl}' already exists.`);
      const count = this.s.nodes.length;
      const node = {
        id, label: lbl, type: t,
        x: x != null ? Number(x) : 140 + (count % 4) * 170,
        y: y != null ? Number(y) : 120 + Math.floor(count / 4) * 140,
        status: 'up', integrations: [],
        meraki_serial: `Q2FK-LAB-${id.toUpperCase()}`,
        config: { hostname: lbl, mgmt_ip: '', access_vlan: 1, uplink_enabled: true, notes: '', interfaces: [], config_rev: 0 },
      };
      this.s.nodes.push(node);
      const warnings = [];
      for (const sys of integrations || []) {
        const r = this._attach(node, sys);
        if (!r.ok) warnings.push(r.message);
      }
      this._event('node_added', { node: id });
      this._commit();
      const out = { ok: true, node: clone(node) };
      if (warnings.length) out.warnings = warnings;
      return out;
    }
    _attach(node, system) {
      system = String(system).toLowerCase();
      if (!SYSTEMS.includes(system)) return err('bad_system', `Unknown system '${system}'.`, { allowed: SYSTEMS.slice() });
      if (!ATTACH_RULES[system].includes(node.type)) {
        return err('bad_attach', `${system} does not belong on a ${node.type}. It fits: ${ATTACH_RULES[system].join(', ')}.`);
      }
      if (!node.integrations.includes(system)) node.integrations.push(system);
      return { ok: true };
    }
    attach(nodeRef, system) {
      this._begin();
      const node = this._node(nodeRef);
      if (!node) return err('not_found', `No device '${nodeRef}'.`);
      const r = this._attach(node, system);
      if (r.ok) this._commit();
      return r;
    }
    detach(nodeRef, system) {
      const node = this._node(nodeRef);
      if (!node) return err('not_found', `No device '${nodeRef}'.`);
      node.integrations = node.integrations.filter((x) => x !== system);
      this._commit();
      return { ok: true };
    }
    removeNode(nodeRef) {
      const node = this._node(nodeRef);
      if (!node) return err('not_found', `No device '${nodeRef}'.`);
      this.s.edges = this.s.edges.filter((e) => e.a !== node.id && e.b !== node.id);
      this.s.nodes = this.s.nodes.filter((n) => n.id !== node.id);
      for (const n of this.s.nodes) n.config.interfaces = n.config.interfaces.filter((i) => i.peer !== node.id);
      this._commit();
      return { ok: true };
    }
    moveNode(id, x, y) {
      const n = this._node(id);
      if (n) { n.x = Math.round(x); n.y = Math.round(y); }
    }
    _nextPort(node) {
      const used = new Set(node.config.interfaces.map((i) => i.name));
      for (let k = 1; k < 33; k++) {
        const name = { pc: `eth${k - 1}`, server: `eth${k - 1}`, cloud: `wan${k - 1}`, firewall: `port${k}` }[node.type] || `Gi0/${k}`;
        if (!used.has(name)) return name;
      }
      return `x${used.size}`;
    }
    topology_connect({ a, b } = {}) {
      this._begin();
      const na = this._node(a), nb = this._node(b);
      if (!na || !nb) return err('not_found', `Both ends must exist (got '${a}', '${b}').`);
      if (na.id === nb.id) return err('self_link', 'A device cannot be cabled to itself.');
      for (const e of this.s.edges) {
        if ((e.a === na.id && e.b === nb.id) || (e.a === nb.id && e.b === na.id)) {
          return err('duplicate_link', `${na.label} and ${nb.label} are already connected.`);
        }
      }
      for (const n of [na, nb]) {
        if (this._neighbors(n.id).length >= MAX_LINKS[n.type]) {
          return err('no_free_port', `${n.label} (${n.type}) has no free port (max ${MAX_LINKS[n.type]}). Put a switch between them.`);
        }
      }
      const pa = this._nextPort(na), pb = this._nextPort(nb);
      na.config.interfaces.push({ name: pa, peer: nb.id, ip: '', status: 'up' });
      nb.config.interfaces.push({ name: pb, peer: na.id, ip: '', status: 'up' });
      const edge = { id: `${na.id}--${nb.id}`, a: na.id, b: nb.id, a_port: pa, b_port: pb };
      this.s.edges.push(edge);
      this._event('link_added', { edge: edge.id });
      this._commit();
      return { ok: true, edge };
    }

    // ---- lab/device
    device_list() {
      this._begin();
      const devices = this.s.nodes.map((n) => ({
        id: n.id, label: n.label, type: n.type, status: n.status || 'up',
        mgmt_ip: n.config.mgmt_ip || '', links: this._neighbors(n.id).length,
        integrations: (n.integrations || []).slice(),
      }));
      return { ok: true, devices, count: devices.length };
    }
    device_inspect({ device_id } = {}) {
      this._begin();
      const n = this._node(device_id);
      if (!n) return err('not_found', `No device '${device_id}'.`, { known: this.s.nodes.map((x) => x.id) });
      const alloc = [];
      for (const sn of this.s.integrations.ipam.subnets) {
        for (const a of sn.allocations) if (a.node === n.id) alloc.push(Object.assign({ subnet: sn.id }, a));
      }
      const alerts = this.s.integrations.monitoring.alerts.filter((a) => a.source === n.label);
      return {
        ok: true,
        device: clone(n),
        neighbors: this._neighbors(n.id).map((x) => ({ id: x, label: this._node(x).label })),
        metrics: this._metricsFor(n.label, n.status || 'up'),
        ipam: alloc,
        alerts,
      };
    }
    _path(src, dst) {
      const prev = { [src]: null };
      const queue = [src];
      while (queue.length) {
        let cur = queue.shift();
        if (cur === dst) {
          const path = [];
          while (cur !== null) { path.push(cur); cur = prev[cur]; }
          return path.reverse();
        }
        for (const nb of this._neighbors(cur)) {
          if (!(nb in prev) && (this._node(nb).status || 'up') === 'up') { prev[nb] = cur; queue.push(nb); }
        }
      }
      return null;
    }
    device_run_command({ device_id, command } = {}) {
      this._begin();
      const n = this._node(device_id);
      if (!n) return err('not_found', `No device '${device_id}'.`);
      const cmd = String(command || '').trim().split(/\s+/).filter(Boolean).join(' ');
      const low = cmd.toLowerCase();
      const cfg = n.config;
      const host = cfg.hostname || n.label;
      let lines;
      if (['show version', 'sh ver'].includes(low)) {
        lines = [`${host} — Agent0067 SimOS 6.7 (FAKE)`, `Device type: ${n.type}`, 'Uptime: 6 days, 7 hours',
          `Config revision: ${cfg.config_rev || 0}`];
      } else if (['show running-config', 'sh run', 'show run'].includes(low)) {
        lines = [`hostname ${host}`];
        for (const i of cfg.interfaces) {
          lines.push(`interface ${i.name}`, ` description link to ${i.peer}`);
          if (i.ip) lines.push(` ip address ${i.ip}`);
          lines.push(i.status === 'up' ? ' no shutdown' : ' shutdown');
        }
        if (cfg.mgmt_ip) lines.push(`ip mgmt ${cfg.mgmt_ip}`);
        lines.push(`switchport access vlan ${cfg.access_vlan != null ? cfg.access_vlan : 1}`);
        if (cfg.notes) lines.push(`! notes: ${cfg.notes}`);
        lines.push('end');
      } else if (['show ip interface brief', 'sh ip int br', 'show ip int brief'].includes(low)) {
        lines = ['Interface        IP-Address       Status   Peer'];
        for (const i of cfg.interfaces) lines.push(`${pad(i.name, 16)} ${pad(i.ip || 'unassigned', 16)} ${pad(i.status, 8)} ${i.peer}`);
        if (cfg.mgmt_ip) lines.push(`${pad('mgmt0', 16)} ${pad(cfg.mgmt_ip, 16)} ${pad('up', 8)} -`);
      } else if (['show cdp neighbors', 'show lldp neighbors', 'sh cdp nei', 'sh lldp nei'].includes(low)) {
        lines = ['Device-ID        Local-Port   Remote-Port'];
        for (const e of this.s.edges) {
          if (e.a === n.id) lines.push(`${pad(this._node(e.b).label, 16)} ${pad(e.a_port, 12)} ${e.b_port}`);
          else if (e.b === n.id) lines.push(`${pad(this._node(e.a).label, 16)} ${pad(e.b_port, 12)} ${e.a_port}`);
        }
      } else if (low.startsWith('ping ') || low.startsWith('traceroute ')) {
        const targetRef = cmd.split(' ').slice(1).join(' ');
        let target = this._node(targetRef);
        if (!target) for (const x of this.s.nodes) if (x.config.mgmt_ip && x.config.mgmt_ip === targetRef) target = x;
        if (!target) {
          this._verify('ping', false, `${host}: unknown target ${targetRef}`);
          this._commit();
          return err('unknown_target', `% Unrecognized host or address: ${targetRef}`);
        }
        const path = this._path(n.id, target.id);
        const ok = path !== null;
        const hops = path ? path.map((p) => this._node(p).label) : [];
        if (low.startsWith('ping')) {
          lines = [`Sending 5, 100-byte ICMP Echos to ${target.label}, timeout is 2 seconds:`,
            ok ? '!!!!!' : '.....',
            `Success rate is ${ok ? '100 percent (5/5)' : '0 percent (0/5)'}`];
          if (ok) lines.push('path: ' + hops.join(' -> '));
          this._verify('ping', ok, `${n.label} -> ${target.label}: ` + (ok ? hops.join(' -> ') : 'no path'));
        } else {
          lines = [`traceroute to ${target.label}`].concat(ok ? hops.slice(1).map((h, i) => ` ${i + 1}  ${h}  ${1 + i * 2} ms`) : [' 1  * * *']);
        }
        this._commit();
        return { ok: true, device: n.id, command: cmd, output: lines, success: ok, path: hops };
      } else if (['send test-trap', 'test trap', 'send test trap'].includes(low)) {
        const c = this.s.counters;
        c.alert += 1;
        const alert = { id: `AL-${c.alert}`, severity: 'warning', source: n.label, site: 'HQ',
          message: `TEST-TRAP from ${host} (lab verification)`, status: 'open', at: this.clock() };
        this.s.integrations.monitoring.alerts.push(alert);
        this._verify('alert', true, `${alert.id} raised by ${n.label}`);
        this._event('alert', { alert: alert.id });
        this._commit();
        return { ok: true, device: n.id, command: cmd, output: [`SNMP trap sent to monitoring collector: ${alert.id}`], alert };
      } else {
        return err('invalid_input', `% Invalid input detected: '${cmd}'`, {
          supported: ['show version', 'show running-config', 'show ip interface brief', 'show cdp neighbors',
            'ping <device>', 'traceroute <device>', 'send test-trap'],
        });
      }
      return { ok: true, device: n.id, command: cmd, output: lines };
    }

    // ---- integrations/email
    email_list({ folder = 'inbox', limit = 20, unread_only = false } = {}) {
      this._begin();
      const g = this._gate('email'); if (g) return g;
      let msgs = this.s.integrations.email.messages.filter((m) =>
        (folder === 'all' || m.folder === folder) && (!unread_only || !m.read));
      msgs = msgs.slice().sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
        .slice(0, Math.max(1, Math.min(parseInt(limit, 10), 100)));
      return { ok: true, auth: this.auth('email'), mailbox: this.s.integrations.email.mailbox,
        folder, messages: clone(msgs), count: msgs.length };
    }
    email_send({ to, subject, body, confirm = false } = {}) {
      this._begin();
      const g = this._gate('email'); if (g) return g;
      to = String(to || '').trim();
      if (!/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.example$/.test(to)) {
        return err('bad_recipient', 'The simulated mail relay only delivers to *.example addresses.');
      }
      if (!subject) return err('bad_subject', 'Subject is required.');
      const box = this.s.integrations.email.mailbox;
      const preview = { from: box, to, subject, body };
      if (!confirm) return Lab._confirmNeeded('integrations.email.send', preview);
      const c = this.s.counters;
      c.msg += 1;
      const msg = Object.assign({ id: `msg-${c.msg}`, folder: 'sent', read: true, at: this.clock() }, preview);
      this.s.integrations.email.messages.push(msg);
      if (to.toLowerCase() === box.toLowerCase()) {
        c.msg += 1;
        this.s.integrations.email.messages.push(Object.assign({}, msg, { id: `msg-${c.msg}`, folder: 'inbox', read: false }));
      }
      this._event('email_sent', { msg: msg.id });
      this._commit();
      return { ok: true, auth: this.auth('email'), message: msg };
    }

    // ---- integrations/meraki
    meraki_get_networks() {
      this._begin();
      const g = this._gate('meraki'); if (g) return g;
      const devs = this._merakiDevices();
      const nets = this.s.integrations.meraki.networks.map((net) => {
        const mine = devs.filter((d) => d.network_id === net.id);
        const off = mine.filter((d) => d.status === 'offline').length;
        const alerting = mine.filter((d) => d.status === 'alerting').length;
        let status;
        if (!mine.length) status = 'empty';
        else if (off === mine.length) status = 'down';
        else if (off || alerting) status = 'degraded';
        else status = 'up';
        return Object.assign({}, net, { status, devices: mine.length, offline: off, alerting });
      });
      return { ok: true, auth: this.auth('meraki'), org: this.s.integrations.meraki.org, networks: nets };
    }
    meraki_get_devices({ network_id = null, status = null } = {}) {
      this._begin();
      const g = this._gate('meraki'); if (g) return g;
      let devs = this._merakiDevices();
      if (network_id) {
        devs = devs.filter((d) => d.network_id === network_id ||
          this.s.integrations.meraki.networks.some((n) => n.id === d.network_id && n.name.toLowerCase() === network_id.toLowerCase()));
      }
      if (status) devs = devs.filter((d) => d.status === status);
      return { ok: true, auth: this.auth('meraki'), devices: devs, count: devs.length };
    }
    meraki_update_config({ serial, changes, confirm = false } = {}) {
      this._begin();
      const g = this._gate('meraki'); if (g) return g;
      const allowed = ['name', 'access_vlan', 'uplink_enabled', 'notes'];
      if (!changes || typeof changes !== 'object' || Array.isArray(changes) || !Object.keys(changes).length) {
        return err('bad_changes', 'changes must be a non-empty object.', { allowed });
      }
      const bad = Object.keys(changes).filter((k) => !allowed.includes(k));
      if (bad.length) return err('bad_changes', `Unsupported setting(s): ${bad.join(', ')}.`, { allowed });
      if ('access_vlan' in changes) {
        const v = parseInt(changes.access_vlan, 10);
        if (Number.isNaN(v)) return err('bad_vlan', 'access_vlan must be an integer 1-4094.');
        if (v < 1 || v > 4094) return err('bad_vlan', 'access_vlan must be 1-4094.');
        changes = Object.assign({}, changes, { access_vlan: v });
      }
      const node = this.s.nodes.find((n) => n.meraki_serial === serial && n.integrations.includes('meraki')) || null;
      const seeded = this.s.integrations.meraki.devices.find((d) => d.serial === serial) || null;
      if (!node && !seeded) return err('not_found', `No Meraki device with serial ${serial}.`);
      const before = node
        ? { name: node.label, access_vlan: node.config.access_vlan, uplink_enabled: node.config.uplink_enabled, notes: node.config.notes }
        : Object.assign({ name: seeded.name }, seeded.config);
      const after = Object.assign({}, before, changes);
      if (!confirm) return Lab._confirmNeeded('integrations.meraki.update_config', { serial, before, after });
      if (node) {
        if ('name' in changes) { node.label = String(changes.name).slice(0, 24); node.config.hostname = node.label; }
        for (const k of ['access_vlan', 'uplink_enabled', 'notes']) if (k in changes) node.config[k] = changes[k];
        node.config.config_rev = (node.config.config_rev || 0) + 1;
        const applied = node.config.access_vlan === after.access_vlan && node.label === after.name;
        this._verify('config', applied, `${serial} -> ${node.label} rev ${node.config.config_rev}`);
      } else {
        if ('name' in changes) seeded.name = String(changes.name).slice(0, 24);
        for (const k of ['access_vlan', 'uplink_enabled', 'notes']) if (k in changes) seeded.config[k] = changes[k];
        this._verify('config', true, `${serial} (${seeded.name}) updated`);
      }
      this._event('config_push', { serial });
      this._commit();
      return { ok: true, auth: this.auth('meraki'), serial, before, after, lab_node: node ? node.id : null };
    }

    // ---- integrations/monitoring
    monitoring_get_alerts({ severity = null, status = 'open', site = null } = {}) {
      this._begin();
      const g = this._gate('monitoring'); if (g) return g;
      const out = this.s.integrations.monitoring.alerts.filter((a) => (status === 'all' || a.status === status) &&
        (!severity || a.severity === severity) && (!site || a.site.toLowerCase() === site.toLowerCase()));
      return { ok: true, auth: this.auth('monitoring'), alerts: clone(out).reverse(), count: out.length };
    }
    monitoring_get_metrics({ device = null } = {}) {
      this._begin();
      const g = this._gate('monitoring'); if (g) return g;
      let rows = [];
      for (const n of this.s.nodes) {
        if (n.integrations.includes('monitoring')) rows.push(Object.assign({ device: n.label, source: 'lab' }, this._metricsFor(n.label, n.status || 'up')));
      }
      for (const d of this.s.integrations.meraki.devices) rows.push(Object.assign({ device: d.name, source: 'branch' }, this._metricsFor(d.name, d.status)));
      if (device) {
        const nd = this._node(device);
        rows = rows.filter((r) => r.device.toLowerCase() === device.toLowerCase() || (nd && nd.label === r.device));
        if (!rows.length) return err('not_monitored', `'${device}' is not monitored. Attach monitoring to it on the canvas first.`);
      }
      return { ok: true, auth: this.auth('monitoring'), metrics: rows, count: rows.length };
    }

    // ---- integrations/salesforce
    salesforce_query({ soql } = {}) {
      this._begin();
      const g = this._gate('salesforce'); if (g) return g;
      const SOQL = /^\s*SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?)?(?:\s+LIMIT\s+(\d+))?\s*$/i;
      const m = SOQL.exec(soql || '');
      if (!m) {
        return err('malformed_query', "Expected: SELECT f1, f2 FROM Case|Account [WHERE f = 'v' [AND ...]] [ORDER BY f [ASC|DESC]] [LIMIT n]");
      }
      const [, fieldsRaw, objRaw, where, order, dir, limit] = m;
      const table = { case: 'cases', account: 'accounts' }[objRaw.toLowerCase()];
      if (!table) return err('bad_object', `sObject type '${objRaw}' is not supported.`, { supported: ['Case', 'Account'] });
      const rows = this.s.integrations.salesforce[table];
      const known = rows.length ? Object.keys(rows[0]) : [];
      let fields = fieldsRaw.split(',').map((f) => f.trim());
      if ((fields.length === 1 && fields[0] === '*') || (fields.length === 1 && fields[0].toUpperCase() === 'FIELDS(ALL)')) fields = known.slice().sort();
      const bad = fields.filter((f) => !known.includes(f));
      if (bad.length) return err('invalid_field', `No such column(s) on ${objRaw}: ${bad.join(', ')}`, { known: known.slice().sort() });
      const conds = [];
      if (where) {
        for (const part of where.split(/\s+AND\s+/i)) {
          const c = /^\s*(\w+)\s*(=|!=|LIKE)\s*'([^']*)'\s*$/i.exec(part);
          if (!c || !known.includes(c[1])) return err('malformed_where', `Cannot parse condition: ${part.trim()}`);
          conds.push([c[1], c[2].toUpperCase(), c[3]]);
        }
      }
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const keep = (r) => conds.every(([f, op, v]) => {
        const val = String(r[f] != null ? r[f] : '');
        if (op === '=') return val === v;
        if (op === '!=') return val !== v;
        return new RegExp('^' + esc(v).replace(/%/g, '.*').replace(/_/g, '.') + '$', 'i').test(val);
      });
      let out = rows.filter(keep);
      if (order) {
        if (!known.includes(order)) return err('invalid_field', `Cannot order by ${order}`);
        const desc = (dir || '').toUpperCase() === 'DESC';
        out = out.slice().sort((a, b) => {
          const x = String(a[order] != null ? a[order] : ''), y = String(b[order] != null ? b[order] : '');
          return x < y ? (desc ? 1 : -1) : x > y ? (desc ? -1 : 1) : 0;
        });
      }
      if (limit) out = out.slice(0, parseInt(limit, 10));
      return { ok: true, auth: this.auth('salesforce'), totalSize: out.length,
        records: out.map((r) => Object.fromEntries(fields.map((f) => [f, r[f] !== undefined ? r[f] : null]))) };
    }
    salesforce_create_case({ subject, description = '', priority = 'Medium', account = null, device = null, confirm = false } = {}) {
      this._begin();
      const g = this._gate('salesforce'); if (g) return g;
      if (!subject) return err('bad_subject', 'Subject is required.');
      if (!['Low', 'Medium', 'High', 'Critical'].includes(priority)) return err('bad_priority', 'priority must be Low, Medium, High or Critical.');
      let acct = null;
      if (account) {
        const a = account.toLowerCase();
        acct = this.s.integrations.salesforce.accounts.find((x) => [x.Id.toLowerCase(), x.Name.toLowerCase(), x.Site.toLowerCase()].includes(a)) || null;
        if (!acct) return err('bad_account', `No account matching '${account}'.`);
      }
      const preview = { Subject: subject, Description: description, Priority: priority, AccountId: acct ? acct.Id : '', Device: device || '' };
      if (!confirm) return Lab._confirmNeeded('integrations.salesforce.create_case', preview);
      const c = this.s.counters;
      c.case += 1;
      const num = String(c.case).padStart(8, '0');
      const kase = Object.assign({ Id: `500FAKE${num.slice(-8)}`, CaseNumber: num, Status: 'New', CreatedDate: this.clock() }, preview);
      this.s.integrations.salesforce.cases.push(kase);
      this._verify('case', true, `Case ${num} created`);
      this._event('case', { case: num });
      this._commit();
      return { ok: true, auth: this.auth('salesforce'), case: kase };
    }

    // ---- integrations/ipam
    _subnetView(sn) {
      const usable = Math.max(0, cidrInfo(sn.cidr).size - 2);
      const used = sn.allocations.length;
      return Object.assign(clone(sn), { usable, used, free: usable - used });
    }
    ipam_get_subnets({ site = null } = {}) {
      this._begin();
      const g = this._gate('ipam'); if (g) return g;
      const subs = this.s.integrations.ipam.subnets.filter((sn) => !site || sn.site.toLowerCase() === site.toLowerCase()).map((sn) => this._subnetView(sn));
      return { ok: true, auth: this.auth('ipam'), subnets: subs, count: subs.length };
    }
    ipam_allocate({ subnet, hostname, node_id = null, confirm = false } = {}) {
      this._begin();
      const g = this._gate('ipam'); if (g) return g;
      const sn = this.s.integrations.ipam.subnets.find((x) => x.id === subnet || x.cidr === subnet) || null;
      if (!sn) return err('not_found', `No subnet '${subnet}'.`, { known: this.s.integrations.ipam.subnets.map((x) => x.id) });
      hostname = String(hostname || '').trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(hostname)) return err('bad_hostname', 'hostname must be 1-31 chars: letters, digits, dashes.');
      if (sn.allocations.some((a) => a.hostname === hostname)) return err('duplicate_hostname', `${hostname} already has an address in ${sn.cidr}.`);
      let node = null;
      if (node_id) {
        node = this._node(node_id);
        if (!node) return err('not_found', `No device '${node_id}' to bind the address to.`);
      }
      const used = new Set(sn.allocations.map((a) => a.ip));
      const hosts = cidrHosts(sn.cidr);
      const start = cidrInfo(sn.cidr).size > 64 ? 9 : 2;
      const ip = hosts.slice(start).find((h) => !used.has(h)) || null;
      if (!ip) {
        this._verify('allocate', false, `${sn.cidr} is full`);
        this._commit();
        return err('subnet_full', `${sn.cidr} has no free addresses.`);
      }
      const preview = { subnet: sn.id, cidr: sn.cidr, ip, hostname, node: node ? node.id : null };
      if (!confirm) return Lab._confirmNeeded('integrations.ipam.allocate', preview);
      const alloc = { ip, hostname, kind: 'host', at: this.clock() };
      if (node) { alloc.node = node.id; node.config.mgmt_ip = ip; }
      sn.allocations.push(alloc);
      this._verify('allocate', true, `${ip} -> ${hostname}`);
      this._event('ip_allocated', { ip });
      this._commit();
      return { ok: true, auth: this.auth('ipam'), allocation: Object.assign({ subnet: sn.id }, alloc), subnet: this._subnetView(sn) };
    }

    call(name, args) {
      const fn = {
        'lab.topology.get': 'topology_get', 'lab.topology.add_node': 'topology_add_node',
        'lab.topology.connect': 'topology_connect', 'lab.device.list': 'device_list',
        'lab.device.inspect': 'device_inspect', 'lab.device.run_command': 'device_run_command',
        'integrations.email.list': 'email_list', 'integrations.email.send': 'email_send',
        'integrations.meraki.get_networks': 'meraki_get_networks', 'integrations.meraki.get_devices': 'meraki_get_devices',
        'integrations.meraki.update_config': 'meraki_update_config',
        'integrations.monitoring.get_alerts': 'monitoring_get_alerts', 'integrations.monitoring.get_metrics': 'monitoring_get_metrics',
        'integrations.salesforce.query': 'salesforce_query', 'integrations.salesforce.create_case': 'salesforce_create_case',
        'integrations.ipam.get_subnets': 'ipam_get_subnets', 'integrations.ipam.allocate': 'ipam_allocate',
      }[name];
      if (!fn) return err('unknown_tool', `Unknown tool: ${name}`, { known: TOOL_NAMES.slice() });
      return this[fn](args || {});
    }
  }

  /* What tools/list returns for these tools: name, description, input schema.
   * The game shows this exact payload in DISCOVER/CLIENT; note there is no
   * URL and no key anywhere in it. */
  const S = (props, req) => ({ type: 'object', properties: props, required: req || [] });
  const str = (d) => (d ? { type: 'string', description: d } : { type: 'string' });
  const CONFIRM = { type: 'boolean', default: false, description: 'Must be true to actually write. Leave false to get a preview for the user.' };
  const TOOL_SCHEMAS = [
    { name: 'lab.topology.get', description: 'Return the lab topology the player built on the canvas: nodes and cabled edges.', inputSchema: S({}), readOnly: true },
    { name: 'lab.topology.add_node', description: 'Place a new device on the lab map.', inputSchema: S({ type: { enum: NODE_TYPES }, label: str('Display name'), x: { type: 'number' }, y: { type: 'number' }, integrations: { type: 'array', items: { enum: SYSTEMS } } }, ['type']), readOnly: false },
    { name: 'lab.topology.connect', description: 'Cable two devices together. Assigns the next free port on each end.', inputSchema: S({ a: str('Device id or label'), b: str('Device id or label') }, ['a', 'b']), readOnly: false },
    { name: 'lab.device.list', description: 'List every device in the lab with status, management IP, link count and attached systems.', inputSchema: S({}), readOnly: true },
    { name: 'lab.device.inspect', description: 'Full detail for one device: config, interfaces, neighbors, metrics, IPAM bindings, alerts.', inputSchema: S({ device_id: str('Device id or label') }, ['device_id']), readOnly: true },
    { name: 'lab.device.run_command', description: 'Run a CLI command on a simulated device (show/ping/traceroute; send test-trap raises a lab alert).', inputSchema: S({ device_id: str(), command: str() }, ['device_id', 'command']), readOnly: false },
    { name: 'integrations.email.list', description: 'List messages in the NOC mailbox (simulated mail system).', inputSchema: S({ folder: { enum: ['inbox', 'sent', 'all'] }, limit: { type: 'integer' }, unread_only: { type: 'boolean' } }), readOnly: true },
    { name: 'integrations.email.send', description: 'Send an email from the NOC mailbox. WRITE: returns a preview unless confirm=true.', inputSchema: S({ to: str('@*.example address'), subject: str(), body: str(), confirm: CONFIRM }, ['to', 'subject', 'body']), readOnly: false },
    { name: 'integrations.meraki.get_networks', description: "List Meraki networks (sites) with a rolled-up status: up, degraded, down or empty. Use this to answer 'which sites are down?'.", inputSchema: S({}), readOnly: true },
    { name: 'integrations.meraki.get_devices', description: 'List Meraki-managed devices, optionally filtered by network or status. Use this to find offline devices.', inputSchema: S({ network_id: str(), status: { enum: ['online', 'offline', 'alerting'] } }), readOnly: true },
    { name: 'integrations.meraki.update_config', description: 'Push a simple config change to a Meraki device. WRITE: returns before/after preview unless confirm=true.', inputSchema: S({ serial: str(), changes: { type: 'object' }, confirm: CONFIRM }, ['serial', 'changes']), readOnly: false },
    { name: 'integrations.monitoring.get_alerts', description: 'List monitoring alerts (newest first), optionally filtered by severity, status, or site.', inputSchema: S({ severity: { enum: ['critical', 'warning', 'info'] }, status: { enum: ['open', 'resolved', 'all'] }, site: str() }), readOnly: true },
    { name: 'integrations.monitoring.get_metrics', description: 'CPU, memory, latency and interface utilisation for monitored devices.', inputSchema: S({ device: str() }), readOnly: true },
    { name: 'integrations.salesforce.query', description: 'Run a small SOQL subset against the simulated Salesforce org (Case, Account).', inputSchema: S({ soql: str() }, ['soql']), readOnly: true },
    { name: 'integrations.salesforce.create_case', description: 'Open a support case. WRITE: returns a preview unless confirm=true.', inputSchema: S({ subject: str(), description: str(), priority: { enum: ['Low', 'Medium', 'High', 'Critical'] }, account: str(), device: str(), confirm: CONFIRM }, ['subject']), readOnly: false },
    { name: 'integrations.ipam.get_subnets', description: 'List IPAM subnets with used/free counts and every allocation.', inputSchema: S({ site: str() }), readOnly: true },
    { name: 'integrations.ipam.allocate', description: 'Reserve the next free address in a subnet. WRITE: returns a preview unless confirm=true.', inputSchema: S({ subnet: str(), hostname: str(), node_id: str(), confirm: CONFIRM }, ['subnet', 'hostname']), readOnly: false },
  ];

  const api = { Lab, TOOL_NAMES, TOOL_SCHEMAS, WRITE_TOOLS, NODE_TYPES, SYSTEMS, KEY_ENV, KEY_RE, ATTACH_RULES, maskKey, fnv1a, clone };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LabTools = api;
})(typeof window !== 'undefined' ? window : globalThis);
