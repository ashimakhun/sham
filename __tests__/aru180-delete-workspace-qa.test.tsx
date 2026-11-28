// ARU-180 QA: Delete workspace (UI side), adding to aru180-delete-workspace.test.tsx: Russian texts, the button before
// the summary loads and for a non-teacher, an offline error, the load error's instruction, the deactivated screen for
// every former role and over deep-linked content, and the Profile order with ARU-185's legal links.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import DeleteWorkspaceScreen from '@/app/delete-workspace';
import { AccessGate, DEACTIVATED_TITLE } from '@/components/AccessGate';
import { translate } from '@/i18n';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { DELETE_OFFLINE } from '@/lib/deleteAccount';

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

const button = (name: string | RegExp) => screen.getByRole('button', { name });
const isDisabled = (node: { props: { accessibilityState?: { disabled?: boolean } } }) =>
  !!node.props.accessibilityState?.disabled;

async function openScreen(over: Parameters<typeof fakeStore>[1] = {}, who: 'T' = 'T') {
  const store = fakeStore(who, {
    getWorkspaceDeletionSummary: jest.fn(async () => ({ name: 'Sunny School', otherAccounts: 5 })),
    ...over,
  });
  setStore(store);
  await render(<DeleteWorkspaceScreen />);
  await act(async () => {});
  return store;
}

beforeEach(() => jest.clearAllMocks());

describe('AC1 with ARU-185: Delete account stays the last Profile button', () => {
  it.each(['T', 'S1', 'M'] as const)('%s: Delete account is the last button, right after Sign out', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    const buttons = screen.getAllByRole('button');
    const del = buttons.indexOf(button('Delete account'));
    expect(del).toBe(buttons.length - 1);
    expect(buttons[del - 1]).toBe(button('Sign out'));
  });
});

describe('AC2: Russian', () => {
  it('the explanation, the count (plural form) and the button are in Russian', async () => {
    const store = fakeStore('T', {
      currentUser: { ...users.T, language: 'ru' },
      getWorkspaceDeletionSummary: jest.fn(async () => ({ name: 'Sunny School', otherAccounts: 5 })),
    });
    setStore(store);
    await render(
      <LanguageProvider>
        <DeleteWorkspaceScreen />
      </LanguageProvider>,
    );
    await act(async () => {});
    const text = screen.getByTestId('delete-workspace-explanation');
    expect(text).toHaveTextContent(/^Ваш аккаунт и рабочее пространство Sunny School удаляются/);
    expect(text).toHaveTextContent(/5 других аккаунтов в нём деактивируются/);
    expect(text).toHaveTextContent(/Это нельзя отменить\.$/);
    expect(screen.getByRole('button', { name: 'Удалить рабочее пространство' })).toBeTruthy();
  });
});

describe('AC3: the button', () => {
  it('stays disabled while the workspace name is still loading, even with both fields filled', async () => {
    setStore(fakeStore('T', { getWorkspaceDeletionSummary: jest.fn(() => new Promise<never>(() => {})) }));
    await render(<DeleteWorkspaceScreen />);
    await fireEvent.changeText(screen.getByLabelText('Workspace name'), 'Sunny School');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    expect(isDisabled(button('Delete workspace'))).toBe(true);
  });

  it('a Cyrillic name typed in another case is accepted', async () => {
    await openScreen({ getWorkspaceDeletionSummary: jest.fn(async () => ({ name: 'Школа Солнце', otherAccounts: 1 })) });
    await fireEvent.changeText(screen.getByLabelText('Workspace name'), ' школа СОЛНЦЕ ');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    expect(isDisabled(button('Delete workspace'))).toBe(false);
  });

  it('no summary (not the teacher any more): says so and the button stays disabled', async () => {
    await openScreen({ getWorkspaceDeletionSummary: jest.fn(async () => null) });
    expect(screen.getByTestId('delete-workspace-not-teacher')).toHaveTextContent(
      'Only the teacher can delete the workspace.',
    );
    await fireEvent.changeText(screen.getByLabelText('Workspace name'), 'Sunny School');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    expect(isDisabled(button('Delete workspace'))).toBe(true);
  });
});

describe('AC12: errors', () => {
  it('offline: the offline error shows, both fields are kept and the button works again', async () => {
    const deleteWorkspace = jest.fn(async () => Promise.reject(new Error(DELETE_OFFLINE)));
    await openScreen({ deleteWorkspace });
    await fireEvent.changeText(screen.getByLabelText('Workspace name'), 'Sunny School');
    await fireEvent.changeText(screen.getByLabelText('Password'), 'secret1');
    await fireEvent.press(button('Delete workspace'));
    expect(await screen.findByText(DELETE_OFFLINE)).toBeTruthy();
    expect(screen.getByLabelText('Workspace name').props.value).toBe('Sunny School');
    expect(screen.getByLabelText('Password').props.value).toBe('secret1');
    expect(isDisabled(button('Delete workspace'))).toBe(false);
  });

  it("the summary's load error tells the user what actually works on this screen", async () => {
    const view = await (async () => {
      setStore(
        fakeStore('T', { getWorkspaceDeletionSummary: jest.fn(async () => Promise.reject(new Error('offline'))) }),
      );
      const v = await render(<DeleteWorkspaceScreen />);
      await act(async () => {});
      return v;
    })();
    const message = screen.getByTestId('delete-workspace-load-error');
    expect(button('Try again')).toBeTruthy();
    // The screen has a Try again button and no pull to refresh, so the message must not ask to pull down.
    const hasPullToRefresh = view.container.queryAll((n) => !!n.props.refreshControl).length > 0;
    if (!hasPullToRefresh) {
      expect(message).not.toHaveTextContent(/pull down/i);
      expect(translate('ru', 'deleteWorkspace.loadError')).not.toMatch(/потяните/i);
    }
  });
});

describe('AC9: the deactivated screen', () => {
  const App = () => (
    <AccessGate>
      <Text>course screen from a deep link</Text>
    </AccessGate>
  );
  it.each(['S1', 'M', 'M2'] as const)('former %s sees only "Your workspace was deleted", never the route', async (who) => {
    setStore(fakeStore(who, { currentUser: { ...users[who], accessStatus: 'deactivated' } }));
    await render(<App />);
    expect(screen.getByText(DEACTIVATED_TITLE)).toBeTruthy();
    expect(screen.queryByText('course screen from a deep link')).toBeNull();
    expect(screen.queryByText(translate('en', 'gate.waitingTitle'))).toBeNull();
    expect(screen.queryByText(translate('en', 'gate.declinedTitle'))).toBeNull();
  });

  it('the waiting and declined screens are unchanged (ARU-43)', async () => {
    setStore(fakeStore('S1', { currentUser: { ...users.S1, accessStatus: 'pending' } }));
    await render(<App />);
    expect(screen.getByText(translate('en', 'gate.waitingTitle'))).toBeTruthy();
    expect(button('Check again')).toBeTruthy();
    setStore(fakeStore('S1', { currentUser: { ...users.S1, accessStatus: 'rejected' } }));
    await render(<App />);
    expect(screen.getByText(translate('en', 'gate.declinedTitle'))).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
  });
});
