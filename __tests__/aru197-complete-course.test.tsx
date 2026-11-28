// ARU-197: the course owner or the teacher marks a course Completed and can reopen it (UI side). The server rules are
// covered by supabase/tests/aru197_complete_course.test.sql.
// Teacher T; mentor M owns A; mentor N owns B; M2 is a mentor listener of A; S1 a student listener of A; S2 in nothing.
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import CourseFeedbackScreen from '@/app/courses/[id]/feedback';
import AddListenersScreen from '@/app/courses/[id]/listeners';
import ListenersScreen from '@/app/courses/[id]/members';
import AssignHomeworkScreen from '@/app/courses/[id]/meetings/[meetingId]/assign-homework';
import ScheduleMeetingScreen from '@/app/courses/[id]/meetings/new';
import DisciplineScreen from '@/app/disciplines/[id]';
import { completeCourseMessage } from '@/components/CompleteCourseButton';
import { CourseCard } from '@/components/CourseCard';
import { dbErrorMessage, translateKnown } from '@/i18n';
import {
  canCompleteCourse,
  completedLast,
  COURSE_SAVE_FAILED,
  isCourseCompleted,
  scheduledMeetingCount,
} from '@/lib/courseCompletion';
import { remindersFor } from '@/lib/reminders';
import { formatDate } from '@/lib/theme';
import type { Course, Discipline, Meeting } from '@/lib/types';

import { courseA, courseB, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@/components/DateTimeField', () => {
  const { TextInput } = require('react-native');
  return {
    DateTimeField: ({ value, onChange }: { value?: Date; onChange: (d: Date) => void }) => (
      <TextInput testID="starts-at" value={value?.toISOString() ?? ''} onChangeText={(t: string) => onChange(new Date(t))} />
    ),
  };
});

const HOUR = 60 * 60 * 1000;
const at = (offsetHours: number) => new Date(Date.now() + offsetHours * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(24),
  topic: 'Meeting',
  status: 'scheduled',
  createdById: 'M',
  createdAt: at(-48),
  ...over,
});
const COMPLETED_AT = '2026-11-28T09:30:00.000Z';
const doneA: Course = { ...courseA, completedAt: COMPLETED_AT, completedById: 'M' };
const members = [member('A', 'S1'), member('A', 'M2')];
const future = meeting({ id: 'F' });
const inProgress = meeting({ id: 'P', startsAt: at(-1) });
const held = meeting({ id: 'C', startsAt: at(-30), status: 'completed' });
const canceled = meeting({ id: 'X', startsAt: at(-50), status: 'canceled' });

type Who = keyof typeof users;
const forRole = (who: Who, course: Course = courseA, over = {}) =>
  fakeStore(who, { courses: [courseB, course], courseMembers: members, meetings: [future, inProgress, held, canceled], ...over });

/** Answers the next native alert by pressing the button with this text (or dismissing it with null). */
function answerAlert(press: string | null) {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons, options) => {
    if (press === null) options?.onDismiss?.();
    else buttons?.find((b) => b.text === press)?.onPress?.();
  });
}
const completeButton = () => screen.queryByRole('button', { name: 'Complete course' });
const reopenButton = () => screen.queryByRole('button', { name: 'Reopen course' });

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  params.id = 'A';
  params.meetingId = undefined;
});

describe('AC 1: who sees Complete course', () => {
  it.each(['T', 'M'] as const)('%s (the teacher, the owner) sees it on an active course, and no Reopen', async (who) => {
    setStore(forRole(who));
    await render(<CourseDetailScreen />);
    expect(completeButton()).toBeTruthy();
    expect(reopenButton()).toBeNull();
  });

  it.each(['N', 'M2', 'S1', 'S2'] as const)('%s never sees Complete or Reopen', async (who) => {
    setStore(forRole(who));
    const view = await render(<CourseDetailScreen />);
    expect(completeButton()).toBeNull();
    setStore(forRole(who, doneA));
    await view.rerender(<CourseDetailScreen />);
    expect(completeButton()).toBeNull();
    expect(reopenButton()).toBeNull();
  });

  it('the teacher sees it on a hidden course they do not own', async () => {
    setStore(forRole('T', { ...courseA, hidden: true }));
    await render(<CourseDetailScreen />);
    expect(completeButton()).toBeTruthy();
  });

  it('mirrors complete_course(): the current owner or the teacher', () => {
    expect(canCompleteCourse(users.T, courseA)).toBe(true);
    expect(canCompleteCourse(users.M, courseA)).toBe(true);
    expect(canCompleteCourse(users.N, courseA)).toBe(false);
    expect(canCompleteCourse(users.S1, courseA)).toBe(false);
    expect(canCompleteCourse(null, courseA)).toBe(false);
    // After an owner change: the new owner can, the old one can't.
    expect(canCompleteCourse(users.N, { ...courseA, createdById: 'N' })).toBe(true);
    expect(canCompleteCourse(users.M, { ...courseA, createdById: 'N' })).toBe(false);
  });
});

describe('AC 2: the confirmation', () => {
  it('with Scheduled meetings it says how many will be canceled (one in progress counts)', async () => {
    setStore(forRole('M'));
    const alert = answerAlert('Cancel');
    await render(<CourseDetailScreen />);
    await fireEvent.press(completeButton()!);
    expect(alert).toHaveBeenCalledTimes(1);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe('Complete course');
    expect(message).toBe(
      "Complete this course? New meetings, homework and listeners can't be added. Listeners can still leave feedback. " +
        'Its 2 scheduled meetings will be canceled.',
    );
    expect(buttons?.map((b) => [b.text, b.style])).toEqual([
      ['Cancel', 'cancel'],
      ['Complete', 'default'],
    ]);
  });

  it('with no Scheduled meeting it shows the base text only', async () => {
    setStore(forRole('M', courseA, { meetings: [held, canceled] }));
    const alert = answerAlert('Cancel');
    await render(<CourseDetailScreen />);
    await fireEvent.press(completeButton()!);
    expect(alert.mock.calls[0][1]).toBe(
      "Complete this course? New meetings, homework and listeners can't be added. Listeners can still leave feedback.",
    );
  });

  it('counts only this course\'s Scheduled meetings', () => {
    const other = meeting({ id: 'O', courseId: 'B' });
    expect(scheduledMeetingCount([future, inProgress, held, canceled, other], 'A')).toBe(2);
    expect(scheduledMeetingCount([held, canceled, other], 'A')).toBe(0);
  });

  it('both languages, with the right plural', () => {
    expect(completeCourseMessage(1, 'en')).toMatch(/Its 1 scheduled meeting will be canceled\.$/);
    expect(completeCourseMessage(1, 'ru')).toBe(
      'Завершить этот курс? Новые встречи, домашние задания и слушателей добавить будет нельзя. Слушатели по-прежнему ' +
        'смогут оставлять отзывы. Его 1 запланированная встреча будет отменена.',
    );
    expect(completeCourseMessage(3, 'ru')).toMatch(/Его 3 запланированные встречи будут отменены\.$/);
    expect(completeCourseMessage(5, 'ru')).toMatch(/Его 5 запланированных встреч будут отменены\.$/);
    expect(completeCourseMessage(0, 'ru')).toMatch(/оставлять отзывы\.$/);
  });

  it.each([['Cancel'], [null]] as const)('%s changes nothing', async (press) => {
    const store = forRole('M');
    setStore(store);
    answerAlert(press);
    await render(<CourseDetailScreen />);
    await fireEvent.press(completeButton()!);
    expect(store.completeCourse).not.toHaveBeenCalled();
    expect(completeButton()).toBeTruthy();
  });
});

describe('AC 3: completing', () => {
  it('Complete calls completeCourse once with the course', async () => {
    const store = forRole('T');
    setStore(store);
    answerAlert('Complete');
    await render(<CourseDetailScreen />);
    await fireEvent.press(completeButton()!);
    await waitFor(() => expect(store.completeCourse).toHaveBeenCalledTimes(1));
    expect(store.completeCourse).toHaveBeenCalledWith('A');
    expect(store.reopenCourse).not.toHaveBeenCalled();
  });

  it('a double tap opens one confirmation', async () => {
    const store = forRole('M');
    setStore(store);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<CourseDetailScreen />);
    await fireEvent.press(completeButton()!);
    await fireEvent.press(completeButton()!);
    expect(alert).toHaveBeenCalledTimes(1);
  });

  it('offline: the usual "Could not save" error shows and the button stays', async () => {
    const store = forRole('M');
    (store.completeCourse as jest.Mock).mockRejectedValueOnce(new Error(COURSE_SAVE_FAILED));
    setStore(store);
    answerAlert('Complete');
    await render(<CourseDetailScreen />);
    await fireEvent.press(completeButton()!);
    expect(await screen.findByText('Could not save. Please try again.')).toBeTruthy();
    expect(completeButton()).toBeTruthy();
    expect(translateKnown('ru', COURSE_SAVE_FAILED)).toBe('Не удалось сохранить. Попробуйте ещё раз.');
  });

  it('note 7: the reminders of the meetings completing cancels go away', () => {
    const input = {
      userId: 'S1',
      role: 'student' as const,
      settings: {},
      courses: [courseA],
      courseMembers: members,
      assignments: [],
      homework: [],
      photoDeletionStart: null,
      now: new Date(),
      lang: 'en' as const,
    };
    expect(remindersFor({ ...input, meetings: [future] })).toHaveLength(1);
    expect(remindersFor({ ...input, courses: [doneA], meetings: [{ ...future, status: 'canceled' }] })).toHaveLength(0);
  });
});

describe('AC 4: shown as completed', () => {
  it('details: the badge next to the title and "Completed on <date>" in the app\'s date format', async () => {
    setStore(forRole('S1', doneA));
    await render(<CourseDetailScreen />);
    expect(within(screen.getByTestId('completed-badge')).getByText('Completed')).toBeTruthy();
    expect(screen.getByTestId('course-completed-on').props.children).toBe(`Completed on ${formatDate(COMPLETED_AT)}`);
  });

  it('details of an active course: no badge and no line', async () => {
    setStore(forRole('S1'));
    await render(<CourseDetailScreen />);
    expect(screen.queryByTestId('completed-badge')).toBeNull();
    expect(screen.queryByTestId('course-completed-on')).toBeNull();
  });

  it('a student who is not a listener (summary view) sees the badge and the line too', async () => {
    setStore(forRole('S2', doneA));
    await render(<CourseDetailScreen />);
    expect(screen.getByTestId('completed-badge')).toBeTruthy();
    expect(screen.getByTestId('course-completed-on')).toBeTruthy();
  });

  it('hidden and completed: both badges', async () => {
    setStore(forRole('T', { ...doneA, hidden: true }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Hidden')).toBeTruthy();
    expect(within(screen.getByTestId('completed-badge')).getByText('Completed')).toBeTruthy();
  });

  it('the card shows the badge only on a completed course; hidden + completed shows both', async () => {
    setStore(forRole('S1', doneA));
    const view = await render(<CourseCard course={doneA} />);
    expect(screen.getByText('Completed')).toBeTruthy();
    await view.rerender(<CourseCard course={courseA} />);
    expect(screen.queryByText('Completed')).toBeNull();
    await view.rerender(<CourseCard course={{ ...doneA, hidden: true }} />);
    expect(screen.getByText('Hidden')).toBeTruthy();
    expect(screen.getByText('Completed')).toBeTruthy();
  });

  it('the discipline page card shows the badge and keeps today\'s order', async () => {
    const D: Discipline = { id: 'D', name: 'Sciences', hidden: false, createdById: 'T', createdAt: courseA.createdAt };
    const inD = [{ ...doneA, disciplineId: 'D' }, { ...courseB, disciplineId: 'D' }];
    params.id = 'D';
    setStore(fakeStore('T', { courses: inD, disciplines: [D] }));
    await render(<DisciplineScreen />);
    expect(screen.getAllByText('Completed')).toHaveLength(1);
    expect(screen.queryAllByText(/^(Algebra|Biology)$/).map((t) => t.props.children)).toEqual(['Algebra', 'Biology']);
  });

  it('Courses tab: in each section completed courses come last, the rest keep their order', async () => {
    const c = (id: string, title: string, over: Partial<Course> = {}): Course => ({
      id,
      title,
      description: '',
      createdById: 'N',
      createdAt: courseA.createdAt,
      ...over,
    });
    // As the store gives them (newest first). M owns O1-O2, listens to L1-L2; F1-F2 have no discipline and aren't M's.
    const courses = [
      c('O1', 'Own one', { createdById: 'M', completedAt: COMPLETED_AT }),
      c('L1', 'In one', { completedAt: COMPLETED_AT }),
      c('F1', 'Free one', { completedAt: COMPLETED_AT }),
      c('O2', 'Own two', { createdById: 'M' }),
      c('L2', 'In two'),
      c('F2', 'Free two'),
    ];
    const shown = () => screen.queryAllByText(/^(Own|In|Free) (one|two)$/).map((t) => t.props.children);
    // The list renders its first rows only, so the three sections are read in two renders.
    const mine = courses.filter((x) => !x.id.startsWith('F'));
    setStore(fakeStore('M', { courses: mine, courseMembers: [member('L1', 'M'), member('L2', 'M')] }));
    const view = await render(<CoursesScreen />);
    expect(shown()).toEqual(['In two', 'In one', 'Own two', 'Own one']);
    setStore(fakeStore('S2', { courses }));
    await view.rerender(<CoursesScreen />);
    expect(shown()).toEqual(['Own two', 'In two', 'Free two', 'Own one', 'In one', 'Free one']);
  });

  it('completedLast keeps each group in the order it came', () => {
    const list = [{ id: 1, completedAt: 'x' }, { id: 2 }, { id: 3, completedAt: 'y' }, { id: 4 }];
    expect(completedLast(list).map((c) => c.id)).toEqual([2, 4, 1, 3]);
    expect(isCourseCompleted({})).toBe(false);
    expect(isCourseCompleted(undefined)).toBe(false);
  });
});

describe('AC 5: no new meetings', () => {
  it.each(['T', 'M'] as const)('%s sees no "+ Schedule meeting" on a completed course, but does on an active one', async (who) => {
    setStore(forRole(who));
    const view = await render(<CourseDetailScreen />);
    expect(screen.getByRole('button', { name: '+ Schedule meeting' })).toBeTruthy();
    setStore(forRole(who, doneA));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: '+ Schedule meeting' })).toBeNull();
  });

  it('the Schedule meeting screen opened for a completed course shows no form', async () => {
    setStore(forRole('M', doneA));
    await render(<ScheduleMeetingScreen />);
    expect(screen.getByText("This course is completed. New meetings can't be added.")).toBeTruthy();
    expect(screen.queryByTestId('starts-at')).toBeNull();
  });
});

describe('AC 6: no new homework', () => {
  it('Assign homework is hidden on a completed course\'s meetings, and shown on an active one', async () => {
    setStore(forRole('M', courseA, { meetings: [held] }));
    const view = await render(<CourseDetailScreen />);
    expect(screen.getByRole('button', { name: 'Assign homework' })).toBeTruthy();
    setStore(forRole('M', doneA, { meetings: [held] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Assign homework' })).toBeNull();
  });

  it('the Assign homework screen opened for a completed course shows no form', async () => {
    params.meetingId = 'C';
    setStore(forRole('M', doneA));
    await render(<AssignHomeworkScreen />);
    expect(screen.getByText("This course is completed. New homework can't be assigned.")).toBeTruthy();
    expect(screen.queryByRole('button', { name: /assign/i })).toBeNull();
  });
});

describe('AC 7: no new listeners', () => {
  it('"+ Add listeners" is hidden on a completed course; removing stays', async () => {
    setStore(forRole('M'));
    const view = await render(<ListenersScreen />);
    expect(screen.getByRole('button', { name: '+ Add listeners' })).toBeTruthy();
    setStore(forRole('M', doneA));
    await view.rerender(<ListenersScreen />);
    expect(screen.queryByRole('button', { name: '+ Add listeners' })).toBeNull();
    expect(screen.getByTestId('remove-listener-S1')).toBeTruthy();
  });

  it('the Add listeners screen opened for a completed course offers nobody', async () => {
    setStore(forRole('M', doneA));
    await render(<AddListenersScreen />);
    expect(screen.getByText("This course is completed. New listeners can't be added.")).toBeTruthy();
    expect(screen.queryByText('Student Sue')).toBeNull();
  });
});

describe('AC 9: feedback on a completed course', () => {
  const noMeetings = { meetings: [] };

  it('a listener gets Add feedback even if no meeting was ever completed', async () => {
    setStore(forRole('S1', doneA, noMeetings));
    await render(<CourseDetailScreen />);
    expect(screen.getByRole('button', { name: 'Add feedback' })).toBeTruthy();
    expect(screen.queryByText('Feedback opens after the first meeting')).toBeNull();
  });

  it('an active course with no completed meeting still does not', async () => {
    setStore(forRole('S1', courseA, noMeetings));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Add feedback' })).toBeNull();
    expect(screen.getByText('Feedback opens after the first meeting')).toBeTruthy();
  });

  it('the feedback form opens for a listener of a completed course with no completed meeting', async () => {
    setStore(forRole('S1', doneA, noMeetings));
    await render(<CourseFeedbackScreen />);
    expect(screen.queryByText("Can't leave feedback")).toBeNull();
    expect(screen.getByRole('button', { name: 'Save' })).toBeTruthy();
  });

  it('and stays closed on an active course that has not started', async () => {
    setStore(forRole('S1', courseA, noMeetings));
    await render(<CourseFeedbackScreen />);
    expect(screen.getByText("Can't leave feedback")).toBeTruthy();
  });

  it('the owner and the teacher (never listeners) get no Add feedback', async () => {
    setStore(forRole('M', doneA, noMeetings));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole('button', { name: 'Add feedback' })).toBeNull();
  });
});

describe('AC 11: reopen', () => {
  it.each(['T', 'M'] as const)('%s sees Reopen course instead of Complete course', async (who) => {
    setStore(forRole(who, doneA));
    await render(<CourseDetailScreen />);
    expect(reopenButton()).toBeTruthy();
    expect(completeButton()).toBeNull();
  });

  it('asks with the reopen text and calls reopenCourse', async () => {
    const store = forRole('M', doneA);
    setStore(store);
    const alert = answerAlert('Reopen');
    await render(<CourseDetailScreen />);
    await fireEvent.press(reopenButton()!);
    const [title, message, buttons] = alert.mock.calls[0];
    expect(title).toBe('Reopen course');
    expect(message).toBe('Reopen this course? Meetings, homework and listeners can be added again.');
    expect(buttons?.map((b) => b.text)).toEqual(['Cancel', 'Reopen']);
    await waitFor(() => expect(store.reopenCourse).toHaveBeenCalledWith('A'));
    expect(store.completeCourse).not.toHaveBeenCalled();
  });

  it('Cancel keeps the course completed', async () => {
    const store = forRole('M', doneA);
    setStore(store);
    answerAlert('Cancel');
    await render(<CourseDetailScreen />);
    await fireEvent.press(reopenButton()!);
    expect(store.reopenCourse).not.toHaveBeenCalled();
  });
});

describe('texts: the new database refusals in Russian', () => {
  it.each([
    ['course_complete_role', 'Завершить курс может только куратор курса или преподаватель.'],
    ['course_reopen_role', 'Возобновить курс может только куратор курса или преподаватель.'],
    ['course_completed_no_meetings', 'Этот курс завершён. Новые встречи добавить нельзя.'],
    ['course_completed_no_homework', 'Этот курс завершён. Новое домашнее задание задать нельзя.'],
    ['course_completed_no_listeners', 'Этот курс завершён. Новых слушателей добавить нельзя.'],
  ])('%s', (code, text) => {
    expect(dbErrorMessage({ message: 'x', code: '23514', hint: `sham:${code}` }, 'ru')).toBe(text);
  });
});
