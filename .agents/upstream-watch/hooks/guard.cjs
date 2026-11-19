#!/usr/bin/env node
'use strict';

// PreToolUse guard for the upstream-watch agent.
// Allows only reads inside the repo, writes inside .agents/upstream-watch,
// and a small set of read-only shell commands.
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
  const tool = input.tool_name || '';
  const ti = input.tool_input || {};
  const result = decide(tool, ti);
  emit(result.ok ? 'allow' : 'deny', result.reason);
});

function inWatch(p) {
  const r = path.resolve(p || '');
  return r === WATCH || r.startsWith(WATCH + path.sep);
}
function writable(p) {
  const r = path.resolve(p || '');
  const reports = path.join(WATCH, 'reports');
  return (
    r === path.join(WATCH, 'state.json') ||
    r === path.join(WATCH, 'decisions.md') ||
    r.startsWith(reports + path.sep)
  );
}
function inRepo(p) {
  const r = path.resolve(p || '');
  return r === ROOT || r.startsWith(ROOT + path.sep);
}

function decide(tool, ti) {
  if (tool === 'TodoWrite') return { ok: true, reason: 'todo state' };
  if (tool === 'Read') {
    const p = ti.file_path || ti.path || '';
    if (!p) return { ok: true, reason: 'read cwd' };
    return inRepo(p)
      ? { ok: true, reason: 'read repo' }
      : { ok: false, reason: 'read outside repo denied: ' + p };
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const p = ti.path || ti.glob || '';
    if (!p) return { ok: true, reason: 'search cwd' };
    return inRepo(p)
      ? { ok: true, reason: 'search repo' }
      : { ok: false, reason: 'search outside repo denied: ' + p };
  }
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const p = ti.file_path || ti.notebook_path || '';
    return writable(p)
      ? { ok: true, reason: 'write watch output' }
      : { ok: false, reason: 'write outside watch output denied: ' + p };
  }
  if (tool === 'Bash') return decideBash(String(ti.command || ''));
  return { ok: false, reason: 'tool not allowed: ' + tool };
}

function splitCommands(cmd) {
  const parts = [];
  let cur = '';
  let quote = null;
  let esc = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (esc) { cur += c; esc = false; continue; }
    if (c === '\\') { cur += c; esc = true; continue; }
    if (quote) { cur += c; if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; cur += c; continue; }
    if (c === '\n' || c === ';') { parts.push(cur); cur = ''; continue; }
    if (c === '&' && cmd[i + 1] === '&') { parts.push(cur); cur = ''; i++; continue; }
    if (c === '|' && cmd[i + 1] === '|') { parts.push(cur); cur = ''; i++; continue; }
    if (c === '|') { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((s) => s.trim()).filter(Boolean);
}

function unquotedDanger(cmd) {
  let quote = null;
  let esc = false;
  for (let i = 0; i < cmd.length; i++) {
    const c = cmd[i];
    if (esc) { esc = false; continue; }
    if (c === '\\') { esc = true; continue; }
    if (quote) { if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (c === '>' || c === '<' || c === '`') return true;
    if (c === '$' && cmd[i + 1] === '(') return true;
  }
  return false;
}

function tokens(seg) {
  const out = [];
  let cur = '';
  let quote = null;
  for (let i = 0; i < seg.length; i++) {
    const c = seg[i];
    if (quote) {
      if (c === quote) quote = null;
      else cur += c;
      continue;
    }
    if (c === "'" || c === '"') { quote = c; continue; }
    if (/\s/.test(c)) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur += c;
  }
  if (cur) out.push(cur);
  return out;
}

function denied(msg) { return { ok: false, reason: msg }; }

function decideBash(cmd) {
  if (!cmd.trim()) return denied('empty command');
  const segs = splitCommands(cmd);
  for (const seg of segs) {
    if (unquotedDanger(seg)) return denied('redirection or command substitution denied');
    const toks = tokens(seg);
    let i = 0;
    while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
    const c0 = toks[i];
    const args = toks.slice(i + 1);
    if (!c0) continue;

    if (c0 === 'gh') {
      const sub = args[0];
      if (sub === 'api') {
        const method = args.find((a) => /^(-X|--method)$/.test(a));
        if (method) {
          const idx = args.indexOf(method);
          const m = (args[idx + 1] || 'GET').toUpperCase();
          if (m !== 'GET') return denied('gh api non-GET denied');
        }
        if (args.some((a) => /^--method=(POST|PUT|PATCH|DELETE)$/i.test(a))) return denied('gh api non-GET denied');
        if (args.some((a) => /^(-f|-F|--field|--raw-field|--input)(=|$)/.test(a))) return denied('gh api request body denied');
        return { ok: true, reason: 'gh api read' };
      }
      if (sub === 'release') {
        if (['create', 'upload', 'edit', 'delete'].includes(args[1])) return denied('gh release write denied');
        return { ok: true, reason: 'gh release read' };
      }
      if (sub === 'search') return { ok: true, reason: 'gh search' };
      if (sub === 'repo') {
        if (['create', 'delete', 'edit', 'fork', 'clone'].includes(args[1])) return denied('gh repo write denied');
        return { ok: true, reason: 'gh repo read' };
      }
      return denied('gh subcommand denied: ' + (sub || '(none)'));
    }

    if (c0 === 'git') {
      const sub = args[0];
      const allowed = ['log', 'show', 'diff', 'status', 'ls-remote', 'rev-parse', 'describe'];
      if (!allowed.includes(sub)) return denied('git subcommand denied: ' + (sub || '(none)'));
      return { ok: true, reason: 'git read' };
    }

    if (['rg', 'grep', 'ls', 'jq', 'date', 'pwd'].includes(c0)) {
      for (const a of args) {
        if (a.startsWith('/') && !inRepo(a)) return denied('absolute path outside repo denied: ' + a);
      }
      return { ok: true, reason: c0 + ' read' };
    }

    if (c0 === 'mkdir') {
      const target = args.filter((a) => !a.startsWith('-')).join(' ');
      if (!target || !inWatch(target)) return denied('mkdir outside watch dir denied');
      return { ok: true, reason: 'mkdir watch dir' };
    }

    return denied('command denied: ' + c0);
  }
  return { ok: true, reason: 'read-only bash' };
}

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: 'upstream-watch guard: ' + reason,
    },
  }) + '\n');
}
