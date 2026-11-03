/**
 * @jest-environment node
 */
// QA ARU-74: every migration has its own 4-digit number, the numbers have no gaps from 0022 on (0023 is ARU-48's
// open Telegram migration and may be missing), and the README names each migration file.
// Paths are relative to the repo root (Jest's working directory), as in aru58-59-keyboard-forms.test.tsx.
const fs = jest.requireActual<{
  readFileSync: (file: string, encoding: 'utf8') => string;
  readdirSync: (dir: string) => string[];
}>('fs');

const files = fs
  .readdirSync('supabase/migrations')
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();
const numberOf = (f: string) => Number(f.slice(0, 4));

it('no two migrations share a number', () => {
  const seen = new Map<number, string>();
  const clashes: string[] = [];
  for (const f of files) {
    const n = numberOf(f);
    if (seen.has(n)) clashes.push(`${seen.get(n)} / ${f}`);
    seen.set(n, f);
  }
  expect(clashes).toEqual([]);
});

it('numbers run without gaps (0023, ARU-48\'s Telegram migration, may still be on its branch)', () => {
  const numbers = files.map(numberOf);
  const missing: number[] = [];
  for (let n = numbers[0]; n <= numbers[numbers.length - 1]; n++) if (!numbers.includes(n) && n !== 23) missing.push(n);
  expect(missing).toEqual([]);
});

it('the README names every migration file (so none is forgotten when setting up)', () => {
  const readme = fs.readFileSync('README.md', 'utf8');
  const counts: [string, number][] = files.map((f) => [f, readme.split(f).length - 1]);
  expect(counts.filter(([, c]) => c === 0)).toEqual([]);
});
