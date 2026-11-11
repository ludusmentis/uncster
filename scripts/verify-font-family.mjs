// M004/S01/T1 verification: Shrikhand fully replaced by Righteous in source.
// Exits 0 when every check passes; prints failures and exits 1 otherwise.
import { readFileSync } from 'node:fs';

const checks = [
  // Presence checks (planned replacements)
  ['src/styles/fonts.css', 'family=Righteous&display=swap', true],
  ['src/styles/fonts.css', 'family=Monoton&display=swap', true], // untouched
  ['src/styles/tokens.css', "--font-body-family: 'Righteous', cursive;", true],
  ['src/styles/base.css', 'Heading emphasis: Righteous', true],
  ['src/styles/base.css', 'body font (Righteous/17px)', true],
  ['src/components/HeroTagline.tsx', 'one-liner in Righteous', true],
  // Absence check: no stale Shrikhand anywhere in source or index.html
  ['src/styles/fonts.css', 'Shrikhand', false],
  ['src/styles/tokens.css', 'Shrikhand', false],
  ['src/styles/base.css', 'Shrikhand', false],
  ['src/components/HeroTagline.tsx', 'Shrikhand', false],
  ['index.html', 'Shrikhand', false],
];

const failures = checks
  .map(([file, needle, shouldContain]) => {
    const content = readFileSync(file, 'utf8');
    const contains = content.includes(needle);
    const ok = shouldContain ? contains : !contains;
    return ok ? null : `${file}: expected ${shouldContain ? '' : 'no '}'${needle}'`;
  })
  .filter(Boolean);

if (failures.length > 0) {
  console.error('Font-family verification FAILED:');
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log('Font-family verification passed: Righteous everywhere, no Shrikhand in source.');
