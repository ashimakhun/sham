// QA ARU-53: screen-side gaps: the star picker's accessibility, the rating read as part of a card that has the chat
// icon (ARU-27 / ARU-34 layout), the average shown to a hidden course's participant, rounding, and a whitespace-only
// edit keeping Save disabled.
import { fireEvent, render, screen } from '@testing-library/react-native';

import CourseFeedbackScreen from '@/app/courses/[id]/feedback';
import { CourseCard } from '@/components/CourseCard';
import { ratingSummary, ratingSummaryLabel } from '@/lib/feedback';
import type { Course, CourseFeedback, Meeting } from '@/lib/types';

import { courseA, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const done: Meeting = {
  id: 'D',
  courseId: 'A',
  startsAt: '2026-10-20T10:00:00.000Z',
  topic: 'Done',
  status: 'completed',
  createdById: 'M',
  createdAt: '2026-10-01T10:00:00.000Z',
};
const fb = (id: string, userId: string, rating: number, courseId = 'A'): CourseFeedback => ({
  id,
  courseId,
  userId,
  rating,
  body: `Review ${id}`,
  createdAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
});
const members = [member('A', 'S1'), member('A', 'M2')];
const store = (who: keyof typeof users, over: Parameters<typeof fakeStore>[1] = {}) =>
  fakeStore(who, { courseMembers: members, meetings: [done], ...over });

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('edge case iOS/Android: the star picker', () => {
  it('five radios "1 star" … "5 stars"; picking one checks it and only it', async () => {
    setStore(store('S1'));
    await render(<CourseFeedbackScreen />);
    const names = ['1 star', '2 stars', '3 stars', '4 stars', '5 stars'];
    for (const n of names) expect(screen.getByRole('radio', { name: n }).props.accessibilityState.checked).toBe(false);
    await fireEvent.press(screen.getByRole('radio', { name: '4 stars' }));
    for (const n of names)
      expect(screen.getByRole('radio', { name: n }).props.accessibilityState.checked).toBe(n === '4 stars');
    await fireEvent.press(screen.getByRole('radio', { name: '1 star' }));
    expect(screen.getByRole('radio', { name: '1 star' }).props.accessibilityState.checked).toBe(true);
    expect(screen.getByRole('radio', { name: '4 stars' }).props.accessibilityState.checked).toBe(false);
  });

  it('editing to whitespace only keeps Save disabled', async () => {
    const mine = fb('f1', 'S1', 4);
    setStore(store('S1', { courseFeedback: [mine] }));
    await render(<CourseFeedbackScreen />);
    const input = screen.getByLabelText('Feedback');
    await fireEvent.changeText(input, '   \n  ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });
});

describe('AC 7 / AC 8: averages', () => {
  it('rounds to one decimal and reads the same way to screen readers', () => {
    const items = [fb('a', 'S1', 5), fb('b', 'M2', 4), fb('c', 'S2', 4)];
    expect(ratingSummary(items)).toBe('★ 4.3 · 3 reviews');
    expect(ratingSummaryLabel(items)).toBe('Rated 4.3 out of 5, 3 reviews');
    expect(ratingSummary([fb('a', 'S1', 1)])).toBe('★ 1.0 · 1 review');
  });

  it('a card with the chat icon reads the rating as part of its content, not in the chat label', async () => {
    setStore(store('S1', { courseFeedback: [fb('a', 'S1', 5), fb('b', 'M2', 3)] }));
    await render(<CourseCard course={courseA} />);
    expect(screen.getByLabelText('Rated 4.0 out of 5, 2 reviews')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Open chat for Algebra' })).toBeTruthy();
  });

  it('a hidden course\'s participant sees its average on the card; other courses\' feedback doesn\'t count', async () => {
    const H: Course = { ...courseA, id: 'H', title: 'Secret', hidden: true };
    setStore(store('S3', { courseMembers: [member('H', 'S3')], courseFeedback: [fb('h', 'S3', 2, 'H'), fb('a', 'S1', 5)] }));
    await render(<CourseCard course={H} />);
    expect(screen.getByText('★ 2.0 · 1 review')).toBeTruthy();
  });
});
