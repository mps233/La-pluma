#!/usr/bin/env node
'use strict';

// PreToolUse guard for the upstream-watch APPLY agent.
// It may write only inside .agents/upstream-watch/worktrees and reports,
// and may run only a narrow set of read-only / build / git commands.
const path = require('path');

const ROOT = '/Users/miaopasi/La-pluma';
const WATCH = path.join(ROOT, '.agents/upstream-watch');
const WORKTREES = path.join(WATCH, 'worktrees');

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
  const result = decide(input.tool_name || '', input.tool_input || {});
  emit(result.ok ? 'allow' : 'deny', result.reason);
});

function inRoot(p) {
  const r = path.resolve(p || '');
  return r === ROOT || r.startsWith(ROOT + path.sep);
}
function inWorktrees(p) {
  const r = path.resolve(p || '');
  return r.startsWith(WORKTREES + path.sep);
}
function writable(p) {
  const r = path.resolve(p || '');
  const reports = path.join(WATCH, 'reports');
  return (
    r === path.join(WATCH, 'state.json') ||
    r === path.join(WATCH, 'decisions.md') ||
    r.startsWith(reports + path.sep) ||
    r.startsWith(WORKTREES + path.sep)
  );
}

function decide(tool, ti) {
  if (tool === 'TodoWrite') return { ok: true, reason: 'todo state' };
  if (tool === 'Read') {
    const p = ti.file_path || ti.path || '';
    if (!p) return { ok: true, reason: 'read cwd' };
    return inRoot(p) ? { ok: true, reason: 'read repo' } : { ok: false, reason: 'read outside repo denied' };
  }
  if (tool === 'Grep' || tool === 'Glob') {
    const p = ti.path || ti.glob || '';
    if (!p) return { ok: true, reason: 'search cwd' };
    return inRoot(p) ? { ok: true, reason: 'search repo' } : { ok: false, reason: 'search outside repo denied' };
  }
  if (tool === 'Write' || tool === 'Edit' || tool === 'MultiEdit' || tool === 'NotebookEdit') {
    const p = ti.file_path || ti.notebook_path || '';
    return writable(p)
      ? { ok: true, reason: 'write allowed path' }
      : { ok: false, reason: 'write outside worktree/reports denied: ' + p };
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
  if (unquotedDanger(cmd)) return denied('redirection, heredoc or command substitution denied');
  const segs = splitCommands(cmd);
  for (const seg of segs) {
    const toks = tokens(seg);
    let i = 0;
    while (i < toks.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(toks[i])) i++;
    const c0 = toks[i];
    let args = toks.slice(i + 1);
    if (!c0) continue;

    if (c0 === 'cd') {
      const target = args[0] || '';
      if (!target || !inRoot(target)) return denied('cd outside repo denied');
      continue;
    }

    if (c0 === 'git') {
      if (args[0] === '-C') {
        if (!args[1] || !inRoot(args[1])) return denied('git -C outside repo denied');
        args = args.slice(2);
      }
      const sub = args[0];
      if (sub === 'status' || sub === 'diff' || sub === 'log' || sub === 'show' || sub === 'rev-parse') {
        return { ok: true, reason: 'git read' };
      }
      if (sub === 'add') return { ok: true, reason: 'git add' };
      if (sub === 'commit') {
        if (args.includes('--amend')) return denied('git commit --amend denied');
        return { ok: true, reason: 'git commit' };
      }
      if (sub === 'merge' || sub === 'checkout' || sub === 'switch') {
        return denied('git ' + sub + ' denied: 合并由 merge.sh 负责');
      }
      if (sub === 'push') {
        if (args.some((a) => ['--force', '-f', '--all', '--tags', '--mirror', '--delete'].includes(a))) {
          return denied('unsafe git push denied');
        }
        const rest = args.slice(1).filter((a) => !a.startsWith('-'));
        const remote = rest[0];
        const branch = rest[1];
        if (remote !== 'origin') return denied('git push remote must be origin');
        if (!branch || !branch.startsWith('upstream-watch/')) return denied('git push must target an upstream-watch/* branch');
        if (branch === 'main' || branch === 'master') return denied('push to main denied');
        return { ok: true, reason: 'git push branch' };
      }
      if (sub === 'worktree') {
        const action = args[1];
        if (!['add', 'list', 'remove'].includes(action)) return denied('git worktree action denied: ' + action);
        if (action === 'add') {
          if (args.includes('-b')) {
            const bi = args.indexOf('-b');
            const branch = args[bi + 1] || '';
            if (!branch.startsWith('upstream-watch/')) return denied('worktree branch must be upstream-watch/*');
          }
          const p = args.find((a) => a.startsWith('/'));
          if (!p || !inWorktrees(p)) return denied('worktree path must be under .agents/upstream-watch/worktrees');
        }
        if (action === 'remove') {
          const p = args.find((a) => a.startsWith('/'));
          if (!p || !inWorktrees(p)) return denied('worktree remove outside worktrees denied');
        }
        return { ok: true, reason: 'git worktree' };
      }
      if (sub === 'branch') {
        if (args[1] === '--show-current') return { ok: true, reason: 'git branch current' };
        return denied('git branch write denied');
      }
      return denied('git subcommand denied: ' + (sub || '(none)'));
    }

    if (c0 === 'npm') {
      let ni = 0;
      while (ni < args.length && args[ni].startsWith('-')) {
        if ((args[ni] === '--prefix' || args[ni] === '--cache') ) ni += 2;
        else ni += 1;
      }
      const sub = args[ni];
      if (args.some((a) => a === '--prefix')) {
        const pi = args.indexOf('--prefix');
        const pv = args[pi + 1] || ''
        if (!inRoot(pv)) return denied('npm --prefix outside repo denied');
      }
      if (args.some((a) => a === '--cache')) {
        const ci = args.indexOf('--cache');
        const cv = args[ci + 1] || '';
        if (!inWorktrees(cv)) return denied('npm cache must be inside a worktree');
      }
      if (['ci', 'install', 'update', 'run', 'test'].includes(sub)) return { ok: true, reason: 'npm ' + sub };
      return denied('npm subcommand denied: ' + (sub || '(none)'));
    }

    if (c0 === 'go') {
      let ni = 0;
      if (args[0] === '-C') {
        if (!args[1] || !inRoot(args[1])) return denied('go -C outside repo denied');
        ni = 2;
      }
      const sub = args[ni];
      if (['get', 'mod', 'test', 'vet', 'build'].includes(sub)) return { ok: true, reason: 'go ' + sub };
      return denied('go subcommand denied: ' + (sub || '(none)'));
    }

    if (['rg', 'grep', 'ls', 'jq', 'date', 'pwd'].includes(c0)) {
      for (const a of args) {
        if (a.startsWith('/') && !inRoot(a)) return denied('absolute path outside repo denied: ' + a);
      }
      return { ok: true, reason: c0 + ' read' };
    }

    if (c0 === 'mkdir') {
      const target = args.filter((a) => !a.startsWith('-')).join(' ');
      if (!target || !inWorktrees(target)) return denied('mkdir outside worktrees denied');
      return { ok: true, reason: 'mkdir worktree' };
    }

    return denied('command denied: ' + c0);
  }
  return { ok: true, reason: 'apply command' };
}

function emit(decision, reason) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: decision,
      permissionDecisionReason: 'upstream-watch apply guard: ' + reason,
    },
  }) + '\n');
}
