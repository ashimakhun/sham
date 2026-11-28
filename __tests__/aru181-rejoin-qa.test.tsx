// ARU-181 QA: screen checks the dev tests (aru181-rejoin.test.tsx) don't cover: Russian texts of both modes and while
// sending, the database errors in Russian, the keyboard's Done key, refresh, and the gate after a join / create.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { AccessGate } from '@/components/AccessGate';
import { dbErrorMessage, setCurrentLanguage, translate } from '@/i18n';
import { LanguageProvider } from '@/i18n/LanguageProvider';

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
const Ru = () => (
  <LanguageProvider>
    <App />
  </LanguageProvider>
);
const ru = (key: Parameters<typeof translate>[1]) => translate('ru', key);
const isDisabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) =>
  !!node.props.accessibilityState?.disabled;
const deactivated = (over: Parameters<typeof fakeStore>[1] = {}, language: 'en' | 'ru' = 'en') =>
  fakeStore('S1', { currentUser: { ...users.S1, accessStatus: 'deactivated', language }, ...over });

beforeEach(() => {
  jest.clearAllMocks();
  setCurrentLanguage('en');
});

describe('AC1 / AC2 in Russian', () => {
  it('Join mode: the switch, the field, its placeholder and the button', async () => {
    setStore(deactivated({}, 'ru'));
    await render(<Ru />);
    expect(screen.getByText(ru('gate.deactivatedTitle'))).toBeTruthy();
    expect(screen.getByRole('tab', { name: ru('signIn.workspaceJoin') }).props.accessibilityState).toEqual({ selected: true });
    expect(screen.getByRole('tab', { name: ru('signIn.workspaceCreate') })).toBeTruthy();
    expect(screen.getByText(ru('signIn.inviteCode'))).toBeTruthy();
    expect(screen.getByPlaceholderText(ru('signIn.inviteCodePlaceholder'))).toBeTruthy();
    expect(screen.getByRole('button', { name: ru('gate.join') })).toBeTruthy();
  });

  it('Create mode and Создаём… while sending', async () => {
    const rejoinWorkspace = jest.fn(() => new Promise<void>(() => {}));
    setStore(deactivated({ rejoinWorkspace }, 'ru'));
    await render(<Ru />);
    await fireEvent.press(screen.getByRole('tab', { name: ru('signIn.workspaceCreate') }));
    expect(screen.getByText(ru('signIn.workspaceName'))).toBeTruthy();
    await fireEvent.changeText(screen.getByPlaceholderText(ru('signIn.workspaceNamePlaceholder')), 'Школа');
    await fireEvent.press(screen.getByRole('button', { name: ru('gate.create') }));
    expect(ru('gate.creating')).toBe('Создаём…');
    expect(isDisabled(screen.getByRole('button', { name: ru('gate.creating') }))).toBe(true);
  });

  it('Присоединяем… while joining', async () => {
    const rejoinWorkspace = jest.fn(() => new Promise<void>(() => {}));
    setStore(deactivated({ rejoinWorkspace }, 'ru'));
    await render(<Ru />);
    await fireEvent.changeText(screen.getByPlaceholderText(ru('signIn.inviteCodePlaceholder')), 'abcd1234');
    await fireEvent.press(screen.getByRole('button', { name: ru('gate.join') }));
    expect(ru('gate.joining')).toBe('Присоединяем…');
    expect(screen.getByRole('button', { name: ru('gate.joining') })).toBeTruthy();
  });
});

// The store throws dbErrorMessage(error) (src/lib/store.tsx rejoinWorkspace), which is already in the user's language
// (ARU-111): these tests throw exactly that, built at call time, so the screen gets what it gets on a phone.
const dbError = (hint: string, message: string, code: string) => () => {
  throw new Error(dbErrorMessage({ hint, message, code }));
};
const DB_ERRORS = [
  ['AC4 unknown code', 'join', 'sham:invite_code_unknown', 'No workspace has this invite code.', 'P0002', 'db.invite_code_unknown'],
  ['AC5 name too long', 'create', 'sham:workspace_name_length', 'Workspace name must be 1 to 80 characters.', '23514', 'db.workspace_name_length'],
  ['AC10 already a member', 'join', 'sham:workspace_already_member', 'You already belong to a workspace.', '55000', 'db.workspace_already_member'],
] as const;

describe('AC4 / AC5 / AC10: database errors from the store', () => {
  it.each(DB_ERRORS)('%s: shown in English', async (_name, mode, hint, message, code) => {
    const rejoinWorkspace = jest.fn(async () => dbError(hint, message, code)());
    setStore(deactivated({ rejoinWorkspace }));
    await render(<App />);
    if (mode === 'create') await fireEvent.press(screen.getByRole('tab', { name: 'Create a workspace' }));
    await fireEvent.changeText(screen.getByPlaceholderText(mode === 'create' ? 'My school' : '8 letters and digits'), 'x');
    await fireEvent.press(screen.getByRole('button', { name: mode === 'create' ? 'Create' : 'Join' }));
    await act(async () => {});
    expect(screen.getByText(message)).toBeTruthy();
  });

  it.each(DB_ERRORS)('%s: shown in Russian (ARU-111), not the generic error', async (_name, mode, hint, message, code, key) => {
    const rejoinWorkspace = jest.fn(async () => dbError(hint, message, code)());
    setStore(deactivated({ rejoinWorkspace }, 'ru'));
    await render(<Ru />);
    if (mode === 'create') await fireEvent.press(screen.getByRole('tab', { name: ru('signIn.workspaceCreate') }));
    const field = screen.getByPlaceholderText(ru(mode === 'create' ? 'signIn.workspaceNamePlaceholder' : 'signIn.inviteCodePlaceholder'));
    await fireEvent.changeText(field, 'zzzz9999');
    await fireEvent.press(screen.getByRole('button', { name: ru(mode === 'create' ? 'gate.create' : 'gate.join') }));
    await act(async () => {});
    expect(screen.queryByText(ru('common.genericError'))).toBeNull();
    expect(screen.getByText(ru(key))).toBeTruthy();
    expect(field.props.value).toBe('zzzz9999');
  });
});

describe('AC11: the keyboard', () => {
  it('the Done key sends the form, and does nothing while the field is empty', async () => {
    const store = deactivated();
    setStore(store);
    await render(<App />);
    const field = screen.getByPlaceholderText('8 letters and digits');
    expect(field.props.returnKeyType).toBe('done');
    await fireEvent(field, 'submitEditing');
    expect(store.rejoinWorkspace).not.toHaveBeenCalled();
    await fireEvent.changeText(field, 'abcd1234');
    await fireEvent(field, 'submitEditing');
    expect(store.rejoinWorkspace).toHaveBeenCalledWith({ kind: 'join', code: 'abcd1234' });
  });

  it('the invite code field types capitals without autocorrect', async () => {
    setStore(deactivated());
    await render(<App />);
    const field = screen.getByPlaceholderText('8 letters and digits');
    expect(field.props.autoCapitalize).toBe('characters');
    expect(field.props.autoCorrect).toBe(false);
  });
});

describe('ARU-180 AC 9 kept: pull to refresh', () => {
  it('pulling the deactivated screen reloads', async () => {
    const store = deactivated();
    setStore(store);
    const view = await render(<App />);
    const scroll = view.container.queryAll((n) => n.type === 'RCTScrollView' && !!n.props.refreshControl)[0];
    await act(async () => scroll.props.refreshControl.props.onRefresh());
    expect(store.refresh).toHaveBeenCalled();
  });
});

describe('AC3 / AC5 / AC8: the gate after the store reloads', () => {
  it('pending after a join: Waiting for approval with Check again, no join form', async () => {
    setStore(fakeStore('S1', { currentUser: { ...users.S1, accessStatus: 'pending', role: 'student' } }));
    await render(<App />);
    expect(screen.getByText(translate('en', 'gate.waitingTitle'))).toBeTruthy();
    expect(screen.getByRole('button', { name: translate('en', 'gate.checkAgain') })).toBeTruthy();
    expect(screen.queryByTestId('rejoin-card')).toBeNull();
  });

  it('declined after a join: Request declined, no join form', async () => {
    setStore(fakeStore('S1', { currentUser: { ...users.S1, accessStatus: 'rejected' } }));
    await render(<App />);
    expect(screen.getByText(translate('en', 'gate.declinedTitle'))).toBeTruthy();
    expect(screen.queryByTestId('rejoin-card')).toBeNull();
  });

  it('approved teacher after a create: the app', async () => {
    setStore(fakeStore('T'));
    await render(<App />);
    expect(screen.getByText('the app')).toBeTruthy();
  });
});
