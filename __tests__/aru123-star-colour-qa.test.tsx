// QA ARU-123: gaps in aru123-star-colour.test.tsx: the colours follow a changed selection (5, then 1); one review
// reads "★ 4.0 · 1 review" / "Rated 4.0 out of 5, 1 review" with the theme ★; the Courses tab's own course card
// shows the theme ★; the summary's ★ has no label of its own (it's read with the line); no star in src is drawn in
// grey (`border` / `muted`) or amber; the Waiting homework badge keeps its amber (out of scope).
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseFeedbackScreen from '@/app/courses/[id]/feedback';
import { CourseCard } from '@/components/CourseCard';
import { colors } from '@/lib/theme';
import type { CourseFeedback, Meeting } from '@/lib/types';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const done: Meeting = {
  id: 'D',
  courseId: 'A',
  startsAt: '2026-10-20T10:00:00.000Z',
  topic: 'Intro',
  status: 'completed',
  createdById: 'M',
  createdAt: '2026-10-01T10:00:00.000Z',
};
const fb = (id: string, userId: string, rating: number): CourseFeedback => ({
  id,
  courseId: 'A',
  userId,
  rating,
  body: `Review ${id}`,
  createdAt: '2026-11-02T10:00:00.000Z',
  updatedAt: '2026-11-02T10:00:00.000Z',
});
const store = (who: 'T' | 'S1', courseFeedback: CourseFeedback[]) =>
  fakeStore(who, { courses: [courseA], courseMembers: [member('A', 'S1')], meetings: [done], courseFeedback });
const starText = (n: number) =>
  within(screen.getByRole('radio', { name: n === 1 ? '1 star' : `${n} stars` })).getByText('★');

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

it('AC1: the colours follow a changed selection (5, then 1)', async () => {
  setStore(store('S1', []));
  await render(<CourseFeedbackScreen />);
  await fireEvent.press(screen.getByRole('radio', { name: '5 stars' }));
  for (const n of [1, 2, 3, 4, 5]) expect(starText(n)).toHaveStyle({ color: colors.star });
  await fireEvent.press(screen.getByRole('radio', { name: '1 star' }));
  expect(starText(1)).toHaveStyle({ color: colors.star });
  for (const n of [2, 3, 4, 5]) expect(starText(n)).toHaveStyle({ color: colors.starEmpty });
  expect(screen.getByRole('radio', { name: '1 star' })).toBeSelected();
  expect(screen.getByRole('radio', { name: '5 stars' })).not.toBeSelected();
});

it('AC3 / AC6: one review keeps the singular text and label, with the theme ★', async () => {
  setStore(store('T', [fb('f1', 'S1', 4)]));
  await render(<CourseCard course={courseA} />);
  const line = screen.getByText('★ 4.0 · 1 review');
  expect(line).toHaveStyle({ color: colors.muted });
  expect(screen.getByLabelText('Rated 4.0 out of 5, 1 review')).toBeTruthy();
  expect(within(line).getByTestId('rating-summary-star')).toHaveStyle({ color: colors.star });
});

it('AC3: the Courses tab card shows the theme ★', async () => {
  setStore(store('T', [fb('f1', 'S1', 5), fb('f2', 'S1', 2)]));
  await render(<CoursesScreen />);
  const line = screen.getByText('★ 3.5 · 2 reviews');
  expect(within(line).getByTestId('rating-summary-star')).toHaveStyle({ color: colors.star });
});

it('AC6: the summary ★ has no label of its own, so the line is read once with its label', async () => {
  setStore(store('T', [fb('f1', 'S1', 5)]));
  await render(<CourseCard course={courseA} />);
  const star = screen.getByTestId('rating-summary-star');
  expect(star.props.accessibilityLabel).toBeUndefined();
  expect(star.props.accessible).not.toBe(true);
  expect(screen.getAllByLabelText(/^Rated /)).toHaveLength(1);
});

describe('AC5: code review of src', () => {
  const fs = jest.requireActual<{
    readFileSync: (file: string, encoding: 'utf8') => string;
    readdirSync: (dir: string, options: { recursive: true }) => string[];
  }>('fs');
  const files = fs.readdirSync('src', { recursive: true }).filter((f) => /\.tsx$/.test(f));

  it('every line that draws a ★ or stars() uses colors.star / colors.starEmpty, never border, muted or amber', () => {
    const bad: string[] = [];
    let found = 0;
    for (const f of files) {
      const lines = fs.readFileSync(`src/${f}`, 'utf8').split('\n');
      lines.forEach((l, i) => {
        // The colour sits on the same line (form) or the line before (reviews' <Text style=…>{stars(...)}).
        if (!/>★<|\{stars\(/.test(l)) return;
        found += 1;
        const near = `${lines[i - 1] ?? ''}\n${l}`;
        if (/colors\.(border|muted)|#F59E0B|warning/i.test(near) || !/colors\.star/.test(near)) bad.push(`${f}:${i + 1}`);
      });
    }
    expect(found).toBeGreaterThanOrEqual(3);
    expect(bad).toEqual([]);
  });

  it('the star colour is the theme colour; the warning colours for the Waiting badge are unchanged', () => {
    expect(colors.star).toBe(colors.primary);
    expect(colors.warning).toBe('#B45309');
    expect(colors.warningSoft).toBe('#FFFBEB');
  });
});
