// ARU-75: deleting your own account (UI side). The server side is tested in
// supabase/functions/_shared/delete-account.test.ts and supabase/tests/aru75_delete_account.test.sql; the store's
// call and the other-device check in aru75-store-delete-account.test.tsx.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Text } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import CourseDetailScreen from '@/app/courses/[id]';
import CourseChatScreen from '@/app/courses/[id]/chat';
import ListenersScreen from '@/app/courses/[id]/members';
import MeetingNotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import DeleteAccountScreen from '@/app/delete-account';
import GeneralChatScreen from '@/app/general-chat';
import HomeworkDetailScreen from '@/app/homework/[id]';
import SignInScreen from '@/app/index';
import { AccessGate } from '@/components/AccessGate';
import { ACCOUNT_DELETED, DELETED_ACCOUNT, ownedCoursesProblem, personName, WRONG_PASSWORD } from '@/lib/deleteAccount';
import { PHOTO_UNAVAILABLE } from '@/lib/photo';
import type { CourseMessage, Meeting } from '@/lib/types';

import { courseA, fakeStore, hw, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => ({
  ...require('./helpers/mocks').expoRouter,
  Redirect: ({ href }: { href: string }) => {
    const { Text: T } = require('react-native');
    return <T>{`redirect:${href}`}</T>;
  },
}));
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const EXPLANATION =
  'Your profile, homework and photos, course memberships, attendance marks, feedback, likes, materials and PDFs you ' +
  'shared, and your Telegram link are deleted. Your chat messages and the work you did for others (checked homework, ' +
  "meetings, notes) stay, shown as Deleted account. This can't be undone.";

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const deleteButton = () => button(/^(Delete my account|Deleting…)$/);
const isDisabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) =>
  !!node.props.accessibilityState?.disabled;

beforeEach(() => {
  jest.clearAllMocks();
  params.id = undefined;
  params.meetingId = undefined;
  params.edit = undefined;
});

describe('AC1: Delete account on the Profile tab', () => {
  it.each(['S1', 'M2'] as const)('%s sees it last in the bottom group, below Sign out, and it opens the screen', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    const buttons = screen.getAllByRole('button');
    const del = buttons.indexOf(button('Delete account'));
    expect(del).toBe(buttons.length - 1);
    expect(del).toBe(buttons.indexOf(button('Sign out')) + 1);
    await fireEvent.press(button('Delete account'));
    expect(router.push).toHaveBeenCalledWith('/delete-account');
  });

  it('an accountant mentor sees it too', async () => {
    setStore(fakeStore('M2', { currentUser: { ...users.M2, isAccountant: true } }));
    await render(<ProfileScreen />);
    expect(button('Delete account')).toBeTruthy();
  });

  it('the teacher does not', async () => {
    setStore(fakeStore('T'));
    await render(<ProfileScreen />);
    expect(screen.queryByRole('button', { name: 'Delete account' })).toBeNull();
  });
});

describe('AC2–AC4, AC12: the Delete account screen', () => {
  it('AC2: explains what happens; Delete my account is disabled until a password is typed', async () => {
    setStore(fakeStore('S1'));
    await render(<DeleteAccountScreen />);
    expect(screen.getByTestId('delete-account-explanation')).toHaveTextContent(EXPLANATION);
    const field = screen.getByLabelText('Password');
    expect(field.props.secureTextEntry).toBe(true);
    expect(isDisabled(deleteButton())).toBe(true);
    await fireEvent.changeText(field, 'secret1');
    expect(isDisabled(deleteButton())).toBe(false);
  });

  it('AC2: Cancel goes back without deleting', async () => {
    const store = fakeStore('S1');
    setStore(store);
    await render(<DeleteAccountScreen />);
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    await fireEvent.press(button('Cancel'));
    expect(router.back).toHaveBeenCalled();
    expect(store.deleteAccount).not.toHaveBeenCalled();
  });

  it('AC4: sends the typed password', async () => {
    const store = fakeStore('S1');
    setStore(store);
    await render(<DeleteAccountScreen />);
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    await fireEvent.press(deleteButton());
    expect(store.deleteAccount).toHaveBeenCalledWith('secret1');
  });

  it('AC3: a wrong password shows "Password is incorrect" and keeps what was typed', async () => {
    const store = fakeStore('S1', { deleteAccount: jest.fn(async () => Promise.reject(new Error(WRONG_PASSWORD))) });
    setStore(store);
    await render(<DeleteAccountScreen />);
    await fireEvent.changeText(screen.getByLabelText('Password'), 'wrong!');
    await fireEvent.press(deleteButton());
    expect(await screen.findByText(WRONG_PASSWORD)).toBeTruthy();
    expect(screen.getByLabelText('Password').props.value).toBe('wrong!');
    expect(isDisabled(deleteButton())).toBe(false);
  });

  it('AC12: while deleting the button says "Deleting…" and is disabled; a double tap sends one request', async () => {
    let finish: () => void = () => {};
    const deleteAccount = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setStore(fakeStore('S1', { deleteAccount }));
    await render(<DeleteAccountScreen />);
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    const b = deleteButton();
    await fireEvent.press(b);
    await fireEvent.press(b);
    expect(deleteAccount).toHaveBeenCalledTimes(1);
    expect(button('Deleting…')).toBeTruthy();
    expect(isDisabled(button('Deleting…'))).toBe(true);
    await act(async () => finish());
  });

  it('AC12: an error (e.g. offline) is shown and tapping again retries', async () => {
    const deleteAccount = jest
      .fn()
      .mockRejectedValueOnce(new Error("Couldn't reach Sham. Check your connection and try again."))
      .mockResolvedValueOnce(undefined);
    setStore(fakeStore('S1', { deleteAccount }));
    await render(<DeleteAccountScreen />);
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    await fireEvent.press(deleteButton());
    expect(await screen.findByText(/Couldn't reach Sham/)).toBeTruthy();
    await fireEvent.press(deleteButton());
    expect(deleteAccount).toHaveBeenCalledTimes(2);
  });

  it('AC4: once the account is gone the screen goes to sign-in', async () => {
    setStore(fakeStore(null));
    await render(<DeleteAccountScreen />);
    expect(screen.getByText('redirect:/')).toBeTruthy();
  });

  it('AC6: a mentor who owns courses sees them listed and can\'t delete', async () => {
    const courseC = { ...courseA, id: 'C', title: 'Calculus' };
    const store = fakeStore('M', { courses: [courseC, courseA] });
    setStore(store);
    await render(<DeleteAccountScreen />);
    expect(
      screen.getByText('You own courses: Algebra, Calculus. Ask the teacher or a mentor to change their owner first.'),
    ).toBeTruthy();
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    expect(isDisabled(deleteButton())).toBe(true);
    await fireEvent.press(deleteButton());
    expect(store.deleteAccount).not.toHaveBeenCalled();
  });

  it('AC6: a mentor who owns nothing is not blocked', async () => {
    setStore(fakeStore('M2'));
    await render(<DeleteAccountScreen />);
    expect(screen.queryByTestId('delete-account-blocked')).toBeNull();
  });

  it('ownedCoursesProblem matches the database message', () => {
    expect(ownedCoursesProblem([])).toBeNull();
    expect(ownedCoursesProblem(['Zoology', 'Algebra'])).toBe(
      'You own courses: Algebra, Zoology. Ask the teacher or a mentor to change their owner first.',
    );
  });
});

describe('AC10: waiting and declined accounts', () => {
  const App = () => (
    <AccessGate>
      <Text>the app</Text>
    </AccessGate>
  );
  it.each([
    ['pending', 'waiting'],
    ['rejected', 'declined'],
  ] as const)('%s (%s): Delete account opens the same screen; Cancel goes back', async (status, _label) => {
    const store = fakeStore('S3', { currentUser: { ...users.S3, accessStatus: status } });
    setStore(store);
    await render(<App />);
    await fireEvent.press(button('Delete account'));
    expect(screen.getByText('Delete account')).toBeTruthy();
    expect(screen.getByTestId('delete-account-explanation')).toHaveTextContent(EXPLANATION);
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    await fireEvent.press(deleteButton());
    expect(store.deleteAccount).toHaveBeenCalledWith('secret1');
    await fireEvent.press(button('Cancel'));
    expect(button('Delete account')).toBeTruthy();
  });
});

describe('AC4 / AC9: the sign-in screen says the account was deleted', () => {
  it('shows "Your account was deleted"', async () => {
    setStore(fakeStore(null, { accountNotice: ACCOUNT_DELETED }));
    await render(<SignInScreen />);
    expect(screen.getByText('Your account was deleted')).toBeTruthy();
  });
  it('and nothing otherwise', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    expect(screen.queryByTestId('account-notice')).toBeNull();
  });
});

describe('AC8: shared content shows "Deleted account"', () => {
  const cmsg = (id: string, authorId: string | null, body: string, minute: number): CourseMessage => ({
    id,
    courseId: 'A',
    authorId,
    body,
    createdAt: `2026-10-28T10:${String(minute).padStart(2, '0')}:00.000Z`,
  });

  it('course chat: no name, no role or Owner badge, not "Former member"', async () => {
    params.id = 'A';
    const messages = [cmsg('c2', 'M', 'from the owner', 2), cmsg('c1', null, 'from a deleted user', 1)];
    setStore(
      fakeStore('S1', {
        courseMembers: [member('A', 'S1')],
        loadMessages: jest.fn(async () => ({ messages, hasMore: false })),
      }),
    );
    await render(<CourseChatScreen />);
    await screen.findByText('from a deleted user');
    expect(screen.getByText(DELETED_ACCOUNT)).toBeTruthy();
    expect(screen.queryByText('Former member')).toBeNull();
    expect(screen.getAllByText('Owner')).toHaveLength(1); // only the real owner's message
  });

  it('general chat: "Deleted account", not "Unknown user"; an unreadable author keeps "Unknown user"', async () => {
    const messages = [
      { id: 'g2', authorId: 'ghost', body: 'unreadable profile', createdAt: '2026-11-02T10:02:00.000Z' },
      { id: 'g1', authorId: null, body: 'deleted author', createdAt: '2026-11-02T10:01:00.000Z' },
    ];
    setStore(fakeStore('S1', { loadGeneralMessages: jest.fn(async () => ({ messages, hasMore: false })) }));
    await render(<GeneralChatScreen />);
    await screen.findByText('deleted author');
    expect(screen.getByText(DELETED_ACCOUNT)).toBeTruthy();
    expect(screen.getByText('Unknown user')).toBeTruthy();
  });

  it('homework: the checker shows as "Deleted account"; comment and status stay', async () => {
    params.id = 'h1';
    const item = hw({ id: 'h1', courseId: 'A', status: 'checked', mentorComment: 'Well done', checkedAt: '2026-10-20T10:00:00.000Z' });
    setStore(fakeStore('S1', { visibleHomework: [item], courseMembers: [member('A', 'S1')] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.getByText('Well done')).toBeTruthy();
    expect(screen.getByText(new RegExp(`^${DELETED_ACCOUNT}`))).toBeTruthy();
  });

  it('homework: a checker this device can\'t read keeps today\'s blank name', async () => {
    params.id = 'h1';
    const item = hw({ id: 'h1', courseId: 'A', status: 'checked', checkedById: 'ghost' });
    setStore(fakeStore('S1', { visibleHomework: [item] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.queryByText(new RegExp(DELETED_ACCOUNT))).toBeNull();
  });

  const completed = (over: Partial<Meeting>): Meeting => ({
    id: 'K',
    courseId: 'A',
    startsAt: '2026-10-20T10:00:00.000Z',
    topic: 'Checked lesson',
    status: 'completed',
    createdById: null,
    createdAt: '2026-10-01T10:00:00.000Z',
    ...over,
  });

  it('MeetingsSection: a checked meeting whose checker deleted their account shows no checker line (ARU-126 AC 7)', async () => {
    params.id = 'A';
    const k = completed({ homeworkCheckedAt: '2026-10-21T10:00:00.000Z', homeworkCheckedById: undefined });
    setStore(fakeStore('S1', { meetings: [k], courseMembers: [member('A', 'S1')] }));
    await render(<CourseDetailScreen />);
    // ARU-126 removed the "Homework checked by <name> · <date>" line from MEETING HISTORY.
    expect(screen.queryByText(/Homework checked by/)).toBeNull();
    expect(screen.queryByText(/Unknown/)).toBeNull();
  });

  // ARU-142: one kind of notes; a note whose author deleted their account is signed "Deleted account".
  it('meeting notes: signed "Deleted account"', async () => {
    params.id = 'A';
    params.meetingId = 'K';
    const k = completed({});
    const note = { id: 'nk', meetingId: k.id, courseId: 'A', authorId: null, body: 'Read chapter 1',
      createdAt: '2026-10-21T10:00:00.000Z', updatedAt: '2026-10-21T10:00:00.000Z', isPublic: true };
    setStore(fakeStore('S1', { meetings: [k], courseMembers: [member('A', 'S1')], meetingListenerNotes: [note] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByText('Deleted account')).toBeTruthy();
    expect(screen.getByText('Read chapter 1')).toBeTruthy();
  });

  it('personName: empty reference -> Deleted account; unreadable -> the screen\'s fallback', () => {
    expect(personName(null, undefined, 'Unknown')).toBe(DELETED_ACCOUNT);
    expect(personName(undefined, undefined, 'Unknown')).toBe(DELETED_ACCOUNT);
    expect(personName('ghost', undefined, 'Unknown')).toBe('Unknown');
    expect(personName('S1', users.S1, 'Unknown')).toBe('Student Sam');
  });
});

describe('AC8 / AC11: screens that only show rows deleted with the account never show the deleted user', () => {
  // After S2 is deleted: their profile and memberships are gone; a listener addition by S2's mentor... is kept.
  const others = Object.values(users).filter((u) => u.id !== 'S2');
  const after = (who: 'M' | 'T') =>
    fakeStore(who, {
      users: others,
      getUser: (id) => others.find((u) => u.id === id),
      courseMembers: [{ ...member('A', 'S1'), addedById: null }],
    });

  it('course details (listeners, owner line): no deleted user, no "Unknown", count without them', async () => {
    params.id = 'A';
    setStore(after('M'));
    await render(<CourseDetailScreen />);
    expect(screen.queryByText(/Student Sue/)).toBeNull();
    expect(screen.queryByText(/Unknown|Deleted account/)).toBeNull();
    // ARU-97: listener names moved to the Listeners page.
    await render(<ListenersScreen />);
    expect(screen.queryByText(/Student Sue/)).toBeNull();
    expect(screen.queryByText(/Unknown|Deleted account/)).toBeNull();
    expect(screen.getByText(/Student Sam/)).toBeTruthy();
  });

  it('Profile: no deleted user, no "Unknown"', async () => {
    setStore(after('M'));
    await render(<ProfileScreen />);
    expect(screen.queryByText(/Student Sue|Unknown|Deleted account/)).toBeNull();
  });
});

describe('AC12 b: a homework photo whose file is gone', () => {
  it('shows "Photo unavailable" instead of an empty box', async () => {
    params.id = 'h1';
    const item = hw({ id: 'h1', courseId: 'A', photoPath: 'S1/h1.jpg' }); // no signed link: the file is gone
    setStore(fakeStore('S1', { visibleHomework: [item], courseMembers: [member('A', 'S1')] }));
    await render(<HomeworkDetailScreen />);
    expect(screen.getByText(PHOTO_UNAVAILABLE)).toBeTruthy();
    expect(screen.queryByTestId('homework-photo')).toBeNull();
  });

  it('or when the image fails to load', async () => {
    params.id = 'h1';
    const item = hw({ id: 'h1', courseId: 'A', photoPath: 'S1/h1.jpg', photoUrl: 'https://signed.example/x' });
    setStore(fakeStore('S1', { visibleHomework: [item], courseMembers: [member('A', 'S1')] }));
    await render(<HomeworkDetailScreen />);
    const img = screen.getByTestId('homework-photo');
    await act(async () => img.props.onError?.({ nativeEvent: { error: 'not found' } }));
    expect(within(screen.getByTestId('homework-photo-unavailable')).getByText(PHOTO_UNAVAILABLE)).toBeTruthy();
  });
});
