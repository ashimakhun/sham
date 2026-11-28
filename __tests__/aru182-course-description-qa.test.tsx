// QA ARU-182: gaps in aru182-course-description.test.tsx: Russian texts (label, placeholder, Save / Сохранение…, the
// owner-only error from the database); a mentor listener and an accountant mentor who don't own the course get no
// section; a long multi-line text saves with its inner line breaks; course details and the course card show the new
// description, and none when it's empty (AC 4 / AC 5), for a listener and for a non-listener student (ARU-24).
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import EditCourseScreen from '@/app/courses/[id]/edit';
import CourseDetailScreen from '@/app/courses/[id]';
import { CourseCard } from '@/components/CourseCard';
import { dbErrorMessage } from '@/i18n';
import { I18nContext, make } from '@/i18n/context';
import type { Course } from '@/lib/types';

import { courseA, fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const A: Course = { ...courseA, description: 'Equations and more' };
const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const field = () => screen.getByTestId('edit-course-description');
const isDisabled = (el: { props: { accessibilityState?: { disabled?: boolean } } }) => !!el.props.accessibilityState?.disabled;

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('QA ARU-182', () => {
  it('Russian: label, placeholder, Сохранить → Сохранение… while saving', async () => {
    let finish!: () => void;
    const setCourseDescription = jest.fn(() => new Promise<void>((r) => (finish = r)));
    setStore(fakeStore('M', { courses: [A], courseMembers: [member('A', 'S1')], setCourseDescription }));
    await render(ru(<EditCourseScreen />));
    expect(screen.getByText('Описание (необязательно)')).toBeTruthy();
    expect(field().props.placeholder).toBe('О чём этот курс?');
    await fireEvent.changeText(field(), 'Новое описание');
    const save = screen.getByRole('button', { name: 'Сохранить' });
    expect(isDisabled(save)).toBe(false);
    await fireEvent.press(save);
    expect(isDisabled(screen.getByRole('button', { name: 'Сохранение…' }))).toBe(true);
    expect(setCourseDescription).toHaveBeenCalledWith('A', 'Новое описание');
    await act(async () => finish());
  });

  it('AC 8: the owner-only database error is translated (EN and RU)', () => {
    const err = { code: '42501', message: 'Only the course owner can change its description.', hint: 'sham:course_description_owner_only' };
    expect(dbErrorMessage(err, 'en')).toBe('Only the course owner can change its description.');
    expect(dbErrorMessage(err, 'ru')).toBe('Изменить описание курса может только его куратор.');
  });

  it('AC 8: the Russian owner-only error shows under the field and the typed text stays', async () => {
    const setCourseDescription = jest.fn(async () => {
      throw new Error('Изменить описание курса может только его куратор.');
    });
    setStore(fakeStore('M', { courses: [A], courseMembers: [member('A', 'S1')], setCourseDescription }));
    await render(ru(<EditCourseScreen />));
    await fireEvent.changeText(field(), 'Моё описание');
    await fireEvent.press(screen.getByRole('button', { name: 'Сохранить' }));
    expect(screen.getByText('Изменить описание курса может только его куратор.')).toBeTruthy();
    expect(field().props.value).toBe('Моё описание');
  });

  it.each([
    ['a mentor listener who does not own the course', 'M2' as const, {}],
    ['an accountant mentor who does not own the course', 'N' as const, { isAccountant: true }],
  ])('AC 2: %s gets no Description section', async (_label, who, extra) => {
    setStore({
      ...fakeStore(who, { courses: [A], courseMembers: [member('A', 'S1'), member('A', 'M2')] }),
      currentUser: { ...users[who], ...extra },
    });
    await render(<EditCourseScreen />);
    expect(screen.queryByTestId('edit-course-description')).toBeNull();
  });

  it('a long multi-line description is sent whole, only its outer spaces trimmed', async () => {
    const setCourseDescription = jest.fn(async () => {});
    setStore(fakeStore('T', { courses: [A], courseMembers: [member('A', 'S1')], setCourseDescription }));
    await render(<EditCourseScreen />);
    const long = `Week 1\n\n${'Algebra basics. '.repeat(300)}\nWeek 2`;
    await fireEvent.changeText(field(), `\n  ${long}  \n`);
    await fireEvent.press(screen.getByRole('button', { name: 'Save' }));
    expect(setCourseDescription).toHaveBeenCalledWith('A', long);
  });

  it.each([
    ['a listener', 'S1' as const],
    ['a student who is not a listener (ARU-24)', 'S2' as const],
  ])('AC 4 / AC 5: course details show the description to %s, and no line when empty', async (_label, who) => {
    setStore(fakeStore(who, { courses: [{ ...A, description: 'Updated text' }], courseMembers: [member('A', 'S1')] }));
    const view = await render(<CourseDetailScreen />);
    expect(screen.getByText('Updated text')).toBeTruthy();
    await view.unmount();
    setStore(fakeStore(who, { courses: [{ ...A, description: '' }], courseMembers: [member('A', 'S1')] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByText('Updated text')).toBeNull();
    expect(screen.queryByText('Equations and more')).toBeNull();
  });

  it('AC 4 / AC 5: the course card shows the new description, and none when empty', async () => {
    setStore(fakeStore('S1', { courses: [A], courseMembers: [member('A', 'S1')] }));
    const view = await render(<CourseCard course={{ ...A, description: 'Card text' }} />);
    expect(screen.getByText('Card text')).toBeTruthy();
    await view.rerender(<CourseCard course={{ ...A, description: '' }} />);
    expect(screen.queryByText('Card text')).toBeNull();
  });
});
