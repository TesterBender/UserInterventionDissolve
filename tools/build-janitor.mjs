#!/usr/bin/env node
// janitor-bundle: no-dependency concatenator for the userscript host → docs/modules/janitor-build.md#why-a-hand-written-concatenator
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'janitor', 'main.js');
const OUT_FILE = join(ROOT, 'dist', 'janitor-manuscript-dissolve.user.js');

const IMPORT_RE = /^import\b[\s\S]*?;\s*$/gm;
const NAMED_IMPORT_RE = /^import\s*\{([^}]*)\}\s*from\s*'([^']+)'\s*;$/;
const EXPORT_DECL_RE = /^export\s+(?=(?:async\s+function|function|const|let|class)\b)/;
const TOP_LEVEL_NAME_RE = /^(?:async\s+function|function|const|let|var|class)\s+([A-Za-z0-9_$]+)/;

function fail(file, line, message) {
  const where = line == null ? file : `${file}:${line}`;
  throw new Error(`build-janitor: ${where}: ${message}`);
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

function underAnyRoot(path, roots) {
  return roots.some((root) => {
    const rel = relative(root, path);
    return rel !== '' && !rel.startsWith('..') && !rel.startsWith(`..${sep}`);
  });
}

// shared-private-helper: identical helpers may repeat, anything else collides → docs/modules/janitor-build.md#duplicate-top-level-names
function functionText(body, start) {
  const open = body.indexOf('{', start);
  if (open < 0) return body.slice(start);
  let depth = 0;
  for (let i = open; i < body.length; i += 1) {
    if (body[i] === '{') depth += 1;
    else if (body[i] === '}') {
      depth -= 1;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return body.slice(start);
}

// resolve-relative-only: no node_modules, no maps, no bare names → docs/modules/janitor-build.md#supported-module-syntax
function parseModule(absPath, roots) {
  const label = relative(ROOT, absPath).split(sep).join('/');
  const source = readFileSync(absPath, 'utf8');

  const dynamic = /\bimport\s*\(/.exec(source);
  if (dynamic) fail(label, lineOf(source, dynamic.index), 'dynamic import() is not supported');

  const imports = [];
  const stripped = source.replace(IMPORT_RE, (statement, index) => {
    const line = lineOf(source, index);
    const flat = statement.trim().replace(/\s+/g, ' ');
    const named = NAMED_IMPORT_RE.exec(flat);
    if (!named) fail(label, line, `unsupported import form: ${flat}`);
    if (/\bas\b/.test(named[1])) fail(label, line, `renamed import is not supported: ${flat}`);
    const specifier = named[2];
    if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
      fail(label, line, `specifier must be relative: ${specifier}`);
    }
    const target = resolve(dirname(absPath), specifier);
    if (!underAnyRoot(target, roots)) {
      fail(label, line, `import leaves the bundled roots: ${specifier}`);
    }
    imports.push(target);
    return '';
  });

  const body = stripped
    .split('\n')
    .map((text, i) => {
      if (!/^export\b/.test(text)) return text;
      if (!EXPORT_DECL_RE.test(text)) {
        fail(label, i + 1, `unsupported export form: ${text.trim()}`);
      }
      return text.replace(EXPORT_DECL_RE, '');
    })
    .join('\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '\n');

  const declarations = [];
  let cursor = 0;
  for (const text of body.split('\n')) {
    const match = TOP_LEVEL_NAME_RE.exec(text);
    if (match) {
      const isFunction = /^(?:async\s+)?function\b/.test(text);
      declarations.push({
        name: match[1],
        isFunction,
        text: isFunction ? functionText(body, cursor) : text,
      });
    }
    cursor += text.length + 1;
  }

  return { path: absPath, label, imports, body, declarations };
}

// post-order-graph: dependency before dependent, cycles rejected → docs/modules/janitor-build.md#bundle-shape
function collectModules(entry, roots) {
  const modules = [];
  const done = new Map();
  const stack = [];

  const visit = (absPath) => {
    if (done.has(absPath)) return;
    if (stack.includes(absPath)) {
      const cycle = [...stack.slice(stack.indexOf(absPath)), absPath]
        .map((p) => relative(ROOT, p).split(sep).join('/'))
        .join(' -> ');
      fail(relative(ROOT, absPath).split(sep).join('/'), null, `import cycle: ${cycle}`);
    }
    stack.push(absPath);
    const module = parseModule(absPath, roots);
    for (const dependency of module.imports) visit(dependency);
    stack.pop();
    done.set(absPath, module);
    modules.push(module);
  };

  visit(entry);

  const owners = new Map();
  for (const module of modules) {
    for (const declaration of module.declarations) {
      const owner = owners.get(declaration.name);
      if (owner && !(owner.isFunction && declaration.isFunction && owner.text === declaration.text)) {
        fail(module.label, null, `top-level name '${declaration.name}' is already declared by ${owner.label}`);
      }
      if (!owner) owners.set(declaration.name, { ...declaration, label: module.label });
    }
  }

  return modules;
}

function header(version) {
  return [
    '// ==UserScript==',
    '// @name         Janitor Manuscript Dissolve',
    '// @namespace    http://tampermonkey.net/',
    `// @version      ${version}`,
    '// @description  Carries the User Intervention Dissolve protocol onto JanitorAI proxy requests: one continuous manuscript, hidden interaction boundaries.',
    '// @match        https://janitorai.com/*',
    '// @match        https://*.janitorai.com/*',
    '// @grant        none',
    '// @run-at       document-start',
    '// @sandbox      raw',
    '// ==/UserScript==',
  ].join('\n');
}

// generated-never-edited: regenerate with npm run build:janitor → docs/modules/janitor-build.md#dist-is-a-build-product
export function buildJanitorBundle(entry = ENTRY) {
  const entryPath = resolve(entry);
  const roots = [join(ROOT, 'janitor'), join(ROOT, 'src'), dirname(entryPath)];
  const modules = collectModules(entryPath, roots);
  const { version } = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

  // literals-verbatim: bodies are copied, never rewritten → docs/modules/janitor-build.md#what-the-build-must-never-do
  const bodies = modules.map((module) => `// ---- ${module.label} ----\n${module.body}`).join('\n');

  return [
    header(version),
    '',
    '// Generated by `npm run build:janitor` from janitor/ and src/. Do not edit by hand.',
    '',
    '(function () {',
    "'use strict';",
    '',
    bodies,
    '})();',
    '',
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const bundle = buildJanitorBundle();
    mkdirSync(dirname(OUT_FILE), { recursive: true });
    writeFileSync(OUT_FILE, bundle, 'utf8');
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
