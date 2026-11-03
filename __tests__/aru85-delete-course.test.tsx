// ARU-85: the teacher's "Delete course" on course details. Store logic: aru85-store-delete-course.test.tsx; database
// rules: supabase/tests/aru85_delete_course.test.sql.
// Teacher T; mentor M owns A; mentor N owns B; H is a hidden course of M; S1 is a listener of A.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import { deleteCourseMessage } from '@/components/DeleteCourseButton';
import { canDeleteCourse } from '@/lib/roles';
import type { Course } from '@/lib/types';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { expoRouter, params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const H: Course = { id: 'H', title: 'Hidden algebra', description: '', createdById: 'M', createdAt: '2026-10-05T10:00:00.000Z', hidden: true };
const T_OWN: Course = { id: 'TC', title: 'Teacher course', description: '', createdById: 'T', createdAt: '2026-10-06T10:00:00.000Z' };
const courses = [courseA, courseB, H, T_OWN];
const forRole = (who: string, over = {}) => fakeStore(who, { courses, courseMembers: [member('A', 'S1')], ...over });

const deleteButton = () => screen.queryByText('Delete course');

/** Answers the next native alert by pressing the button with this text (or dismissing it with null). */
function answerAlert(press: 'Delete' | 'Cancel' | null) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons, options) => {
    if (press === null) options?.onDismiss?.();
    else buttons?.find((b) => b.text === press)?.onPress?.();
  });
}

/** All host texts in render order, to check what comes last. */
function texts(): string[] {
  const out: string[] = [];
  const walk = (n: unknown): void => {
    if (!n) return;
    if (Array.isArray(n)) return n.forEach(walk);
    if (typeof n === 'string') return void out.push(n);
    const node = n as { children?: unknown };
    walk(node.children);
  };
  walk(screen.toJSON());
  return out;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();
  expoRouter.router.canGoBack.mockReturnValue(true);
});

describe('AC1: who sees Delete course', () => {
  it.each(['A', 'B', 'H', 'TC'])('the teacher sees it on course %s, as the very last item', async (id) => {
    params.id = id;
    setStore(forRole('T'));
    await render(<CourseDetailScreen />);
    expect(deleteButton()).toBeTruthy();
    expect(texts().at(-1)).toBe('Delete course');
  });

  it.each(['M', 'N', 'S1'])('%s (the owner, another mentor, a listener) never sees it', async (who) => {
    params.id = 'A';
    setStore(forRole(who));
    await render(<CourseDetailScreen />);
    expect(deleteButton()).toBeNull();
  });

  it('mirrors delete_course(): the teacher only', () => {
    expect(canDeleteCourse('teacher')).toBe(true);
    expect(canDeleteCourse('mentor')).toBe(false);
    expect(canDeleteCourse('student')).toBe(false);
    expect(canDeleteCourse(undefined)).toBe(false);
  });
});

describe('AC2-AC4: confirmation, cancel, success', () => {
  it('asks with the exact title, message and a red Delete', async () => {
    params.id = 'A';
    const store = forRole('T');
    setStore(store);
    const alert = answerAlert('Cancel');
    await render(<CourseDetailScreen />);
    await fireEvent.press(deleteButton()!);
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe('Delete course');
    expect(message).toBe(
      'Delete "Algebra"? Its meetings, notes, attendance, homework and photos, chat, listeners, feedback and payment ' +
        "settings are deleted too. This can't be undone.",
    );
    expect(message).toBe(deleteCourseMessage('Algebra'));
    expect(buttons?.map((b) => [b.text, b.style])).toEqual([
      ['Cancel', 'cancel'],
      ['Delete', 'destructive'],
    ]);
  });

  it.each([['Cancel'], [null]] as const)('%s deletes nothing and stays on the screen', async (press) => {
    params.id = 'A';
    const store = forRole('T');
    setStore(store);
    answerAlert(press);
    await render(<CourseDetailScreen />);
    await fireEvent.press(deleteButton()!);
    expect(store.deleteCourse).not.toHaveBeenCalled();
    expect(expoRouter.router.back).not.toHaveBeenCalled();
    expect(deleteButton()).toBeTruthy();
  });

  it('Delete deletes the course and goes back where the teacher came from', async () => {
    params.id = 'H';
    const store = forRole('T');
    setStore(store);
    answerAlert('Delete');
    await render(<CourseDetailScreen />);
    await fireEvent.press(deleteButton()!);
    expect(store.deleteCourse).toHaveBeenCalledWith('H');
    expect(expoRouter.router.back).toHaveBeenCalledTimes(1);
    expect(expoRouter.router.replace).not.toHaveBeenCalled();
  });

  it('with no history (deep link, web refresh) it lands on the Courses tab', async () => {
    params.id = 'A';
    const store = forRole('T');
    setStore(store);
    expoRouter.router.canGoBack.mockReturnValue(false);
    answerAlert('Delete');
    await render(<CourseDetailScreen />);
    await fireEvent.press(deleteButton()!);
    expect(expoRouter.router.replace).toHaveBeenCalledWith('/courses');
  });
});

describe('AC8 / AC9: busy state, double taps and errors', () => {
  it('shows "Deleting…", is disabled, and a double tap sends one request', async () => {
    params.id = 'A';
    let finish: () => void = () => {};
    const store = forRole('T', { deleteCourse: jest.fn(() => new Promise<void>((r) => (finish = r))) });
    setStore(store);
    const alert = answerAlert('Delete');
    await render(<CourseDetailScreen />);
    const button = deleteButton()!;
    await fireEvent.press(button);
    await fireEvent.press(button);
    expect(screen.getByText('Deleting…')).toBeTruthy();
    await fireEvent.press(screen.getByText('Deleting…'));
    expect(alert).toHaveBeenCalledTimes(1);
    expect(store.deleteCourse).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(expoRouter.router.back).toHaveBeenCalledTimes(1);
  });

  it('an error (e.g. offline) shows on the screen, stays there, and tapping again retries', async () => {
    params.id = 'A';
    const deleteCourse = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network request failed'))
      .mockResolvedValueOnce(undefined);
    const store = forRole('T', { deleteCourse });
    setStore(store);
    answerAlert('Delete');
    await render(<CourseDetailScreen />);
    await fireEvent.press(deleteButton()!);
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(expoRouter.router.back).not.toHaveBeenCalled();
    expect(deleteButton()).toBeTruthy();
    await fireEvent.press(deleteButton()!);
    expect(deleteCourse).toHaveBeenCalledTimes(2);
    expect(expoRouter.router.back).toHaveBeenCalledTimes(1);
  });
});

describe('AC7: other users after the delete', () => {
  it('the course screen shows "Course not found" once the course is gone', async () => {
    params.id = 'A';
    setStore(forRole('S1'));
    const view = await render(<CourseDetailScreen />);
    setStore(forRole('S1', { courses: [courseB] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.getByText('Course not found')).toBeTruthy();
  });
});
