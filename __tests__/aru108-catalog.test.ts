/**
 * @jest-environment node
 */
// ARU-108 AC 1: the catalog check. en.json, ru.json and notes.json have exactly the same text IDs; no text, Russian
// text or note is empty; a text's {placeholders} are the same in both languages; plural IDs come with every form
// their language needs. Fails `npm test` (and CI) when any of this breaks. checkCatalog() is also tested on broken
// catalogs so the check itself can't silently pass.
import en from '@/i18n/en.json';
import notes from '@/i18n/notes.json';
import ru from '@/i18n/ru.json';

type Catalog = Record<string, string>;

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const PLURAL = /_(one|few|many|other)$/;

export function checkCatalog(enC: Catalog, ruC: Catalog, notesC: Catalog): string[] {
  const problems: string[] = [];
  const all = new Set([...Object.keys(enC), ...Object.keys(ruC), ...Object.keys(notesC)]);
  for (const id of all) {
    if (!(id in enC)) problems.push(`${id}: missing in en.json`);
    if (!(id in ruC)) problems.push(`${id}: missing in ru.json`);
    if (!(id in notesC)) problems.push(`${id}: missing in notes.json`);
    if (id in enC && !enC[id].trim()) problems.push(`${id}: empty English text`);
    if (id in ruC && !ruC[id].trim()) problems.push(`${id}: empty Russian text`);
    if (id in notesC && !notesC[id].trim()) problems.push(`${id}: empty note`);
    if (id in enC && id in ruC && placeholders(enC[id]) !== placeholders(ruC[id])) {
      problems.push(`${id}: placeholders differ ({${placeholders(enC[id])}} vs {${placeholders(ruC[id])}})`);
    }
  }
  const bases = new Set([...all].filter((id) => PLURAL.test(id)).map((id) => id.replace(PLURAL, '')));
  for (const base of bases) {
    for (const form of ['one', 'few', 'many', 'other']) {
      if (!(`${base}_${form}` in ruC) && form !== 'other') problems.push(`${base}: Russian plural form "${form}" missing`);
      if (!(`${base}_${form}` in enC) && (form === 'one' || form === 'other')) {
        problems.push(`${base}: English plural form "${form}" missing`);
      }
    }
  }
  return problems;
}

it('the shipped catalog passes', () => {
  expect(checkCatalog(en, ru, notes)).toEqual([]);
});

it('every catalog has the same number of texts and a note says where each text appears', () => {
  expect(Object.keys(ru).length).toBe(Object.keys(en).length);
  expect(Object.keys(notes).length).toBe(Object.keys(en).length);
  for (const note of Object.values(notes)) expect(note).toMatch(/ · /);
});

describe('the check catches', () => {
  const base = { 'a.b': 'Hi {name}' };
  it.each([
    ['an ID missing from ru', base, {}, base, 'a.b: missing in ru.json'],
    ['an ID missing from en', {}, base, base, 'a.b: missing in en.json'],
    ['an ID without a note', base, { 'a.b': 'Привет {name}' }, {}, 'a.b: missing in notes.json'],
    ['an empty Russian text', base, { 'a.b': ' ' }, base, 'a.b: empty Russian text'],
    ['an empty note', base, { 'a.b': 'Привет {name}' }, { 'a.b': '' }, 'a.b: empty note'],
    ['different placeholders', base, { 'a.b': 'Привет {nmae}' }, base, 'a.b: placeholders differ ({name} vs {nmae})'],
    [
      'a missing Russian plural form',
      { 'x_one': '1', 'x_other': 'n' },
      { 'x_one': '1', 'x_many': 'n', 'x_other': 'n' },
      { 'x_one': 'n', 'x_other': 'n', 'x_few': 'n', 'x_many': 'n' },
      'x: Russian plural form "few" missing',
    ],
  ])('%s', (_l, e, r, n, problem) => {
    expect(checkCatalog(e as Catalog, r as Catalog, n as Catalog)).toContain(problem);
  });
});
