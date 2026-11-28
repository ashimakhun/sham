// ARU-182: Edit course gets a Description section (field + Save) for the course owner and the teacher. The server
// rules (trim, owner / teacher only, safe retry) are covered by supabase/tests/aru182_course_description.test.sql.
// Teacher T; mentor M owns A; mentor N owns nothing here; S1 is a listener of A.
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import EditCourseScreen from '@/app/courses/[id]/edit';
import type { Course } from '@/lib/types';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const A: Course = { ...courseA, description: 'Equations and more' };
const forRole = (who: 'T' | 'M' | 'N' | 'S1', over = {}) =>
  fakeStore(who, { courses: [A], courseMembers: [member('A', 'S1')], ...over });

const field = () => screen.getByTestId('edit-course-description');
const saveButton = () => screen.getByRole('button', { name: 'Save' });
const isDisabled = (el: ReturnType<typeof saveButton>) => !!el.props.accessibilityState?.disabled;

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('AC 1 / AC 2: who sees the Description section', () => {
  it.each(['T', 'M'] as const)('%s sees the field with the current description, label, placeholder and Save', async (who) => {
    setStore(forRole(who));
    await render(<EditCourseScreen />);
    expect(screen.getByText('Description (optional)')).toBeTruthy();
    expect(field().props.value).toBe('Equations and more');
    expect(field().props.placeholder).toBe('What is this course about?');
    expect(field().props.multiline).toBe(true);
    expect(saveButton()).toBeTruthy();
  });

  it('the Description section comes before the Discipline section', async () => {
    setStore(forRole('T', { disciplines: [{ id: 'DM', name: 'Math', hidden: false, createdById: 'T', createdAt: '2026-11-01T10:00:00.000Z' }] }));
    await render(<EditCourseScreen />);
    const json = JSON.stringify(screen.toJSON());
    expect(json.indexOf('Description (optional)')).toBeGreaterThan(-1);
    expect(json.indexOf('Description (optional)')).toBeLessThan(json.indexOf('Discipline'));
  });

  it('the teacher sees it on a hidden course they do not own', async () => {
    setStore(forRole('T', { courses: [{ ...A, hidden: true }] }));
    await render(<EditCourseScreen />);
    expect(field()).toBeTruthy();
  });

  it('a mentor who does not own the course sees no Description section', async () => {
    setStore(forRole('N'));
    await render(<EditCourseScreen />);
    expect(screen.queryByTestId('edit-course-description')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Change owner' })).toBeTruthy();
  });

  it('a student sees "Not allowed"', async () => {
    setStore(forRole('S1'));
    await render(<EditCourseScreen />);
    expect(screen.getByText('Not allowed')).toBeTruthy();
    expect(screen.queryByTestId('edit-course-description')).toBeNull();
  });
});

describe('AC 3: Save button state', () => {
  it('disabled on open, enabled after a change, disabled again for the same text or only extra spaces', async () => {
    setStore(forRole('M'));
    await render(<EditCourseScreen />);
    expect(isDisabled(saveButton())).toBe(true);
    await fireEvent.changeText(field(), 'Something new');
    expect(isDisabled(saveButton())).toBe(false);
    await fireEvent.changeText(field(), '  Equations and more \n');
    expect(isDisabled(saveButton())).toBe(true);
  });

  it('shows "Saving…" and is disabled while saving', async () => {
    let finish: () => void = () => {};
    const store = forRole('M');
    (store.setCourseDescription as jest.Mock).mockImplementation(() => new Promise<void>((r) => (finish = r)));
    setStore(store);
    await render(<EditCourseScreen />);
    await fireEvent.changeText(field(), 'New');
    await fireEvent.press(saveButton());
    const saving = screen.getByRole('button', { name: 'Saving…' });
    expect(isDisabled(saving)).toBe(true);
    await act(async () => finish());
  });
});

describe('AC 4 / AC 5: saving', () => {
  it('saves the trimmed text, shows it, and disables Save', async () => {
    const store = forRole('M');
    setStore(store);
    const view = await render(<EditCourseScreen />);
    await fireEvent.changeText(field(), '  New text  ');
    await fireEvent.press(saveButton());
    await waitFor(() => expect(store.setCourseDescription).toHaveBeenCalledWith('A', 'New text'));
    // The store reloads with the saved value.
    setStore({ ...store, courses: [{ ...A, description: 'New text' }], getCourse: () => ({ ...A, description: 'New text' }) });
    await view.rerender(<EditCourseScreen />);
    await waitFor(() => expect(field().props.value).toBe('New text'));
    expect(isDisabled(saveButton())).toBe(true);
  });

  it('clearing the field (or only spaces) saves an empty description', async () => {
    const store = forRole('T');
    setStore(store);
    await render(<EditCourseScreen />);
    await fireEvent.changeText(field(), '   ');
    await fireEvent.press(saveButton());
    await waitFor(() => expect(store.setCourseDescription).toHaveBeenCalledWith('A', ''));
  });
});

describe('AC 7: errors and double taps', () => {
  it('a failed save shows the error, keeps the typed text, and Save retries', async () => {
    const store = forRole('M');
    (store.setCourseDescription as jest.Mock)
      .mockRejectedValueOnce(new Error('Could not reach the server. Check your connection and try again.'))
      .mockResolvedValueOnce(undefined);
    setStore(store);
    await render(<EditCourseScreen />);
    await fireEvent.changeText(field(), 'Typed');
    await fireEvent.press(saveButton());
    expect(await screen.findByText('Could not reach the server. Check your connection and try again.')).toBeTruthy();
    expect(field().props.value).toBe('Typed');
    await fireEvent.press(saveButton());
    await waitFor(() => expect(store.setCourseDescription).toHaveBeenCalledTimes(2));
  });

  it('a double tap sends one save', async () => {
    const store = forRole('M');
    setStore(store);
    await render(<EditCourseScreen />);
    await fireEvent.changeText(field(), 'Once');
    const btn = saveButton();
    await act(async () => {
      fireEvent.press(btn);
      fireEvent.press(btn);
    });
    await waitFor(() => expect(store.setCourseDescription).toHaveBeenCalledTimes(1));
  });
});

describe('AC 8 and live updates', () => {
  it('the owner-only error shows, and after the owner change the section disappears', async () => {
    const store = forRole('M');
    (store.setCourseDescription as jest.Mock).mockRejectedValueOnce(new Error('Only the course owner can change its description.'));
    setStore(store);
    const view = await render(<EditCourseScreen />);
    await fireEvent.changeText(field(), 'Late');
    await fireEvent.press(saveButton());
    expect(await screen.findByText('Only the course owner can change its description.')).toBeTruthy();
    setStore(forRole('M', { courses: [{ ...A, createdById: 'N' }] }));
    await view.rerender(<EditCourseScreen />);
    expect(screen.queryByTestId('edit-course-description')).toBeNull();
  });

  it('a reload with someone else\'s change keeps what I typed, and Save compares against the latest saved text', async () => {
    setStore(forRole('M'));
    const view = await render(<EditCourseScreen />);
    await fireEvent.changeText(field(), 'Mine');
    setStore(forRole('M', { courses: [{ ...A, description: 'Mine' }] }));
    await view.rerender(<EditCourseScreen />);
    expect(field().props.value).toBe('Mine');
    expect(isDisabled(saveButton())).toBe(true);
  });

  it('a reload while I have not typed shows the new saved text', async () => {
    setStore(forRole('M'));
    const view = await render(<EditCourseScreen />);
    setStore(forRole('M', { courses: [{ ...A, description: 'From the teacher' }] }));
    await view.rerender(<EditCourseScreen />);
    await waitFor(() => expect(field().props.value).toBe('From the teacher'));
  });
});

describe('AC 9: keyboard', () => {
  it('Edit course is a KeyboardForm (keyboard insets, dismiss on drag, taps on Save handled)', async () => {
    setStore(forRole('M'));
    await render(<EditCourseScreen />);
    const form = screen.getByTestId('keyboard-form');
    expect(form.props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(form.props.keyboardShouldPersistTaps).toBe('handled');
    expect(form.props.keyboardDismissMode).toBeTruthy();
  });
});
