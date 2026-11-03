// ARU-53: listeners rate a started course; everyone who sees the course reads the feedback and the average.
// Database rules: supabase/tests/aru53_course_feedback.test.sql.
// Course A is owned by mentor M; listeners S1 (student) and M2 (mentor). S3 is a student who isn't a listener.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import CourseFeedbackScreen from '@/app/courses/[id]/feedback';
import { CourseCard } from '@/components/CourseCard';
import { ratingSummary } from '@/lib/feedback';
import type { CourseFeedback, Meeting } from '@/lib/types';

import { courseA, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const meeting = (id: string, status: Meeting['status']): Meeting => ({
  id,
  courseId: 'A',
  startsAt: '2026-10-20T10:00:00.000Z',
  topic: `Topic ${id}`,
  status,
  createdById: 'M',
  createdAt: '2026-10-01T10:00:00.000Z',
});
const done = meeting('D', 'completed');
const fb = (over: Partial<CourseFeedback> & { id: string; userId: string }): CourseFeedback => ({
  courseId: 'A',
  rating: 4,
  body: `Review by ${over.userId}`,
  createdAt: '2026-10-25T10:00:00.000Z',
  updatedAt: '2026-10-25T10:00:00.000Z',
  ...over,
});
const members = [member('A', 'S1'), member('A', 'M2')];
const store = (who: keyof typeof users, over: Parameters<typeof fakeStore>[1] = {}) =>
  fakeStore(who, { courseMembers: members, meetings: [done], ...over });
const button = (name: string) => screen.queryByRole('button', { name });

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

it('ratingSummary: one decimal, review / reviews', () => {
  expect(ratingSummary([])).toBeUndefined();
  expect(ratingSummary([fb({ id: '1', userId: 'S1', rating: 5 })])).toBe('★ 5.0 · 1 review');
  const six = [5, 5, 4, 4, 4, 4].map((rating, i) => fb({ id: `${i}`, userId: `U${i}`, rating }));
  expect(ratingSummary(six)).toBe('★ 4.3 · 6 reviews');
});

describe('course screen', () => {
  it.each(['S1', 'M2'] as const)('AC1 %s: no completed meeting → "Feedback opens after the first meeting"', async (who) => {
    setStore(store(who, { meetings: [meeting('S', 'scheduled'), meeting('X', 'canceled')] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Feedback opens after the first meeting')).toBeTruthy();
    expect(button('Add feedback')).toBeNull();
  });

  it.each(['S1', 'M2'] as const)('AC1 %s: a completed meeting → Add feedback opens the form', async (who) => {
    const { router } = require('expo-router');
    setStore(store(who));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('No feedback yet')).toBeTruthy();
    await fireEvent.press(button('Add feedback')!);
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]/feedback', params: { id: 'A' } });
  });

  it('AC3 / AC5: with own feedback, Edit and Delete (asks first) instead of Add', async () => {
    const s = store('S1', { courseFeedback: [fb({ id: 'F1', userId: 'S1' })] });
    setStore(s);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === 'Delete')?.onPress?.();
    });
    await render(<CourseDetailScreen />);
    expect(button('Add feedback')).toBeNull();
    expect(button('Edit feedback')).toBeTruthy();
    await fireEvent.press(button('Delete feedback')!);
    expect(alert).toHaveBeenCalled();
    await waitFor(() => expect(s.deleteFeedback).toHaveBeenCalledWith('F1'));
  });

  it('AC5: cancelling the delete keeps it', async () => {
    const s = store('S1', { courseFeedback: [fb({ id: 'F1', userId: 'S1' })] });
    setStore(s);
    jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.text === 'Cancel')?.onPress?.();
    });
    await render(<CourseDetailScreen />);
    await fireEvent.press(button('Delete feedback')!);
    expect(s.deleteFeedback).not.toHaveBeenCalled();
  });

  it.each(['M', 'T', 'N'] as const)('AC6 %s (owner, teacher, non-listener) sees no Add / Edit', async (who) => {
    setStore(store(who, { courseFeedback: [fb({ id: 'F1', userId: 'S1' })] }));
    await render(<CourseDetailScreen />);
    for (const name of ['Add feedback', 'Edit feedback', 'Delete feedback']) expect(button(name)).toBeNull();
    expect(screen.getByText('Review by S1')).toBeTruthy();
  });

  it('AC7: the list (name, stars, text, date) newest first, and the average', async () => {
    setStore(
      store('T', {
        courseFeedback: [
          fb({ id: 'old', userId: 'S1', rating: 5, createdAt: '2026-10-21T10:00:00.000Z', updatedAt: '2026-10-21T10:00:00.000Z' }),
          fb({ id: 'new', userId: 'M2', rating: 2, createdAt: '2026-10-26T10:00:00.000Z', updatedAt: '2026-10-26T10:00:00.000Z' }),
          fb({ id: 'other', userId: 'S3', courseId: 'B' }),
        ],
      }),
    );
    await render(<CourseDetailScreen />);
    expect(screen.getByText('★ 3.5 · 2 reviews')).toBeTruthy();
    const order = screen.queryAllByTestId(/^feedback-/).map((n) => n.props.testID);
    expect(order).toEqual(['feedback-new', 'feedback-old']);
    const entry = within(screen.getByTestId('feedback-old'));
    expect(entry.getByText('Student Sam')).toBeTruthy();
    expect(entry.getByLabelText('5 stars')).toBeTruthy();
    expect(entry.getByText('Review by S1')).toBeTruthy();
    expect(screen.queryByText('Review by S3')).toBeNull();
  });

  it('AC4: an edited entry shows "edited" with the new date', async () => {
    setStore(store('S2', { courseFeedback: [fb({ id: 'F1', userId: 'S1', updatedAt: '2026-10-28T10:00:00.000Z' })] }));
    await render(<CourseDetailScreen />);
    expect(within(screen.getByTestId('feedback-F1')).getByText(/^edited /)).toBeTruthy();
  });

  it('AC7: a student who is not in the course reads it on the summary screen', async () => {
    setStore(store('S3', { courseFeedback: [fb({ id: 'F1', userId: 'S1', rating: 5 })] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('You are not in this course')).toBeTruthy();
    expect(screen.getByText('★ 5.0 · 1 review')).toBeTruthy();
    expect(screen.getByText('Review by S1')).toBeTruthy();
    expect(button('Add feedback')).toBeNull();
  });

  it('AC9: a removed listener\'s feedback stays with their name, without Edit or Delete', async () => {
    setStore(store('S1', { courseMembers: [member('A', 'M2')], courseFeedback: [fb({ id: 'F1', userId: 'S1' })] }));
    await render(<CourseDetailScreen />);
    expect(within(screen.getByTestId('feedback-F1')).getByText('Student Sam')).toBeTruthy();
    expect(button('Edit feedback')).toBeNull();
    expect(button('Delete feedback')).toBeNull();
  });

  it('AC11: feedback arriving live updates the list and the average', async () => {
    setStore(store('M'));
    const view = await render(<CourseDetailScreen />);
    expect(screen.getByText('No feedback yet')).toBeTruthy();
    setStore(store('M', { courseFeedback: [fb({ id: 'F1', userId: 'S1', rating: 3 })] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.getByText('★ 3.0 · 1 review')).toBeTruthy();
  });
});

describe('course card (AC 8)', () => {
  it('shows the average and count when there is feedback, nothing when not', async () => {
    setStore(store('S1', { courseFeedback: [fb({ id: '1', userId: 'S1', rating: 5 }), fb({ id: '2', userId: 'M2', rating: 4 })] }));
    const view = await render(<CourseCard course={courseA} />);
    expect(screen.getByText('★ 4.5 · 2 reviews')).toBeTruthy();
    setStore(store('S1'));
    await view.rerender(<CourseCard course={courseA} />);
    expect(screen.queryByText(/★/)).toBeNull();
  });
});

describe('form', () => {
  const star = (n: number) => screen.getByRole('radio', { name: n === 1 ? '1 star' : `${n} stars` });
  const save = () => screen.getByRole('button', { name: 'Save' });

  it('AC2: Save is disabled until stars and non-blank text; then saves trimmed and goes back', async () => {
    const { router } = require('expo-router');
    const s = store('S1');
    setStore(s);
    await render(<CourseFeedbackScreen />);
    expect(save()).toBeDisabled();
    await fireEvent.changeText(screen.getByLabelText('Feedback'), '   ');
    await fireEvent.press(star(4));
    expect(save()).toBeDisabled();
    expect(star(4)).toBeSelected();
    await fireEvent.changeText(screen.getByLabelText('Feedback'), '  Nice course  ');
    expect(save()).toBeEnabled();
    await fireEvent.press(save());
    await waitFor(() =>
      expect(s.saveFeedback).toHaveBeenCalledWith({ id: undefined, courseId: 'A', rating: 4, body: '  Nice course  ' }),
    );
    await waitFor(() => expect(router.back).toHaveBeenCalled());
  });

  it('AC2: the text is limited to 1000 characters with a counter', async () => {
    setStore(store('S1'));
    await render(<CourseFeedbackScreen />);
    expect(screen.getByLabelText('Feedback').props.maxLength).toBe(1000);
    await fireEvent.changeText(screen.getByLabelText('Feedback'), 'abc');
    expect(screen.getByText('3/1000')).toBeTruthy();
  });

  it('AC4: editing prefills the stars and text and saves with the id', async () => {
    const s = store('S1', { courseFeedback: [fb({ id: 'F1', userId: 'S1', rating: 2, body: 'Meh' })] });
    setStore(s);
    await render(<CourseFeedbackScreen />);
    expect(star(2)).toBeSelected();
    expect(screen.getByLabelText('Feedback').props.value).toBe('Meh');
    await fireEvent.press(star(5));
    await fireEvent.press(save());
    await waitFor(() => expect(s.saveFeedback).toHaveBeenCalledWith({ id: 'F1', courseId: 'A', rating: 5, body: 'Meh' }));
  });

  it('AC12: a failed save shows the error and keeps what was typed', async () => {
    const { router } = require('expo-router');
    setStore(store('S1', { saveFeedback: jest.fn().mockRejectedValue(new Error("You're no longer a listener of this course.")) }));
    await render(<CourseFeedbackScreen />);
    await fireEvent.press(star(3));
    await fireEvent.changeText(screen.getByLabelText('Feedback'), 'Keep me');
    await fireEvent.press(save());
    expect(await screen.findByText("You're no longer a listener of this course.")).toBeTruthy();
    expect(screen.getByLabelText('Feedback').props.value).toBe('Keep me');
    expect(star(3)).toBeSelected();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('AC12: Save is disabled while saving, so a double tap saves once', async () => {
    let finish: () => void = () => {};
    const s = store('S1', { saveFeedback: jest.fn(() => new Promise<void>((r) => (finish = r))) });
    setStore(s);
    await render(<CourseFeedbackScreen />);
    await fireEvent.press(star(5));
    await fireEvent.changeText(screen.getByLabelText('Feedback'), 'Great');
    fireEvent.press(save());
    const saving = await screen.findByRole('button', { name: 'Saving…' });
    expect(saving).toBeDisabled();
    await fireEvent.press(saving);
    expect(s.saveFeedback).toHaveBeenCalledTimes(1);
    finish();
  });

  it.each(['M', 'T', 'S3'] as const)('AC6 %s can\'t open the form', async (who) => {
    setStore(store(who));
    await render(<CourseFeedbackScreen />);
    expect(screen.getByText("Can't leave feedback")).toBeTruthy();
  });

  it('AC1: a listener can\'t open the form before the first completed meeting', async () => {
    setStore(store('S1', { meetings: [meeting('S', 'scheduled')] }));
    await render(<CourseFeedbackScreen />);
    expect(screen.getByText("Can't leave feedback")).toBeTruthy();
  });
});
