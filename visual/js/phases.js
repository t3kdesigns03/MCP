/* Agent0067 — the six phases. One persistent scenario (Neon Harbor Freight,
 * FICTIONAL), the same five systems and the same keys all the way through.
 * Objectives are graded live (after every command / canvas change), hints
 * appear when you're stuck, and every briefing says what carried over. */
(function () {
  'use strict';
  const A67 = window.A67;
  const { SYSTEMS, TOOL_SCHEMAS } = window.LabTools;
  const esc = (s) => A67.esc(s);
  const G = () => A67.store.game;
  const L = () => A67.store.lab;
  const SH = () => A67.store.game.shell;
  const READ_ONLY = TOOL_SCHEMAS.filter((t) => t.readOnly).map((t) => t.name);
  const vpass = (k) => (L().verification[k] || {}).status === 'pass';
  const attached = (s) => L().nodes.some((n) => n.integrations.includes(s));
  const has = (t) => L().nodes.some((n) => n.type === t);
  function connected() {
    const ns = L().nodes;
    if (ns.length < 2) return false;
    const adj = {};
    ns.forEach((n) => { adj[n.id] = []; });
    L().edges.forEach((e) => { adj[e.a].push(e.b); adj[e.b].push(e.a); });
    const seen = new Set([ns[0].id]);
    const q = [ns[0].id];
    while (q.length) for (const x of adj[q.shift()]) if (!seen.has(x)) { seen.add(x); q.push(x); }
    return seen.size === ns.length;
  }
  const keyOk = (s) => A67.store.keyStatus()[s];

  const PHASES = [
    {
      n: 1, id: 'discover', name: 'DISCOVER', goal: 'API vs MCP — by doing',
      carried: 'Nothing yet: an empty map and a fictional company, <b>Neon Harbor Freight</b>, that runs five systems — Email, Meraki, Monitoring, Salesforce, IPAM. You will carry these five through every phase.',
      brief: 'An API is two programs talking. Wire AI apps straight to five APIs and count the integrations. Then rebuild it with MCP, where one server sits <i>in front of</i> the APIs (they stay exactly where they are), and count again. Finally, watch a model discover tools — and notice what it never sees.',
      procedure: ['Add an app, wire it raw, add a second, wire it raw', 'Rebuild with <code>wire --mcp</code> and compare', '<code>quiz</code> → <code>answer</code>', '<code>discover</code>'],
      judgment: ['MCP does not replace APIs. It is a translator + discovery layer in front of them.', 'MCP is not free: with one app it is more pieces. It pays off as apps × services grows.', 'Discovery costs context: every tool description rides along in the prompt.'],
      objs: [
        { id: 'p1a', t: 'Add your first AI app: <code>apps add ChatOps</code>', hint: 'Type exactly: apps add ChatOps (any name works)', ok: () => G().board.apps.length >= 1 },
        { id: 'p1b', t: 'Wire it straight to all five APIs: <code>wire --raw</code>', hint: 'wire --raw wires every un-wired app to all five services', ok: () => G().board.raw.length >= 1 },
        { id: 'p1c', t: 'Add a second app and wire it raw too — watch 5 become 10', hint: 'apps add OpsBot, then wire --raw', ok: () => G().board.raw.length >= 2 },
        { id: 'p1d', t: 'Rebuild it the MCP way: <code>wire --mcp</code>', hint: 'wire --mcp (needs two raw-wired apps first)', ok: () => G().board.mcp },
        { id: 'p1e', t: 'Who calls the API? <code>quiz</code> then <code>answer …</code>', hint: 'The model only picks. Something else executes. answer b', ok: () => G().board.quiz === 'b' },
        { id: 'p1f', t: 'Watch discovery: <code>discover</code>', hint: 'Type: discover', ok: () => G().board.discovered },
      ],
      debrief: () => {
        const a = Math.max(2, G().board.apps.length);
        const row = (n) => `<tr><td>${n}</td><td style="color:var(--red)">${n * 5}</td><td style="color:var(--neon)">${n + 5}</td></tr>`;
        return `<p>With <b>${a}</b> apps and 5 services: raw = <b>${a * 5}</b> hand-built integrations; MCP = <b>${a + 5}</b> pieces (${a} clients + 5 adapters).</p>
          <table style="width:100%;font-size:12px"><tr><th>apps</th><th>raw (apps×5)</th><th>MCP (apps+5)</th></tr>${[1, 2, 3, 5, 10].map(row).join('')}</table>
          <p>One app: MCP costs <b>more</b> (6 vs 5). Ten apps: 15 vs 50. The model picked <code>integrations.meraki.get_devices</code> from a list of names and schemas — no URL, no key. Discovery put ≈<b>${G().board.tokens || '~3000'}</b> tokens of tool descriptions in its context: that is warning #1.</p>`;
      },
    },
    {
      n: 2, id: 'keys', name: 'KEYS', goal: 'Get FAKE keys, store them server-side, never commit them',
      carried: 'From DISCOVER: the same five systems you just counted, and the rule — <b>the model never holds a key</b>. The server does.',
      brief: 'Do it the real way. Open each system\'s settings, generate a key (FAKE here), copy it, and put it where the <i>server</i> reads it: <code>.env</code> or an exported variable. <code>.env</code> is in <code>.gitignore</code> from the first commit. Output is masked everywhere. Paste a key into a prompt and it gets revoked on the spot.',
      procedure: ['SYSTEMS › Meraki › Settings › GENERATE FAKE KEY › COPY', '<code>echo "MERAKI_API_KEY=&lt;paste&gt;" &gt;&gt; .env</code> (or <code>export …</code>)', 'Repeat for the other four', '<code>env</code> and <code>git status</code> to check'],
      judgment: ['Keys live on the server, never with the model or the client.', '<code>.env</code> in <code>.gitignore</code> before the first key exists — not after.', 'If a key ever lands in a chat, a log or a commit: rotate it. Deleting the message is not enough.'],
      objs: [
        { id: 'p2a', t: 'Confirm <code>.env</code> is ignored: <code>cat .gitignore</code>', hint: 'cat .gitignore  (or git check-ignore -v .env)', ok: () => !!SH().flags.sawGitignore },
        ...SYSTEMS.map((s) => ({
          id: 'p2k' + s, t: `Store the <b>${s}</b> key where the server reads it`,
          hint: `SYSTEMS › ${s.toUpperCase()} › GENERATE › COPY, then: echo "${window.LabTools.KEY_ENV[s]}=<paste>" >> .env`, ok: () => keyOk(s),
        })),
        { id: 'p2b', t: 'See the keys masked: <code>env</code>', hint: 'Type env — values end in …xxxx', ok: () => !!SH().flags.sawMaskedEnv },
        { id: 'p2c', t: 'Prove .env stays out of git: <code>git status</code>', hint: 'git status — .env should NOT be listed as untracked', ok: () => !!SH().flags.gitStatus && SH().files['.env'] !== undefined },
      ],
      debrief: () => `<p>Five FAKE keys, all server-side, all masked (<code>…${esc(((G().keys.meraki || '') + '????').slice(-4))}</code>). ${G().leaks ? `You leaked ${G().leaks} key(s) into a prompt and had to rotate — that is the real cost of a leak.` : 'Zero leaks.'} The client and the model will never see these values: that is warning #2.</p>`,
    },
    {
      n: 3, id: 'scaffold', name: 'SCAFFOLD', goal: 'A real FastMCP server with its first tool',
      carried: 'From KEYS: five FAKE keys in <code>.env</code> (git-ignored), the same five systems, the same fictional network.',
      brief: 'Build the server that will hold those keys. Python first, a virtual environment, FastMCP, a <code>server.py</code>, one read-only tool, and run it. Then ask it what it offers — that is MCP discovery from the command line.',
      procedure: ['<code>python --version</code> (3.10+)', '<code>python -m venv .venv</code> → activate', '<code>pip install fastmcp python-dotenv</code>', '<code>scaffold server.py</code> → <code>tool add lab.topology.get</code>', '<code>fastmcp run server.py</code> → <code>fastmcp list server.py</code>'],
      judgment: ['One venv per project: the server runs on the versions you pinned, not whatever is global.', 'First tool is read-only on purpose — prove the plumbing before anything can change state.', 'stdio is the default transport: the client launches the server and talks over stdin/stdout.'],
      real: 'python -m venv .venv\nsource .venv/bin/activate      # Windows: .venv\\Scripts\\activate\npip install -r mcp_server/requirements.txt\nfastmcp run mcp_server/server.py\nfastmcp list mcp_server/server.py',
      objs: [
        { id: 'p3a', t: 'Check Python: <code>python --version</code>', hint: 'python --version', ok: (c) => c.ran(/^python3? (--version|-V)$/) },
        { id: 'p3b', t: 'Create a venv: <code>python -m venv .venv</code>', hint: 'python -m venv .venv', ok: () => SH().venvCreated },
        { id: 'p3c', t: 'Activate it (<code>source .venv/bin/activate</code> or <code>.venv\\Scripts\\activate</code>)', hint: 'The prompt shows (.venv) when it worked', ok: () => SH().venvActive },
        { id: 'p3d', t: 'Install into the venv: <code>pip install fastmcp python-dotenv</code>', hint: 'With (.venv) active: pip install fastmcp python-dotenv', ok: () => !!SH().venvPkgs.fastmcp && !!SH().venvPkgs['python-dotenv'] },
        { id: 'p3e', t: 'Write server.py with its first tool: <code>scaffold server.py</code>, <code>tool add lab.topology.get</code>', hint: 'scaffold server.py, then tool add lab.topology.get, then answer y', ok: () => SH().tools.includes('lab.topology.get') },
        { id: 'p3f', t: 'Run it from the venv: <code>fastmcp run server.py</code>', hint: 'fastmcp run server.py (with .venv active)', ok: () => SH().server.running && SH().server.venv && SH().server.tools >= 1 },
        { id: 'p3g', t: 'Discover it: <code>fastmcp list server.py</code>', hint: 'fastmcp list server.py', ok: () => SH().flags.listed >= 1 },
      ],
      debrief: () => '<p>You have a real server shape: FastMCP, a decorated tool, stdio transport, keys loaded from <code>.env</code>. The repo\'s <code>mcp_server/server.py</code> is exactly this, with all 17 tools — run it for real with the commands above.</p>',
    },
    {
      n: 4, id: 'tools', name: 'TOOLS', goal: 'Topology → device config → integrations → tools',
      carried: 'From SCAFFOLD: <code>.venv</code> with FastMCP, <code>server.py</code> with <code>lab.topology.get</code>, five keys in <code>.env</code>.',
      brief: 'Now build the network the tools will reach. Place classic devices, cable them, configure one from its console, attach the five systems to the devices where they belong, then give the server the rest of its tools: every read-only tool first, writes last, writes behind <code>confirm=true</code>.',
      procedure: ['Drag a router, switch, server, firewall, cloud and a PC onto the grid', 'Drag from a node\'s pink port dot to another node to cable it (or CABLE mode)', 'Tap a device → its console tab: <code>enable</code>, <code>conf t</code>, <code>hostname …</code>', 'Double-click a device → attach systems', '<code>tool add --read-only</code>, then <code>tool add --writes</code>, restart the server'],
      judgment: ['Meraki manages switches/routers/firewalls; Email lives on a server; Salesforce is SaaS — it hangs off the cloud.', 'Read-only first: the model learns to look before it touches, and you learn the data shape.', 'A write tool returns a preview until the human approves. The approval belongs to the human, not the model.'],
      objs: [
        { id: 'p4a', t: 'Place at least 4 devices, including a router, a switch and a server', hint: 'Drag ROUTER, SWITCH, SERVER (and more) from the palette onto the grid', ok: () => L().nodes.length >= 4 && has('router') && has('switch') && has('server') },
        { id: 'p4b', t: 'Cable them into one connected network', hint: 'Every device needs a path to every other. Drag from the pink port dot, or turn on CABLE', ok: () => L().nodes.length >= 4 && connected() },
        { id: 'p4c', t: 'Configure a device from its console (hostname, ip address or vlan)', hint: 'Tap a device → console tab → enable → conf t → hostname CORE-SW', ok: () => G().deviceConfigured },
        { id: 'p4d', t: 'Attach all five systems to the right devices (<span data-count="attach"></span>/5)', hint: 'Double-click devices. Salesforce needs a CLOUD node; Email needs a SERVER.', ok: () => SYSTEMS.every(attached) },
        { id: 'p4e', t: 'Add every read-only tool (<span data-count="ro"></span>/10): <code>tool add --read-only</code>', hint: 'tool add --read-only, then y', ok: () => READ_ONLY.every((t) => SH().tools.includes(t)) },
        { id: 'p4f', t: 'Add the 7 write tools: <code>tool add --writes</code>', hint: 'tool add --writes, then y', ok: () => SH().tools.length === 17 },
        { id: 'p4g', t: 'Restart and rediscover: <code>fastmcp run server.py</code>, <code>fastmcp list server.py</code> → 17', hint: 'The running server still has the old tool list until you restart it', ok: () => SH().server.running && SH().server.tools === 17 && SH().flags.listed === 17 },
      ],
      debrief: () => `<p>${L().nodes.length} devices, ${L().edges.length} links, five systems attached, 17 tools in <code>server.py</code> — 10 read-only, 3 lab writes, 4 confirmed writes. Same names as the real server: <code>fastmcp list mcp_server/server.py</code>.</p>`,
    },
    {
      n: 5, id: 'client', name: 'CLIENT', goal: 'Connect a client, ask a real question, verify everything',
      carried: 'From TOOLS: your topology, five attached systems, 17 tools on a running server, keys server-side.',
      brief: 'Be the app. Connect a client (initialize → tools/list), ask a real question, and watch the model pick a tool by name. The app executes it; the server calls the API with its key. Then run the five verification checks — each is a chain of real tool calls whose result shows pass/fail on the board.',
      procedure: ['<code>client connect</code>', '<code>ask "which sites are down?"</code>', '<code>verify ping &lt;a&gt; &lt;b&gt;</code>, <code>verify alert &lt;dev&gt;</code>', '<code>ask "open a case for dockside"</code> → approve with <code>y</code> (or <code>verify case</code>)', '<code>verify allocate</code>, <code>verify config &lt;dev&gt;</code>', '<code>ask "email dispatch an update"</code> → <code>y</code>'],
      judgment: ['Count the tokens on connect — that cost is paid on every turn.', 'A write shows a preview first. Read it before you type y.', 'Turn on the bridge (menu) and the same commands hit the real Python server over real MCP.'],
      real: 'python mcp_server/client_demo.py          # real client, real stdio, real discovery\npython mcp_server/server.py --http         # then menu › Local server bridge › on',
      objs: [
        { id: 'p5a', t: 'Connect the client: <code>client connect</code>', hint: 'If it fails, the server is not running: fastmcp run server.py', ok: () => G().client.connected },
        { id: 'p5b', t: 'Ask: <code>ask "which sites are down?"</code>', hint: 'ask "which sites are down?" — watch which tool the model picks', ok: () => G().client.asked.some((x) => x.tool === 'integrations.meraki.get_networks') },
        { id: 'p5c', t: 'Verify ping between two devices', hint: 'verify ping <a> <b> — they must be cabled', ok: () => vpass('ping') },
        { id: 'p5d', t: 'Verify alert generation', hint: 'verify alert <device> — sends a test trap, then reads monitoring', ok: () => vpass('alert') },
        { id: 'p5e', t: 'Verify case creation', hint: 'ask "open a case for the dockside outage", y — or verify case', ok: () => vpass('case') },
        { id: 'p5f', t: 'Verify IP allocation', hint: 'ask "allocate an ip for the label printer", y — or verify allocate', ok: () => vpass('allocate') },
        { id: 'p5g', t: 'Verify a config push', hint: 'verify config <meraki device> — watch its vlan change on the map', ok: () => vpass('config') },
        { id: 'p5h', t: 'Tell dispatch by email: <code>ask "email dispatch an update"</code> → <code>y</code>', hint: 'ask "email dispatch an update", read the preview, then y — the sent mail shows up in SYSTEMS › Email', ok: () => G().client.asked.some((x) => x.tool === 'integrations.email.send') && (L().integrations.email.messages || []).some((m) => m.folder === 'sent' && Number(String(m.id).replace(/\D/g, '')) > 1004) },
      ],
      debrief: () => `<p>The model saw ${G().client.count || 17} tools (≈${G().client.tokens || '?'} tokens), never a key. You asked ${G().client.asked.length} question(s); every write waited for your y. All five checks are green on the VERIFY board — and lab_state.verification says so too.</p>`,
    },
    {
      n: 6, id: 'ship', name: 'SHIP', goal: 'Static game on Netlify, MCP server on a real runtime',
      carried: 'From CLIENT: a verified lab, the 17-tool server, the client session, the same five keys.',
      brief: 'Netlify hosts the static game: HTML, JS, icons, seed data. The MCP server is Python and needs a Python runtime — local first (stdio), then a serverless or hosted endpoint once you have checked what the platform supports <i>today</i>. Never fake that step. This lab simulates the deploy; nothing is pushed or deployed for real.',
      procedure: ['<code>verify all</code>', '<code>cat netlify.toml</code>', '<code>netlify deploy</code> (simulated dry run)', '<code>answer</code> the runtime question', '<code>git add .</code> → <code>git commit -m "ship v1"</code>'],
      judgment: ['Check the platform\'s current runtime support at ship time; docs change.', 'Production deploys and merges need the owner\'s explicit approval.', 'The secret scan runs on every commit, not just the first.'],
      objs: [
        { id: 'p6a', t: 'All checks green in one run: <code>verify all</code>', hint: 'verify all — fix any ✗ it reports', ok: () => G().ship.verifiedAll },
        { id: 'p6b', t: 'Read the deploy config: <code>cat netlify.toml</code>', hint: 'cat netlify.toml', ok: (c) => c.ran(/^cat netlify\.toml$/) },
        { id: 'p6c', t: 'Dry-run the static deploy: <code>netlify deploy</code>', hint: 'netlify deploy (no --prod)', ok: () => G().ship.deployed },
        { id: 'p6d', t: 'Where does the MCP server run? <code>answer a|b|c</code>', hint: 'a) inside the static site  b) local Python first, then a Python-capable runtime you have checked  c) in the browser with the keys', ok: () => G().ship.quiz === 'b' },
        { id: 'p6e', t: 'Commit your work — the secret scan must pass', hint: 'git add .  then  git commit -m "ship v1"  (.env must stay ignored)', ok: () => SH().lastCommitOk === true && ((SH().git || {}).tracked || []).includes('server.py') },
      ],
      debrief: () => '<p><b>V1 complete.</b> You built every piece: topology, device config, integrations, a 17-tool MCP server, keys on the server, a client that discovers instead of hard-coding, and verification that proves it. Two warnings to keep: discovery costs tokens, and keys never leave the server.</p>',
    },
  ];

  // ----------------------------------------------------------- engine
  const recent = [];
  A67.on('cmd', (e) => { if (e && e.line) { recent.push(e.line.trim()); if (recent.length > 200) recent.shift(); } });
  const ctx = { ran: (re) => recent.some((l) => re.test(l)) || (G().ran || []).some((l) => re.test(l)) };

  const P = (A67.phases = {
    list: PHASES,
    cur() { return PHASES[G().phase - 1]; },
    current() {
      const ph = this.cur();
      return ph.objs.find((o) => !G().done[o.id]) || null;
    },
    evaluate() {
      const g = G();
      if (g.freePlay) { this.render(); return; }
      const ph = this.cur();
      let changed = false;
      for (const o of ph.objs) {
        if (!g.done[o.id] && o.ok(ctx)) {
          g.done[o.id] = true; changed = true;
          A67.ui.toast('✓ ' + o.t.replace(/<[^>]+>/g, ''));
          g.stuck = {};
        }
      }
      // keep commands that grade objectives across reloads
      g.ran = Array.from(new Set((g.ran || []).concat(recent.filter((l) => /^(python3? (--version|-V)|cat netlify\.toml)$/.test(l))))).slice(-20);
      if (ph.objs.every((o) => g.done[o.id]) && !g.phaseDone[ph.n]) {
        g.phaseDone[ph.n] = true;
        g.unlocked = Math.max(g.unlocked, Math.min(6, ph.n + 1));
        A67.term.print(`████ PHASE ${ph.n} ${ph.name} COMPLETE ████`, 'ok');
        A67.ui.toast(`PHASE ${ph.n} COMPLETE`);
        changed = true;
      }
      if (changed) A67.store.saveGame();
      this.render();
    },
    noteCommand() {
      const o = this.current();
      if (!o || G().freePlay) return;
      const s = G().stuck;
      s[o.id] = (s[o.id] || 0) + 1;
      if (s[o.id] === 4) this.hint(false);
    },
    hint(asked) {
      if (G().freePlay) return A67.term.print('Free Play — no objectives. freeplay off to return to the guided build.', 'dim');
      const o = this.current();
      if (!o) return A67.term.print('All objectives in this phase are done. Open GUIDE → NEXT PHASE.', 'ok');
      A67.term.print(`HINT ▸ ${o.hint}`, 'warn');
      G().stuck[o.id] = Math.max(G().stuck[o.id] || 0, 4);
      if (!asked) A67.term.print('(stuck? type hint any time)', 'dim');
      this.render();
    },
    goto(n) {
      const g = G();
      if (!n) return A67.term.print(`phase ${g.phase} ${this.cur().name} · unlocked up to ${g.unlocked}`, 'dim');
      if (n < 1 || n > 6) return A67.term.print('phase 1-6', 'err');
      if (n > g.unlocked) return A67.term.print(`phase ${n} is locked — finish phase ${g.unlocked} first`, 'err');
      g.phase = n;
      A67.store.saveGame();
      this.showBrief(true);
      this.evaluate();
      A67.app.renderPhasebar();
    },
    shipAnswer(x) {
      if (x === 'b') { G().ship.quiz = 'b'; A67.term.print('✓ Right. Local Python (stdio) first. For a hosted endpoint, check what the platform supports at ship time and use a runtime that really runs Python — or port the tools. Never pretend.', 'ok'); }
      else if (x === 'a') A67.term.print('✗ A static deploy serves files. It cannot run a Python process.', 'err');
      else A67.term.print('✗ Never ship keys to a browser. Anything in the page is public.', 'err');
    },
    showBrief(force) {
      const ph = this.cur();
      const g = G();
      if (g.freePlay || (!force && g.seenBrief[ph.n])) return;
      g.seenBrief[ph.n] = true;
      A67.store.saveGame();
      A67.ui.brief(`<h1>PHASE ${ph.n} · ${ph.name}</h1><p style="color:var(--cyan)">${ph.goal}</p>
        <div class="carry"><b>CARRIED OVER</b> — ${ph.carried}</div><p>${ph.brief}</p>
        <p style="font-size:12px;color:var(--muted)">Everything in this lab is fictional and simulated in your browser. No real systems, no real keys, no network calls.</p>`, ph.n === 1 && !g.phaseDone[1] ? 'BEGIN' : 'GO');
    },

    // ----------------------------------------------------------- render guide
    render() {
      const el = document.getElementById('guide');
      if (!el) return;
      const g = G();
      if (g.freePlay) {
        el.innerHTML = `<div class="free-banner">FREE PLAY — no grading. Place devices, cable them, attach systems, call any tool. Everything still writes to lab_state.</div>
          <h3>TRY</h3><p><code>place router EDGE</code> · <code>cable EDGE SW-01</code> · <code>mcp call lab.topology.get</code> · <code>systems</code> · <code>verify all</code></p>
          <button class="btn next-btn" id="free-off">BACK TO THE GUIDED BUILD</button>`;
        el.querySelector('#free-off').onclick = () => A67.app.setFree(false);
        document.getElementById('obj-count').textContent = '';
        return;
      }
      const ph = this.cur();
      const cur = this.current();
      const done = ph.objs.filter((o) => g.done[o.id]).length;
      document.getElementById('obj-count').textContent = `${done}/${ph.objs.length}`;
      let html = `<h2>PHASE ${ph.n} · ${ph.name}</h2><p style="color:var(--cyan);margin-top:0">${ph.goal}</p>`;
      html += `<div class="carry"><b>CARRIED OVER</b> — ${ph.carried}</div>`;
      if (ph.n === 1) html += this.board();
      html += '<h3>OBJECTIVES</h3><ul class="objs">';
      for (const o of ph.objs) {
        const d = !!g.done[o.id];
        const isCur = cur && cur.id === o.id;
        html += `<li class="${d ? 'done' : ''} ${isCur ? 'current' : ''}"><span class="box">${d ? '[✓]' : isCur ? '[▸]' : '[ ]'}</span><span class="t">${o.t}</span>`;
        if (isCur && (g.stuck[o.id] || 0) >= 4) html += `<span class="hint">hint ▸ ${esc(o.hint)}</span>`;
        html += '</li>';
      }
      html += '</ul>';
      html += `<div class="tip"><div class="k">PROCEDURE</div><ol style="margin:4px 0 0 18px;padding:0">${ph.procedure.map((x) => `<li>${x}</li>`).join('')}</ol></div>`;
      html += `<div class="tip warn"><div class="k">JUDGMENT</div><ul style="margin:4px 0 0 18px;padding:0">${ph.judgment.map((x) => `<li>${x}</li>`).join('')}</ul></div>`;
      if (ph.real) html += `<div class="tip"><div class="k">DO IT FOR REAL (in this repo)</div><pre class="code">${esc(ph.real)}</pre></div>`;
      if (g.phaseDone[ph.n]) {
        html += `<div class="debrief"><b style="color:var(--neon)">DEBRIEF</b>${ph.debrief()}</div>`;
        if (ph.n < 6) html += `<button class="btn primary next-btn" id="next-phase">NEXT PHASE ▸ ${PHASES[ph.n].name}</button>`;
      }
      html += `<p style="font-size:11px;color:var(--muted);margin-top:14px">Stuck? <code>hint</code>. Just exploring? <code>freeplay</code>. Guides: <code>guides/</code> in the repo.</p>`;
      el.innerHTML = html;
      const cnt = (k) => (k === 'attach' ? SYSTEMS.filter(attached).length : READ_ONLY.filter((t) => SH().tools.includes(t)).length);
      el.querySelectorAll('[data-count]').forEach((s) => { s.textContent = cnt(s.dataset.count); });
      const nx = el.querySelector('#next-phase');
      if (nx) nx.onclick = () => this.goto(ph.n + 1);
    },
    board() {
      const b = G().board;
      const apps = b.apps.slice(0, 6);
      const W = 340, H = 30 + Math.max(5, apps.length) * 30;
      const sy = (i, n) => 24 + i * ((H - 40) / Math.max(1, n - 1));
      let svg = `<svg class="board" viewBox="0 0 ${W} ${H}" role="img" aria-label="Integration board">`;
      const svcY = SYSTEMS.map((s, i) => sy(i, 5));
      const appY = apps.map((a, i) => sy(i, Math.max(apps.length, 1)));
      if (b.mcp) {
        svg += `<rect x="140" y="${H / 2 - 22}" width="64" height="44" fill="#001a10" stroke="#00ff9f"/><text x="172" y="${H / 2 - 3}" fill="#00ff9f" font-size="9" text-anchor="middle" font-family="monospace">MCP</text><text x="172" y="${H / 2 + 9}" fill="#00ff9f" font-size="9" text-anchor="middle" font-family="monospace">SERVER</text>`;
        appY.forEach((y) => { svg += `<line x1="88" y1="${y}" x2="140" y2="${H / 2}" stroke="#00ff9f" stroke-width="1.5"/>`; });
        svcY.forEach((y) => { svg += `<line x1="204" y1="${H / 2}" x2="252" y2="${y}" stroke="#00ff9f" stroke-width="1.5"/>`; });
      } else {
        apps.forEach((a, i) => { if (b.raw.includes(a)) svcY.forEach((y) => { svg += `<line x1="88" y1="${appY[i]}" x2="252" y2="${y}" stroke="#ff3b5c" stroke-opacity=".7" stroke-width="1"/>`; }); });
      }
      apps.forEach((a, i) => { svg += `<rect x="6" y="${appY[i] - 10}" width="82" height="20" fill="#000" stroke="#ff2bd6"/><text x="47" y="${appY[i] + 4}" fill="#ff2bd6" font-size="10" text-anchor="middle" font-family="monospace">${esc(a.slice(0, 10))}</text>`; });
      SYSTEMS.forEach((s, i) => { svg += `<rect x="252" y="${svcY[i] - 10}" width="82" height="20" fill="#000" stroke="#00e5ff"/><text x="293" y="${svcY[i] + 4}" fill="#00e5ff" font-size="10" text-anchor="middle" font-family="monospace">${s}</text>`; });
      if (!apps.length) svg += `<text x="47" y="${H / 2}" fill="#5f8f80" font-size="10" text-anchor="middle" font-family="monospace">apps add …</text>`;
      svg += '</svg>';
      const a = b.raw.length, n = b.apps.length;
      return `${svg}<div class="counter"><div class="raw">RAW API<b>${a * 5}</b><small>${a} app${a === 1 ? '' : 's'} × 5</small></div><div class="mcp">MCP<b>${b.mcp ? n + 5 : '—'}</b><small>${b.mcp ? `${n} clients + 5 adapters` : 'wire --mcp'}</small></div></div>`;
    },
  });

  A67.on('cmd', (e) => { P.evaluate(); if (e && e.line) P.noteCommand(); });
  A67.on('lab', () => P.evaluate());
  A67.on('board', () => P.evaluate());
  A67.on('tool', () => setTimeout(() => P.evaluate(), 0));
})();
