'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { addHook, removeHook, run } = require('./install-hook');

const CMD = 'node "C:/x/hook/register.js" 2>/dev/null || true';
const existing = () => ({ hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node other.js', timeout: 10 }] }] }, model: 'sonnet' });

test('addHook appends a second group and keeps the existing one', () => {
  const s = addHook(existing(), CMD);
  assert.strictEqual(s.hooks.SessionStart.length, 2);
  assert.strictEqual(s.hooks.SessionStart[0].hooks[0].command, 'node other.js');
  assert.strictEqual(s.hooks.SessionStart[1].hooks[0].command, CMD);
  assert.strictEqual(s.model, 'sonnet');
});

test('addHook is idempotent', () => {
  const s = addHook(addHook(existing(), CMD), CMD);
  assert.strictEqual(s.hooks.SessionStart.length, 2);
});

test('addHook creates hooks.SessionStart when absent', () => {
  assert.strictEqual(addHook({}, CMD).hooks.SessionStart.length, 1);
});

test('removeHook removes only our group', () => {
  const s = removeHook(addHook(existing(), CMD), CMD);
  assert.deepStrictEqual(s.hooks.SessionStart, existing().hooks.SessionStart);
});

test('run backs up, writes, and --remove restores shape', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-'));
  const f = path.join(dir, 'settings.json');
  fs.writeFileSync(f, JSON.stringify(existing(), null, 2) + '\n');
  run([f], CMD);
  assert.ok(fs.readdirSync(dir).some(n => n.startsWith('settings.json.bak-')));
  assert.strictEqual(JSON.parse(fs.readFileSync(f, 'utf8')).hooks.SessionStart.length, 2);
  run(['--remove', f], CMD);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(f, 'utf8')), existing());
});
