// ARU-123: rating stars use the theme colour (colors.star = colors.primary) everywhere: the form, each review and the
// "★ 4.3 · 6 reviews" summaries. The summary text, sizes and screen reader labels don't change.
import { fireEvent, render, screen, within } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import CourseFeedbackScreen from '@/app/courses/[id]/feedback';
import DisciplineScreen from '@/app/disciplines/[id]';
import { CourseCard } from '@/components/CourseCard';
import { colors } from '@/lib/theme';
import type { Course, CourseFeedback, Discipline, Meeting } from '@/lib/types';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const math: Discipline = { id: 'DM', name: 'Math', hidden: false, createdById: 'T', createdAt: '2026-11-01T10:00:00.000Z' };
const A: Course = { ...courseA, disciplineId: 'DM' };
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
const feedback = [fb('f1', 'S1', 5), fb('f2', 'M2', 2)];
const store = (who: 'T' | 'S1', over = {}) =>
  fakeStore(who, {
    courses: [A],
    courseMembers: [member('A', 'S1'), member('A', 'M2')],
    meetings: [done],
    courseFeedback: feedback,
    disciplines: [math],
    ...over,
  });

/** The summary line: the ★ in colors.star, the rest in the line's own colour; text and label unchanged. */
function expectSummary(textColor: string) {
  const line = screen.getByText('★ 3.5 · 2 reviews');
  expect(line).toHaveStyle({ color: textColor });
  expect(screen.getByLabelText('Rated 3.5 out of 5, 2 reviews')).toBeTruthy();
  const star = within(line).getByTestId('rating-summary-star');
  expect(star).toHaveTextContent('★');
  expect(star).toHaveStyle({ color: colors.star });
}

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

it('AC4: one shared star colour, the theme colour; the empty star is light indigo', () => {
  expect(colors.star).toBe(colors.primary);
  expect(colors.starEmpty).toBe('#C7D2FE');
});

describe('AC1: rating form', () => {
  const starText = (n: number) =>
    within(screen.getByRole('radio', { name: n === 1 ? '1 star' : `${n} stars` })).getByText('★');

  it('nothing selected → all light indigo; the selection fills in the theme colour', async () => {
    setStore(store('S1', { courseFeedback: [] }));
    await render(<CourseFeedbackScreen />);
    for (const n of [1, 2, 3, 4, 5]) expect(starText(n)).toHaveStyle({ color: colors.starEmpty, fontSize: 30 });
    await fireEvent.press(screen.getByRole('radio', { name: '3 stars' }));
    for (const n of [1, 2, 3]) expect(starText(n)).toHaveStyle({ color: colors.star });
    for (const n of [4, 5]) expect(starText(n)).toHaveStyle({ color: colors.starEmpty });
    expect(screen.getByRole('radio', { name: '3 stars' })).toBeSelected();
  });

  it('editing opens with the saved rating coloured', async () => {
    setStore(store('S1', { courseFeedback: [fb('mine', 'S1', 2)] }));
    await render(<CourseFeedbackScreen />);
    for (const n of [1, 2]) expect(starText(n)).toHaveStyle({ color: colors.star });
    for (const n of [3, 4, 5]) expect(starText(n)).toHaveStyle({ color: colors.starEmpty });
  });
});

describe('AC2 / AC3: reviews and summaries', () => {
  it('course Feedback section: dark summary with a theme ★, and review stars in the theme colour', async () => {
    setStore(store('T'));
    await render(<CourseDetailScreen />);
    expectSummary(colors.text);
    const stars = within(screen.getByTestId('feedback-f2')).getByLabelText('2 stars');
    expect(stars).toHaveTextContent('★★☆☆☆');
    expect(stars).toHaveStyle({ color: colors.star, fontSize: 16 });
  });

  it('course card: grey summary with a theme ★', async () => {
    setStore(store('T'));
    await render(<CourseCard course={A} />);
    expectSummary(colors.muted);
  });

  it('Disciplines list: grey summary with a theme ★', async () => {
    setStore(store('T'));
    await render(<CoursesScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Disciplines' }));
    expectSummary(colors.muted);
  });

  it('Discipline details: dark summary with a theme ★, and review stars in the theme colour', async () => {
    params.id = 'DM';
    setStore(store('S1')); // the teacher also sees the course list with its own summary
    await render(<DisciplineScreen />);
    expectSummary(colors.text);
    const stars = within(screen.getByTestId('review-f1')).getByLabelText('5 stars');
    expect(stars).toHaveTextContent('★★★★★');
    expect(stars).toHaveStyle({ color: colors.star, fontSize: 16 });
  });

  it('no feedback → no summary', async () => {
    setStore(store('T', { courseFeedback: [] }));
    await render(<CourseCard course={A} />);
    expect(screen.queryByTestId('rating-summary-star')).toBeNull();
  });
});

it('AC5: no amber star colour is left in src', () => {
  const fs = jest.requireActual<{
    readFileSync: (file: string, encoding: 'utf8') => string;
    readdirSync: (dir: string, options: { recursive: true }) => string[];
  }>('fs');
  const files = fs.readdirSync('src', { recursive: true }).filter((f) => /\.tsx?$/.test(f));
  expect(files.length).toBeGreaterThan(10);
  expect(files.filter((f) => /F59E0B/i.test(fs.readFileSync(`src/${f}`, 'utf8')))).toEqual([]);
});
