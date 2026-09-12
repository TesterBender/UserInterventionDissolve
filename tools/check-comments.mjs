#!/usr/bin/env node
// pointer-policy: enforces one-line comment→docs pointers → docs/workflow/comment-policy.md#rule
import { readFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.css']);
const SKIP_DIRS = ['node_modules/', 'docs/', '.claude/', 'tests/fixtures/'];

// pointer-shape: slug, ≤80-char shorthand, arrow, docs path#anchor → docs/workflow/comment-policy.md#shape
const POINTER = /^\s*(?:\/\/|\/\*)\s*([a-z0-9][a-z0-9-]*):\s(.{1,80}?)\s(?:→|->)\s(docs\/[\w\-./]+\.md)#([\w-]+)\s*(?:\*\/)?\s*$/;
const ALLOWED_PREFIXES = ['// eslint-', '// @ts-', '/* eslint-', '/* global ', '#!'];

function headingsOf(mdPath) {
  const text = readFileSync(mdPath, 'utf8');
  const anchors = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const explicit = /\{#([\w-]+)\}\s*$/.exec(m[1]);
    if (explicit) { anchors.add(explicit[1]); continue; }
    anchors.add(m[1].toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-'));
  }
  return anchors;
}

function checkFile(absPath) {
  const rel = relative(ROOT, absPath).replace(/\\/g, '/');
  if (!CODE_EXT.has(extname(absPath))) return [];
  if (SKIP_DIRS.some((d) => rel.startsWith(d))) return [];
  if (!existsSync(absPath)) return [];
  const problems = [];
  const lines = readFileSync(absPath, 'utf8').split(/\r?\n/);
  let inBlock = false;
  lines.forEach((line, i) => {
    const n = i + 1;
    const trimmed = line.trim();
    if (inBlock) {
      problems.push(`${rel}:${n} multi-line block comment is not allowed; move the prose to docs/ and leave one pointer line`);
      if (trimmed.includes('*/')) inBlock = false;
      return;
    }
    const isLineComment = trimmed.startsWith('//');
    const isBlockStart = trimmed.startsWith('/*');
    const stripped = line.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, '""').replace(/\/(?:\\.|[^/\\])+\/[gimsuy]*/g, '/re/');
    const hasTrailing = !isLineComment && !isBlockStart && /\S.*(?:\/\/|\/\*)/.test(stripped) && !/:\/\//.test(stripped);
    if (hasTrailing) {
      problems.push(`${rel}:${n} trailing comment after code is not allowed; put the pointer on its own line above`);
      return;
    }
    if (!isLineComment && !isBlockStart) return;
    if (ALLOWED_PREFIXES.some((p) => trimmed.startsWith(p))) return;
    if (isBlockStart && !trimmed.includes('*/')) {
      inBlock = true;
      problems.push(`${rel}:${n} multi-line block comment is not allowed; move the prose to docs/ and leave one pointer line`);
      return;
    }
    const m = POINTER.exec(line);
    if (!m) {
      problems.push(`${rel}:${n} comment does not match pointer shape "// slug: shorthand → docs/<file>.md#anchor"`);
      return;
    }
    const [, , , docPath, anchor] = m;
    const docAbs = resolve(ROOT, docPath);
    if (!existsSync(docAbs)) {
      problems.push(`${rel}:${n} pointer target ${docPath} does not exist`);
      return;
    }
    if (!headingsOf(docAbs).has(anchor)) {
      problems.push(`${rel}:${n} pointer anchor #${anchor} not found as a heading in ${docPath}`);
    }
  });
  return problems;
}

function main() {
  const args = process.argv.slice(2);
  let files = [];
  if (args.includes('--hook')) {
    let raw = '';
    try { raw = readFileSync(0, 'utf8'); } catch { raw = ''; }
    let payload = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { payload = {}; }
    const fp = payload?.tool_input?.file_path || payload?.tool_response?.filePath;
    if (fp) files = [resolve(fp)];
  } else {
    files = args.filter((a) => !a.startsWith('--')).map((a) => resolve(a));
  }
  const problems = files.flatMap(checkFile);
  if (problems.length === 0) {
    if (args.includes('--hook')) process.stdout.write(JSON.stringify({ suppressOutput: true }));
    process.exit(0);
  }
  const reason = `comment-policy violations:\n${problems.join('\n')}\nSee docs/workflow/comment-policy.md`;
  if (args.includes('--hook')) {
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
    process.exit(0);
  }
  process.stderr.write(reason + '\n');
  process.exit(1);
}

main();
