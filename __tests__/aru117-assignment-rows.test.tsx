// ARU-117: on Homework details, the assignment block shows Assignment, Meeting and Due on rows of their own.
import { render, screen, within } from '@testing-library/react-native';

import HomeworkDetailScreen from '@/app/homework/[id]';
import { formatDateTime } from '@/lib/theme';
import type { HomeworkAssignment, Meeting } from '@/lib/types';

import { fakeStore, hw, member } from './helpers/fakeStore';
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
  title: 'Write essay about yourself',
  description: '',
  createdById: 'M',
  createdAt: '2026-11-03T16:00:00.000Z',
  dueAt: '2026-11-04T17:00:00.000Z',
  ...over,
});

/** The block's rows, in order, as their text. */
async function rows(assignment: HomeworkAssignment, meetings: Meeting[] = [meeting]) {
  params.id = 'h1';
  setStore(
    fakeStore('S1', {
      courseMembers: [member('A', 'S1')],
      meetings,
      assignments: [assignment],
      visibleHomework: [hw({ id: 'h1', courseId: 'A', studentId: 'S1', assignmentId: 'a1', title: 'Mine' })],
    }),
  );
  await render(<HomeworkDetailScreen />);
  const block = screen.getByTestId('homework-assignment');
  return within(block)
    .getAllByText(/./)
    .map((t) => [t.props.children].flat().join(''));
}

beforeEach(() => jest.clearAllMocks());

describe('ARU-117 assignment block on Homework details', () => {
  it('AC 1 / AC 2: three rows in order, with no " · " separator', async () => {
    const r = await rows(asg());
    expect(r).toHaveLength(3);
    expect(r[0]).toBe('Assignment: Write essay about yourself');
    expect(r[1]).toBe(`Meeting ${formatDateTime(meeting.startsAt)}`);
    expect(r[2]).toMatch(/^Due /);
    expect(r.join('\n')).not.toContain(' · ');
  });

  it('AC 3: no Meeting row (and no empty row) when the meeting is not loaded', async () => {
    const r = await rows(asg(), []);
    expect(r).toEqual(['Assignment: Write essay about yourself', expect.stringMatching(/^Due /)]);
    expect(screen.queryByTestId('homework-assignment-meeting')).toBeNull();
  });

  it('AC 4: no Due row without a deadline; only Assignment when both are missing', async () => {
    expect(await rows(asg({ dueAt: undefined }))).toEqual([
      'Assignment: Write essay about yourself',
      `Meeting ${formatDateTime(meeting.startsAt)}`,
    ]);
    expect(screen.queryByTestId('homework-assignment-due')).toBeNull();
    expect(await rows(asg({ dueAt: undefined }), [])).toEqual(['Assignment: Write essay about yourself']);
  });

  it('AC 5: a long title stays in its own row; Meeting is a separate row', async () => {
    const title = 'A very long assignment title '.repeat(5).trim();
    const r = await rows(asg({ title }));
    expect(r[0]).toBe(`Assignment: ${title}`);
    expect(r[1]).toBe(`Meeting ${formatDateTime(meeting.startsAt)}`);
  });
});
