#!/usr/bin/env node
// docs-links: docs/**.md#anchor refs resolve; briefs skipped (forward-looking) → docs/workflow/comment-policy.md#rule
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = join(ROOT, 'docs');

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : p.endsWith('.md') ? [p] : [];
  });
}

function anchorsOf(text) {
  const out = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!m) continue;
    const explicit = /\{#([\w-]+)\}\s*$/.exec(m[1]);
    if (explicit) { out.add(explicit[1]); continue; }
    out.add(m[1].toLowerCase().replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-'));
  }
  return out;
}

const problems = [];
for (const file of walk(DOCS)) {
  const text = readFileSync(file, 'utf8');
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (rel.startsWith('docs/briefs/')) continue;
  const prose = text.replace(/```[\s\S]*?```/g, '');
  const refs = prose.matchAll(/(?:^|[\s(`])(docs\/[\w\-./]+\.md)(?:#([\w-]+))?/g);
  for (const [, target, anchor] of refs) {
    const abs = join(ROOT, target);
    if (!existsSync(abs)) { problems.push(`${rel}: missing target ${target}`); continue; }
    if (anchor && !anchorsOf(readFileSync(abs, 'utf8')).has(anchor)) problems.push(`${rel}: missing anchor ${target}#${anchor}`);
  }
}

if (problems.length) { console.error(problems.join('\n')); process.exit(1); }
console.log('docs links ok');
