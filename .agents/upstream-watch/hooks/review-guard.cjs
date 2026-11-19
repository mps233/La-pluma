#!/usr/bin/env node
'use strict';

// PreToolUse guard for the upstream-review agent.
// It only explains updates and records the user's decisions: read the repo,
// read reports, append to decisions.md. No code changes, no git writes.
const path = require('path');

const ROOT = '/Users/miaopasi/La-pluma';
const WATCH = path.join(ROOT, '.agents/upstream-watch');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => { raw += d; });
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(raw);
  } catch (e) {
    return emit('deny', 'guard: invalid hook input');
  }
  const r = decide(input.tool_name || '', input.tool_input || {});
  emit(r.ok ? 'allow' : 'deny', r.reason);
});

const inRoot = (p) => {
  const r = path.resolve(p || '');
  return r === ROOT || r.startsWith(ROOT + path.sep);
};
const decisionsFile = () => path.join(WATCH, 'decisions.md');

function decide(tool, ti) {
  if (tool === 'TodoWrite') return { ok: true, reason: 'todo' };

  if (tool === 'Read') {
    const p = ti.file_path || ti.path || '';
    return !p || inRoot(p) ? { ok: true, reason: 'read repo' } : { ok: false, reason: 'read outside repo denied' };
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const p = ti.path || ti.glob || '';
    return !p || inRoot(p) ? { ok: true, reason: 'search repo' } : { ok: false, reason: 'search outside repo denied' };
  }

  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit') {
    const p = ti.file_path || '';
    // 只允许写裁决记录，且必须是追加语义
    return path.resolve(p) === decisionsFile()
      ? { ok: true, reason: 'append decisions' }
      : { ok: false, reason: 'only decisions.md is writable: ' + p };
  }

  if (tool === 'Bash') return decideBash(String(ti.command || ''));

  return { ok: false, reason: 'tool not allowed: ' + tool };
}

function unquotedDanger(cmd) {
  let q = null, esc = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (q) { if (c === q) q = null; continue; }
    if (c === "'" || c === '"') { q = c; continue; }
    if (c === '>' || c === '<' || c === '`' || (c === '$' && cmd[i + 1] === '(')) return true;
    if (c === ';' || c === '|' || c === '&') return true;
  }
  return false;
}

function decideBash(cmd) {
  const t = cmd.trim();
  if (!t) return { ok: false, reason: 'empty command' };
  if (unquotedDanger(cmd)) return { ok: false, reason: 'chain/redirection/substitution denied' };

  const toks = t.split(/\s+/);
  const c0 = toks[0];
  const args = toks.slice(1);

  if (c0 === 'date' || c0 === 'pwd') return { ok: true, reason: 'read' };
  if (c0 === 'cat' || c0 === 'ls' || c0 === 'head' || c0 === 'tail' || c0 === 'rg' || c0 === 'grep') {
    for (const a of args) {
      if (a.startsWith('/') && !inRoot(a)) return { ok: false, reason: 'path outside repo denied' };
    }
    return { ok: true, reason: 'read' };
  }
  if (c0 === 'git') {
    const sub = args[0];
    if (['log', 'show', 'diff', 'status', 'rev-parse'].includes(sub)) return { ok: true, reason: 'git read' };
    return { ok: false, reason: 'git subcommand denied: ' + sub };
  }
  return { ok: false, reason: 'command denied: ' + c0 };
}

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: 'upstream-review guard: ' + reason,
    },
  }) + '\n');
}
