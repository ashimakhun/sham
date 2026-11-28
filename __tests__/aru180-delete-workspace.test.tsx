// ARU-180: Delete workspace (UI side). The server side is tested in
// supabase/functions/_shared/delete-workspace.test.ts and supabase/tests/aru180_delete_workspace.test.sql; the store's
// call and the other-device checks in aru180-store-delete-workspace.test.tsx.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { router } from 'expo-router';
import { Text } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import DeleteWorkspaceScreen from '@/app/delete-workspace';
import SignInScreen from '@/app/index';
import { AccessGate, DEACTIVATED_TEXT, DEACTIVATED_TITLE } from '@/components/AccessGate';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { WORKSPACE_DELETED, workspaceNameMatches, WRONG_PASSWORD } from '@/lib/deleteAccount';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

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
  'Your account and the workspace Sunny School are deleted, with everything in it: courses, disciplines, meetings, ' +
  'notes, homework and photos, chats, Blog posts, PDFs, payments and their proofs, reviews, reports and the invite ' +
  "code. The 5 other accounts in it are deactivated: they can't use Sham until they join another workspace. This " +
  "can't be undone.";

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const deleteButton = () => button(/^(Delete workspace|Deleting…)$/);
const isDisabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) =>
  !!node.props.accessibilityState?.disabled;
const summary = (otherAccounts = 5) => jest.fn(async () => ({ name: 'Sunny School', otherAccounts }));

async function openScreen(over: Parameters<typeof fakeStore>[1] = {}) {
  const store = fakeStore('T', { getWorkspaceDeletionSummary: summary(), ...over });
  setStore(store);
  await render(<DeleteWorkspaceScreen />);
  await act(async () => {});
  return store;
}
async function fill(name: string, password: string) {
  await fireEvent.changeText(screen.getByLabelText('Workspace name'), name);
  await fireEvent.changeText(screen.getByLabelText('Password'), password);
}

beforeEach(() => jest.clearAllMocks());

describe('AC1: the entry point', () => {
  it('the teacher sees Delete account last, below Sign out, and it opens Delete workspace', async () => {
    setStore(fakeStore('T'));
    await render(<ProfileScreen />);
    const buttons = screen.getAllByRole('button');
    const del = buttons.indexOf(button('Delete account'));
    expect(del).toBe(buttons.length - 1);
    expect(del).toBe(buttons.indexOf(button('Sign out')) + 1);
    await fireEvent.press(button('Delete account'));
    expect(router.push).toHaveBeenCalledWith('/delete-workspace');
  });

  it.each(['S1', 'M2'] as const)('%s keeps the Delete account screen', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    await fireEvent.press(button('Delete account'));
    expect(router.push).toHaveBeenCalledWith('/delete-account');
  });

  it('a student or mentor opening the route is sent to Delete account', async () => {
    setStore(fakeStore('S1'));
    await render(<DeleteWorkspaceScreen />);
    expect(screen.getByText('redirect:/delete-account')).toBeTruthy();
  });
});

describe('AC2: the explanation', () => {
  it('names the workspace and the number of other accounts', async () => {
    await openScreen();
    expect(screen.getByTestId('delete-workspace-explanation')).toHaveTextContent(EXPLANATION);
    expect(screen.getByTestId('delete-workspace-name')).toHaveTextContent('Sunny School');
  });

  it('one other account: singular', async () => {
    await openScreen({ getWorkspaceDeletionSummary: summary(1) });
    expect(screen.getByTestId('delete-workspace-explanation')).toHaveTextContent(
      /The 1 other account in it is deactivated: it can't use Sham until it joins another workspace\./,
    );
  });

  it('edge case: a workspace with only the teacher has no sentence about other accounts', async () => {
    await openScreen({ getWorkspaceDeletionSummary: summary(0) });
    const text = screen.getByTestId('delete-workspace-explanation');
    expect(text).not.toHaveTextContent(/other account/);
    expect(text).toHaveTextContent(/invite code\. This can't be undone\.$/);
  });

  it('a failed load shows an error and Try again loads again', async () => {
    const get = jest
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue({ name: 'Sunny School', otherAccounts: 5 });
    await openScreen({ getWorkspaceDeletionSummary: get });
    expect(screen.getByTestId('delete-workspace-load-error')).toBeTruthy();
    await fireEvent.press(button('Try again'));
    await act(async () => {});
    expect(screen.getByTestId('delete-workspace-explanation')).toHaveTextContent(EXPLANATION);
  });
});

describe('AC3: the confirmation', () => {
  it('the password is hidden; autofill doesn’t fill the name field', async () => {
    await openScreen();
    expect(screen.getByLabelText('Password').props.secureTextEntry).toBe(true);
    const name = screen.getByLabelText('Workspace name');
    expect(name.props.secureTextEntry).toBeFalsy();
    expect(name.props.autoComplete).toBe('off');
    expect(name.props.textContentType).toBe('none');
  });

  it.each([
    ['', 'secret1', true],
    ['Sunny School', '', true],
    ['Sunny', 'secret1', true],
    ['Sunny  School', 'secret1', true],
    ['  sunny SCHOOL ', 'secret1', false],
    ['Sunny School', 'secret1', false],
  ])('name "%s", password "%s": disabled %s', async (name, password, disabled) => {
    await openScreen();
    await fill(name, password);
    expect(isDisabled(deleteButton())).toBe(disabled);
  });

  it('matches like the server (shared rule)', () => {
    expect(workspaceNameMatches(' ШКОЛА ', 'школа')).toBe(true);
    expect(workspaceNameMatches('школа 1', 'школа')).toBe(false);
  });

  it('Cancel goes back without deleting', async () => {
    const store = await openScreen();
    await fill('Sunny School', 'secret1');
    await fireEvent.press(button('Cancel'));
    expect(router.back).toHaveBeenCalled();
    expect(store.deleteWorkspace).not.toHaveBeenCalled();
  });
});

describe('AC4, AC5, AC12: deleting', () => {
  it('AC5: sends the typed name and password', async () => {
    const store = await openScreen();
    await fill(' sunny school', 'secret1');
    await fireEvent.press(deleteButton());
    expect(store.deleteWorkspace).toHaveBeenCalledWith(' sunny school', 'secret1');
  });

  it('AC4: a wrong password shows "Password is incorrect" and keeps both fields', async () => {
    await openScreen({ deleteWorkspace: jest.fn(async () => Promise.reject(new Error(WRONG_PASSWORD))) });
    await fill('Sunny School', 'wrong!');
    await fireEvent.press(deleteButton());
    expect(await screen.findByText(WRONG_PASSWORD)).toBeTruthy();
    expect(screen.getByLabelText('Workspace name').props.value).toBe('Sunny School');
    expect(screen.getByLabelText('Password').props.value).toBe('wrong!');
    expect(isDisabled(deleteButton())).toBe(false);
  });

  it('AC12: while deleting the button says "Deleting…" and is disabled; a double tap sends one request', async () => {
    let finish: () => void = () => {};
    const deleteWorkspace = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    await openScreen({ deleteWorkspace });
    await fill('Sunny School', 'secret1');
    const b = deleteButton();
    await fireEvent.press(b);
    await fireEvent.press(b);
    expect(deleteWorkspace).toHaveBeenCalledTimes(1);
    expect(isDisabled(button('Deleting…'))).toBe(true);
    await act(async () => finish());
  });

  it('AC12: an error is shown and tapping again retries', async () => {
    const deleteWorkspace = jest
      .fn()
      .mockRejectedValueOnce(new Error("Your account and workspace couldn't be deleted. Please try again."))
      .mockResolvedValueOnce(undefined);
    await openScreen({ deleteWorkspace });
    await fill('Sunny School', 'secret1');
    await fireEvent.press(deleteButton());
    expect(await screen.findByText(/couldn't be deleted/)).toBeTruthy();
    await fireEvent.press(deleteButton());
    expect(deleteWorkspace).toHaveBeenCalledTimes(2);
  });

  it('AC5: once deleted the screen goes to sign-in, which says so', async () => {
    setStore(fakeStore(null));
    await render(<DeleteWorkspaceScreen />);
    expect(screen.getByText('redirect:/')).toBeTruthy();
    setStore(fakeStore(null, { accountNotice: WORKSPACE_DELETED }));
    await render(<SignInScreen />);
    expect(screen.getByText(WORKSPACE_DELETED)).toBeTruthy();
  });
});

describe('AC9: a deactivated account', () => {
  const App = () => (
    <AccessGate>
      <Text>the app</Text>
    </AccessGate>
  );
  const deactivated = (over = {}) =>
    fakeStore('S1', { currentUser: { ...users.S1, accessStatus: 'deactivated' }, ...over });

  it('sees only "Your workspace was deleted" with Sign out and Delete account', async () => {
    setStore(deactivated());
    await render(<App />);
    expect(screen.queryByText('the app')).toBeNull();
    expect(screen.getByText(DEACTIVATED_TITLE)).toBeTruthy();
    expect(screen.getByText(DEACTIVATED_TEXT)).toBeTruthy();
    expect(button('Sign out')).toBeTruthy();
    expect(button('Delete account')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    // ARU-159 AC 7: the legal links, as on the waiting screen.
    expect(screen.getByText('Privacy Policy')).toBeTruthy();
  });

  it('Sign out signs out', async () => {
    const store = deactivated();
    setStore(store);
    await render(<App />);
    await fireEvent.press(button('Sign out'));
    expect(store.signOut).toHaveBeenCalled();
  });

  it('Delete account opens ARU-75’s screen and works with a password (no course-owner block)', async () => {
    const store = deactivated();
    setStore(store);
    await render(<App />);
    await fireEvent.press(button('Delete account'));
    expect(screen.getByTestId('delete-account-explanation')).toBeTruthy();
    expect(screen.queryByTestId('delete-account-blocked')).toBeNull();
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    await fireEvent.press(button('Delete my account'));
    expect(store.deleteAccount).toHaveBeenCalledWith('secret1');
  });

  it('pull to refresh checks again', async () => {
    const store = deactivated();
    setStore(store);
    const view = await render(<App />);
    const scroll = view.container.queryAll((n) => n.type === 'RCTScrollView' && !!n.props.refreshControl)[0];
    await act(async () => scroll.props.refreshControl.props.onRefresh());
    expect(store.refresh).toHaveBeenCalled();
  });

  it('in Russian', async () => {
    setStore(deactivated({ currentUser: { ...users.S1, accessStatus: 'deactivated', language: 'ru' } }));
    await render(
      <LanguageProvider>
        <App />
      </LanguageProvider>,
    );
    expect(screen.getByText('Ваше рабочее пространство удалено')).toBeTruthy();
  });
});
