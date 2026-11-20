// ARU-169: the teacher makes a one-time reset code on Manage roles (UI side).
// The rules themselves are tested against the database in supabase/tests/aru169_reset_codes.test.sql.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';

import RolesScreen from '@/app/roles';
import { dbErrorMessage, formatDateTimeIn } from '@/i18n';
import { confirmAction } from '@/lib/confirm';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@/lib/confirm', () => ({ confirmAction: jest.fn(), confirmDestructive: jest.fn() }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => true) }));

const confirm = confirmAction as jest.Mock;
const row = (id: string) => screen.getByTestId(`user-${id}`);
const shownNames = () => screen.queryAllByTestId(/^user-/).map((r) => r.props.testID.slice(5));
const memberUsernames = { T: 'tess', M: 'max', S1: 'sam' };
const CODE = { code: 'ABCD-EFGH-JKMN-PQRS', expiresAt: '2026-05-13T09:05:00Z' };

function teacher(over: Record<string, unknown> = {}) {
  const store = fakeStore('T', {
    memberUsernames,
    makeResetCode: jest.fn(async () => CODE),
    ...over,
  } as never);
  setStore(store);
  return store;
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe('AC 1: usernames on Manage roles', () => {
  it('rows show @username under the name; an account without one shows nothing', async () => {
    teacher();
    await render(<RolesScreen />);
    expect(within(row('T')).getByText('@tess')).toBeTruthy();
    expect(within(row('M')).getByText('@max')).toBeTruthy();
    expect(within(row('S1')).getByText('@sam')).toBeTruthy();
    expect(within(row('S2')).queryByText(/^@/)).toBeNull();
  });

  it('search matches the username too, and the name still', async () => {
    teacher();
    await render(<RolesScreen />);
    const search = screen.getByLabelText('Search users');
    await fireEvent.changeText(search, 'SAM');
    expect(shownNames()).toEqual(['S1']);
    await fireEvent.changeText(search, 'tes');
    expect(shownNames()).toEqual(['T']); // "Teacher Tess" and @tess: one row
    await fireEvent.changeText(search, 'nina');
    expect(shownNames()).toEqual(['N']);
  });
});

describe('AC 2: Reset password button', () => {
  it('mentor and student rows have it; the teacher row has none', async () => {
    teacher();
    await render(<RolesScreen />);
    for (const id of ['M', 'N', 'M2', 'S1', 'S2', 'S3']) {
      expect(within(row(id)).getByRole('button', { name: `Reset password for ${users(id)}` })).toBeTruthy();
    }
    expect(within(row('T')).queryByText('Reset password')).toBeNull();
  });

  it('request rows have none', async () => {
    teacher({
      accessRequests: [{ id: 'P1', name: 'Pending Pat', username: 'pat', createdAt: '2026-10-01T10:00:00Z', status: 'pending' }],
    });
    await render(<RolesScreen />);
    expect(within(screen.getByTestId('request-P1')).queryByText('Reset password')).toBeNull();
  });
});

describe('AC 3–4: confirmation and the Reset code sheet', () => {
  it('Cancel makes no code', async () => {
    const store = teacher();
    confirm.mockResolvedValue(false);
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByTestId('reset-password-S1'));
    expect(confirm).toHaveBeenCalledWith(
      'Reset password',
      'Make a reset code for Student Sam? It lets them set a new password within 24 hours. Any earlier reset code for them stops working.',
      'Make code',
    );
    expect(store.makeResetCode).not.toHaveBeenCalled();
    expect(screen.queryByTestId('reset-code-sheet')).toBeNull();
  });

  it('Make code shows name, @username, the code, Copy and the expiry; Done forgets it', async () => {
    const store = teacher();
    confirm.mockResolvedValue(true);
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByTestId('reset-password-S1'));
    expect(store.makeResetCode).toHaveBeenCalledWith('S1');
    const sheet = await screen.findByTestId('reset-code-sheet');
    expect(within(sheet).getByText('Reset code')).toBeTruthy();
    expect(within(sheet).getByText('Student Sam')).toBeTruthy();
    expect(within(sheet).getByText('@sam')).toBeTruthy();
    const code = within(sheet).getByTestId('reset-code');
    expect(code.props.children).toBe(CODE.code);
    expect(code.props.selectable).toBe(true);
    expect(
      within(sheet).getByText(
        `Give this code to Student Sam in person or by message. It works once, until ${formatDateTimeIn('en', CODE.expiresAt)}. You won't see it again.`,
      ),
    ).toBeTruthy();

    await fireEvent.press(within(sheet).getByRole('button', { name: 'Copy reset code' }));
    expect(Clipboard.setStringAsync).toHaveBeenCalledWith(CODE.code);
    expect(within(sheet).getByText('Copied')).toBeTruthy();

    await fireEvent.press(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByTestId('reset-code-sheet')).toBeNull();
    expect(screen.queryByText(CODE.code)).toBeNull();
  });

  it('edge: an account without a username is told so, without a confirmation or a code', async () => {
    const store = teacher();
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByTestId('reset-password-S2'));
    expect(
      await screen.findByText('Student Sue has no username yet. They need to sign in and choose one first.'),
    ).toBeTruthy();
    expect(confirm).not.toHaveBeenCalled();
    expect(store.makeResetCode).not.toHaveBeenCalled();
  });

  it('edge: a server error shows under the search field and no code', async () => {
    teacher({ makeResetCode: jest.fn(async () => Promise.reject(new Error('Network request failed'))) });
    confirm.mockResolvedValue(true);
    await render(<RolesScreen />);
    await act(async () => {
      fireEvent.press(screen.getByTestId('reset-password-M'));
    });
    expect(await screen.findByText('Network request failed')).toBeTruthy();
    expect(screen.queryByTestId('reset-code-sheet')).toBeNull();
  });
});

describe('AC 11: database refusals in Russian', () => {
  it.each([
    ['only_teacher_reset_code', '42501', {}, 'Только преподаватель может создавать коды сброса.'],
    ['reset_code_students_mentors', '42501', {}, 'Коды сброса можно создавать только для студентов и менторов.'],
    [
      'reset_code_no_username',
      '23514',
      { name: 'Сабина' },
      'У Сабина пока нет имени пользователя. Сначала нужно войти и выбрать его.',
    ],
  ])('db.%s', (code, errcode, details, ru) => {
    const error = { message: 'English', code: errcode, hint: `sham:${code}`, details: JSON.stringify(details) };
    expect(dbErrorMessage(error, 'ru')).toBe(ru);
    expect(dbErrorMessage(error, 'en')).toBe('English');
  });
});

function users(id: string) {
  return { M: 'Mentor Max', N: 'Mentor Nina', M2: 'Mentor Mo', S1: 'Student Sam', S2: 'Student Sue', S3: 'Abby Student' }[
    id
  ];
}
