// ARU-40: hidden courses. Access is enforced by the database (supabase/tests/aru40_hidden_courses.test.sql): a hidden
// course a user can't see never reaches the store, so the app only adds the switch, the "Hidden" label and relies on
// the screens' existing not-found states.
import { fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import ChatScreen from '@/app/courses/[id]/chat';
import NewCourseScreen from '@/app/courses/new';
import MaterialFileScreen from '@/app/materials/files/[id]';
import type { Course, MaterialFile } from '@/lib/types';

import { courseA, courseB, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HINT = 'Only the owner, listeners and the teacher will see this course.';
const hiddenH: Course = { id: 'H', title: 'Secret', description: '', createdById: 'M', createdAt: '2026-10-04T10:00:00.000Z', hidden: true };
const sw = () => screen.getByLabelText('Hidden course');

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'H';
});

describe('Create hidden (AC 1)', () => {
  it.each(['T', 'M'] as const)('%s sees the switch, off by default, with the hint', async (who) => {
    setStore(fakeStore(who));
    await render(<NewCourseScreen />);
    expect(sw().props.value).toBe(false);
    expect(screen.getByText('Hidden course')).toBeTruthy();
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it('switch on creates a hidden course', async () => {
    const store = fakeStore('M');
    setStore(store);
    await render(<NewCourseScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Algebra — Grade 7'), 'Secret');
    await fireEvent(sw(), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Create course' }));
    expect(store.addCourse).toHaveBeenCalledWith({ id: expect.any(String), title: 'Secret', description: '', hidden: true });
    expect(router.back).toHaveBeenCalled();
  });

  it('switch off creates a visible course, as today', async () => {
    const store = fakeStore('T');
    setStore(store);
    await render(<NewCourseScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Algebra — Grade 7'), 'Open');
    await fireEvent.press(screen.getByRole('button', { name: 'Create course' }));
    expect(store.addCourse).toHaveBeenCalledWith({ id: expect.any(String), title: 'Open', description: '' });
  });

  it('an error keeps the switch on, and the retry reuses the same id', async () => {
    const store = fakeStore('M', {
      addCourse: jest.fn().mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce(undefined),
    });
    setStore(store);
    await render(<NewCourseScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Algebra — Grade 7'), 'Secret');
    await fireEvent(sw(), 'valueChange', true);
    await fireEvent.press(screen.getByRole('button', { name: 'Create course' }));
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(sw().props.value).toBe(true);
    await fireEvent.press(screen.getByRole('button', { name: 'Create course' }));
    const [first, second] = jest.mocked(store.addCourse).mock.calls;
    expect(second[0]).toEqual(first[0]);
    expect(second[0].hidden).toBe(true);
  });
});

describe('Hidden label (AC 2)', () => {
  it('the card of a hidden course shows "Hidden" next to the title; visible courses don\'t', async () => {
    setStore(fakeStore('S1', { courses: [hiddenH, courseB, courseA], courseMembers: [member('H', 'S1')] }));
    await render(<CoursesScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'All courses' }));
    expect(screen.getAllByText('Hidden')).toHaveLength(1);
    expect(screen.getByText('Secret')).toBeTruthy();
  });

  it('the owner sees it under Courses I own with the label', async () => {
    setStore(fakeStore('M', { courses: [hiddenH, courseA] }));
    await render(<CoursesScreen />);
    expect(screen.getByText('Secret')).toBeTruthy();
    expect(screen.getByText('Hidden')).toBeTruthy();
  });

  it('the course screen shows the label', async () => {
    setStore(fakeStore('T', { courses: [hiddenH, courseA] }));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Secret')).toBeTruthy();
    expect(screen.getByText('Hidden')).toBeTruthy();
  });

  it('a visible course screen has no label', async () => {
    params.id = 'A';
    setStore(fakeStore('T'));
    await render(<CourseDetailScreen />);
    expect(screen.queryByText('Hidden')).toBeNull();
  });
});

describe('Without access (AC 3, 8, 10)', () => {
  // The database never returns the hidden course to a non-participant, so the store doesn't have it.
  it('a non-participant has no trace of it in Courses', async () => {
    setStore(fakeStore('S2', { courses: [courseB, courseA] }));
    await render(<CoursesScreen />);
    await fireEvent.press(screen.getByRole('tab', { name: 'All courses' }));
    expect(screen.queryByText('Secret')).toBeNull();
    expect(screen.queryByText('Hidden')).toBeNull();
  });

  it.each([
    ['course screen', CourseDetailScreen],
    ['chat', ChatScreen],
  ])('opening the %s by link shows "Course not found"', async (_l, Screen) => {
    setStore(fakeStore('S2', { courses: [courseB, courseA] }));
    await render(<Screen />);
    expect(screen.getByText('Course not found')).toBeTruthy();
    expect(screen.queryByText('Secret')).toBeNull();
  });

  it('a removed listener sees "Course not found" after the reload drops the course', async () => {
    setStore(fakeStore('S1', { courses: [hiddenH, courseA], courseMembers: [member('H', 'S1')] }));
    const view = await render(<CourseDetailScreen />);
    expect(screen.getByText('Secret')).toBeTruthy();
    setStore(fakeStore('S1', { courses: [courseA], courseMembers: [] }));
    await view.rerender(<CourseDetailScreen />);
    expect(screen.getByText('Course not found')).toBeTruthy();
  });

  it('a Knowledge base PDF linked to a hidden course shows no course name to a non-participant', async () => {
    const pdf: MaterialFile = {
      id: 'f',
      authorId: 'M',
      name: 'Book',
      description: '',
      courseId: 'H',
      storagePath: 'M/f.pdf',
      sizeBytes: 10,
      createdAt: '2026-10-20T10:00:00.000Z',
      updatedAt: '2026-10-20T10:00:00.000Z',
    };
    params.id = 'f';
    setStore(fakeStore('S2', { courses: [courseB, courseA], materialFiles: [pdf] }));
    await render(<MaterialFileScreen />);
    expect(screen.getByText('Book')).toBeTruthy();
    expect(screen.queryByText(/^Course: /)).toBeNull();
  });
});
