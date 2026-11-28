// QA ARU-184 (ARU-117 AC 1 revised, AC 7): gaps in aru184-assignment-title-once.test.tsx: the same result for the
// owner mentor and the teacher (test case 8); homework with no assignment (case 7); the rest of the card unchanged
// and no gap left where the block was (case 9); Cyrillic case-insensitive and non-breaking outer spaces count as
// "the same title"; a difference inside the title (a doubled inner space, an extra word) still shows the row.
import { act, render, screen } from '@testing-library/react-native';

import HomeworkDetailScreen from '@/app/homework/[id]';
import { LanguageProvider } from '@/i18n/LanguageProvider';
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

type Who = 'S1' | 'M' | 'T';
async function open(
  who: Who,
  homeworkTitle: string,
  assignment: HomeworkAssignment | null,
  opts: { meetings?: Meeting[]; language?: 'en' | 'ru'; checked?: boolean } = {},
) {
  params.id = 'h1';
  setStore(
    fakeStore(who, {
      currentUser: { ...users[who], language: opts.language },
      courseMembers: [member('A', 'S1')],
      meetings: opts.meetings ?? [meeting],
      assignments: assignment ? [assignment] : [],
      visibleHomework: [
        hw({
          id: 'h1',
          courseId: 'A',
          studentId: 'S1',
          assignmentId: assignment ? 'a1' : undefined,
          title: homeworkTitle,
          description: 'My answer text',
          ...(opts.checked
            ? { status: 'checked', mentorComment: 'excellent!', checkedById: 'T', checkedAt: '2026-11-05T10:00:00.000Z' }
            : {}),
        }),
      ],
    }),
  );
  const view = await render(
    <LanguageProvider>
      <HomeworkDetailScreen />
    </LanguageProvider>,
  );
  await act(async () => {});
  return view;
}

// Every text on screen, in render order.
const allText = () => screen.getAllByText(/./).map((n) => [n.props.children].flat().join(''));

beforeEach(() => jest.clearAllMocks());

describe('QA ARU-184: the title is shown once', () => {
  it.each(['S1', 'M', 'T'] as const)('case 8: %s sees the heading once and no Assignment row for equal titles', async (who) => {
    const view = await open(who, 'Homework Title', asg());
    expect(screen.getAllByText('Homework Title')).toHaveLength(1);
    expect(screen.queryByText(/^Assignment:/)).toBeNull();
    expect(screen.getByTestId('homework-assignment')).toBeTruthy();
    await view.unmount();
  });

  it.each(['S1', 'M', 'T'] as const)('case 8: %s still sees the Assignment row when the titles differ', async (who) => {
    await open(who, 'My essay', asg({ title: 'Write essay about yourself' }));
    expect(screen.getByText('Assignment: Write essay about yourself')).toBeTruthy();
  });

  it('case 7: homework with no assignment has no block, as before', async () => {
    await open('S1', 'Old homework', null);
    expect(screen.queryByTestId('homework-assignment')).toBeNull();
    expect(screen.getByText('Old homework')).toBeTruthy();
  });

  it('case 9: heading, course, author, text and feedback unchanged; the author line follows the course line when no block is left', async () => {
    await open('S1', 'Homework Title', asg({ dueAt: undefined }), { meetings: [], checked: true });
    expect(screen.queryByTestId('homework-assignment')).toBeNull();
    const texts = allText();
    const heading = texts.indexOf('Homework Title');
    const course = texts.indexOf('Algebra');
    expect(heading).toBeGreaterThanOrEqual(0);
    expect(course).toBe(heading + 1);
    // The next text after the course line is the author line, not an empty row.
    expect(texts[course + 1]).toMatch(new RegExp(`^${users.S1.name}`));
    expect(screen.getByText('My answer text')).toBeTruthy();
    expect(screen.getByText('excellent!')).toBeTruthy();
  });

  it('Russian: equal titles in different case (Cyrillic) hide «Задание: …»', async () => {
    await open('M', 'эссе о себе', asg({ title: 'ЭССЕ О СЕБЕ' }), { language: 'ru' });
    expect(screen.queryByText(/^Задание:/)).toBeNull();
    expect(screen.getByText(/^Встреча /)).toBeTruthy();
  });

  it('non-breaking and tab spaces around the title count as the same title', async () => {
    await open('S1', ' \tHomework Title ', asg());
    expect(screen.queryByText(/^Assignment:/)).toBeNull();
  });

  it('a difference inside the title still shows the row (doubled inner space, an extra word)', async () => {
    const view = await open('S1', 'Homework  Title', asg());
    expect(screen.getByText('Assignment: Homework Title')).toBeTruthy();
    await view.unmount();
    await open('S1', 'Homework Title, part 2', asg());
    expect(screen.getByText('Assignment: Homework Title')).toBeTruthy();
  });
});
