import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import url from 'node:url';
import { buildJanitorBundle } from '../../tools/build-janitor.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
const HOST_GLOBAL = ['Silly', 'Tavern'].join('');
const HOST_MODULE = path.join(ROOT, 'src', 'host.js');
const LIFTED_ENTRY = path.join(ROOT, 'tests', 'janitor', 'fixtures', 'lifted-entry.js');
const DIST_BUNDLE = path.join(ROOT, 'dist', 'janitor-manuscript-dissolve.user.js');
const IMPORT_RE = /^import\b[\s\S]*?;\s*$/gm;
const FROM_RE = /\bfrom '([^']+)';$/;

function label(file) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

function sourcesOf(dir) {
  return fs.readdirSync(path.join(ROOT, dir))
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name: `${dir}/${name}`, text: fs.readFileSync(path.join(ROOT, dir, name), 'utf8') }));
}

function specifiersOf(file, text) {
  const found = [];
  for (const [statement] of text.matchAll(IMPORT_RE)) {
    const flat = statement.trim().replace(/\s+/g, ' ');
    const match = FROM_RE.exec(flat);
    if (match === null) throw new Error(`${label(file)}: unsupported import form: ${flat}`);
    found.push(match[1]);
  }
  return found;
}

// host-shell: a pure module may never reach src/host.js → docs/modules/host.md#host-shell
function reachedFrom(entries) {
  const reached = new Map();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop();
    if (reached.has(file)) continue;
    if (!fs.existsSync(file)) throw new Error(`unresolvable import target: ${label(file)}`);
    const text = fs.readFileSync(file, 'utf8');
    reached.set(file, text);
    for (const specifier of specifiersOf(file, text)) {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) continue;
      queue.push(path.resolve(path.dirname(file), specifier));
    }
  }
  return reached;
}

function hostViolations(entries) {
  const violations = [];
  for (const [file, text] of reachedFrom(entries)) {
    if (file === HOST_MODULE) violations.push(`${label(file)}: is the extension host door`);
    else if (text.includes(HOST_GLOBAL)) violations.push(`${label(file)}: names the extension host global`);
  }
  return violations;
}

describe('the janitor host is not the extension host', () => {
  const files = [...sourcesOf('janitor'), ...sourcesOf('tests/janitor'), ...sourcesOf('tests/janitor/fixtures')];

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('$name never names the extension host global', ({ text }) => {
    expect(text).not.toContain(HOST_GLOBAL);
  });

  it('reaches neither src/host.js nor the host global through any import', () => {
    const entries = files.map((file) => path.join(ROOT, file.name));
    expect(hostViolations(entries)).toEqual([]);
  });

  it('reports a file that does import the extension host door', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uid-isolation-'));
    const entry = path.join(dir, 'reaches-host.js');
    const specifier = path.relative(dir, HOST_MODULE).split(path.sep).join('/');
    fs.writeFileSync(entry, `import { getCtx } from '${specifier}';\nexport const ctx = getCtx;\n`, 'utf8');

    expect(hostViolations([entry])).toEqual(['src/host.js: is the extension host door']);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('fails on an import specifier it cannot resolve', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'uid-isolation-'));
    const entry = path.join(dir, 'missing-import.js');
    fs.writeFileSync(entry, "import { nothing } from './absent.js';\nexport const value = nothing;\n", 'utf8');

    expect(() => hostViolations([entry])).toThrow(/unresolvable import target/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('the bundled lifted core', () => {
  it('builds from the lifted entry without naming the extension host global', () => {
    expect(buildJanitorBundle(LIFTED_ENTRY)).not.toContain(HOST_GLOBAL);
  });

  it('is absent from the committed dist bundle too', () => {
    expect(fs.readFileSync(DIST_BUNDLE, 'utf8')).not.toContain(HOST_GLOBAL);
  });
});
