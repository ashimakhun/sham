// ARU-184: Homework details leaves out the "Assignment: …" row when it would repeat the heading (ARU-117 AC 1 revised, AC 7).
import { act, render, screen, within } from '@testing-library/react-native';

import HomeworkDetailScreen from '@/app/homework/[id]';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { formatDateTime } from '@/lib/theme';
import type { HomeworkAssignment, Meeting } from '@/lib/types';

import { fakeStore, hw, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const meeting: Meeting = {
  id: 'C1',
  courseId: 'A',
  startsAt: '2026-11-03T15:37:00.000Z',
  topic: 'Topic',
  status: 'completed',
  createdById: 'M',
  createdAt: '2026-11-01T10:00:00.000Z',
};
const asg = (over: Partial<HomeworkAssignment> = {}): HomeworkAssignment => ({
  id: 'a1',
  courseId: 'A',
  meetingId: 'C1',
  title: 'Homework Title',
  description: '',
  createdById: 'M',
  createdAt: '2026-11-03T16:00:00.000Z',
  dueAt: '2026-11-04T17:00:00.000Z',
  ...over,
});

async function open(
  homeworkTitle: string,
  assignment: HomeworkAssignment,
  meetings: Meeting[] = [meeting],
  language?: 'en' | 'ru',
) {
  params.id = 'h1';
  setStore(
    fakeStore('S1', {
      currentUser: { ...users.S1, language },
      courseMembers: [member('A', 'S1')],
      meetings,
      assignments: [assignment],
      visibleHomework: [hw({ id: 'h1', courseId: 'A', studentId: 'S1', assignmentId: 'a1', title: homeworkTitle })],
    }),
  );
  await render(
    <LanguageProvider>
      <HomeworkDetailScreen />
    </LanguageProvider>,
  );
  await act(async () => {});
}
const blockRows = () =>
  within(screen.getByTestId('homework-assignment'))
    .getAllByText(/./)
    .map((t) => [t.props.children].flat().join(''));

beforeEach(() => jest.clearAllMocks());

describe('ARU-184 assignment title shown once', () => {
  it('equal titles: no Assignment row; Meeting and Due stay, in order', async () => {
    await open('Homework Title', asg());
    expect(screen.getAllByText('Homework Title')).toHaveLength(1);
    expect(screen.queryByText(/^Assignment:/)).toBeNull();
    const r = blockRows();
    expect(r).toEqual([`Meeting ${formatDateTime(meeting.startsAt)}`, expect.stringMatching(/^Due /)]);
  });

  it('compares after trimming and ignoring case', async () => {
    await open('  homework title ', asg());
    expect(screen.queryByText(/^Assignment:/)).toBeNull();
  });

  it('different titles: the Assignment row shows as before', async () => {
    await open('Mine', asg({ title: 'Write essay about yourself' }));
    expect(blockRows()[0]).toBe('Assignment: Write essay about yourself');
  });

  it('equal titles, no meeting and no deadline: no block at all', async () => {
    await open('Homework Title', asg({ dueAt: undefined }), []);
    expect(screen.queryByTestId('homework-assignment')).toBeNull();
  });

  it('equal titles, a deadline but no meeting: only the Due row', async () => {
    await open('Homework Title', asg(), []);
    expect(blockRows()).toEqual([expect.stringMatching(/^Due /)]);
  });

  it('Russian: no «Задание: …» row for equal titles; shown for different ones', async () => {
    await open('Homework Title', asg(), [meeting], 'ru');
    expect(screen.queryByText(/^Задание:/)).toBeNull();
    await open('Мой ответ', asg({ title: 'Эссе' }), [meeting], 'ru');
    expect(screen.getByText('Задание: Эссе')).toBeTruthy();
  });
});
