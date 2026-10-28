import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

/** Components must size text through the scale (`text-[length:calc(Npx_*_var(--fs,1))]`, `text-sm`, ...), not a bare px value. */
const ALLOWED = new Set(['AppearanceSettingsModal.tsx']); // the size picker's own labels stay fixed on purpose

function tsxFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? tsxFiles(full) : entry.name.endsWith('.tsx') ? [full] : [];
  });
}

test('no component hardcodes a pixel text size outside the font-size scale', () => {
  const offenders = tsxFiles('src')
    .filter((file) => !ALLOWED.has(path.basename(file)))
    .filter((file) => /(^|[\s"'`:])text-\[\d+(\.\d+)?px\]/.test(fs.readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});
