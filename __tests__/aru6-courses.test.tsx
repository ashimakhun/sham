// ARU-6: teachers and mentors create courses; students submit homework for a course (UI side).
// The access rules themselves are tested against the database in supabase/tests/aru6_courses.test.sql.
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import CoursesScreen from '@/app/(tabs)/courses';
import CourseDetailScreen from '@/app/courses/[id]';
import NewCourseScreen from '@/app/courses/new';
import HomeworkDetailScreen from '@/app/homework/[id]';
import NewHomeworkScreen from '@/app/homework/new';
import { HomeworkCard } from '@/components/HomeworkCard';
import { formatDate } from '@/lib/theme';
import { router } from 'expo-router';

import { courseA, courseB, fakeStore, hw } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('expo-image-picker', () => ({ launchImageLibraryAsync: jest.fn() }));

const button = (name: string | RegExp) => screen.getByRole('button', { name });

beforeEach(() => jest.clearAllMocks());

describe('Courses tab', () => {
  it.each(['T', 'M'] as const)('AC1: %s (teacher/mentor) sees "+ New course" above the list', async (who) => {
    setStore(fakeStore(who));
    await render(<CoursesScreen />);
    expect(button('+ New course')).toBeTruthy();
    await fireEvent.press(button('+ New course'));
    expect(router.push).toHaveBeenCalledWith('/courses/new');
  });

  it('AC4: a student sees the courses but no "+ New course"', async () => {
    setStore(fakeStore('S1'));
    await render(<CoursesScreen />);
    expect(screen.queryByRole('button', { name: '+ New course' })).toBeNull();
    expect(screen.getByText('Algebra')).toBeTruthy();
    expect(screen.getByText('Biology')).toBeTruthy();
  });

  it('AC6: each course shows title, creator and creation date, in the store order (newest first)', async () => {
    setStore(fakeStore('S1'));
    await render(<CoursesScreen />);
    const titles = screen.getAllByText(/^(Algebra|Biology)$/).map((t) => t.props.children);
    expect(titles).toEqual(['Biology', 'Algebra']);
    expect(screen.getByText(`Mentor Max · ${formatDate(courseA.createdAt)}`)).toBeTruthy();
    expect(screen.getByText(`Mentor Nina · ${formatDate(courseB.createdAt)}`)).toBeTruthy();
  });

  it('AC6: tapping a course opens its details', async () => {
    setStore(fakeStore('S1'));
    await render(<CoursesScreen />);
    await fireEvent.press(screen.getByText('Algebra'));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/courses/[id]', params: { id: 'A' } });
  });

  it('edge: empty state with a hint per role', async () => {
    setStore(fakeStore('M', { courses: [] }));
    const { unmount } = await render(<CoursesScreen />);
    expect(screen.getByText('No courses yet')).toBeTruthy();
    expect(screen.getByText('Tap "+ New course" to create the first one.')).toBeTruthy();
    await unmount();
    setStore(fakeStore('S1', { courses: [] }));
    await render(<CoursesScreen />);
    expect(screen.getByText('Your teacher or mentor has not created any courses yet.')).toBeTruthy();
  });

  it('edge: pull to refresh reloads', async () => {
    const store = fakeStore('S1');
    setStore(store);
    const { container } = await render(<CoursesScreen />);
    const list = container.queryAll((n) => typeof n.props.onRefresh === 'function')[0];
    list.props.onRefresh();
    expect(store.refresh).toHaveBeenCalled();
  });
});

describe('New course screen', () => {
  it('AC3: "Create course" is disabled while the title is empty or only spaces', async () => {
    setStore(fakeStore('M'));
    await render(<NewCourseScreen />);
    expect(button('Create course')).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Algebra — Grade 7'), '   ');
    expect(button('Create course')).toBeDisabled();
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Algebra — Grade 7'), 'Geometry');
    expect(button('Create course')).toBeEnabled();
  });

  it('AC2: creates the course with title and optional description, then goes back to the list', async () => {
    const store = fakeStore('T');
    setStore(store);
    await render(<NewCourseScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Algebra — Grade 7'), 'Geometry');
    await fireEvent.changeText(screen.getByPlaceholderText('What is this course about?'), 'Shapes');
    await fireEvent.press(button('Create course'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(store.addCourse).toHaveBeenCalledWith({ id: expect.any(String), title: 'Geometry', description: 'Shapes' });
  });

  it('AC4: a student opening the route sees "Not allowed" and no form', async () => {
    setStore(fakeStore('S1'));
    await render(<NewCourseScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Create course' })).toBeNull();
  });

  it('edge: an error is shown, the text is kept, and the retry reuses the same id', async () => {
    const addCourse = jest.fn().mockRejectedValueOnce(new Error('Network request failed')).mockResolvedValueOnce(undefined);
    setStore(fakeStore('M', { addCourse }));
    await render(<NewCourseScreen />);
    await fireEvent.changeText(screen.getByPlaceholderText('e.g. Algebra — Grade 7'), 'Geometry');
    await fireEvent.press(button('Create course'));
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.getByDisplayValue('Geometry')).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
    await fireEvent.press(button('Create course'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(addCourse.mock.calls[1][0].id).toBe(addCourse.mock.calls[0][0].id);
  });
});

describe('Course details', () => {
  it('AC7: shows title, description, creator and only this course\'s visible homework', async () => {
    params.id = 'A';
    setStore(
      fakeStore('M', {
        visibleHomework: [hw({ id: 'h1', courseId: 'A', title: 'Fractions' }), hw({ id: 'h2', courseId: 'B', title: 'Cells' })],
      }),
    );
    await render(<CourseDetailScreen />);
    // Once as the course title, once as the course label on the homework card.
    expect(screen.getAllByText('Algebra')).toHaveLength(2);
    expect(screen.getByText('Equations and more')).toBeTruthy();
    expect(screen.getByText(`Mentor Max · ${formatDate(courseA.createdAt)}`)).toBeTruthy();
    expect(screen.getByText('Fractions')).toBeTruthy();
    expect(screen.queryByText('Cells')).toBeNull();
  });

  it('edge: a course with no visible homework says so', async () => {
    params.id = 'B';
    setStore(fakeStore('S2'));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('No homework for this course yet')).toBeTruthy();
  });

  it('edge: an unknown course shows "Course not found"', async () => {
    params.id = 'nope';
    setStore(fakeStore('S2'));
    await render(<CourseDetailScreen />);
    expect(screen.getByText('Course not found')).toBeTruthy();
  });
});

describe('Add homework', () => {
  const titleInput = () => screen.getByPlaceholderText('e.g. Fractions — exercises 1–10');

  it('AC8: "Send to mentor" needs exactly one course picked from all courses', async () => {
    setStore(fakeStore('S1'));
    await render(<NewHomeworkScreen />);
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(2);
    await fireEvent.changeText(titleInput(), 'Exercises');
    expect(button('Send to mentor')).toBeDisabled();
    await fireEvent.press(screen.getByText('Algebra'));
    expect(button('Send to mentor')).toBeEnabled();
    await fireEvent.press(screen.getByText('Biology'));
    expect(screen.getAllByRole('radio', { selected: true })).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /Biology/ })).toBeSelected();
  });

  it('AC9: the homework is sent with the selected course', async () => {
    const store = fakeStore('S1');
    setStore(store);
    await render(<NewHomeworkScreen />);
    await fireEvent.press(screen.getByText('Biology'));
    await fireEvent.changeText(titleInput(), 'Cells');
    await fireEvent.press(button('Send to mentor'));
    await waitFor(() => expect(router.back).toHaveBeenCalled());
    expect(store.addHomework).toHaveBeenCalledWith(expect.objectContaining({ courseId: 'B', title: 'Cells' }));
  });

  it('AC10: with no courses it explains why and "Send to mentor" stays disabled', async () => {
    setStore(fakeStore('S1', { courses: [] }));
    await render(<NewHomeworkScreen />);
    expect(screen.getByText('No courses yet — ask your teacher or mentor to create one.')).toBeTruthy();
    await fireEvent.changeText(titleInput(), 'Exercises');
    expect(button('Send to mentor')).toBeDisabled();
  });
});

describe('Homework card and details', () => {
  it('AC9: the card shows the course name', async () => {
    setStore(fakeStore('S1'));
    await render(<HomeworkCard item={hw({ id: 'h1', courseId: 'A' })} />);
    expect(screen.getByText('Algebra')).toBeTruthy();
  });

  it('AC11: homework without a course is labelled "No course" on the card', async () => {
    setStore(fakeStore('M'));
    await render(<HomeworkCard item={hw({ id: 'old' })} />);
    expect(screen.getByText('No course')).toBeTruthy();
  });

  it('AC9: the details screen shows the course name', async () => {
    params.id = 'h1';
    setStore(fakeStore('S1', { visibleHomework: [hw({ id: 'h1', courseId: 'B' })] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.getByText('Biology')).toBeTruthy();
  });

  it('AC11/AC12: legacy homework shows "No course" and the mentor can still check it', async () => {
    params.id = 'old';
    const store = fakeStore('M', { visibleHomework: [hw({ id: 'old' })] });
    setStore(store);
    await render(<HomeworkDetailScreen />);
    expect(screen.getByText('No course')).toBeTruthy();
    await fireEvent.press(button('✓ Mark as checked'));
    await waitFor(() => expect(store.checkHomework).toHaveBeenCalledWith('old', ''));
  });
});
