#!/usr/bin/env node
// pinned-swap: replace a pinned template-literal constant and its test copy from a scratch file → docs/workflow/workflow.md#pinned-string-lane
import { readFileSync, writeFileSync } from 'node:fs';
const BS = String.fromCharCode(92), BT = String.fromCharCode(96);
const raw = readFileSync(process.env.TEMP + '/newprompt.txt', 'utf8');
const esc = raw.split(BS).join(BS + BS).split(BT).join(BS + BT).split('${').join(BS + '${');
const words = (raw.match(/[A-Za-z'’]+/g) || []).length;
function swap(file, marker) {
  let s = readFileSync(file, 'utf8');
  const start = s.indexOf(marker);
  if (start < 0) throw new Error('start not found in ' + file);
  const litStart = s.indexOf(BT, start);
  let i = litStart + 1, end = -1;
  while (i < s.length) { if (s[i] === BS) { i += 2; continue; } if (s[i] === BT) { end = i; break; } i++; }
  if (end < 0) throw new Error('end not found in ' + file);
  s = s.slice(0, litStart + 1) + esc + s.slice(end);
  writeFileSync(file, s);
}
swap('src/prompt.js', 'export const MANUSCRIPT_SYSTEM_PROMPT = ');
swap('tests/prompt.test.js', 'const EXPECTED_PROMPT = ');
let t = readFileSync('tests/prompt.test.js', 'utf8');
t = t.replace(/(match\(\/\[A-Za-z'’\]\+\/g\)\)\.toHaveLength\()\d+\)/, '$1' + words + ')');
writeFileSync('tests/prompt.test.js', t);
console.log('words:', words);
