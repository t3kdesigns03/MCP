/* Agent0067 — CLiDK-style console.
 *
 * kernel tab   : a simulated workstation shell (python, pip, venv, mcp,
 *                fastmcp, git, netlify, the lab commands and the MCP client)
 * device tabs  : per-device consoles with >, #, (config)#, (config-if)# modes
 *
 * Everything here is simulated in the browser and says so. Unknown commands
 * fail honestly. Keys are masked in every line of output.
 */
(function () {
  'use strict';
  const A67 = window.A67;
  const LT = window.LabTools;
  const { KEY_ENV, KEY_RE, TOOL_SCHEMAS, TOOL_NAMES, WRITE_TOOLS, NODE_TYPES, SYSTEMS, maskKey } = LT;
  const store = () => A67.store;
  const G = () => A67.store.game;
  const SH = () => A67.store.game.shell;
  const lab = () => A67.store.labApi;

  const PY_VER = '3.12.8';
  const READ_ONLY = TOOL_SCHEMAS.filter((t) => t.readOnly).map((t) => t.name);
  const LAB_WRITES = ['lab.topology.add_node', 'lab.topology.connect', 'lab.device.run_command'];

  // ----------------------------------------------------------- package index (simulated)
  const PKG = {
    'fastmcp': ['4.1.6', ['mcp', 'pydantic', 'httpx', 'uvicorn', 'starlette', 'rich', 'python-dotenv', 'anyio', 'typer']],
    'mcp': ['2.3.0', ['pydantic', 'httpx', 'anyio', 'starlette', 'uvicorn', 'sse-starlette', 'httpx-sse']],
    'typer': ['0.20.0', ['click', 'rich']],
    'python-dotenv': ['1.2.4', []],
    'pydantic': ['2.14.3', ['pydantic-core', 'typing-extensions', 'annotated-types']],
    'pydantic-core': ['2.41.6', ['typing-extensions']],
    'typing-extensions': ['4.15.0', []], 'annotated-types': ['0.7.0', []],
    'httpx': ['0.28.1', ['httpcore', 'anyio', 'certifi', 'idna']],
    'httpcore': ['1.0.9', ['h11', 'certifi']], 'h11': ['0.16.0', []], 'certifi': ['2026.10.5', []], 'idna': ['3.11', []],
    'anyio': ['4.11.0', ['idna', 'sniffio']], 'sniffio': ['1.3.1', []],
    'uvicorn': ['0.54.0', ['click', 'h11']], 'click': ['8.3.0', []],
    'starlette': ['1.10.0', ['anyio']], 'sse-starlette': ['3.0.3', ['starlette']], 'httpx-sse': ['0.4.3', []],
    'rich': ['15.0.0', ['markdown-it-py', 'pygments']], 'markdown-it-py': ['4.0.0', ['mdurl']], 'mdurl': ['0.1.2', []], 'pygments': ['2.19.2', []],
    'requests': ['2.32.5', ['urllib3', 'certifi', 'idna', 'charset-normalizer']], 'urllib3': ['2.5.0', []], 'charset-normalizer': ['3.4.4', []],
    'ansible': ['12.2.0', ['ansible-core']], 'ansible-core': ['2.19.4', ['jinja2', 'pyyaml', 'cryptography']],
    'jinja2': ['3.1.6', ['markupsafe']], 'markupsafe': ['3.0.3', []], 'pyyaml': ['6.0.3', []], 'cryptography': ['46.0.3', []],
    'netmiko': ['4.6.0', ['paramiko', 'textfsm', 'pyserial']], 'paramiko': ['4.0.0', ['cryptography']], 'textfsm': ['1.1.3', []], 'pyserial': ['3.5', []],
    'napalm': ['5.1.0', ['netmiko', 'paramiko', 'jinja2']], 'pysnmp': ['7.1.21', []],
    'pip': ['25.3', []], 'setuptools': ['80.9.0', []],
  };
  const KERNEL_SET = ['mcp', 'fastmcp', 'ansible', 'netmiko', 'napalm', 'pysnmp', 'requests', 'rich', 'pydantic', 'httpx', 'uvicorn', 'python-dotenv'];
  const SYSTEM_PKGS = (() => {
    const out = { pip: '25.3', setuptools: '80.9.0' };
    const add = (n) => { if (out[n] && n !== 'pip' && n !== 'setuptools') return; const p = PKG[n]; if (!p) return; out[n] = p[0]; p[1].forEach(add); };
    KERNEL_SET.forEach(add);
    return out;
  })();
  const MODULE_OF = { 'python-dotenv': 'dotenv', 'pyyaml': 'yaml', 'typing-extensions': 'typing_extensions', 'pydantic-core': 'pydantic_core', 'markdown-it-py': 'markdown_it', 'ansible-core': 'ansible', 'pyserial': 'serial' };
  const STDLIB = ['os', 'sys', 'json', 're', 'math', 'time', 'datetime', 'pathlib', 'asyncio', 'typing', 'ipaddress', 'subprocess', 'socket', 'random', 'collections', 'itertools', 'functools', 'logging', 'http', 'urllib', 'venv'];

  const FILES0 = {
    'README.md': '# agent0067 (lab workspace)\nA Python MCP server in front of five FAKE systems.\n',
    '.gitignore': '.env\n.venv/\n__pycache__/\nlab_state/state.json\n',
    'netlify.toml': '[build]\n  publish = "."\n  command = ""\n\n[[redirects]]\n  from = "/"\n  to = "/visual/"\n  status = 302\n\n# The MCP server is Python. It is NOT part of this static deploy.\n# Run it locally (stdio) or on a Python-capable runtime.\n',
    'requirements.txt': 'fastmcp>=4.1\npython-dotenv>=1.2\n',
  };
  const TRACKED0 = ['README.md', '.gitignore', 'netlify.toml', 'requirements.txt'];

  // ----------------------------------------------------------- helpers
  function tokenize(line) {
    const out = [];
    const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(line))) out.push(m[1] !== undefined ? m[1].replace(/\\"/g, '"') : m[2] !== undefined ? m[2] : m[3]);
    return out;
  }
  const pad = (s, n) => { s = String(s); return s.length >= n ? s + ' ' : s + ' '.repeat(n - s.length); };

  /* Python-ish arithmetic without eval(): + - * / // % ** and parentheses. */
  function arith(src) {
    const toks = src.match(/\d+\.?\d*|\*\*|\/\/|[+\-*/%()]/g) || [];
    let i = 0;
    const peek = () => toks[i];
    const zero = () => { throw new Error('ZeroDivisionError: division by zero'); };
    const atom = () => {
      const t = toks[i++];
      if (t === '(') { const v = sum(); if (toks[i++] !== ')') throw new Error('SyntaxError: invalid syntax'); return v; }
      if (t === '-') return -power();
      if (t === '+') return power();
      if (t === undefined || !/^\d/.test(t)) throw new Error('SyntaxError: invalid syntax');
      return Number(t);
    };
    const power = () => { const b = atom(); if (peek() === '**') { i++; return b ** unary(); } return b; };
    const unary = () => (peek() === '-' ? (i++, -unary()) : peek() === '+' ? (i++, unary()) : power());
    const term = () => {
      let v = unary();
      while (['*', '/', '//', '%'].includes(peek())) {
        const op = toks[i++]; const r = unary();
        if (op === '*') v *= r;
        else if (op === '/') { if (r === 0) zero(); v /= r; }
        else if (op === '//') { if (r === 0) zero(); v = Math.floor(v / r); }
        else { if (r === 0) zero(); v = ((v % r) + r) % r; }
      }
      return v;
    };
    const sum = () => { let v = term(); while (peek() === '+' || peek() === '-') v = toks[i++] === '+' ? v + term() : v - term(); return v; };
    const v = sum();
    if (i !== toks.length) throw new Error('SyntaxError: invalid syntax');
    return v;
  }
  const files = () => Object.assign({}, FILES0, SH().files);
  const venvOn = () => SH().venvActive;
  const envPkgs = () => (venvOn() ? SH().venvPkgs : SYSTEM_PKGS);
  const hasPkg = (n) => !!envPkgs()[n];
  const serverSrcExists = () => 'server.py' in SH().files;
  const now = () => new Date().toISOString().slice(11, 19);

  function sig(t) {
    const props = t.inputSchema.properties || {};
    const req = t.inputSchema.required || [];
    const ty = (p) => (p.enum ? 'str' : ({ string: 'str', number: 'float', integer: 'int', boolean: 'bool', object: 'dict', array: 'list' }[p.type] || 'str'));
    const parts = Object.keys(props).sort((a, b) => req.includes(b) - req.includes(a)).map((k) => {
      const p = props[k];
      if (req.includes(k)) return `${k}: ${ty(p)}`;
      if (k === 'confirm') return 'confirm: bool = False';
      return `${k}: ${ty(p)} | None = None`;
    });
    return parts;
  }
  function toolCode(name) {
    const t = TOOL_SCHEMAS.find((x) => x.name === name);
    const fn = name.split('.').slice(-2).join('_');
    const params = sig(t);
    const ann = t.readOnly ? 'READ' : WRITE_TOOLS.includes(name) ? 'WRITE' : 'LAB_WRITE';
    const call = Object.keys(t.inputSchema.properties || {}).join(', ');
    const method = name.replace(/^lab\./, '').replace(/^integrations\./, '').replace(/\./g, '_');
    return [
      `@mcp.tool(name="${name}", annotations=${ann})`,
      `def ${fn}(${params.join(', ')}) -> dict:`,
      `    """${t.description}"""`,
      `    return lab.${method}(${call})`,
    ].join('\n');
  }
  function serverSource() {
    const tools = SH().tools;
    return [
      '"""agent0067 MCP server (your copy). Keys come from .env — never from the client."""',
      'from dotenv import load_dotenv',
      'from fastmcp import FastMCP',
      'from lab import Lab, LabStore   # the simulated systems',
      '',
      'load_dotenv()                     # MERAKI_API_KEY etc. live on the SERVER',
      'mcp = FastMCP("agent0067-lab")',
      'lab = Lab(LabStore())',
      'READ = {"readOnlyHint": True}',
      'LAB_WRITE = {"readOnlyHint": False, "destructiveHint": False}',
      'WRITE = {"readOnlyHint": False, "destructiveHint": True}  # + confirm=True',
      '',
      ...tools.map((n) => toolCode(n) + '\n'),
      'if __name__ == "__main__":',
      '    mcp.run()                     # stdio',
    ].join('\n');
  }

  // ----------------------------------------------------------- the terminal
  const T = (A67.term = {
    out: null, input: null, promptEl: null,
    tabs: [{ id: 'kernel' }], active: 'kernel', dev: {}, hist: [], hIdx: 0,
    mode: null, pending: null, busy: false, queue: Promise.resolve(), py: {},

    init() {
      this.out = document.getElementById('term-out');
      this.input = document.getElementById('term-in');
      this.promptEl = document.getElementById('prompt');
      this.hist = (G().shell.history || []).slice(-100);
      this.hIdx = this.hist.length;
      document.getElementById('term-form').addEventListener('submit', (e) => { e.preventDefault(); this.submit(); });
      this.input.addEventListener('keydown', (e) => this.key(e));
      document.getElementById('btn-tab').addEventListener('click', () => { this.complete(); this.input.focus(); });
      document.getElementById('btn-hist').addEventListener('click', () => { this.histMove(-1); this.input.focus(); });
      this.out.addEventListener('click', () => { if (!window.getSelection().toString()) this.input.focus({ preventScroll: true }); });
      A67.on('select', (id) => { if (id) this.openDevice(id, true); });
      A67.on('lab', () => this.renderTabs());
      this.renderTabs();
      this.setPrompt();
      this.print('AGENT0067 lab kernel — simulated workstation. Everything here is FICTIONAL.', 'help');
      this.print('Type  help  or  ?  for commands · TAB completes · ↑/↓ history', 'help');
    },

    // ------------------------------------------------- output
    print(text, cls) {
      const lines = String(text).split('\n');
      const frag = document.createDocumentFragment();
      for (const l of lines) {
        const d = document.createElement('div');
        d.className = 'l ' + (cls || 'out');
        d.textContent = A67.mask(l);
        frag.appendChild(d);
      }
      this.out.appendChild(frag);
      while (this.out.childElementCount > 1500) this.out.firstChild.remove();
      this.out.scrollTop = this.out.scrollHeight;
    },
    json(obj, max) {
      let s = JSON.stringify(obj, null, 2);
      const lines = s.split('\n');
      if (max && lines.length > max) s = lines.slice(0, max).join('\n') + `\n  … (${lines.length - max} more lines)`;
      this.print(s, 'json');
    },
    echoTool(name, args, res, src) {
      this.print(`[${src}] → ${name} ${JSON.stringify(args)}  ${res.ok ? '✓' : '✗ ' + (res.error || res.status)}`, res.ok ? 'dim' : 'warn');
      A67.emit('cmd', { line: '', source: src });
    },
    clear() { this.out.innerHTML = ''; },
    prefill(text) { this.input.value = text; this.input.focus(); },

    // ------------------------------------------------- prompt + tabs
    devNode() { return this.active === 'kernel' ? null : lab()._node(this.active); },
    setPrompt() {
      let p;
      if (this.mode === 'confirm') p = 'approve this write? [y/N] ';
      else if (this.mode === 'accept') p = 'write this into server.py? [y/N] ';
      else if (this.mode === 'python') p = '>>> ';
      else if (this.active !== 'kernel') {
        const n = this.devNode();
        const d = this.dev[this.active] || { mode: 'user' };
        const host = n ? (n.config.hostname || n.label) : this.active;
        p = host + { user: '>', priv: '#', config: '(config)#', if: '(config-if)#' }[d.mode] + ' ';
      } else p = `${venvOn() ? '(.venv) ' : ''}agent0067 $ `;
      this.promptEl.textContent = p;
    },
    renderTabs() {
      const el = document.getElementById('term-tabs');
      this.tabs = this.tabs.filter((t) => t.id === 'kernel' || lab()._node(t.id));
      if (!this.tabs.find((t) => t.id === this.active)) this.active = 'kernel';
      el.innerHTML = '';
      for (const t of this.tabs) {
        const b = document.createElement('button');
        const n = t.id === 'kernel' ? null : lab()._node(t.id);
        b.className = 'ttab' + (t.id === this.active ? ' active' : '');
        b.innerHTML = t.id === 'kernel' ? 'kernel' : `${A67.esc(n.label)}<span class="x" aria-label="close">×</span>`;
        b.onclick = (e) => {
          if (e.target.classList.contains('x')) { this.closeDevice(t.id); return; }
          this.switchTab(t.id);
        };
        el.appendChild(b);
      }
      this.setPrompt();
    },
    switchTab(id) {
      if (this.mode === 'python' || this.mode === 'confirm' || this.mode === 'accept') { this.print('(finish the current prompt first)', 'warn'); return; }
      this.active = id;
      this.renderTabs();
      if (id !== 'kernel') {
        const n = this.devNode();
        this.print(`--- console ${n.label} (${n.type}) — type ? for commands, exit to leave ---`, 'info');
      }
    },
    openDevice(id, quiet) {
      const n = lab()._node(id);
      if (!n) { this.print(`% no device ${id}`, 'err'); return; }
      if (!this.tabs.find((t) => t.id === n.id)) { this.tabs.push({ id: n.id }); this.dev[n.id] = { mode: 'user', iface: null }; }
      if (this.mode || this.active === n.id) { this.renderTabs(); return; }
      this.switchTab(n.id);
      if (!quiet && A67.app) A67.app.showPane('term');
    },
    closeDevice(id) {
      this.tabs = this.tabs.filter((t) => t.id !== id);
      if (this.active === id) this.active = 'kernel';
      this.renderTabs();
    },

    // ------------------------------------------------- input
    key(e) {
      if (e.key === 'Tab') { e.preventDefault(); this.complete(); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); this.histMove(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); this.histMove(1); }
      else if (e.key === 'c' && e.ctrlKey && !window.getSelection().toString()) {
        e.preventDefault(); this.print(this.promptEl.textContent + this.input.value + '^C', 'cmd'); this.input.value = '';
        if (this.mode) { this.mode = null; this.pending = null; this.setPrompt(); }
      } else if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); this.clear(); }
      else if (e.key === 'd' && e.ctrlKey && this.mode === 'python') { e.preventDefault(); this.input.value = 'exit()'; this.submit(); }
    },
    histMove(d) {
      if (!this.hist.length) return;
      this.hIdx = Math.max(0, Math.min(this.hist.length, this.hIdx + d));
      this.input.value = this.hist[this.hIdx] || '';
      const v = this.input.value.length;
      requestAnimationFrame(() => this.input.setSelectionRange(v, v));
    },
    submit() {
      const line = this.input.value;
      this.input.value = '';
      this.run(line);
    },
    run(line, fromUi) {
      this.queue = this.queue.then(() => this.exec(line, fromUi)).catch((e) => { this.print('kernel error: ' + (e && e.message || e), 'err'); console.error(e); });
      return this.queue;
    },
    async exec(line, fromUi) {
      this.print(this.promptEl.textContent + line, 'cmd');
      const trimmed = line.trim();
      if (trimmed && trimmed !== this.hist[this.hist.length - 1]) {
        this.hist.push(A67.mask(trimmed));
        G().shell.history = this.hist.slice(-100);
      }
      this.hIdx = this.hist.length;
      if (!trimmed && !this.mode) return;
      if (/^FAKE-[A-Z]+-[0-9a-f]{32}$/.test(trimmed)) {
        this.print('command not found: ...' + trimmed.slice(-4), 'err');
        this.print('⚠ That was an API key typed as a command. It is now in your shell history. In real life: clear history and rotate the key.', 'warn');
        return;
      }
      if (this.mode === 'python') await this.python(trimmed);
      else if (this.mode === 'confirm') await this.confirm(trimmed);
      else if (this.mode === 'accept') this.accept(trimmed);
      else if (this.active !== 'kernel') this.device(trimmed);
      else await this.kernel(trimmed);
      this.setPrompt();
      store().saveGame();
      A67.emit('cmd', { line: trimmed, tab: this.active });
    },

    // ------------------------------------------------- completion
    complete() {
      const v = this.input.value;
      const words = v.split(/\s+/);
      const cur = words[words.length - 1] || '';
      const before = words.slice(0, -1);
      let cands;
      if (this.active !== 'kernel' && !this.mode) cands = this.devCommands(before);
      else if (this.mode === 'python') cands = ['import ', 'print(', 'exit()', 'help()', 'from fastmcp import FastMCP', 'import mcp', 'import os'];
      else if (this.mode) cands = ['y', 'n'];
      else cands = this.kernelCands(before);
      const hits = [...new Set(cands)].filter((c) => c.toLowerCase().startsWith(cur.toLowerCase()));
      if (!hits.length) return;
      if (hits.length === 1) {
        words[words.length - 1] = hits[0];
        this.input.value = words.join(' ') + (hits[0].endsWith('(') || hits[0].endsWith(' ') ? '' : ' ');
        return;
      }
      let pre = hits[0];
      for (const h of hits) while (!h.toLowerCase().startsWith(pre.toLowerCase())) pre = pre.slice(0, -1);
      if (pre.length > cur.length) { words[words.length - 1] = pre; this.input.value = words.join(' '); }
      else { this.print(this.promptEl.textContent + v, 'cmd'); this.print(hits.join('  '), 'dim'); }
    },
    kernelCands(before) {
      const nodes = store().lab.nodes.flatMap((n) => [n.id, n.label]);
      const top = ['help', 'clear', 'history', 'ls', 'cat', 'pwd', 'echo', 'export', 'unset', 'env', 'printenv', 'whoami', 'version',
        'nodes', 'devices', 'place', 'cable', 'attach', 'detach', 'inspect', 'console', 'remove', 'systems', 'keys',
        'python', 'python3', 'py', 'pip', 'pip3', 'packages', 'pkg', 'source', '.venv\\Scripts\\activate', 'deactivate', 'which', 'where',
        'mcp', 'fastmcp', 'scaffold', 'tool', 'tools', 'client', 'ask', 'apps', 'wire', 'quiz', 'answer', 'discover',
        'verify', 'git', 'netlify', 'ansible-galaxy', 'ansible', 'hint', 'phase', 'freeplay', 'bridge', 'reset'];
      if (!before.length) return top;
      const c0 = before[0];
      const sub = {
        place: NODE_TYPES, cable: nodes, inspect: nodes, console: nodes, remove: nodes, systems: SYSTEMS,
        cat: Object.keys(files()), ls: ['-a', '-la'], source: ['.venv/bin/activate'],
        attach: before.length === 1 ? SYSTEMS : nodes, detach: before.length === 1 ? SYSTEMS : nodes,
        pip: ['install', 'list', 'freeze', 'show', 'uninstall', '--version', 'help'].concat(before[1] === 'install' ? Object.keys(PKG).concat(['-U', '-r', 'requirements.txt']) : []),
        python: ['--version', '-m', '-c', 'server.py'].concat(before[1] === '-m' ? ['venv', 'pip', 'http.server', 'fastmcp', 'mcp'] : []),
        mcp: ['--help', 'version', 'dev', 'run', 'install', 'call', 'server.py'].concat(before[1] === 'call' ? TOOL_NAMES : []),
        fastmcp: ['--help', 'version', 'run', 'dev', 'list', 'inspect', 'server.py', '--transport', 'http'],
        tool: ['add', 'list', 'show', '--read-only', '--writes'].concat(TOOL_NAMES),
        client: ['connect', 'status', 'disconnect'],
        verify: before.length === 1 ? ['ping', 'alert', 'case', 'allocate', 'config', 'all'] : nodes,
        git: ['status', 'add', 'commit', 'check-ignore', 'log', 'diff', '.env', '.', '-m'],
        netlify: ['status', 'deploy', '--prod', 'functions:list', '--help'],
        apps: ['add', 'list'], wire: ['--raw', '--mcp'], answer: ['a', 'b', 'c'], phase: ['1', '2', '3', '4', '5', '6'],
        reset: ['lab', 'progress'], freeplay: ['on', 'off'], bridge: ['on', 'off', 'status'],
        export: Object.values(KEY_ENV).map((k) => k + '='), unset: Object.values(KEY_ENV),
        python3: ['--version', '-m'], py: ['--version', '-m'],
      };
      return sub[c0] || nodes;
    },

    // ------------------------------------------------- kernel shell
    async kernel(line) {
      const argv = tokenize(line);
      const [c, ...a] = argv;
      const cmd = (c || '').toLowerCase();
      const p = (t, cls) => this.print(t, cls);

      // Windows-style venv activation + PowerShell env syntax
      if (/^\.?\\?\.?venv[\\/]+scripts[\\/]+activate(\.bat|\.ps1)?$/i.test(c.replace(/^\.\\/, '')) || /^\.\\\.venv\\Scripts\\activate/i.test(c)) return this.activate();
      const ps = /^\$env:([A-Z0-9_]+)\s*=\s*["']?([^"']*)["']?$/i.exec(line.trim());
      if (ps) return this.setEnv(ps[1], ps[2]);

      switch (cmd) {
        case '?': case 'help': case 'help?': return this.help();
        case 'clear': case 'cls': return this.clear();
        case 'history': return this.hist.forEach((h, i) => p(`${String(i + 1).padStart(4)}  ${h}`, 'dim'));
        case 'whoami': return p('agent');
        case 'pwd': return p('/home/agent/agent0067');
        case 'version': return p('Agent0067 lab kernel 1.0 — browser simulation (no real network, no real keys)');
        case 'cd': return p(a[0] && !['~', '.', '~/agent0067'].includes(a[0]) ? `cd: ${a[0]}: stays in ~/agent0067 in this lab` : '', 'dim');
        case 'ls': case 'dir': return this.ls(a);
        case 'cat': case 'type': return this.cat(a[0]);
        case 'echo': return this.echo(line);
        case 'touch': if (a[0]) { SH().files[a[0]] = SH().files[a[0]] || ''; } return;
        case 'export': case 'set': {
          if (!a.length) return this.env();
          const m = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(a.join(' '));
          if (!m) return p(`${cmd}: usage: ${cmd} NAME=value`, 'err');
          return this.setEnv(m[1], m[2]);
        }
        case 'unset': delete SH().env[a[0]]; store().refreshEnv(); return;
        case 'env': case 'printenv': return this.env(a[0]);
        case 'nodes': case 'devices': return this.nodes();
        case 'place': return this.place(a);
        case 'cable': case 'connect': return this.toolLocal('lab.topology.connect', { a: a[0], b: a[1] });
        case 'attach': case 'detach': {
          const node = lab()._node(a[1]);
          if (!a[0] || !node) return p(`usage: ${cmd} <system> <device>   systems: ${SYSTEMS.join(' ')}`, 'err');
          A67.ui.attach(node.id, a[0].toLowerCase(), cmd === 'attach');
          return;
        }
        case 'inspect': { const n = lab()._node(a[0]); if (!n) return p(`inspect: no device '${a[0] || ''}'`, 'err'); A67.ui.inspect(n.id); return; }
        case 'console': return this.openDevice(a[0]);
        case 'remove': case 'rm': {
          if (cmd === 'rm' && a[0] && files()[a[0]] !== undefined) { delete SH().files[a[0]]; return; }
          const n = lab()._node(a[0]); if (!n) return p(`remove: no device '${a[0] || ''}'`, 'err'); A67.ui.removeNode(n.id); return;
        }
        case 'systems': case 'sys': A67.ui.systems(a[0] && SYSTEMS.includes(a[0]) ? a[0] : undefined); return;
        case 'keys': return this.keys();
        case 'python': case 'python3': case 'py': return this.pythonCmd(a);
        case 'pip': case 'pip3': return this.pip(a);
        case 'source': case '.': return a[0] && /\.?venv[\\/](bin|Scripts)[\\/]activate$/i.test(a[0]) ? this.activate() : p(`source: ${a[0] || ''}: No such file or directory`, 'err');
        case 'deactivate': if (!venvOn()) return p('deactivate: command not found', 'err'); SH().venvActive = false; return;
        case 'which': case 'where': case 'where.exe': return this.which(a[0]);
        case 'packages': case 'pkg': return this.packages();
        case 'ansible-galaxy': return this.galaxy(a);
        case 'ansible': return a[0] === '--version' ? p(`ansible [core ${PKG['ansible-core'][0]}] (simulated)\n  python version = ${PY_VER}`) : p('ansible: simulated in this lab — try ansible --version or ansible-galaxy', 'dim');
        case 'mcp': return this.mcpCli(a);
        case 'fastmcp': return this.fastmcp(a);
        case 'scaffold': return this.scaffold(a);
        case 'tool': return this.tool(a);
        case 'tools': return this.tool(['list']);
        case 'client': return this.client(a);
        case 'ask': case 'chat': return this.ask(line.replace(/^\s*(ask|chat)\s*/i, '').replace(/^["']|["']$/g, ''));
        case 'y': case 'yes': case 'n': case 'no': return p('nothing is waiting for approval', 'dim');
        case 'apps': return this.apps(a);
        case 'wire': return this.wire(a);
        case 'quiz': return this.quiz();
        case 'answer': return this.answer(a[0]);
        case 'discover': return this.discover();
        case 'verify': return this.verify(a);
        case 'git': return this.git(a, line);
        case 'netlify': case 'ntl': return this.netlify(a);
        case 'hint': return A67.phases.hint(true);
        case 'phase': return A67.phases.goto(a[0] ? Number(a[0]) : null);
        case 'objectives': case 'obj': A67.app.showPane('guide'); return;
        case 'freeplay': return A67.app.setFree(a[0] ? a[0] === 'on' : !G().freePlay);
        case 'bridge': return A67.app.bridge(a[0]);
        case 'reset':
          if (a[0] === 'lab') { store().resetLab(); return p('lab_state reset to seed (progress kept)', 'ok'); }
          if (a[0] === 'progress') { store().resetAll(); location.reload(); return; }
          return p('usage: reset lab | reset progress', 'err');
        case 'exit': case 'logout': return p('this is the lab kernel — close the tab to leave', 'dim');
        case 'sudo': return p('sudo: this lab has no root and needs none', 'err');
        case 'curl': case 'wget': case 'ssh': case 'ping': case 'nc': case 'telnet':
          return p(`${cmd}: not available in the kernel — the game never makes real network calls.${cmd === 'ping' ? ' Use a device console or `verify ping <a> <b>`.' : ''}`, 'err');
        default:
          if (/^[A-Z_][A-Z0-9_]*=/.test(c)) return this.setEnv(c.split('=')[0], c.slice(c.indexOf('=') + 1));
          return p(`${c}: command not found — type help`, 'err');
      }
    },

    help() {
      const p = (t) => this.print(t, 'help');
      p('LAB      place <type> [label] · cable <a> <b> · attach|detach <system> <device>');
      p('         nodes · inspect <device> · console <device> · remove <device>');
      p('SYSTEMS  systems [email|meraki|monitoring|salesforce|ipam] · keys');
      p('SHELL    ls [-a] · cat <file> · echo … [>|>> file] · export NAME=v · env · git … · clear · history');
      p('PYTHON   python · python --version · python -m venv .venv · source .venv/bin/activate');
      p('         .venv\\Scripts\\activate · deactivate · pip --version|list|freeze|install|show');
      p('         python -m pip install -U pip · packages (pkg) · ansible-galaxy');
      p('MCP      scaffold server.py · tool add <name>|--read-only|--writes · tools · cat server.py');
      p('         fastmcp run|dev|list server.py · mcp --help|dev|install · mcp call <tool> {json}');
      p('CLIENT   client connect · ask "<question>" · y / n to approve writes');
      p('DISCOVER apps add <name> · wire --raw · wire --mcp · quiz · answer <a|b|c> · discover');
      p('VERIFY   verify ping <a> <b> | alert <dev> | case | allocate | config <dev> | all');
      p('SHIP     netlify status|deploy · git add … · git commit -m "…"');
      p('GAME     hint · phase [n] · freeplay [on|off] · bridge [on|off] · reset lab');
      this.print('TAB completes commands and device names · ↑/↓ history · Ctrl+C cancels', 'dim');
    },

    ls(a) {
      const all = a.some((x) => x.includes('a'));
      const names = Object.keys(files()).filter((n) => all || !n.startsWith('.')).concat(SH().venvCreated && all ? ['.venv/'] : []).sort();
      this.print(names.join('  ') || '(empty)');
    },
    cat(f) {
      if (!f) return this.print('cat: missing file operand', 'err');
      if (f === 'server.py' && serverSrcExists()) return this.print(serverSource(), 'json');
      const fs = files();
      if (!(f in fs)) return this.print(`cat: ${f}: No such file or directory`, 'err');
      let txt = fs[f];
      if (f === '.env') txt = txt.split('\n').map((l) => l.replace(/=(.+)$/, (m, v) => '=' + (v ? maskKey(v.replace(/["']/g, '')) : ''))).join('\n');
      this.print(txt.replace(/\n$/, ''));
      if (f === '.gitignore') SH().flags.sawGitignore = true;
    },
    echo(line) {
      const rest = line.replace(/^\s*echo\s?/, '');
      const m = /^(.*?)\s*(>>|>)\s*(\S+)\s*$/.exec(rest);
      const expand = (s) => s.replace(/^["']|["']$/g, '').replace(/\$\{?([A-Z_][A-Z0-9_]*)\}?/g, (x, n) => SH().env[n] || '');
      if (!m) { this.print(expand(rest)); return; }
      const [, body, op, file] = m;
      const text = expand(body.trim()) + '\n';
      SH().files[file] = op === '>>' ? (SH().files[file] !== undefined ? SH().files[file] : (FILES0[file] || '')) + text : text;
      if (file === '.env') {
        store().refreshEnv();
        const kv = /^([A-Z0-9_]+)=(.*)$/.exec(text.trim());
        if (kv) this.keyCheck(kv[1], kv[2].replace(/["']/g, ''));
      }
    },
    setEnv(name, val) {
      val = String(val).replace(/^["']|["']$/g, '');
      SH().env[name] = val;
      store().refreshEnv();
      this.keyCheck(name, val);
    },
    keyCheck(name, val) {
      const sys = Object.keys(KEY_ENV).find((s) => KEY_ENV[s] === name);
      if (!sys) return;
      if (!KEY_RE.test(val)) return this.print(`warning: ${name} does not look like a lab key (FAKE-${sys.toUpperCase()}-<32 hex>). The server will reject it.`, 'warn');
      if (G().revoked.includes(val)) return this.print(`warning: ${name} is a REVOKED key (it leaked). Rotate it in ${sys} settings.`, 'warn');
      if (G().keys[sys] !== val) return this.print(`warning: ${name} doesn't match the key ${sys} issued. Copy it again from SYSTEMS › ${sys} › Settings.`, 'warn');
      this.print(`${name} set (${maskKey(val)}) — the MCP server can now reach ${sys}.`, 'ok');
    },
    env(name) {
      const base = { HOME: '/home/agent', USER: 'agent', SHELL: '/bin/bash', PATH: (venvOn() ? '/home/agent/agent0067/.venv/bin:' : '') + '/usr/local/bin:/usr/bin:/bin' };
      if (venvOn()) base.VIRTUAL_ENV = '/home/agent/agent0067/.venv';
      const all = Object.assign(base, SH().env);
      if (name) { if (all[name] !== undefined) this.print(all[name]); return; }
      for (const [k, v] of Object.entries(all)) this.print(`${k}=${k.endsWith('_KEY') ? maskKey(v) : v}`);
      if (Object.keys(SH().env).some((k) => k.endsWith('_KEY'))) SH().flags.sawMaskedEnv = true;
      const dot = store().dotenv();
      if (Object.keys(dot).length) { this.print(`# + ${Object.keys(dot).length} value(s) the server will load from .env (masked)`, 'dim'); SH().flags.sawMaskedEnv = true; }
    },
    keys() {
      const st = store().keyStatus();
      for (const s of SYSTEMS) {
        const k = G().keys[s];
        this.print(`${pad(s, 11)} ${pad(KEY_ENV[s], 20)} issued:${k ? maskKey(k) : ' none   '}  server-has-it:${st[s] ? 'yes' : 'no'}`, st[s] ? 'ok' : 'dim');
      }
    },
    nodes() {
      const L = store().lab;
      if (!L.nodes.length) return this.print('(no devices yet — drag one from the palette, or: place switch SW-CORE)', 'dim');
      for (const n of L.nodes) this.print(`${pad(n.id, 7)}${pad(n.label, 14)}${pad(n.type, 9)}${pad(n.config.mgmt_ip || '-', 14)}${(n.integrations || []).join(',')}`);
      this.print(`${L.nodes.length} devices · ${L.edges.length} links`, 'dim');
    },
    place(a) {
      if (!a[0]) return this.print(`usage: place <${NODE_TYPES.join('|')}> [label]`, 'err');
      const r = this.toolLocal('lab.topology.add_node', { type: a[0], label: a[1] || null });
      if (r.ok) { A67.canvas.ensureVisible(r.node); A67.canvas.select(r.node.id); }
    },
    toolLocal(name, args) {
      const r = lab().call(name, args);
      this.print(`→ ${name} ${JSON.stringify(args)}`, 'dim');
      if (r.ok) this.print(name === 'lab.topology.connect' ? `cabled ${r.edge.a}:${r.edge.a_port} ⇄ ${r.edge.b}:${r.edge.b_port}` : name === 'lab.topology.add_node' ? `placed ${r.node.label} (${r.node.id})` : 'ok', 'ok');
      else this.print(r.message, 'err');
      A67.emit('tool', { name, args, data: r, source: 'kernel' });
      return r;
    },
    which(x) {
      const map = { python: venvOn() ? '/home/agent/agent0067/.venv/bin/python' : '/usr/bin/python3', python3: venvOn() ? '/home/agent/agent0067/.venv/bin/python3' : '/usr/bin/python3', pip: venvOn() ? '/home/agent/agent0067/.venv/bin/pip' : '/usr/bin/pip', fastmcp: hasPkg('fastmcp') ? (venvOn() ? '/home/agent/agent0067/.venv/bin/fastmcp' : '/usr/local/bin/fastmcp') : null, mcp: hasPkg('mcp') ? (venvOn() ? '/home/agent/agent0067/.venv/bin/mcp' : '/usr/local/bin/mcp') : null };
      this.print(map[x] || `${x} not found`, map[x] ? 'out' : 'err');
    },
    packages() {
      this.print('Kernel image — packages available (simulated):', 'help');
      for (const n of KERNEL_SET) this.print(`  ${pad(n, 16)}${pad(PKG[n][0], 10)}${{ mcp: 'MCP Python SDK', fastmcp: 'MCP server framework', ansible: 'automation (+ ansible-galaxy)', netmiko: 'network device SSH', napalm: 'network automation', pysnmp: 'SNMP', requests: 'HTTP client', rich: 'terminal UI', pydantic: 'data validation', httpx: 'async HTTP client', uvicorn: 'ASGI server', 'python-dotenv': 'load .env files' }[n]}`);
      this.print(venvOn() ? `active env: .venv (${Object.keys(SH().venvPkgs).length} packages) — pip list to see it` : 'active env: system interpreter', 'dim');
    },
    galaxy(a) {
      if (a[0] === 'collection' && a[1] === 'install' && a[2]) {
        this.print(`Starting galaxy collection install process\nProcess install dependency map\nStarting collection install process\nInstalling '${a[2]}:latest' to '/home/agent/.ansible/collections/ansible_collections/${a[2].replace('.', '/')}'\n${a[2]} was installed successfully (simulated — no download)`);
        return;
      }
      this.print(`ansible-galaxy [core ${PKG['ansible-core'][0]}] (simulated latest)`);
      this.print('  ansible-galaxy collection install cisco.meraki');
      this.print('  ansible-galaxy collection install community.network');
      this.print('  ansible-galaxy role install geerlingguy.docker');
      this.print('Collections and roles available. Use in playbooks.', 'dim');
    },

    // ------------------------------------------------- python / venv / pip
    pythonCmd(a) {
      if (!a.length) {
        this.mode = 'python';
        this.py = {};
        this.print(`Python ${PY_VER} (main, simulated) [browser kernel] on linux\nType "help", "copyright", "credits" or "license" for more information.`);
        return;
      }
      const [f, ...rest] = a;
      if (f === '--version' || f === '-V') return this.print(`Python ${PY_VER}`);
      if (f === '-VV') return this.print(`Python ${PY_VER} (main, simulated) [GCC 14.2.0]`);
      if (f === '-c') return this.pyEval(rest.join(' '), true);
      if (f === 'server.py') return this.runServer('stdio', 'python server.py');
      if (f === '-m') {
        const [mod, ...ma] = rest;
        if (mod === 'venv') return this.mkvenv(ma);
        if (mod === 'pip') return this.pip(ma);
        if (mod === 'fastmcp') return this.fastmcp(ma);
        if (mod === 'mcp') return this.mcpCli(ma);
        if (mod === 'http.server') return this.print(`[sim] would serve this folder on :${ma[0] || 8000}. In the real repo: python -m http.server 8068, then open http://localhost:8068/visual/`, 'dim');
        return this.print(`/usr/bin/python3: No module named ${mod}`, 'err');
      }
      if (f.endsWith('.py')) return this.print(`python3: can't open file '/home/agent/agent0067/${f}': [Errno 2] No such file or directory`, 'err');
      return this.print(`unknown option: ${f}\nusage: python [option] ... [-c cmd | -m mod | file | -] [arg] ...`, 'err');
    },
    mkvenv(ma) {
      const name = ma[0];
      if (!name) return this.print('usage: venv [-h] ENV_DIR [ENV_DIR ...]\nvenv: error: the following arguments are required: ENV_DIR', 'err');
      if (name !== '.venv') this.print(`(the guide expects .venv — ${name} works in real life too, but .venv is what .gitignore already covers)`, 'warn');
      SH().venvCreated = true;
      SH().venvName = name;
      SH().venvPkgs = { pip: '25.1.1', setuptools: '80.9.0' };
      this.print('', 'out'); // real venv prints nothing on success
      this.print(`[sim] created ${name}/ with its own python + pip. Activate it: source ${name}/bin/activate  (Windows: ${name}\\Scripts\\activate)`, 'dim');
    },
    activate() {
      if (!SH().venvCreated) return this.print('bash: .venv/bin/activate: No such file or directory (run: python -m venv .venv)', 'err');
      SH().venvActive = true;
    },
    pip(a) {
      const [sub, ...rest] = a;
      const loc = venvOn() ? '/home/agent/agent0067/.venv/lib/python3.12/site-packages' : '/usr/lib/python3/dist-packages';
      if (!sub || sub === 'help' || sub === '--help' || sub === '-h') {
        this.print('Usage:\n  pip <command> [options]\n\nCommands:\n  install     Install packages.\n  uninstall   Uninstall packages.\n  freeze      Output installed packages in requirements format.\n  list        List installed packages.\n  show        Show information about installed packages.\n\n(simulated pip — the package index is local to this page)');
        return;
      }
      if (sub === '--version' || sub === '-V') return this.print(`pip ${envPkgs().pip} from ${loc}/pip (python 3.12)`);
      if (sub === 'list') {
        const pk = envPkgs();
        this.print(`${pad('Package', 22)}Version\n${'-'.repeat(21)} ${'-'.repeat(10)}`);
        Object.keys(pk).sort().forEach((n) => this.print(`${pad(n, 22)}${pk[n]}`));
        return;
      }
      if (sub === 'freeze') {
        Object.entries(envPkgs()).filter(([n]) => !['pip', 'setuptools'].includes(n)).sort().forEach(([n, v]) => this.print(`${n}==${v}`));
        return;
      }
      if (sub === 'show') {
        const n = (rest[0] || '').toLowerCase();
        if (!envPkgs()[n]) return this.print(`WARNING: Package(s) not found: ${rest[0] || ''}`, 'warn');
        return this.print(`Name: ${n}\nVersion: ${envPkgs()[n]}\nLocation: ${loc}\nRequires: ${(PKG[n] ? PKG[n][1] : []).join(', ')}`);
      }
      if (sub === 'uninstall') {
        const names = rest.filter((x) => !x.startsWith('-'));
        names.forEach((n) => {
          if (!venvOn()) return this.print(`error: refusing to touch the system interpreter in this lab — activate .venv first`, 'err');
          if (SH().venvPkgs[n]) { this.print(`Found existing installation: ${n} ${SH().venvPkgs[n]}\n  Successfully uninstalled ${n}-${SH().venvPkgs[n]}`); delete SH().venvPkgs[n]; }
          else this.print(`WARNING: Skipping ${n} as it is not installed.`, 'warn');
        });
        return;
      }
      if (sub === 'install') return this.pipInstall(rest);
      return this.print(`ERROR: unknown command "${sub}"`, 'err');
    },
    pipInstall(rest) {
      let names = [];
      const upgrade = rest.includes('-U') || rest.includes('--upgrade');
      for (let i = 0; i < rest.length; i++) {
        if (rest[i] === '-r' || rest[i] === '--requirement') {
          const f = files()[rest[i + 1]];
          if (f === undefined) return this.print(`ERROR: Could not open requirements file: [Errno 2] No such file or directory: '${rest[i + 1]}'`, 'err');
          names = names.concat(f.split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')));
          i++;
        } else if (!rest[i].startsWith('-')) names.push(rest[i]);
      }
      if (!names.length) return this.print('ERROR: You must give at least one requirement to install (see "pip help install")', 'err');
      if (!venvOn()) this.print('note: no virtual environment is active — this would install into the system interpreter. Judgment: create and activate .venv first so this project has its own pinned packages.', 'warn');
      const target = venvOn() ? SH().venvPkgs : SYSTEM_PKGS;
      const want = [];
      const missing = [];
      for (const raw of names) {
        const base = raw.toLowerCase().replace(/\[.*\]/, '').replace(/[<>=!~].*$/, '');
        if (!PKG[base]) { missing.push(raw); continue; }
        want.push(base);
        if (/\[cli\]/.test(raw) && base === 'mcp') want.push('typer', 'python-dotenv');
      }
      if (missing.length) {
        for (const m of missing) this.print(`ERROR: Could not find a version that satisfies the requirement ${m} (from versions: none)\nERROR: No matching distribution found for ${m}\n(simulated index — it carries the lab's packages only: ${KERNEL_SET.join(', ')} and their deps)`, 'err');
        return;
      }
      if (want.length === 1 && want[0] === 'pip') {
        const old = target.pip;
        if (old === PKG.pip[0] && !upgrade) return this.print(`Requirement already satisfied: pip in ${venvOn() ? './.venv/lib/python3.12/site-packages' : '/usr/lib/python3/dist-packages'} (${old})`);
        if (old === PKG.pip[0]) return this.print(`Requirement already satisfied: pip in ./.venv/lib/python3.12/site-packages (${old})`);
        this.print(`Requirement already satisfied: pip in ./.venv/lib/python3.12/site-packages (${old})\nCollecting pip\n  Downloading pip-${PKG.pip[0]}-py3-none-any.whl (1.8 MB)\nInstalling collected packages: pip\n  Attempting uninstall: pip\n    Found existing installation: pip ${old}\n    Uninstalling pip-${old}:\n      Successfully uninstalled pip-${old}\nSuccessfully installed pip-${PKG.pip[0]}`);
        target.pip = PKG.pip[0];
        SH().pipUpgraded = true;
        return;
      }
      const order = [];
      const seen = new Set();
      const walk = (n) => { if (seen.has(n)) return; seen.add(n); order.push(n); PKG[n][1].forEach(walk); };
      want.forEach(walk);
      const newOnes = order.filter((n) => !target[n] || (upgrade && target[n] !== PKG[n][0]));
      for (const n of order) {
        if (target[n] && !newOnes.includes(n)) this.print(`Requirement already satisfied: ${n} in ${venvOn() ? './.venv/lib/python3.12/site-packages' : '/usr/lib/python3/dist-packages'} (${target[n]})`, 'dim');
        else this.print(`Collecting ${n}${want.includes(n) ? '' : ' (from ' + order.find((x) => PKG[x][1].includes(n)) + ')'}\n  Downloading ${n.replace(/-/g, '_')}-${PKG[n][0]}-py3-none-any.whl`, 'out');
      }
      if (!newOnes.length) return;
      this.print(`Installing collected packages: ${newOnes.join(', ')}`);
      newOnes.forEach((n) => { target[n] = PKG[n][0]; });
      this.print(`Successfully installed ${newOnes.map((n) => `${n}-${PKG[n][0]}`).join(' ')}`, 'ok');
      this.print('(simulated install — nothing was downloaded)', 'dim');
    },

    async python(line) {
      if (/^(exit|quit)\(\)$/.test(line) || line === 'exit' || line === 'quit') {
        if (line === 'exit' || line === 'quit') return this.print('Use exit() or Ctrl-D (i.e. EOF) to exit', 'out');
        this.mode = null;
        return;
      }
      if (!line) return;
      this.pyEval(line, false);
    },
    pyEval(code, oneShot) {
      const p = (t, c) => this.print(t, c);
      const tb = (e) => p(`Traceback (most recent call last):\n  File "<stdin>", line 1, in <module>\n${e}`, 'err');
      code = code.trim();
      const imp = /^(?:import\s+([\w.]+)(?:\s+as\s+\w+)?|from\s+([\w.]+)\s+import\s+[\w*, ]+)$/.exec(code);
      if (imp) {
        const mod = (imp[1] || imp[2]).split('.')[0];
        const avail = Object.keys(envPkgs()).map((n) => MODULE_OF[n] || n.replace(/-/g, '_'));
        if (STDLIB.includes(mod) || avail.includes(mod)) { this.py[mod] = true; return; }
        return tb(`ModuleNotFoundError: No module named '${mod}'${venvOn() ? '  (pip install it into .venv)' : ''}`);
      }
      if (code === 'help()' || code === 'help') return p('Welcome to the simulated REPL. It handles imports, arithmetic, strings, print(), len(), and os.getenv(). Real code runs in the real server (mcp_server/server.py).');
      if (code === 'copyright' || code === 'credits' || code === 'license') return p('Python is © the Python Software Foundation. This REPL is a simulation.');
      const env = /^(?:print\()?os\.(?:getenv|environ\.get)\(["']([A-Z0-9_]+)["']\)\)?$|^(?:print\()?os\.environ\[["']([A-Z0-9_]+)["']\]\)?$/.exec(code);
      if (env) {
        if (!this.py.os) return tb("NameError: name 'os' is not defined. Did you forget to import 'os'?");
        const n = env[1] || env[2];
        const v = SH().env[n] || store().dotenv()[n];
        if (!v) return p(env[2] ? '' : 'None');
        p(code.startsWith('print') ? maskKey(v) : `'${maskKey(v)}'`);
        return p('(masked by the lab — in real Python this prints the whole key, which is exactly why you never paste that output into a chat)', 'dim');
      }
      const assign = /^([A-Za-z_]\w*)\s*=\s*(.+)$/.exec(code);
      const val = (expr) => {
        expr = expr.trim();
        if (/^(['"])(.*)\1$/.test(expr)) return { v: expr.slice(1, -1), s: true };
        if (/^[A-Za-z_]\w*$/.test(expr)) { if (expr in (this.py.vars || {})) return this.py.vars[expr]; if (['True', 'False', 'None'].includes(expr)) return { v: expr, raw: true }; throw new Error(`NameError: name '${expr}' is not defined`); }
        const len = /^len\((['"])(.*)\1\)$/.exec(expr);
        if (len) return { v: len[2].length };
        if (/^[\d\s+\-*/().%]+$/.test(expr)) {
          const r = arith(expr);
          return { v: expr.includes('/') && !expr.includes('//') && Number.isInteger(r) ? r.toFixed(1) : r };
        }
        throw new Error('SimKernel: the browser REPL only evaluates simple expressions. Run real Python against the real server.');
      };
      try {
        if (assign && !code.includes('==')) { this.py.vars = this.py.vars || {}; this.py.vars[assign[1]] = val(assign[2]); return; }
        const pr = /^print\((.*)\)$/.exec(code);
        if (pr) { const r = pr[1].trim() ? val(pr[1]) : { v: '' }; return p(String(r.v)); }
        const r = val(code);
        if (!oneShot) p(r.s ? `'${r.v}'` : String(r.v));
      } catch (e) {
        if (String(e.message).startsWith('SimKernel')) p(e.message, 'warn');
        else tb(String(e.message || e).replace(/^Error: /, ''));
      }
    },

    // ------------------------------------------------- mcp / fastmcp / server.py
    needServerFile(file) {
      if ((file || 'server.py') !== 'server.py') { this.print(`Error: ${file}: No such file`, 'err'); return false; }
      if (!serverSrcExists()) { this.print("Error: server.py not found — create it with: scaffold server.py", 'err'); return false; }
      if (!SH().tools.length) { this.print('Warning: server.py defines 0 tools. Add one: tool add lab.topology.get', 'warn'); }
      return true;
    },
    needCli(name) {
      if (hasPkg(name)) return true;
      this.print(`${name}: command not found${venvOn() ? ` — it isn't installed in .venv yet: pip install ${name === 'mcp' ? '"mcp[cli]"' : name}` : ''}`, 'err');
      return false;
    },
    mcpCli(a) {
      if (!this.needCli('mcp')) return;
      const [sub, file] = a;
      if (!sub || sub === '--help' || sub === '-h') {
        this.print(' Usage: mcp [OPTIONS] COMMAND [ARGS]...\n\n MCP development tools\n\n╭─ Commands ───────────────────────────────────────────────╮\n│ version   Show the MCP version.                           │\n│ dev       Run a MCP server with the MCP Inspector.        │\n│ run       Run a MCP server.                               │\n│ install   Install a MCP server in the Claude desktop app. │\n╰──────────────────────────────────────────────────────────╯\n lab extra: mcp call <tool> {json}  — send tools/call as the app');
        return;
      }
      if (sub === 'version') return this.print(`MCP version ${envPkgs().mcp}`);
      if (sub === 'call') return this.mcpCall(a.slice(1));
      if (sub === 'run') return this.needServerFile(file) && this.runServer('stdio', 'mcp run server.py');
      if (sub === 'dev') {
        if (!this.needServerFile(file)) return;
        this.print('Starting MCP inspector...\n⚙️ Proxy server listening on 127.0.0.1:6277\n🔍 MCP Inspector is up and running at http://127.0.0.1:6274 🚀');
        this.print('[sim] nothing is actually listening — in the real repo this opens the Inspector UI. Tools it would list:', 'dim');
        SH().tools.forEach((t) => this.print('  ' + t, 'info'));
        return;
      }
      if (sub === 'install') {
        if (!this.needServerFile(file)) return;
        this.print(`[sim] Added server 'agent0067-lab' to the Claude desktop config.\n      command: ${venvOn() ? '.venv/bin/python' : 'python'} server.py\n      env:     loaded from .env on the server side (use --env-file .env)\nNo file was written — this is the lab.`, 'out');
        SH().flags.installed = true;
        return;
      }
      return this.print(`Error: No such command '${sub}'.`, 'err');
    },
    fastmcp(a) {
      if (!this.needCli('fastmcp')) return;
      const [sub, ...rest] = a;
      if (!sub || sub === '--help' || sub === '-h') {
        this.print('Usage: fastmcp COMMAND\n\nFastMCP - The fast, Pythonic way to build MCP servers and clients.\n\nCommands:\n  run       Run an MCP server or connect to a remote one.\n  dev       Development tools for MCP servers\n  list      List tools available on an MCP server.\n  inspect   Inspect an MCP server and display information.\n  install   Install MCP servers in various clients and formats.\n  version   Display version information and platform details.');
        return;
      }
      if (sub === 'version' || sub === '--version') return this.print(`FastMCP version: ${envPkgs().fastmcp}\nMCP version: ${envPkgs().mcp}\nPython version: ${PY_VER}\nPlatform: simulated-browser-kernel`);
      const file = rest.find((x) => x.endsWith('.py'));
      if (sub === 'run') {
        if (!this.needServerFile(file)) return;
        const ti = rest.indexOf('--transport') >= 0 ? rest.indexOf('--transport') : rest.indexOf('-t');
        const transport = ti >= 0 ? rest[ti + 1] : 'stdio';
        return this.runServer(transport === 'http' || transport === 'streamable-http' ? 'http' : 'stdio', 'fastmcp run server.py');
      }
      if (sub === 'dev') return this.mcpCli(['dev', file]);
      if (sub === 'install') return this.mcpCli(['install', file]);
      if (sub === 'list' || sub === 'inspect') {
        if (!this.needServerFile(file)) return;
        const tools = SH().tools.map((n) => TOOL_SCHEMAS.find((t) => t.name === n));
        if (sub === 'inspect') this.print(`Server: agent0067-lab\nTools: ${tools.length}\nPrompts: 0\nResources: 0`);
        for (const t of tools) this.print(`  ${t.name}(${sig(t).join(', ')}) -> dict\n    ${t.description}`, t.readOnly ? 'info' : 'warn');
        this.print(`${tools.length} tool(s) — discovered over MCP (initialize → tools/list). No URLs, no keys.`, 'dim');
        SH().flags.listed = tools.length;
        return;
      }
      return this.print(`Error: Unknown command "${sub}"`, 'err');
    },
    runServer(transport, how) {
      if (!serverSrcExists()) return this.print("Error: server.py not found — create it with: scaffold server.py", 'err');
      if (!hasPkg('fastmcp')) return this.print("Traceback (most recent call last):\n  File \"server.py\", line 3, in <module>\n    from fastmcp import FastMCP\nModuleNotFoundError: No module named 'fastmcp'", 'err');
      if (!hasPkg('python-dotenv')) return this.print("Traceback (most recent call last):\n  File \"server.py\", line 2, in <module>\n    from dotenv import load_dotenv\nModuleNotFoundError: No module named 'dotenv'", 'err');
      store().refreshEnv();
      const env = store().serverEnv();
      for (const [sys, name] of Object.entries(KEY_ENV)) this.print(`[agent0067] ${pad(name, 20)} ${env[name] ? maskKey(env[name]) : '(unset)'}`, 'dim');
      const was = SH().server.running;
      SH().server = { running: true, transport, tools: SH().tools.length, list: SH().tools.slice(), venv: venvOn(), at: Date.now() };
      if (transport === 'http') this.print(`INFO  Starting MCP server 'agent0067-lab' with transport 'http' on http://127.0.0.1:8067/mcp  [sim: nothing is listening]`, 'out');
      else this.print(`INFO  Starting MCP server 'agent0067-lab' with transport 'stdio'`, 'out');
      this.print(`${SH().tools.length} tool(s) registered: ${SH().tools.join(', ') || '(none)'}`, SH().tools.length ? 'ok' : 'warn');
      this.print(`[sim] ${was ? 'restarted' : 'started'} via \`${how}\` — kept running in the background as job [1] so you can keep typing.`, 'dim');
      if (!venvOn()) this.print('judgment: this ran on the system interpreter. Activate .venv so the server uses the versions you pinned.', 'warn');
      if (G().client.connected) { G().client.connected = false; this.print('(the client was disconnected by the restart — run: client connect)', 'dim'); }
    },
    scaffold(a) {
      const f = a[0] || 'server.py';
      if (f !== 'server.py') return this.print('scaffold: this lab builds server.py', 'err');
      if (serverSrcExists()) return this.print('server.py already exists — add tools with: tool add <name>', 'dim');
      SH().files['server.py'] = '(generated — see cat server.py)';
      this.print(serverSource(), 'json');
      this.print('wrote server.py — a FastMCP server with no tools yet. Next: tool add lab.topology.get', 'ok');
    },
    tool(a) {
      const [sub, name] = a;
      if (!sub || sub === 'list') {
        if (!SH().tools.length) return this.print('server.py defines no tools yet.', 'dim');
        SH().tools.forEach((t) => this.print(`  ${pad(t, 40)}${READ_ONLY.includes(t) ? 'read-only' : WRITE_TOOLS.includes(t) ? 'WRITE (confirm=true)' : 'lab write'}`, READ_ONLY.includes(t) ? 'info' : 'warn'));
        this.print(`${SH().tools.length}/17 in server.py · ${SH().server.running ? `server running with ${SH().server.tools}` : 'server not running'}`, 'dim');
        return;
      }
      if (sub === 'show') { if (!TOOL_NAMES.includes(name)) return this.print(`unknown tool ${name || ''}`, 'err'); return this.print(toolCode(name), 'json'); }
      if (sub !== 'add' && sub !== 'new') return this.print('usage: tool add <name> | tool add --read-only | tool add --writes | tool list | tool show <name>', 'err');
      if (!serverSrcExists()) return this.print('server.py does not exist yet — run: scaffold server.py', 'err');
      let names;
      if (name === '--read-only') names = READ_ONLY.filter((n) => !SH().tools.includes(n));
      else if (name === '--writes') names = LAB_WRITES.concat(WRITE_TOOLS).filter((n) => !SH().tools.includes(n));
      else if (TOOL_NAMES.includes(name)) names = [name];
      else return this.print(`unknown tool '${name || ''}'. TAB lists the 17 names.`, 'err');
      if (!names.length) return this.print('nothing to add — those are already in server.py', 'dim');
      // judgment gate: read-only before writes, per system
      const blocked = names.filter((n) => {
        if (!WRITE_TOOLS.includes(n)) return false;
        const sys = n.split('.')[1];
        const reads = READ_ONLY.filter((r) => r.split('.')[1] === sys);
        return reads.some((r) => !SH().tools.includes(r) && !names.includes(r));
      });
      if (blocked.length) {
        this.print(`refused: ${blocked.join(', ')}`, 'err');
        this.print('judgment: ship the read-only tools for a system first. You learn the data shape, the model learns to look before it touches, and a bad write can\'t happen before you can even see the state.', 'warn');
        return;
      }
      for (const n of names) this.print(toolCode(n) + '\n', 'json');
      this.pending = { kind: 'tools', names };
      this.mode = 'accept';
    },
    accept(ans) {
      const p = this.pending;
      this.mode = null; this.pending = null;
      if (!/^y(es)?$/i.test(ans)) return this.print('not written.', 'dim');
      p.names.forEach((n) => { if (!SH().tools.includes(n)) SH().tools.push(n); });
      this.print(`server.py: +${p.names.length} tool(s) → ${SH().tools.length}/17`, 'ok');
      if (SH().server.running) this.print('note: the running server still has the old tool list — restart it (fastmcp run server.py) so tools/list sees the new ones.', 'warn');
    },

    // ------------------------------------------------- the MCP client (the "app")
    clientTools() {
      if (store().bridge.live) return TOOL_NAMES.slice();
      return SH().server.running ? SH().server.list : [];
    },
    async client(a) {
      const sub = a[0] || 'status';
      if (sub === 'status') return this.print(G().client.connected ? `connected via ${G().client.via} · ${this.clientTools().length} tools` : 'not connected — client connect', 'dim');
      if (sub === 'disconnect') { G().client.connected = false; return this.print('disconnected', 'dim'); }
      if (sub !== 'connect') return this.print('usage: client connect | client status | client disconnect', 'err');
      if (store().bridge.live) {
        this.print('→ initialize  (real JSON-RPC to your local FastMCP server)', 'info');
        const init = await store().rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'agent0067-app', version: '1.0' } });
        const si = init.response.result.serverInfo;
        this.print(`← serverInfo ${si.name} ${si.version} · protocol ${init.response.result.protocolVersion}`, 'ok');
        this.print('→ tools/list', 'info');
        const tl = await store().rpc('tools/list', {});
        const tools = tl.response.result.tools;
        const bytes = JSON.stringify(tools).length;
        tools.forEach((t) => this.print(`   ${pad(t.name, 40)}${(t.description || '').split('\n')[0].slice(0, 60)}`, 'dim'));
        this.print(`← ${tools.length} tools · ${bytes} bytes ≈ ${Math.round(bytes / 4)} tokens the model carries every turn`, 'ok');
        G().client = Object.assign(G().client, { connected: true, via: 'local FastMCP server (real MCP)', tokens: Math.round(bytes / 4), count: tools.length });
      } else {
        if (!SH().server.running) return this.print('connect failed: no MCP server is running. Start it: fastmcp run server.py  (or turn on the bridge to use the real Python server)', 'err');
        const list = SH().server.list;
        this.print('→ initialize {"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"agent0067-app"}}', 'info');
        this.print('← {"serverInfo":{"name":"agent0067-lab","version":"1.0.0"},"capabilities":{"tools":{"listChanged":true}}}', 'ok');
        this.print('→ tools/list', 'info');
        const tools = TOOL_SCHEMAS.filter((t) => list.includes(t.name)).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
        tools.forEach((t) => this.print(`   ${pad(t.name, 40)}${t.description.slice(0, 60)}`, 'dim'));
        const bytes = JSON.stringify(tools).length;
        this.print(`← ${tools.length} tools · ${bytes} bytes ≈ ${Math.round(bytes / 4)} tokens the model carries every turn`, 'ok');
        G().client = Object.assign(G().client, { connected: true, via: 'browser kernel (simulated server)', tokens: Math.round(bytes / 4), count: tools.length });
      }
      this.print('Look closely: names, descriptions, schemas. No URL. No key. That is all the model ever sees.', 'mag');
    },

    async mcpCall(a) {
      const name = a[0];
      if (!TOOL_NAMES.includes(name)) return this.print(`usage: mcp call <tool> {json args}   (TAB completes tool names)`, 'err');
      let args = {};
      const raw = a.slice(1).join(' ').trim();
      if (raw) { try { args = JSON.parse(raw); } catch (e) { return this.print(`bad JSON args: ${e.message}`, 'err'); } }
      if (!store().bridge.live && !(SH().server.running && SH().server.list.includes(name)) && G().phase >= 3 && !G().freePlay) {
        this.print(`note: ${name} is not registered on your running server yet — calling the lab kernel directly.`, 'warn');
      }
      const r = await A67.exec(name, args);
      this.print(`→ tools/call ${name} via ${r.via}`, 'info');
      this.json(r.data, 60);
      A67.emit('tool', { name, args, data: r.data, source: 'mcp call' });
      return r.data;
    },

    /* The simulated model: a transparent keyword router, not an LLM. */
    route(q) {
      const s = q.toLowerCase();
      const L = store().lab;
      const firstMeraki = L.nodes.find((n) => n.integrations.includes('meraki'));
      const vlan = (/vlan\s*(\d+)/.exec(s) || [])[1];
      const host = (/(?:for|named|called)\s+(?:the\s+|a\s+|an\s+)?(?:new\s+)?([a-z0-9-]+(?:\s[a-z0-9-]+)?)/.exec(s) || [])[1];
      const nodeIn = L.nodes.filter((n) => s.includes(n.label.toLowerCase()) || s.includes(n.id.toLowerCase()));
      const R = [
        [/\b(sites?|branch(es)?|networks?)\b.*\b(down|offline|outage|up)\b|which sites/, 'integrations.meraki.get_networks', () => ({})],
        [/\b(devices?|switch(es)?|mx|aps?|gear)\b.*\b(offline|down)\b/, 'integrations.meraki.get_devices', () => ({ status: 'offline' })],
        [/\b(allocate|reserve|assign|give)\b.*\b(ip|address)\b/, 'integrations.ipam.allocate', () => ({ subnet: 'sn-hq-users', hostname: (host || 'label-printer').replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 31) || 'label-printer' })],
        [/\b(subnets?|ipam|address space|free ips?)\b/, 'integrations.ipam.get_subnets', () => ({})],
        [/\b(open|create|file|raise|log)\b.*\b(case|ticket)\b/, 'integrations.salesforce.create_case', () => ({ subject: 'Branch-Dockside outage — MX and switch offline', description: 'Raised from the NOC assistant. Dockside scanners down since 06:10.', priority: 'High', account: 'Dockside', device: 'DOCK-MX' })],
        [/\b(cases?|tickets?)\b/, 'integrations.salesforce.query', () => ({ soql: "SELECT CaseNumber, Subject, Status, Priority FROM Case WHERE Status = 'Open'" })],
        [/\b(send|email|mail|notify|tell)\b.*\b(dispatch|team|them|@)/, 'integrations.email.send', () => ({ to: 'dispatch@neonharbor.example', subject: 'Dockside outage update', body: 'NOC is on it: Dockside MX + switch are offline. Case opened. Next update in 30 min.' })],
        [/\b(inbox|emails?|mail|messages?)\b/, 'integrations.email.list', () => ({ folder: 'inbox' })],
        [/\balerts?|alarms?\b/, 'integrations.monitoring.get_alerts', () => ({})],
        [/\b(cpu|metrics?|latency|utili[sz]ation|memory)\b/, 'integrations.monitoring.get_metrics', () => (nodeIn[0] ? { device: nodeIn[0].label } : {})],
        [/\b(vlan|rename|config(ure)?|push)\b/, 'integrations.meraki.update_config', () => (firstMeraki ? { serial: firstMeraki.meraki_serial, changes: { access_vlan: Number(vlan || 10) } } : null)],
        [/\bping\b|reach/, 'lab.device.run_command', () => (nodeIn.length >= 2 ? { device_id: nodeIn[0].id, command: `ping ${nodeIn[1].id}` } : null)],
        [/\b(topology|map|lab|what.*built|devices?)\b/, 'lab.topology.get', () => ({})],
      ];
      for (const [re, tool, args] of R) if (re.test(s)) return { tool, args: args() };
      return null;
    },
    async ask(q) {
      const p = (t, c) => this.print(t, c);
      if (!q) return p('usage: ask "which sites are down?"', 'err');
      // LOUD failure: a key in a prompt
      if (A67.looksLikeKey(q)) {
        const leaked = (q.match(/FAKE-[A-Z]+-[0-9a-f]{32}/g) || []);
        G().leaks += 1;
        leaked.forEach((k) => { if (!G().revoked.includes(k)) G().revoked.push(k); });
        store().refreshEnv();
        p('██ KEY LEAK BLOCKED ███████████████████████████████████████', 'leak');
        p('You pasted an API key into a prompt. Prompts are logged, cached, and sent to a model provider.', 'leak');
        p('The model never needs a key — the MCP server already holds it in its env.', 'leak');
        p(`That key is now REVOKED${leaked.length ? ` (${leaked.map(maskKey).join(', ')})` : ''}. Rotate it: SYSTEMS › <system> › Settings › ROTATE, then update .env.`, 'leak');
        A67.ui.toast('KEY LEAK — key revoked, rotate it', true);
        return;
      }
      if (!G().client.connected) return p('no client session — run: client connect', 'err');
      const tools = this.clientTools();
      p(`model  ▸ reads ${tools.length} tool descriptions (≈${G().client.tokens || '?'} tokens) — no keys, no URLs`, 'dim');
      const pick = this.route(q);
      if (!pick) return p('model  ▸ "None of my tools fit that. Try asking about sites, devices, alerts, metrics, cases, subnets, email or config."', 'mag');
      if (!tools.includes(pick.tool)) {
        p(`model  ▸ wants ${pick.tool}, but the server doesn't offer it.`, 'warn');
        return p('model  ▸ "I can\'t do that with the tools I have." — add it to server.py (tool add …) and restart the server.', 'mag');
      }
      if (!pick.args) return p(`model  ▸ picks ${pick.tool} but needs details (which device?) — name the device(s) in your question.`, 'mag');
      p(`model  ▸ picks ${pick.tool} ${JSON.stringify(pick.args)}`, 'mag');
      p('[simulated model: a transparent keyword router, not an LLM]', 'dim');
      G().client.asked.push({ q, tool: pick.tool });
      if (WRITE_TOOLS.includes(pick.tool)) {
        const prev = await A67.exec(pick.tool, Object.assign({}, pick.args, { confirm: false }));
        this.print(`app    ▸ tools/call ${pick.tool} (confirm=false) → preview`, 'info');
        if (prev.data.status !== 'confirmation_required') { this.json(prev.data, 30); return; }
        this.json(prev.data.preview, 30);
        this.pending = { tool: pick.tool, args: pick.args, q };
        this.mode = 'confirm';
        return;
      }
      await this.execAndAnswer(pick.tool, pick.args, q);
    },
    async confirm(ans) {
      const pend = this.pending;
      this.mode = null; this.pending = null;
      if (!/^y(es)?$/i.test(ans)) { this.print('app    ▸ write cancelled. Nothing changed.', 'warn'); return; }
      await this.execAndAnswer(pend.tool, Object.assign({}, pend.args, { confirm: true }), pend.q);
    },
    async execAndAnswer(tool, args, q) {
      const sys = tool.split('.')[1];
      const r = await A67.exec(tool, args);
      this.print(`app    ▸ tools/call ${tool} → MCP server (${r.via})`, 'info');
      if (KEY_ENV[sys]) {
        // report the key the server that ran the call actually used (bridge = the Python server's env)
        const k = r.data.auth && r.data.auth.key ? r.data.auth.key : maskKey(store().serverEnv()[KEY_ENV[sys]]);
        this.print(`server ▸ calls the ${sys} API with ${KEY_ENV[sys]}=${k}  [simulated — no real request is made]`, 'dim');
      }
      A67.emit('tool', { name: tool, args, data: r.data, source: 'client' });
      if (!r.data.ok) {
        this.json(r.data, 20);
        if (r.data.error === 'missing_api_key' || r.data.error === 'rejected_api_key') this.print('model  ▸ "The server can\'t reach that system — its key is missing or revoked." (fix it on the SERVER, not in the chat)', 'mag');
        return;
      }
      this.json(r.data, 24);
      this.print('model  ▸ ' + this.summarize(tool, r.data), 'mag');
    },
    summarize(tool, d) {
      switch (tool) {
        case 'integrations.meraki.get_networks': {
          const by = (st) => d.networks.filter((n) => n.status === st).map((n) => `${n.name} (${n.offline}/${n.devices} offline${n.alerting ? `, ${n.alerting} alerting` : ''})`);
          return `Down: ${by('down').join(', ') || 'none'}. Degraded: ${by('degraded').join(', ') || 'none'}. Everything else is up.`;
        }
        case 'integrations.meraki.get_devices': return `${d.count} device(s): ${d.devices.map((x) => `${x.name} [${x.status}]`).join(', ') || 'none'}.`;
        case 'integrations.monitoring.get_alerts': return `${d.count} open alert(s). Worst: ${(d.alerts.find((a) => a.severity === 'critical') || d.alerts[0] || { message: 'none' }).message}.`;
        case 'integrations.monitoring.get_metrics': return d.metrics.map((m) => `${m.device}: ${m.reachable ? `cpu ${m.cpu_pct}% lat ${m.latency_ms}ms` : 'unreachable'}`).slice(0, 6).join(' · ');
        case 'integrations.salesforce.query': return `${d.totalSize} record(s): ${d.records.map((r) => r.CaseNumber + ' ' + (r.Subject || '')).join('; ')}.`;
        case 'integrations.salesforce.create_case': return `Opened case ${d.case.CaseNumber} (${d.case.Priority}). It's in Salesforce now.`;
        case 'integrations.ipam.get_subnets': return d.subnets.map((s) => `${s.cidr} ${s.free} free`).join(' · ');
        case 'integrations.ipam.allocate': return `Reserved ${d.allocation.ip} for ${d.allocation.hostname} in ${d.allocation.subnet}.`;
        case 'integrations.email.list': return `${d.count} message(s). Latest: "${(d.messages[0] || {}).subject || '—'}".`;
        case 'integrations.email.send': return `Sent "${d.message.subject}" to ${d.message.to}.`;
        case 'integrations.meraki.update_config': return `Pushed ${JSON.stringify(d.after)} to ${d.serial}.`;
        case 'lab.device.run_command': return d.success ? `Reachable: ${d.path.join(' → ')}` : 'Not reachable.';
        case 'lab.topology.get': return `${d.counts.nodes} devices, ${d.counts.edges} links.`;
        default: return 'Done.';
      }
    },

    // ------------------------------------------------- DISCOVER board
    apps(a) {
      const b = G().board;
      if (a[0] === 'list' || !a[0]) return this.print(b.apps.length ? b.apps.map((x) => `${x}${b.raw.includes(x) ? ' (wired raw ×5)' : ''}`).join('\n') : 'no apps yet — apps add ChatOps', 'dim');
      if (a[0] !== 'add' || !a[1]) return this.print('usage: apps add <name>', 'err');
      if (b.apps.length >= 6) return this.print('six apps is plenty to see the curve', 'dim');
      if (b.apps.includes(a[1])) return this.print(`${a[1]} already exists`, 'err');
      b.apps.push(a[1]);
      this.print(`+ app ${a[1]} — an AI assistant that needs to reach Email, Meraki, Monitoring, Salesforce and IPAM.`, 'ok');
      A67.emit('board');
    },
    wire(a) {
      const b = G().board;
      if (a[0] === '--raw') {
        const targets = a[1] ? [a[1]] : b.apps.filter((x) => !b.raw.includes(x));
        if (!b.apps.length) return this.print('add an app first: apps add ChatOps', 'err');
        if (!targets.length) return this.print('every app is already wired raw', 'dim');
        for (const t of targets) {
          if (!b.apps.includes(t)) return this.print(`no app ${t}`, 'err');
          b.raw.push(t);
          for (const s of SYSTEMS) this.print(`  ${t} ⇄ ${pad(s, 11)} own auth flow · own SDK · own docs · own error handling`, 'warn');
        }
        b.mcp = false;
        this.print(`raw integrations to build and maintain: ${b.raw.length} apps × 5 services = ${b.raw.length * 5}`, 'err');
        A67.emit('board');
        return;
      }
      if (a[0] === '--mcp') {
        if (b.raw.length < 2) return this.print('wire at least two apps the raw way first, so you can compare', 'err');
        b.mcp = true;
        this.print('rebuilding with MCP:', 'info');
        this.print('  5 services → each API gets ONE adapter, written once, inside the MCP server (the API stays exactly where it is)', 'info');
        b.apps.forEach((x) => this.print(`  ${pad(x, 12)} → speaks MCP once (a client, usually built into the host app)`, 'info'));
        this.print(`pieces to build: ${b.apps.length} clients + 5 adapters = ${b.apps.length + 5}   (raw way: ${b.apps.length * 5})`, 'ok');
        if (b.apps.length + 5 > b.apps.length * 5) this.print('honest note: with this few apps MCP is MORE work. It wins as apps × services grows.', 'warn');
        A67.emit('board');
        return;
      }
      return this.print('usage: wire --raw [app] | wire --mcp', 'err');
    },
    quiz() {
      this.print('QUIZ — the model decides it needs Meraki device status. Who actually sends the HTTP request to the Meraki API?', 'help');
      this.print('  a) the model — it has the docs and calls the URL itself', 'help');
      this.print('  b) the app: it sends tools/call to the MCP server, and the server calls the API with the key it holds', 'help');
      this.print('  c) the user, by pasting the key into the chat', 'help');
      this.print('answer with: answer a|b|c', 'dim');
    },
    answer(x) {
      x = (x || '').toLowerCase();
      if (!['a', 'b', 'c'].includes(x)) return this.print('usage: answer a|b|c', 'err');
      if (G().phase === 6 && !G().freePlay) return A67.phases.shipAnswer(x);
      if (x === 'b') {
        G().board.quiz = 'b';
        this.print('✓ Correct. The model only PICKS a tool. The app executes it through the MCP server, which holds the key and calls the API.', 'ok');
      } else if (x === 'a') this.print('✗ No — the model never calls an API, never sees the URL, never sees a key. It returns a tool choice as text.', 'err');
      else this.print('✗ Never. A key in a chat is a leaked key. The key lives on the server.', 'err');
    },
    discover() {
      const tools = TOOL_SCHEMAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
      const bytes = JSON.stringify(tools).length;
      this.print('client → server: tools/list', 'info');
      tools.forEach((t) => this.print(`  ${pad(t.name, 40)}${t.description.slice(0, 54)}`, 'dim'));
      this.print(`server → client: ${tools.length} tools · ${bytes} bytes ≈ ${Math.round(bytes / 4)} tokens added to the model's context`, 'warn');
      this.print('user  : "Which Meraki devices are offline right now?"', 'out');
      this.print('model : picks integrations.meraki.get_devices {"status":"offline"}', 'mag');
      this.json({ name: 'integrations.meraki.get_devices', description: tools.find((t) => t.name === 'integrations.meraki.get_devices').description, inputSchema: tools.find((t) => t.name === 'integrations.meraki.get_devices').inputSchema });
      this.print('What the model saw: a name, a description, a schema. NO base URL. NO API key. NO SDK.', 'mag');
      this.print('What happens next: the APP sends tools/call; the SERVER calls Meraki with the key from its env.', 'info');
      G().board.discovered = true;
      G().board.tokens = Math.round(bytes / 4);
      A67.emit('board');
    },

    // ------------------------------------------------- verification
    async verify(a) {
      const [what, x, y] = a;
      const L = store().lab;
      const p = (t, c) => this.print(t, c);
      const run = async (tool, args) => { const r = await A67.exec(tool, args); A67.emit('tool', { name: tool, args, data: r.data, source: 'verify' }); p(`  → ${tool} ${JSON.stringify(args)}  ${r.data.ok ? '✓' : '✗ ' + (r.data.message || r.data.error)}`, r.data.ok ? 'dim' : 'err'); return r.data; };
      const badge = (k) => { const v = store().lab.verification[k] || {}; p(`[${(v.status || 'pending').toUpperCase()}] ${k}: ${v.detail || ''}`, v.status === 'pass' ? 'ok' : 'err'); };
      if (!what) { for (const k of ['ping', 'alert', 'case', 'allocate', 'config']) badge(k); return; }
      p('(verification runs its tool calls with confirm=true — you asked for them by typing verify)', 'dim');
      if (what === 'ping') {
        const A = lab()._node(x) || L.nodes[0], B = lab()._node(y) || L.nodes.find((n) => A && n.id !== A.id && lab()._path(A.id, n.id)) || L.nodes[1];
        if (!A || !B) return p('need two devices on the map first', 'err');
        const r = await run('lab.device.run_command', { device_id: A.id, command: `ping ${B.id}` });
        if (r.output) r.output.forEach((l) => p('  ' + l));
        return badge('ping');
      }
      if (what === 'alert') {
        const n = lab()._node(x) || L.nodes.find((q) => q.integrations.includes('monitoring')) || L.nodes[0];
        if (!n) return p('need a device on the map first', 'err');
        const r = await run('lab.device.run_command', { device_id: n.id, command: 'send test-trap' });
        if (r.ok) {
          const al = await run('integrations.monitoring.get_alerts', {});
          if (al.ok && al.alerts.some((q) => q.id === r.alert.id)) p(`  monitoring shows ${r.alert.id} ✓`, 'ok');
          else { store().labApi._verify('alert', false, al.ok ? 'trap sent but not visible in monitoring' : al.message); store().labApi._commit(); }
        }
        return badge('alert');
      }
      if (what === 'case') {
        const r = await run('integrations.salesforce.create_case', { subject: `Verification case ${now()}`, description: 'Lab verification step', priority: 'Low', account: 'Dockside', confirm: true });
        if (r.ok) {
          const q = await run('integrations.salesforce.query', { soql: `SELECT CaseNumber, Status FROM Case WHERE CaseNumber = '${r.case.CaseNumber}'` });
          p(q.ok && q.totalSize === 1 ? `  Salesforce returns case ${r.case.CaseNumber} ✓` : '  case not found on read-back', q.ok ? 'ok' : 'err');
        } else { lab()._verify('case', false, r.message); lab()._commit(); }
        return badge('case');
      }
      if (what === 'allocate') {
        const host = `verify-${Math.floor(Math.random() * 900 + 100)}`;
        const r = await run('integrations.ipam.allocate', { subnet: 'sn-hq-users', hostname: host, confirm: true });
        if (r.ok) {
          const s = await run('integrations.ipam.get_subnets', { site: 'HQ' });
          const sn = s.ok && s.subnets.find((q) => q.id === 'sn-hq-users');
          p(sn && sn.allocations.some((q) => q.ip === r.allocation.ip) ? `  IPAM shows ${r.allocation.ip} as used ✓` : '  allocation missing on read-back', 'ok');
        } else if (!['subnet_full'].includes(r.error)) { lab()._verify('allocate', false, r.message); lab()._commit(); }
        return badge('allocate');
      }
      if (what === 'config') {
        const n = lab()._node(x) || L.nodes.find((q) => q.integrations.includes('meraki'));
        if (!n || !n.integrations.includes('meraki')) { lab()._verify('config', false, 'no Meraki-managed device on the map'); lab()._commit(); p('attach Meraki to a switch/router/firewall first', 'err'); return badge('config'); }
        const vlan = n.config.access_vlan === 10 ? 20 : 10;
        const r = await run('integrations.meraki.update_config', { serial: n.meraki_serial, changes: { access_vlan: vlan }, confirm: true });
        if (r.ok) {
          const ins = await run('lab.device.inspect', { device_id: n.id });
          p(ins.ok && ins.device.config.access_vlan === vlan ? `  ${n.label} now shows vlan ${vlan} on the map ✓` : '  config not visible on read-back', 'ok');
        } else { lab()._verify('config', false, r.message); lab()._commit(); }
        return badge('config');
      }
      if (what === 'all') {
        for (const k of ['ping', 'alert', 'case', 'allocate', 'config']) await this.verify([k]);
        const v = store().lab.verification;
        const pass = ['ping', 'alert', 'case', 'allocate', 'config'].every((k) => v[k] && v[k].status === 'pass');
        G().ship.verifiedAll = pass;
        p(pass ? '█ ALL FIVE CHECKS PASS █' : 'some checks failed — read the ✗ lines above', pass ? 'ok' : 'err');
        return;
      }
      return p('usage: verify ping <a> <b> | alert <dev> | case | allocate | config <dev> | all', 'err');
    },

    // ------------------------------------------------- git (simulated, local)
    git(a, line) {
      const sh = SH();
      sh.git = sh.git || { tracked: TRACKED0.slice(), staged: [], log: [{ h: 'c19e092', m: 'initial lab workspace' }] };
      const g = sh.git;
      const ignored = (f) => (files()['.gitignore'] || '').split('\n').map((x) => x.trim()).filter(Boolean).some((pat) => pat === f || (pat.endsWith('/') && f.startsWith(pat)));
      const untracked = () => Object.keys(files()).filter((f) => !g.tracked.includes(f) && !g.staged.includes(f) && !ignored(f));
      const [sub, ...rest] = a;
      if (sub === 'status') {
        this.print('On branch main');
        if (g.staged.length) { this.print('Changes to be committed:'); g.staged.forEach((f) => this.print(`\tnew file:   ${f}`, 'ok')); }
        const u = untracked();
        if (u.length) { this.print('Untracked files:\n  (use "git add <file>..." to include in what will be committed)'); u.forEach((f) => this.print(`\t${f}`, 'err')); }
        if (!g.staged.length && !u.length) this.print('nothing to commit, working tree clean');
        if (files()['.env'] !== undefined && ignored('.env')) this.print('(.env exists and is ignored by .gitignore — good)', 'dim');
        sh.flags.gitStatus = true;
        return;
      }
      if (sub === 'check-ignore') {
        const f = rest.filter((x) => !x.startsWith('-'))[0];
        if (f && ignored(f)) { this.print(rest.includes('-v') ? `.gitignore:1:${f}\t${f}` : f); sh.flags.sawGitignore = true; }
        return;
      }
      if (sub === 'add') {
        const force = rest.includes('-f') || rest.includes('--force');
        const targets = rest.filter((x) => !x.startsWith('-'));
        if (!targets.length) return this.print('Nothing specified, nothing added.', 'warn');
        const all = targets.some((t) => t === '.' || t === '-A');
        const list = all ? untracked() : targets;
        for (const f of list) {
          if (!(f in files())) { this.print(`fatal: pathspec '${f}' did not match any files`, 'err'); continue; }
          if (ignored(f) && !force) { this.print(`The following paths are ignored by one of your .gitignore files:\n${f}\nhint: Use -f if you really want to add them.`, 'warn'); continue; }
          if (ignored(f) && force && f === '.env') this.print('⚠ you just force-added .env. The pre-commit secret scan will have something to say.', 'warn');
          if (!g.staged.includes(f)) g.staged.push(f);
        }
        return;
      }
      if (sub === 'commit') {
        if (!g.staged.length) return this.print('nothing added to commit but untracked files present (use "git add" to track)', 'warn');
        this.print('pre-commit: scanning staged files for secrets…', 'dim');
        const hits = [];
        for (const f of g.staged) {
          const txt = f === 'server.py' ? serverSource() : (files()[f] || '');
          (txt.match(/FAKE-[A-Z]+-[0-9a-f]{32}|\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}/g) || []).forEach((k) => hits.push(`${f}: ${maskKey(k)}`));
          if (f === '.env') hits.push('.env: env files never belong in git');
        }
        if (hits.length) {
          this.print('██ COMMIT BLOCKED — SECRET SCAN FAILED ██████████████████', 'leak');
          hits.forEach((h) => this.print('  ' + h, 'leak'));
          this.print('Unstage it (git reset .env), keep .env in .gitignore, and rotate any key that was ever committed — even to a branch you never pushed.', 'leak');
          sh.lastCommitOk = false;
          A67.ui.toast('commit blocked: secret in staged files', true);
          return;
        }
        const msg = (/-m\s+["']([^"']+)["']/.exec(line) || /-m\s+(\S+)/.exec(line) || [])[1] || 'update';
        const h = Math.random().toString(16).slice(2, 9);
        this.print(`[main ${h}] ${msg}\n ${g.staged.length} file(s) changed`, 'ok');
        g.tracked.push(...g.staged);
        g.log.unshift({ h, m: msg });
        g.staged = [];
        sh.commits += 1;
        sh.lastCommitOk = true;
        return;
      }
      if (sub === 'reset') { g.staged = g.staged.filter((f) => !rest.includes(f) && rest.length); if (!rest.length) g.staged = []; return; }
      if (sub === 'log') { g.log.forEach((c) => this.print(`${c.h} ${c.m}`, 'out')); return; }
      if (sub === 'diff') return this.print('(the lab tracks files, not hunks — use git status)', 'dim');
      if (sub === 'push') return this.print('push: disabled in this lab. In the real repo, nothing is pushed without the owner\'s approval.', 'err');
      return this.print(`git: '${sub || ''}' is not supported in the lab — status, add, commit, check-ignore, log, reset`, 'err');
    },

    // ------------------------------------------------- netlify (simulated)
    netlify(a) {
      const [sub, ...rest] = a;
      const p = (t, c) => this.print(t, c);
      if (!sub || sub === '--help') return p('netlify-cli (SIMULATED — makes no network calls)\n  status · deploy [--prod] · functions:list');
      if (sub === 'status') return p('Netlify CLI (simulated)\n  Current site: not linked — this lab never links or deploys a real site.\n  Publish dir (netlify.toml): .  → / redirects to /visual/', 'out');
      if (sub === 'functions:list') return p('No functions in this repo. The MCP server is Python; it is not deployed with the static site. See the SHIP guide for runtime options.', 'out');
      if (sub === 'deploy') {
        if (rest.includes('--prod')) {
          p('BLOCKED: production deploys need explicit approval from the repo owner. This lab never deploys.', 'err');
          G().ship.triedProd = true;
          return;
        }
        p('Deploy path (simulated dry run): .');
        p('  would upload: visual/index.html visual/css/app.css visual/js/*.js assets/icons/*.png lab_state/seed.json index.html netlify.toml');
        p('  would NOT upload: .env (ignored) · .venv/ · mcp_server/ (needs a Python runtime, not a CDN)');
        p('  ✔ static game: OK to host on Netlify');
        p('  ✗ MCP server: not part of a static deploy. Run it locally (stdio) or on a Python-capable runtime.', 'warn');
        p('Draft URL: (none — simulated. No request left this page.)', 'dim');
        G().ship.deployed = true;
        return;
      }
      return p(`netlify ${sub}: not simulated here`, 'err');
    },

    // ------------------------------------------------- device consoles
    devCommands(before) {
      const d = this.dev[this.active] || { mode: 'user' };
      const nodes = store().lab.nodes.map((n) => n.id).concat(store().lab.nodes.map((n) => n.label));
      if (before[0] === 'show' || before[0] === 'do') return ['version', 'running-config', 'ip', 'interface', 'brief', 'cdp', 'neighbors', 'lldp', 'show'];
      if (['ping', 'traceroute'].includes(before[0])) return nodes;
      if (before[0] === 'interface') { const n = this.devNode(); return n ? n.config.interfaces.map((i) => i.name) : []; }
      const by = {
        user: ['?', 'enable', 'show', 'ping', 'traceroute', 'exit'],
        priv: ['?', 'configure', 'terminal', 'show', 'ping', 'traceroute', 'write', 'memory', 'disable', 'exit', 'end'],
        config: ['?', 'hostname', 'interface', 'do', 'exit', 'end', 'no'],
        if: ['?', 'ip', 'address', 'shutdown', 'no', 'switchport', 'access', 'vlan', 'description', 'do', 'exit', 'end'],
      };
      return by[d.mode];
    },
    device(line) {
      const n = this.devNode();
      const p = (t, c) => this.print(t, c);
      if (!n) { this.active = 'kernel'; return; }
      const d = (this.dev[n.id] = this.dev[n.id] || { mode: 'user', iface: null });
      const argv = line.split(/\s+/).filter(Boolean);
      const w = argv.map((x) => x.toLowerCase());
      const ab = (word, full) => !!word && full.startsWith(word);
      if (!w.length) return;
      if (w[0] === '?' || w[0] === 'help' || w[w.length - 1] === '?') {
        const help = {
          user: ['enable              enter privileged mode', 'show …              version | running-config | ip interface brief | cdp neighbors', 'ping <device>', 'traceroute <device>', 'exit                back to the kernel tab'],
          priv: ['configure terminal  enter config mode', 'show …', 'ping <device>', 'write memory        save config', 'disable', 'exit'],
          config: ['hostname <name>', 'interface <name>    ' + n.config.interfaces.map((i) => i.name).join(' '), 'do <exec command>', 'exit / end'],
          if: ['ip address <ip> <mask>', 'shutdown / no shutdown', 'switchport access vlan <n>', 'description <text>', 'do <exec command>', 'exit / end'],
        }[d.mode];
        help.forEach((h) => p('  ' + h, 'help'));
        return;
      }
      const exec = (ws, raw) => {
        if (ab(ws[0], 'show') || ws[0] === 'sh') {
          const cmd = 'show ' + ws.slice(1).join(' ');
          const norm = cmd.replace(/^show run(ning-config)?$/, 'show running-config').replace(/^show ip int(erface)? br(ief)?$/, 'show ip interface brief').replace(/^show ver(sion)?$/, 'show version').replace(/^show (cdp|lldp) nei(ghbors)?$/, 'show $1 neighbors');
          const r = lab().device_run_command({ device_id: n.id, command: norm });
          if (r.ok) r.output.forEach((l) => p(l)); else p(r.message, 'err');
          return true;
        }
        if (ws[0] === 'ping' || ws[0] === 'traceroute') {
          const r = lab().device_run_command({ device_id: n.id, command: raw.join(' ') });
          if (r.ok) r.output.forEach((l) => p(l, r.success ? 'out' : 'err')); else p(r.message, 'err');
          A67.emit('tool', { name: 'lab.device.run_command', data: r, source: 'console' });
          return true;
        }
        return false;
      };
      const changed = (what) => { n.config.config_rev = (n.config.config_rev || 0) + 1; G().deviceConfigured = true; lab()._event('device_config', { node: n.id, what }); lab()._commit(); };
      if (d.mode === 'user') {
        if (ab(w[0], 'enable')) { d.mode = 'priv'; return; }
        if (w[0] === 'exit' || w[0] === 'logout') { this.closeDevice(n.id); return; }
        if (exec(w, argv)) return;
        return p(`% Unknown command or not available in user mode: '${line}' (try enable, or ?). Kernel commands run in the kernel tab.`, 'err');
      }
      if (d.mode === 'priv') {
        if (ab(w[0], 'configure') && (!w[1] || ab(w[1], 'terminal'))) { d.mode = 'config'; p('Enter configuration commands, one per line.  End with CNTL/Z.'); return; }
        if (ab(w[0], 'write') || w[0] === 'wr' || (w[0] === 'copy' && w[1] === 'run')) { p('Building configuration...\n[OK]', 'ok'); return; }
        if (ab(w[0], 'disable')) { d.mode = 'user'; return; }
        if (w[0] === 'end') return;
        if (w[0] === 'exit') { d.mode = 'user'; return; }
        if (exec(w, argv)) return;
        return p(`% Invalid input detected at '^' marker: '${line}'`, 'err');
      }
      if (w[0] === 'do') { if (!exec(w.slice(1), argv.slice(1))) p('% Invalid input detected', 'err'); return; }
      if (w[0] === 'end') { d.mode = 'priv'; d.iface = null; return; }
      if (d.mode === 'config') {
        if (w[0] === 'exit') { d.mode = 'priv'; return; }
        if (ab(w[0], 'hostname')) {
          const nm = argv[1];
          if (!nm || !/^[A-Za-z][A-Za-z0-9-]{0,23}$/.test(nm)) return p('% hostname: letters, digits, dashes; start with a letter', 'err');
          const other = lab()._node(nm);
          if (other && other.id !== n.id) return p(`% ${nm} is already used by ${other.id}`, 'err');
          n.label = nm; n.config.hostname = nm;
          changed('hostname');
          this.renderTabs();
          return;
        }
        if (ab(w[0], 'interface') || w[0] === 'int') {
          const name = argv.slice(1).join('');
          const ifc = n.config.interfaces.find((i) => i.name.toLowerCase() === name.toLowerCase());
          if (!ifc) return p(`% no interface ${name || ''} — cabled ports: ${n.config.interfaces.map((i) => i.name).join(', ') || 'none (cable this device first)'}`, 'err');
          d.mode = 'if'; d.iface = ifc.name;
          return;
        }
        return p(`% Invalid input detected: '${line}' (try ?)`, 'err');
      }
      if (d.mode === 'if') {
        const ifc = n.config.interfaces.find((i) => i.name === d.iface);
        if (!ifc) { d.mode = 'config'; return; }
        if (w[0] === 'exit') { d.mode = 'config'; d.iface = null; return; }
        if (w[0] === 'ip' && ab(w[1], 'address')) {
          const ip = argv[2], mask = argv[3];
          const okIp = (s) => /^(\d{1,3}\.){3}\d{1,3}$/.test(s || '') && s.split('.').every((o) => Number(o) <= 255);
          if (!okIp(ip) || !okIp(mask)) return p('% usage: ip address <a.b.c.d> <mask>  e.g. ip address 10.67.1.2 255.255.255.0', 'err');
          const bits = mask.split('.').map((o) => Number(o).toString(2).padStart(8, '0')).join('').replace(/0+$/, '');
          if (bits.includes('0')) return p('% bad mask', 'err');
          ifc.ip = `${ip}/${bits.length}`;
          changed('ip');
          return;
        }
        if (w[0] === 'shutdown' || w[0] === 'shut') {
          ifc.status = 'down';
          const c = store().lab.counters; c.alert += 1;
          store().lab.integrations.monitoring.alerts.push({ id: `AL-${c.alert}`, severity: 'warning', source: n.label, site: 'HQ', message: `Interface ${ifc.name} administratively down`, status: 'open', at: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z') });
          p(`%LINK-5-CHANGED: Interface ${ifc.name}, changed state to administratively down`, 'warn');
          changed('shutdown');
          return;
        }
        if (w[0] === 'no' && (w[1] === 'shutdown' || w[1] === 'shut')) {
          ifc.status = 'up';
          store().lab.integrations.monitoring.alerts.forEach((al) => { if (al.source === n.label && al.message.includes(`Interface ${ifc.name} `) && al.status === 'open') al.status = 'resolved'; });
          p(`%LINK-3-UPDOWN: Interface ${ifc.name}, changed state to up`, 'ok');
          changed('no shutdown');
          return;
        }
        if (w[0] === 'switchport' && w[1] === 'access' && w[2] === 'vlan') {
          const v = Number(w[3]);
          if (!(v >= 1 && v <= 4094)) return p('% vlan 1-4094', 'err');
          n.config.access_vlan = v;
          changed('vlan');
          return;
        }
        if (ab(w[0], 'description')) { ifc.description = argv.slice(1).join(' '); changed('description'); return; }
        return p(`% Invalid input detected: '${line}' (try ?)`, 'err');
      }
    },
  });
})();
