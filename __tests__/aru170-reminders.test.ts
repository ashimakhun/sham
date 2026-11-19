// ARU-170: what the phone schedules (src/lib/reminders.ts), per criterion: meeting started (AC 5-6), homework due
// soon (AC 7-8), photo deletion (AC 10-11), the 60 cap (AC 4) and the language (AC 14). Pure: no native module.
import en from '@/i18n/en.json';
import notes from '@/i18n/notes.json';
import ru from '@/i18n/ru.json';
import { notificationSwitchesFor } from '@/lib/notificationSwitches';
import { DUE_SOON_MS, localNineOn, MAX_REMINDERS, type ReminderInput, remindersFor, reminderSignature } from '@/lib/reminders';
import type { Course, Homework, HomeworkAssignment, Meeting } from '@/lib/types';

const NOW = new Date('2027-03-10T12:00:00Z');
const H = 60 * 60 * 1000;
const at = (ms: number) => new Date(NOW.getTime() + ms).toISOString();

const course = (id: string, owner = 'OWNER', title = `Course ${id}`): Course => ({
  id,
  title,
  description: '',
  createdById: owner,
  createdAt: '2026-01-01T00:00:00Z',
});
const meeting = (id: string, courseId: string, startsAt: string, status: Meeting['status'] = 'scheduled'): Meeting => ({
  id,
  courseId,
  startsAt,
  topic: '',
  status,
  createdById: 'OWNER',
  createdAt: '2026-01-01T00:00:00Z',
});
const assignment = (id: string, courseId: string, dueAt?: string, title = `Task ${id}`): HomeworkAssignment => ({
  id,
  meetingId: 'm',
  courseId,
  title,
  description: '',
  dueAt,
  createdById: 'OWNER',
  createdAt: '2026-01-01T00:00:00Z',
});
const hw = (id: string, over: Partial<Homework> = {}): Homework => ({
  id,
  studentId: 'S',
  courseId: 'A',
  title: '',
  description: '',
  status: 'checked',
  createdAt: '2026-01-01T00:00:00Z',
  ...over,
});

function input(over: Partial<ReminderInput> = {}): ReminderInput {
  return {
    userId: 'S',
    role: 'student',
    settings: {},
    courses: [course('A', 'OWNER', 'Algebra'), course('B', 'OWNER', 'Biology'), course('MINE', 'S', 'Own course')],
    courseMembers: [
      { courseId: 'A', userId: 'S', addedById: 'OWNER', addedAt: '' },
      { courseId: 'MINE', userId: 'S', addedById: 'S', addedAt: '' },
      { courseId: 'B', userId: 'OTHER', addedById: 'OWNER', addedAt: '' },
    ],
    meetings: [],
    assignments: [],
    homework: [],
    photoDeletionStart: null,
    now: NOW,
    lang: 'en',
    ...over,
  };
}
const ids = (i: ReminderInput) => remindersFor(i).map((r) => r.id);

describe('AC 5-6: meeting started', () => {
  it('a listener gets one reminder at the start time of a Scheduled future meeting, with today\'s text', () => {
    const list = remindersFor(input({ meetings: [meeting('m1', 'A', at(2 * H))] }));
    expect(list).toEqual([
      { id: 'sham-reminder:meeting:m1', fireAt: NOW.getTime() + 2 * H, body: 'Algebra meeting has started' },
    ]);
  });

  it('Russian text when the app is in Russian (AC 14)', () => {
    expect(remindersFor(input({ lang: 'ru', meetings: [meeting('m1', 'A', at(H))] }))[0].body).toBe(
      'Встреча курса Algebra началась',
    );
  });

  it.each([
    ['a past start', meeting('m', 'A', at(-1000))],
    ['a start right now', meeting('m', 'A', at(0))],
    ['a canceled meeting', meeting('m', 'A', at(H), 'canceled')],
    ['a completed meeting', meeting('m', 'A', at(H), 'completed')],
    ['a course I don\'t listen to', meeting('m', 'B', at(H))],
    ['a course I own (even as a member)', meeting('m', 'MINE', at(H))],
    ['a course I can\'t see', meeting('m', 'GONE', at(H))],
  ])('nothing for %s', (_, m) => {
    expect(remindersFor(input({ meetings: [m] }))).toEqual([]);
  });

  it('nothing with the Meeting started switch off', () => {
    expect(remindersFor(input({ settings: { meeting_started: false }, meetings: [meeting('m', 'A', at(H))] }))).toEqual([]);
  });

  it('the teacher gets none, even as a member', () => {
    const i = input({
      userId: 'T',
      role: 'teacher',
      courseMembers: [{ courseId: 'A', userId: 'T', addedById: 'OWNER', addedAt: '' }],
      meetings: [meeting('m', 'A', at(H))],
    });
    expect(remindersFor(i)).toEqual([]);
  });

  it('a mentor gets them only for the course they listen to, not the one they own', () => {
    const i = input({
      userId: 'M',
      role: 'mentor',
      courses: [course('OWN', 'M'), course('A', 'OWNER', 'Algebra')],
      courseMembers: [{ courseId: 'A', userId: 'M', addedById: 'OWNER', addedAt: '' }],
      meetings: [meeting('m1', 'OWN', at(H)), meeting('m2', 'A', at(H))],
    });
    expect(ids(i)).toEqual(['sham-reminder:meeting:m2']);
  });

  it('AC 6: a moved meeting moves the reminder (same id, new time); leaving the course removes it', () => {
    const before = remindersFor(input({ meetings: [meeting('m1', 'A', at(2 * H))] }));
    const after = remindersFor(input({ meetings: [meeting('m1', 'A', at(5 * H))] }));
    expect(after[0].id).toBe(before[0].id);
    expect(after[0].fireAt).toBe(NOW.getTime() + 5 * H);
    expect(reminderSignature(after)).not.toBe(reminderSignature(before));
    expect(remindersFor(input({ courseMembers: [], meetings: [meeting('m1', 'A', at(2 * H))] }))).toEqual([]);
  });
});

describe('AC 7-8: homework due soon', () => {
  it('fires 24 hours before the due time when more than 24 hours are left', () => {
    const list = remindersFor(input({ assignments: [assignment('a1', 'A', at(30 * H), 'Fractions')] }));
    expect(list).toEqual([
      {
        id: 'sham-reminder:due:a1',
        fireAt: NOW.getTime() + 6 * H,
        body: 'Homework in Algebra is due in 24 hours: Fractions',
      },
    ]);
    expect(DUE_SOON_MS).toBe(24 * H);
  });

  it('Russian text (AC 14)', () => {
    expect(remindersFor(input({ lang: 'ru', assignments: [assignment('a1', 'A', at(30 * H), 'Дроби')] }))[0].body).toBe(
      'Через 24 часа срок сдачи домашнего задания по курсу Algebra: Дроби',
    );
  });

  it.each([
    ['exactly 24 hours left', assignment('a', 'A', at(24 * H))],
    ['less than 24 hours left', assignment('a', 'A', at(23 * H))],
    ['a past due time', assignment('a', 'A', at(-H))],
    ['no due time', assignment('a', 'A', undefined)],
    ['a course I don\'t listen to', assignment('a', 'B', at(48 * H))],
    ['a course I own', assignment('a', 'MINE', at(48 * H))],
  ])('nothing for %s', (_, a) => {
    expect(remindersFor(input({ assignments: [a] }))).toEqual([]);
  });

  it.each([['submitted' as const], ['checked' as const]])('nothing once I sent homework for it (%s)', (status) => {
    const i = input({ assignments: [assignment('a1', 'A', at(48 * H))], homework: [hw('h', { assignmentId: 'a1', status })] });
    expect(remindersFor(i)).toEqual([]);
  });

  it('someone else\'s homework for it doesn\'t count', () => {
    const i = input({
      assignments: [assignment('a1', 'A', at(48 * H))],
      homework: [hw('h', { assignmentId: 'a1', studentId: 'OTHER' })],
    });
    expect(ids(i)).toEqual(['sham-reminder:due:a1']);
  });

  it('nothing with the Homework due soon switch off; the other switches don\'t matter', () => {
    const a = [assignment('a1', 'A', at(48 * H))];
    expect(remindersFor(input({ settings: { homework_due: false }, assignments: a }))).toEqual([]);
    expect(ids(input({ settings: { new_homework: false, meeting_started: false }, assignments: a }))).toEqual([
      'sham-reminder:due:a1',
    ]);
  });

  it('AC 8: a changed due time moves the reminder', () => {
    const list = remindersFor(input({ assignments: [assignment('a1', 'A', at(72 * H))] }));
    expect(list[0]).toMatchObject({ id: 'sham-reminder:due:a1', fireAt: NOW.getTime() + 48 * H });
  });
});

describe('AC 10-11: photo deletion', () => {
  const START = '2027-01-01';
  // Checked 2026-10-20 → deletion date 2027-04-20 (6 months); marks 2027-03-21 (30 days) and 2027-04-13 (7 days).
  const photo = (id: string, checkedAt = '2026-10-20T10:00:00Z', over: Partial<Homework> = {}) =>
    hw(id, { photoPath: `S/${id}.jpg`, checkedAt, ...over });

  it('09:00 phone time on the day 30 and the day 7 days before the deletion date', () => {
    const list = remindersFor(input({ photoDeletionStart: START, homework: [photo('h1')] }));
    expect(list).toEqual([
      {
        id: 'sham-reminder:photos:2027-03-21',
        fireAt: new Date(2027, 2, 21, 9, 0, 0).getTime(),
        body: '1 homework photo will be deleted on 20 Apr 2027. Open Sham → Homework to download them.',
      },
      {
        id: 'sham-reminder:photos:2027-04-13',
        fireAt: new Date(2027, 3, 13, 9, 0, 0).getTime(),
        body: '1 homework photo will be deleted on 20 Apr 2027. Open Sham → Homework to download them.',
      },
    ]);
  });

  it('photos whose marks fall on the same day share one reminder, with the count and the earliest date', () => {
    // h2 is deleted 2027-05-13: its 30-day mark (2027-04-13) is h1's and h3's 7-day mark day.
    const list = remindersFor(
      input({ photoDeletionStart: START, homework: [photo('h1'), photo('h2', '2026-11-13T10:00:00Z'), photo('h3')] }),
    );
    const byId = Object.fromEntries(list.map((r) => [r.id, r.body]));
    expect(byId['sham-reminder:photos:2027-03-21']).toBe(
      '2 homework photos will be deleted on 20 Apr 2027. Open Sham → Homework to download them.',
    );
    expect(byId['sham-reminder:photos:2027-04-13']).toBe(
      '3 homework photos will be deleted on 20 Apr 2027. Open Sham → Homework to download them.',
    );
  });

  it.each([
    [1, '1 фотография домашнего задания будет удалена 20 апреля 2027. Откройте Sham → Задания, чтобы скачать её.'],
    [2, '2 фотографии домашних заданий будут удалены 20 апреля 2027. Откройте Sham → Задания, чтобы скачать их.'],
    [5, '5 фотографий домашних заданий будут удалены 20 апреля 2027. Откройте Sham → Задания, чтобы скачать их.'],
    [21, '21 фотография домашнего задания будет удалена 20 апреля 2027. Откройте Sham → Задания, чтобы скачать её.'],
  ])('Russian plural forms (AC 14): %i', (n, text) => {
    const homework = Array.from({ length: n }, (_, i) => photo(`h${i}`));
    expect(remindersFor(input({ lang: 'ru', photoDeletionStart: START, homework }))[0].body).toBe(text);
  });

  it('a mark whose 09:00 has passed gets none; the later mark still does', () => {
    const now = new Date(2027, 2, 21, 9, 0, 0); // exactly 09:00 on the 30-day mark
    expect(ids(input({ now, photoDeletionStart: START, homework: [photo('h1')] }))).toEqual(['sham-reminder:photos:2027-04-13']);
    const before = new Date(2027, 2, 21, 8, 59, 0);
    expect(ids(input({ now: before, photoDeletionStart: START, homework: [photo('h1')] }))).toHaveLength(2);
  });

  it('the deletion start date moves the deletion date (never before it)', () => {
    const list = remindersFor(input({ photoDeletionStart: '2027-05-01', homework: [photo('h1')] }));
    expect(list.map((r) => r.id)).toEqual(['sham-reminder:photos:2027-04-01', 'sham-reminder:photos:2027-04-24']);
    expect(list[0].body).toContain('1 May 2027');
  });

  it.each([
    ['an empty start date', { photoDeletionStart: null }],
    ['the switch off', { settings: { photo_deletion: false } }],
    ['someone else\'s photo', { homework: [photo('h1', undefined, { studentId: 'OTHER' })] }],
    ['a removed photo (AC 11)', { homework: [photo('h1', undefined, { photoPath: undefined, photoRemovedAt: '2027-03-01' })] }],
    ['homework without a photo', { homework: [hw('h1', { checkedAt: '2026-10-20T10:00:00Z' })] }],
    ['an unchecked photo', { homework: [photo('h1', undefined, { checkedAt: undefined, status: 'submitted' })] }],
    ['deleted homework (AC 11)', { homework: [] }],
  ] as [string, Partial<ReminderInput>][])('nothing for %s', (_, over) => {
    expect(remindersFor(input({ photoDeletionStart: START, homework: [photo('h1')], ...over }))).toEqual([]);
  });

  it('localNineOn is 09:00 on that calendar day in the phone\'s time zone', () => {
    const d = new Date(localNineOn('2027-03-21'));
    expect([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2027, 2, 21, 9, 0]);
  });
});

describe('AC 4: at most 60, the soonest', () => {
  it('70 candidates give the 60 soonest, in time order', () => {
    const meetings = Array.from({ length: 70 }, (_, i) => meeting(`m${String(i).padStart(2, '0')}`, 'A', at((70 - i) * H)));
    const list = remindersFor(input({ meetings }));
    expect(MAX_REMINDERS).toBe(60);
    expect(list).toHaveLength(60);
    expect(list[0].fireAt).toBe(NOW.getTime() + H);
    expect(list[59].fireAt).toBe(NOW.getTime() + 60 * H);
    expect(list.every((r, i) => i === 0 || r.fireAt >= list[i - 1].fireAt)).toBe(true);
  });

  it('kinds are mixed by time', () => {
    const list = remindersFor(
      input({ meetings: [meeting('m1', 'A', at(10 * H))], assignments: [assignment('a1', 'A', at(26 * H))] }),
    );
    expect(list.map((r) => r.id)).toEqual(['sham-reminder:due:a1', 'sham-reminder:meeting:m1']);
  });
});

describe('AC 9 / AC 14: the switch and the catalog', () => {
  it('Homework due soon comes right after New homework for students and mentors, not for the teacher', () => {
    expect(notificationSwitchesFor('student', 'en').map((s) => s.label).slice(0, 3)).toEqual([
      'Meeting started',
      'New homework',
      'Homework due soon',
    ]);
    expect(notificationSwitchesFor('mentor', 'en').map((s) => s.kind).slice(0, 3)).toEqual([
      'meeting_started',
      'new_homework',
      'homework_due',
    ]);
    expect(notificationSwitchesFor('teacher', 'en').map((s) => s.kind)).not.toContain('homework_due');
    expect(notificationSwitchesFor('student', 'ru')[2].label).toBe('Скоро срок сдачи домашнего задания');
  });

  it.each([
    'notifications.switch.homework_due',
    'reminders.meetingStarted',
    'reminders.homeworkDue',
    'reminders.photoDeletion_one',
    'reminders.photoDeletion_few',
    'reminders.photoDeletion_many',
    'reminders.photoDeletion_other',
  ])('%s has English, Russian and a note', (id) => {
    expect((en as Record<string, string>)[id]).toBeTruthy();
    expect((ru as Record<string, string>)[id]).toMatch(/[а-яё]/i);
    expect((notes as Record<string, string>)[id]).toMatch(/ · /);
  });
});
