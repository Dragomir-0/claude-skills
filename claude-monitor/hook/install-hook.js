'use strict';
const fs = require('fs');
const path = require('path');

const DEFAULT_COMMAND = `node "${path.join(__dirname, 'register.js').replace(/\\/g, '/')}" 2>/dev/null || true`;

function addHook(settings, command) {
  settings.hooks = settings.hooks || {};
  const groups = settings.hooks.SessionStart = settings.hooks.SessionStart || [];
  const present = groups.some(g => (g.hooks || []).some(h => h.command === command));
  if (!present) groups.push({ hooks: [{ type: 'command', command, timeout: 10 }] });
  return settings;
}

function removeHook(settings, command) {
  const groups = settings.hooks && settings.hooks.SessionStart;
  if (!groups) return settings;
  settings.hooks.SessionStart = groups
    .map(g => ({ ...g, hooks: (g.hooks || []).filter(h => h.command !== command) }))
    .filter(g => g.hooks.length > 0);
  return settings;
}

function stamp() {
  return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

function run(argv, command = DEFAULT_COMMAND) {
  const remove = argv.includes('--remove');
  const file = argv.find(a => !a.startsWith('--'));
  if (!file) throw new Error('usage: node install-hook.js [--remove] <settingsPath>');
  const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.copyFileSync(file, `${file}.bak-${stamp()}`);
  const next = remove ? removeHook(settings, command) : addHook(settings, command);
  fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n');
}

module.exports = { addHook, removeHook, run, DEFAULT_COMMAND };
if (require.main === module) run(process.argv.slice(2));
