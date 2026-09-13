import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '../..');
const HOST_GLOBAL = ['Silly', 'Tavern'].join('');
const CORE_IMPORT = /from\s+'[^']*\/src\//;

function sourcesOf(dir) {
  return fs.readdirSync(path.join(ROOT, dir))
    .filter((name) => name.endsWith('.js'))
    .map((name) => ({ name: `${dir}/${name}`, text: fs.readFileSync(path.join(ROOT, dir, name), 'utf8') }));
}

describe('the janitor host is not the extension host', () => {
  const files = [...sourcesOf('janitor'), ...sourcesOf('tests/janitor'), ...sourcesOf('tests/janitor/fixtures')];

  it('has files to check', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('$name imports nothing from src/ and never names the extension host global', ({ text }) => {
    expect(text).not.toMatch(CORE_IMPORT);
    expect(text).not.toContain(HOST_GLOBAL);
  });
});
