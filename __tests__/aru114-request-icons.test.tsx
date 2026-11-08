// ARU-114: access requests on the Roles page show a green check mark and a red X (Requests) or a "Declined" badge and
// a compact "✓ Accept" button (Declined) instead of the Accept / Reject text buttons. Behaviour is unchanged (ARU-43).
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';

import RolesScreen from '@/app/roles';
import { colors } from '@/lib/theme';
import type { AccessRequest } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const req = (id: string, name: string, status: AccessRequest['status']): AccessRequest => ({
  id,
  name,
  email: `${id.toLowerCase()}@x.test`,
  createdAt: '2026-10-30T10:00:00.000Z',
  status,
});
const pending = req('P', 'Pending Pat', 'pending');
const rejected = req('R', 'Rejected Rae', 'rejected');
const flat = (el: { props: { style?: unknown } }) => StyleSheet.flatten(el.props.style as never) as Record<string, unknown>;

beforeEach(() => jest.clearAllMocks());

describe('ARU-114 request icons', () => {
  it('AC 1: a pending request has a green check and a red X in tinted circles, and no Accept / Reject text', async () => {
    setStore(fakeStore('T', { accessRequests: [pending] }));
    await render(<RolesScreen />);
    const accept = screen.getByTestId('accept-request-P');
    const reject = screen.getByTestId('reject-request-P');
    expect(flat(accept)).toMatchObject({ backgroundColor: colors.successSoft, width: 36, height: 36, borderRadius: 18 });
    expect(flat(reject)).toMatchObject({ backgroundColor: '#FEF2F2', width: 36, height: 36, borderRadius: 18 });
    expect(screen.queryByText('Accept')).toBeNull();
    expect(screen.queryByText('Reject')).toBeNull();
    expect(screen.queryByText('Declined')).toBeNull();
  });

  it('AC 2: a declined request has a red "Declined" badge and a compact "Accept" button, no reject', async () => {
    setStore(fakeStore('T', { accessRequests: [rejected] }));
    await render(<RolesScreen />);
    expect(screen.getByText('Declined')).toBeTruthy();
    const accept = screen.getByTestId('accept-request-R');
    expect(flat(accept)).toMatchObject({ backgroundColor: colors.successSoft });
    expect(screen.getByText('Accept')).toBeTruthy();
    expect(screen.queryByTestId('reject-request-R')).toBeNull();
  });

  it('AC 3: the check mark and the Declined "Accept" accept at once, without a confirmation', async () => {
    const store = fakeStore('T', { accessRequests: [pending, rejected] });
    setStore(store);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByTestId('accept-request-P'));
    expect(store.setAccessStatus).toHaveBeenCalledWith('P', 'approved');
    await fireEvent.press(screen.getByTestId('accept-request-R'));
    expect(store.setAccessStatus).toHaveBeenCalledWith('R', 'approved');
    expect(alert).not.toHaveBeenCalled();
  });

  it('AC 4: the X asks first; cancelling changes nothing, confirming declines', async () => {
    const store = fakeStore('T', { accessRequests: [pending] });
    setStore(store);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByTestId('reject-request-P'));
    expect(alert).toHaveBeenCalledWith(
      'Reject request',
      "Reject Pending Pat? They won't be able to use Sham.",
      expect.any(Array),
      expect.any(Object),
    );
    const buttons = alert.mock.lastCall![2]!;
    await act(async () => buttons.find((b) => b.style === 'cancel')?.onPress?.());
    expect(store.setAccessStatus).not.toHaveBeenCalled();

    await fireEvent.press(screen.getByTestId('reject-request-P'));
    await act(async () => alert.mock.lastCall![2]!.find((b) => b.text === 'Reject')!.onPress!());
    expect(store.setAccessStatus).toHaveBeenCalledWith('P', 'rejected');
  });

  it('AC 5: while an action runs, every icon and Accept button is disabled and dimmed; a second tap does nothing', async () => {
    let finish!: () => void;
    const store = fakeStore('T', {
      accessRequests: [pending, rejected],
      setAccessStatus: jest.fn(() => new Promise<void>((resolve) => (finish = resolve))),
    });
    setStore(store);
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByTestId('accept-request-P'));
    for (const id of ['accept-request-P', 'reject-request-P', 'accept-request-R']) {
      const el = screen.getByTestId(id);
      expect(flat(el).opacity).toBe(0.4);
      expect(el.props.accessibilityState).toMatchObject({ disabled: true });
    }
    await fireEvent.press(screen.getByTestId('accept-request-R'));
    expect(store.setAccessStatus).toHaveBeenCalledTimes(1);
    await act(async () => finish());
    expect(flat(screen.getByTestId('accept-request-P')).opacity).toBe(1);
  });

  it('AC 6: screen readers get buttons named "Accept <name>" and "Reject <name>"', async () => {
    setStore(fakeStore('T', { accessRequests: [pending, rejected] }));
    await render(<RolesScreen />);
    expect(screen.getByRole('button', { name: 'Accept Pending Pat' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Reject Pending Pat' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Accept Rejected Rae' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Declined' })).toBeNull();
  });

  it('AC 7: each icon has a 44×44 touch area and the two touch areas do not overlap', async () => {
    setStore(fakeStore('T', { accessRequests: [pending] }));
    await render(<RolesScreen />);
    const accept = screen.getByTestId('accept-request-P');
    const reject = screen.getByTestId('reject-request-P');
    for (const el of [accept, reject]) {
      const slop = el.props.hitSlop as number;
      expect(36 + 2 * slop).toBeGreaterThanOrEqual(44);
    }
    // The circles' row: gap between them must be at least the two slops facing each other.
    // Walk up from the check mark to the first ancestor that lays the circles out with a gap.
    let row = accept.parent;
    while (row && flat(row)?.gap === undefined) row = row.parent;
    const gap = flat(row!).gap as number;
    expect(gap).toBe(8);
    expect((accept.props.hitSlop as number) + (reject.props.hitSlop as number)).toBeLessThanOrEqual(gap);
  });

  it('AC 8: a failed accept shows the error at the top and the row stays', async () => {
    setStore(
      fakeStore('T', { accessRequests: [pending], setAccessStatus: jest.fn().mockRejectedValue(new Error('Network request failed')) }),
    );
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByTestId('accept-request-P'));
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(screen.getByTestId('request-P')).toBeTruthy();
  });
});
