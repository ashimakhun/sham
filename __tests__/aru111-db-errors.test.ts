/**
 * @jest-environment node
 */
// ARU-111 (Russian version, part 5): database errors in the user's language. Every sham: code the migrations raise has
// a catalog text (AC 7); English shows the server's message unchanged (AC 2, AC 6); Russian shows the code's text with
// its values (AC 2, AC 3), and an unknown code or none falls back to "no access" (42501) or the generic text (AC 4, 5).
import { dbErrorMessage } from '@/i18n';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';

// Paths are relative to the repo root (Jest's working directory), as in aru74-migration-numbers-qa.test.ts.
const fs = jest.requireActual<{
  readdirSync: (dir: string) => string[];
  readFileSync: (file: string, encoding: 'utf8') => string;
}>('fs');

const dir = 'supabase/migrations';
const sql = fs
  .readdirSync(dir)
  .filter((f: string) => f.endsWith('.sql'))
  .map((f: string) => fs.readFileSync(`${dir}/${f}`, 'utf8'))
  .join('\n');
const codes = [...new Set([...sql.matchAll(/'sham:([a-z0-9_]+)'/g)].map((m) => m[1]))];

describe('AC 7: every code has a catalog text', () => {
  it('the migrations raise codes', () => {
    expect(codes.length).toBeGreaterThanOrEqual(60);
  });
  it.each(codes)('db.%s has English and Russian', (code) => {
    const has = (catalog: Record<string, string>) => !!(catalog[`db.${code}`] || catalog[`db.${code}_one`]);
    expect(has(en)).toBe(true);
    expect(has(ru)).toBe(true);
  });
});

describe('AC 2 / AC 6: English shows the server message unchanged', () => {
  it.each([
    [{ message: 'Only the teacher can delete a course.', code: '42501', hint: 'sham:only_teacher_delete_course' }],
    [{ message: 'Mentor Max owns 2 course(s): A, B. Reassign them first', code: '23514', hint: 'sham:owner_owns_courses_titles' }],
    [{ message: 'new row violates row-level security policy for table "courses"', code: '42501' }],
    [{ message: 'Something new', hint: 'sham:does_not_exist' }],
  ])('%j', (error) => {
    expect(dbErrorMessage(error, 'en')).toBe(error.message);
  });
});

describe('AC 2 / AC 3: Russian', () => {
  it('a known code', () => {
    expect(dbErrorMessage({ message: 'Attendance can be marked once the meeting has started.', code: '23514', hint: 'sham:attendance_not_started' }, 'ru')).toBe(
      'Посещаемость можно отметить, когда встреча началась.',
    );
    expect(dbErrorMessage({ message: 'This meeting already has homework.', code: '23505', hint: 'sham:meeting_has_homework' }, 'ru')).toBe(
      'У этой встречи уже есть домашнее задание.',
    );
  });

  it.each([
    [1, 'Mentor Max — куратор 1 курса: Алгебра. Сначала смените куратора'],
    [2, 'Mentor Max — куратор 2 курсов: Алгебра. Сначала смените куратора'],
    [5, 'Mentor Max — куратор 5 курсов: Алгебра. Сначала смените куратора'],
    [21, 'Mentor Max — куратор 21 курса: Алгебра. Сначала смените куратора'],
  ])('owner with %i course(s): values in place, names as typed', (count, text) => {
    const details = JSON.stringify({ name: 'Mentor Max', count, titles: 'Алгебра' });
    expect(dbErrorMessage({ message: 'x', code: '23514', hint: 'sham:owner_owns_courses_titles', details }, 'ru')).toBe(text);
  });

  it('a status word is translated', () => {
    const details = JSON.stringify({ status: 'completed' });
    expect(dbErrorMessage({ message: 'x', code: '23514', hint: 'sham:meeting_already_status', details }, 'ru')).toBe(
      'Эта встреча уже завершена, её статус нельзя изменить.',
    );
    expect(dbErrorMessage({ message: 'x', hint: 'sham:meeting_already_edit', details: '{"status":"canceled"}' }, 'ru')).toBe(
      'Эта встреча уже отменена, её нельзя изменить.',
    );
  });

  it('"Accept <name> first." keeps the name', () => {
    expect(dbErrorMessage({ message: 'x', hint: 'sham:accept_first', details: '{"name":"Анна"}' }, 'ru')).toBe('Сначала примите Анна.');
  });

  it('bad details still give the text', () => {
    expect(dbErrorMessage({ message: 'x', hint: 'sham:accept_first', details: 'not json' }, 'ru')).toMatch(/^Сначала примите/);
  });
});

describe('AC 4 / AC 5: unknown code or none (Russian)', () => {
  it('an unknown code: the generic text, never the raw code', () => {
    const text = dbErrorMessage({ message: 'Something new', code: '23514', hint: 'sham:does_not_exist' }, 'ru');
    expect(text).toBe('Что-то пошло не так. Попробуйте снова.');
    expect(text).not.toMatch(/sham|does_not_exist/);
  });
  it('an access refusal without a code', () => {
    expect(dbErrorMessage({ message: 'new row violates row-level security policy', code: '42501' }, 'ru')).toBe('Нет доступа к этому действию.');
  });
  it.each(['23514', '23503', undefined])('%s without a code: the generic text', (code) => {
    expect(dbErrorMessage({ message: 'violates check constraint', code }, 'ru')).toBe('Что-то пошло не так. Попробуйте снова.');
  });
});
