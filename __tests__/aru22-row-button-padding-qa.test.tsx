// ARU-22 QA additions to aru22-row-button-padding.test.tsx. The fix adds side padding to the shared Button, so
// this checks every kind of Button placement: the Manage roles rows (padding, the name column shrinks instead
// of the button, long names), full-width buttons (only the side padding changed), and the fixed-width chat
// "Send" button (its label still fits). jest can't measure pixels; a real-device glance is still worthwhile.
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import SignInScreen from '@/app/index';
import RolesScreen from '@/app/roles';
import { Button, styles } from '@/components/ui';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);
jest.mock('@/lib/confirm', () => ({ confirmDestructive: jest.fn() }));

type Style = Record<string, unknown>;
const flat = (el: { props: { style?: unknown } }) => (StyleSheet.flatten(el.props.style as never) ?? {}) as Style;

beforeEach(() => jest.clearAllMocks());

describe('shared Button', () => {
  it.each(['primary', 'secondary', 'danger'] as const)('%s variant has 16 side padding, and disabled keeps it', async (variant) => {
    await render(<Button title="Go" variant={variant} onPress={() => {}} disabled />);
    const s = flat(screen.getByRole('button', { name: 'Go' }));
    expect(s.paddingHorizontal).toBe(16);
    expect(s.paddingVertical).toBe(13);
  });

  it('only side padding was added: no width, alignSelf or flex that would change full-width buttons', () => {
    expect(styles.button).toEqual({ borderRadius: 10, paddingVertical: 13, paddingHorizontal: 16, alignItems: 'center' });
  });

  it('full-width buttons (e.g. Sign in) still stretch: nothing narrows them', async () => {
    setStore(fakeStore(null));
    await render(<SignInScreen />);
    const s = flat(screen.getByRole('button', { name: 'Sign in' }));
    expect(s.width).toBeUndefined();
    expect(s.alignSelf).toBeUndefined();
    expect(s.flex).toBeUndefined();
  });
});

describe('Manage roles rows', () => {
  it('every Make mentor / Make student button has side padding and does not shrink', async () => {
    setStore(fakeStore('T'));
    await render(<RolesScreen />);
    const buttons = screen.getAllByRole('button', { name: /^Make (mentor|student)$/ });
    expect(buttons.length).toBe(6); // S1, S2, S3 → Make mentor; M, N, M2 → Make student
    for (const b of buttons) {
      const s = flat(b);
      expect(s.paddingHorizontal).toBe(16);
      expect((s.flexShrink as number | undefined) ?? 0).toBe(0);
    }
  });

  it('the name column takes the leftover width (flex 1) and wraps a long name to at most 2 lines', async () => {
    const long = { ...users.S1, name: 'Aigerim Nurlanovna Abdrakhmanova-Seitkazinova' };
    setStore(fakeStore('T', { users: [users.T, long, users.M] }));
    await render(<RolesScreen />);
    const row = screen.getByTestId('user-S1');
    const name = within(row).getByText(long.name);
    expect(name.props.numberOfLines).toBe(2);
    const column = name.parent as { props: { style?: unknown } } | undefined;
    expect(column && flat(column).flex).toBe(1);
    expect(within(row).getByRole('button', { name: 'Make mentor' })).toBeTruthy();
  });

  it('regression: the teacher row still has no button', async () => {
    setStore(fakeStore('T'));
    await render(<RolesScreen />);
    expect(within(screen.getByTestId('user-T')).queryByRole('button')).toBeNull();
  });
});

describe('fixed-width chat Send button', () => {
  it('the 80-wide Send container still leaves room for the label after 16 + 16 side padding', () => {
    // "Send" at 15px semibold is about 36px wide; 80 - 2 * 16 = 48.
    const inner = 80 - 2 * (styles.button as Style & { paddingHorizontal: number }).paddingHorizontal;
    expect(inner).toBeGreaterThanOrEqual(40);
  });
});
