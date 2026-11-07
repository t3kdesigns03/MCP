// Runs tests/parity_calls.json through visual/js/tools.js and prints JSON results.
const fs = require('fs');
const path = require('path');
const { Lab } = require('../visual/js/tools.js');
const root = path.resolve(__dirname, '..');
const seed = JSON.parse(fs.readFileSync(path.join(root, 'lab_state', 'seed.json'), 'utf8'));
const calls = JSON.parse(fs.readFileSync(path.join(__dirname, 'parity_calls.json'), 'utf8'));
const env = JSON.parse(process.argv[2]);
const lab = new Lab(seed, env, () => '2026-11-07T12:00:00Z');
const out = calls.map(([name, args]) => lab.call(name, args));
process.stdout.write(JSON.stringify({ results: out, state: lab.state }));
