// QA ARU-90: gaps in aru90-checked-comment-preview.test.tsx: a homework checked live while Waiting is open moves to
// Checked with its comment and no badge, the preview stays on cards filtered by course (ARU-80), screen readers get
// one "Name: comment" text (not two pieces), a comment with only an emoji is shown as is, and the preview never
// carries the comment's line breaks.
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import HomeworkScreen from '@/app/(tabs)/homework';
import type { Course, Homework } from '@/lib/types';

import { courseA, courseB, fakeStore, hw, member } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const courses: Course[] = [courseA, courseB];
const members = [member('A', 'S1'), member('B', 'S1')];
const waitingA = hw({ id: 'w1', courseId: 'A', studentId: 'S1', title: 'HW A waiting' });
const checkedB = hw({ id: 'b1', courseId: 'B', studentId: 'S1', title: 'HW B checked', status: 'checked', checkedById: 'M', mentorComment: '🎉' });
const flatText = (n: unknown): string => {
  type J = { children?: (J | string)[] | null } | string | null;
  const t = (j: J): string => (!j ? '' : typeof j === 'string' ? j : (j.children ?? []).map(t).join(''));
  return t(n as J);
};
const cardOf = (title: string) => {
  let n = screen.getByText(title) as unknown as { parent: unknown; props: Record<string, unknown> } | null;
  while (n && !('onClick' in n.props) && n.props.accessibilityRole !== 'button') n = n.parent as typeof n;
  return n as never;
};

beforeEach(() => jest.clearAllMocks());

it('live: a homework checked while the list is open shows on Checked with the comment and no badge', async () => {
  setStore(fakeStore('S1', { courses, courseMembers: members, visibleHomework: [waitingA, checkedB] }));
  const view = await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText(/^Waiting/));
  expect(screen.getByText('HW A waiting')).toBeTruthy();
  const nowChecked = { ...waitingA, status: 'checked' as const, checkedById: 'M', mentorComment: 'Well done' };
  setStore(fakeStore('S1', { courses, courseMembers: members, visibleHomework: [nowChecked, checkedB] }));
  await view.rerender(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Checked'));
  const card = within(cardOf('HW A waiting'));
  expect(flatText(card.getByTestId('homework-comment-preview'))).toMatch(/: Well done$/);
  expect(card.queryByText('Checked')).toBeNull();
});

it('ARU-80: cards filtered by course keep the preview and no badge', async () => {
  const checkedA = { ...waitingA, id: 'a1', title: 'HW A checked', status: 'checked' as const, checkedById: 'M', mentorComment: 'Line one\nline two' };
  setStore(fakeStore('S1', { courses, courseMembers: members, visibleHomework: [checkedA, checkedB] }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Checked'));
  await fireEvent.press(screen.getByRole('button', { name: /^Filter by course, / }));
  await fireEvent.press(within(screen.getByTestId('course-filter-list')).getAllByRole('button')[1]); // Algebra
  expect(screen.queryByText('HW B checked')).toBeNull();
  const preview = flatText(screen.getByTestId('homework-comment-preview'));
  expect(preview).toMatch(/: Line one line two$/);
  expect(preview).not.toContain('\n');
});

it('AC 8: the name and the comment are one text node for screen readers; an emoji-only comment shows as is', async () => {
  setStore(fakeStore('S1', { courses, courseMembers: members, visibleHomework: [checkedB] }));
  await render(<HomeworkScreen />);
  await fireEvent.press(screen.getByText('Checked'));
  const preview = screen.getByTestId('homework-comment-preview');
  expect(preview.props.accessible).not.toBe(false);
  expect(preview.props.accessibilityElementsHidden).toBeFalsy();
  expect(flatText(preview)).toMatch(/^.+: 🎉$/);
});
