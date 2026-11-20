// QA ARU-169: gaps in aru169-reset-code.test.tsx. Searching with the "@" the screen shows, the disabled-while-busy rule
// for the row's buttons, a new code after Done (AC 4), closing the sheet with the system back gesture, the Russian
// confirmation, button and sheet (AC 11), a role change refusal from the server shown under the search, and that the
// shared Button's two new optional props change nothing for existing buttons.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Text } from 'react-native';

import RolesScreen from '@/app/roles';
import { Button } from '@/components/ui';
import { formatDateTimeIn } from '@/i18n';
import { LanguageProvider } from '@/i18n/LanguageProvider';
import { confirmAction } from '@/lib/confirm';
import type { User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@/lib/confirm', () => ({ confirmAction: jest.fn(), confirmDestructive: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));
jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'en-US', languageCode: 'en' }]) }));

const confirm = confirmAction as jest.Mock;
const row = (id: string) => screen.getByTestId(`user-${id}`);
const shownNames = () => screen.queryAllByTestId(/^user-/).map((r) => r.props.testID.slice(5));
const memberUsernames = { T: 'tess', M: 'max', S1: 'sam' };
const CODE1 = { code: 'ABCD-EFGH-JKMN-PQRS', expiresAt: '2026-05-13T09:05:00Z' };
const CODE2 = { code: 'WXYZ-2345-6789-ABCD', expiresAt: '2026-05-13T10:00:00Z' };

function teacher(over: Record<string, unknown> = {}, language?: 'en' | 'ru') {
  const me: User = { ...users.T, language };
  const store = fakeStore('T', { currentUser: me, memberUsernames, makeResetCode: jest.fn(async () => CODE1), ...over } as never);
  setStore(store);
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AC 1: search by username', () => {
  it('typing the username as shown, with "@", finds the row', async () => {
    teacher();
    await render(<RolesScreen />);
    await fireEvent.changeText(screen.getByLabelText('Search users'), '@sam');
    expect(shownNames()).toEqual(['S1']);
  });

  it('part of a username in the middle matches; a username of nobody here matches nothing', async () => {
    teacher();
    await render(<RolesScreen />);
    const search = screen.getByLabelText('Search users');
    await fireEvent.changeText(search, 'ax');
    expect(shownNames()).toEqual(['M']);
    await fireEvent.changeText(search, 'zzz_nobody');
    expect(shownNames()).toEqual([]);
  });
});

describe('AC 2 / edge: Reset password shares the disabled-while-busy rule', () => {
  it('while a confirmation is open every row button is disabled, and enabled again after Cancel', async () => {
    let answer: (v: boolean) => void = () => {};
    confirm.mockImplementation(() => new Promise<boolean>((r) => (answer = r)));
    teacher();
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByTestId('reset-password-S1'));
    for (const id of ['M', 'S1', 'S2']) {
      expect(screen.getByTestId(`reset-password-${id}`).props.accessibilityState?.disabled).toBe(true);
    }
    expect(within(row('S2')).getByRole('button', { name: 'Make mentor' }).props.accessibilityState?.disabled).toBe(true);
    await act(async () => answer(false));
    expect(screen.getByTestId('reset-password-S2').props.accessibilityState?.disabled).toBeFalsy();
  });
});

describe('AC 4–5: a code is shown once', () => {
  it('after Done, Reset password again asks again and shows only the new code', async () => {
    const makeResetCode = jest.fn().mockResolvedValueOnce(CODE1).mockResolvedValueOnce(CODE2);
    teacher({ makeResetCode });
    confirm.mockResolvedValue(true);
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByTestId('reset-password-S1'));
    await fireEvent.press(within(await screen.findByTestId('reset-code-sheet')).getByRole('button', { name: 'Done' }));
    await fireEvent.press(screen.getByTestId('reset-password-S1'));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(makeResetCode).toHaveBeenCalledTimes(2);
    const sheet = await screen.findByTestId('reset-code-sheet');
    expect(within(sheet).getByTestId('reset-code').props.children).toBe(CODE2.code);
    expect(screen.queryByText(CODE1.code)).toBeNull();
  });

  it('closing the sheet with the system back gesture forgets the code too', async () => {
    teacher();
    confirm.mockResolvedValue(true);
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByTestId('reset-password-M'));
    await screen.findByTestId('reset-code-sheet');
    // The sheet's Modal (the nearest ancestor with onRequestClose: Android back, iOS swipe down).
    let modal = screen.getByTestId('reset-code-sheet').parent;
    while (modal && !modal.props.onRequestClose) modal = modal.parent;
    expect(modal).toBeTruthy();
    await act(async () => modal!.props.onRequestClose());
    expect(screen.queryByTestId('reset-code-sheet')).toBeNull();
    expect(screen.queryByText(CODE1.code)).toBeNull();
  });

  it('a server refusal shows under the search field, no sheet', async () => {
    teacher({ makeResetCode: jest.fn(async () => Promise.reject(new Error('Accept Mentor Max first.'))) });
    confirm.mockResolvedValue(true);
    await render(<RolesScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('reset-password-M'));
    });
    expect(await screen.findByText('Accept Mentor Max first.')).toBeTruthy();
    expect(screen.queryByTestId('reset-code-sheet')).toBeNull();
  });
});

describe('AC 11: Russian', () => {
  it('button label, confirmation and the Reset code sheet', async () => {
    teacher({}, 'ru');
    confirm.mockResolvedValue(true);
    await render(
      <LanguageProvider>
        <RolesScreen />
      </LanguageProvider>,
    );
    const button = screen.getByTestId('reset-password-S1');
    expect(button.props.accessibilityLabel).toBe('Сбросить пароль для Student Sam');
    expect(within(button).getByText('Сбросить пароль')).toBeTruthy();
    await fireEvent.press(button);
    expect(confirm).toHaveBeenCalledWith(
      'Сброс пароля',
      'Создать код сброса для Student Sam? С ним можно задать новый пароль в течение 24 часов. Прежний код сброса для этого человека перестанет действовать.',
      'Создать код',
    );
    const sheet = await screen.findByTestId('reset-code-sheet');
    expect(within(sheet).getByText('Код сброса')).toBeTruthy();
    expect(
      within(sheet).getByText(
        `Передайте этот код Student Sam лично или в сообщении. Он действует один раз, до ${formatDateTimeIn('ru', CODE1.expiresAt)}. Больше вы его не увидите.`,
      ),
    ).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Скопировать код сброса' })).toBeTruthy();
    expect(within(sheet).getByRole('button', { name: 'Готово' })).toBeTruthy();
  });

  it('no username yet, in Russian', async () => {
    teacher({}, 'ru');
    await render(
      <LanguageProvider>
        <RolesScreen />
      </LanguageProvider>,
    );
    await fireEvent.press(screen.getByTestId('reset-password-S2'));
    expect(await screen.findByText('У Student Sue пока нет имени пользователя. Сначала нужно войти и выбрать его.')).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('Regression: Button with no new props is unchanged', () => {
  it('a plain button: no label override, no testID, the title as text', async () => {
    await render(<Button title="Save" onPress={() => {}} />);
    const b = screen.getByRole('button');
    expect(b.props.accessibilityLabel).toBeUndefined();
    expect(b.props.testID).toBeUndefined();
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('an icon button keeps the title as its label; an unread count still joins it', async () => {
    const view = await render(<Button title="Chat" icon="chatbubble-outline" onPress={() => {}} />);
    expect(screen.getByRole('button').props.accessibilityLabel).toBe('Chat');
    await view.rerender(<Button title="Chat" icon="chatbubble-outline" unread={3} onPress={() => {}} />);
    expect(screen.getByRole('button').props.accessibilityLabel).not.toBe('Chat');
    expect(screen.getByRole('button').props.accessibilityLabel).toContain('Chat');
  });

  it('the new props only add a label and a testID', async () => {
    await render(
      <>
        <Text>x</Text>
        <Button title="Reset password" accessibilityLabel="Reset password for Sam" testID="b1" onPress={() => {}} />
      </>,
    );
    const b = screen.getByTestId('b1');
    expect(b.props.accessibilityLabel).toBe('Reset password for Sam');
    expect(within(b).getByText('Reset password')).toBeTruthy();
  });
});
