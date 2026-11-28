// ARU-181: Delete workspace, part 2 (UI side). A deactivated account joins another workspace with an invite code or
// creates its own, from "Your workspace was deleted". The store's calls are tested in aru181-store-rejoin.test.tsx,
// the database functions in supabase/tests/aru181_rejoin_workspace.test.sql.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AccessGate, DEACTIVATED_TEXT, DEACTIVATED_TITLE } from '@/components/AccessGate';
import { translate } from '@/i18n';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { INVITE_CODE_UNKNOWN } from '@/lib/password';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

const App = () => (
  <AccessGate>
    <Text>the app</Text>
  </AccessGate>
);
const codeField = () => screen.getByPlaceholderText('8 letters and digits');
const nameField = () => screen.getByPlaceholderText('My school');
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const isDisabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) =>
  !!node.props.accessibilityState?.disabled;
const deactivated = (over: Parameters<typeof fakeStore>[1] = {}, who: 'S1' | 'M' = 'S1') =>
  fakeStore(who, { currentUser: { ...users[who], accessStatus: 'deactivated' }, ...over });

beforeEach(() => jest.clearAllMocks());

describe('AC1: the choice on the deactivated screen', () => {
  it('shows the new text and the switch set to Join, with the invite code field', async () => {
    setStore(deactivated());
    await render(<App />);
    expect(screen.getByText(DEACTIVATED_TITLE)).toBeTruthy();
    expect(DEACTIVATED_TEXT).toBe(
      'The teacher deleted your workspace and everything in it. To keep using Sham, join another workspace or create your own.',
    );
    expect(screen.getByText(DEACTIVATED_TEXT)).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Join a workspace' }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByRole('tab', { name: 'Create a workspace' })).toBeTruthy();
    expect(screen.getByText('Invite code')).toBeTruthy();
    expect(codeField()).toBeTruthy();
    expect(screen.queryByPlaceholderText('My school')).toBeNull();
    expect(button('Join')).toBeTruthy();
    // ARU-180 AC 9 stays: Sign out, Delete account, the legal links.
    expect(button('Sign out')).toBeTruthy();
    expect(button('Delete account')).toBeTruthy();
    expect(screen.getByText('Privacy Policy')).toBeTruthy();
  });

  it('Create shows the workspace name field and the Create button', async () => {
    setStore(deactivated());
    await render(<App />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Create a workspace' }));
    expect(screen.getByText('Workspace name')).toBeTruthy();
    expect(nameField()).toBeTruthy();
    expect(nameField().props.maxLength).toBe(80);
    expect(screen.queryByPlaceholderText('8 letters and digits')).toBeNull();
    expect(button('Create')).toBeTruthy();
  });

  it('the waiting and declined screens have no join form', async () => {
    setStore(fakeStore('S1', { currentUser: { ...users.S1, accessStatus: 'pending' } }));
    await render(<App />);
    expect(screen.queryByTestId('rejoin-card')).toBeNull();
    setStore(fakeStore('S1', { currentUser: { ...users.S1, accessStatus: 'rejected' } }));
    await render(<App />);
    expect(screen.queryByTestId('rejoin-card')).toBeNull();
  });

  it('in Russian', async () => {
    setStore(deactivated({ currentUser: { ...users.S1, accessStatus: 'deactivated', language: 'ru' } }));
    await render(
      <LanguageProvider>
        <App />
      </LanguageProvider>,
    );
    expect(screen.getByText(translate('ru', 'gate.deactivatedText'))).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Присоединиться' })).toBeTruthy();
  });
});

describe('AC2: the button', () => {
  it('is disabled while the shown field is empty or only spaces', async () => {
    setStore(deactivated());
    await render(<App />);
    expect(isDisabled(button('Join'))).toBe(true);
    await fireEvent.changeText(codeField(), '   ');
    expect(isDisabled(button('Join'))).toBe(true);
    await fireEvent.changeText(codeField(), 'abcd1234');
    expect(isDisabled(button('Join'))).toBe(false);
    await fireEvent.press(screen.getByRole('tab', { name: 'Create a workspace' }));
    expect(isDisabled(button('Create'))).toBe(true);
  });

  it('shows Joining… while sending, and a double tap sends one request', async () => {
    let finish: () => void = () => {};
    const rejoinWorkspace = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    setStore(deactivated({ rejoinWorkspace }));
    await render(<App />);
    await fireEvent.changeText(codeField(), 'abcd1234');
    await fireEvent.press(button('Join'));
    await fireEvent.press(screen.getByRole('button', { name: /^(Join|Joining…)$/ }));
    expect(button('Joining…')).toBeTruthy();
    expect(isDisabled(button('Joining…'))).toBe(true);
    expect(rejoinWorkspace).toHaveBeenCalledTimes(1);
    await act(async () => finish());
  });

  it('shows Creating… while sending', async () => {
    const rejoinWorkspace = jest.fn(() => new Promise<void>(() => {}));
    setStore(deactivated({ rejoinWorkspace }));
    await render(<App />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Create a workspace' }));
    await fireEvent.changeText(nameField(), 'New school');
    await fireEvent.press(button('Create'));
    expect(button('Creating…')).toBeTruthy();
  });
});

describe('AC3 / AC5: sends the choice', () => {
  it('Join sends the typed code', async () => {
    const store = deactivated();
    setStore(store);
    await render(<App />);
    await fireEvent.changeText(codeField(), '  abcd1234 ');
    await fireEvent.press(button('Join'));
    expect(store.rejoinWorkspace).toHaveBeenCalledWith({ kind: 'join', code: '  abcd1234 ' });
  });

  it('a former mentor sees the same form; Create sends the name', async () => {
    const store = deactivated({}, 'M');
    setStore(store);
    await render(<App />);
    await fireEvent.press(screen.getByRole('tab', { name: 'Create a workspace' }));
    await fireEvent.changeText(nameField(), ' New school ');
    await fireEvent.press(button('Create'));
    expect(store.rejoinWorkspace).toHaveBeenCalledWith({ kind: 'create', name: ' New school ' });
  });
});

describe('AC4 / AC9 / AC10: errors keep the field', () => {
  it.each([
    ['AC4 wrong code', INVITE_CODE_UNKNOWN],
    ['AC9 offline', translate('en', 'auth.network')],
    ['AC10 already in a workspace', translate('en', 'db.workspace_already_member')],
  ])('%s: shows the message, keeps the text, and a second tap retries', async (_name, message) => {
    const rejoinWorkspace = jest.fn(async () => {
      throw new Error(message);
    });
    setStore(deactivated({ rejoinWorkspace }));
    await render(<App />);
    await fireEvent.changeText(codeField(), 'ZZZZ9999');
    await fireEvent.press(button('Join'));
    await act(async () => {});
    expect(screen.getByText(message)).toBeTruthy();
    expect(codeField().props.value).toBe('ZZZZ9999');
    await fireEvent.press(button('Join'));
    await act(async () => {});
    expect(rejoinWorkspace).toHaveBeenCalledTimes(2);
  });

  it('the new error is translated in Russian', () => {
    expect(translate('en', 'db.workspace_already_member')).toBe('You already belong to a workspace.');
    expect(translate('ru', 'db.workspace_already_member')).toBe('Вы уже состоите в рабочем пространстве.');
  });
});

describe('AC11: the keyboard', () => {
  it('the screen scrolls above the keyboard and dismisses it', async () => {
    setStore(deactivated());
    const view = await render(<App />);
    const scroll = view.container.queryAll((n) => n.type === 'RCTScrollView' && !!n.props.refreshControl)[0];
    expect(scroll.props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(scroll.props.keyboardShouldPersistTaps).toBe('handled');
    expect(scroll.props.keyboardDismissMode).toBeTruthy();
  });
});
