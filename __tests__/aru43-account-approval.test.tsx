// ARU-43: new accounts wait for the teacher's approval. Access is enforced by the database
// (supabase/tests/aru43_account_approval.test.sql); the app shows the waiting / declined screen instead of everything
// else and gives the teacher Requests and Declined sections on Manage roles.
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, Text } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import RolesScreen from '@/app/roles';
import { AccessGate, DECLINED_TEXT, WAITING_TEXT } from '@/components/AccessGate';
import type { AccessRequest, User } from '@/lib/types';

import { fakeStore, users } from './helpers/fakeStore';
import { setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const pat: User = { id: 'P', name: 'Pending Pat', role: 'student', accessStatus: 'pending' };
const rae: User = { id: 'R', name: 'Rejected Rae', role: 'student', accessStatus: 'rejected' };
const req = (id: string, name: string, status: AccessRequest['status'], createdAt: string): AccessRequest => ({
  id,
  name,
  email: `${id.toLowerCase()}@x.test`,
  createdAt,
  status,
});
const requests = [
  req('P', 'Pending Pat', 'pending', '2026-10-30T10:00:00.000Z'),
  req('Q', 'Pending Quinn', 'pending', '2026-10-31T10:00:00.000Z'),
  req('R', 'Rejected Rae', 'rejected', '2026-10-29T10:00:00.000Z'),
];
const App = () => (
  <AccessGate>
    <Text>The app</Text>
  </AccessGate>
);
const labels = () => screen.queryAllByText(/^(REQUESTS|TEACHER|MENTORS|STUDENTS|DECLINED)$/).map((n) => n.props.children);

beforeEach(() => jest.clearAllMocks());

describe('Waiting and declined screens (AC 1–3)', () => {
  it('a pending account sees only the waiting screen, with Check again and Sign out', async () => {
    const store = fakeStore(null, { currentUser: pat });
    setStore(store);
    await render(<App />);
    expect(screen.queryByText('The app')).toBeNull();
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
    expect(screen.getByText(WAITING_TEXT)).toBeTruthy();
    await fireEvent.press(screen.getByRole('button', { name: 'Check again' }));
    expect(store.refresh).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole('button', { name: 'Sign out' }));
    expect(store.signOut).toHaveBeenCalled();
  });

  it('Check again shows an error (offline) and stays on the waiting screen', async () => {
    setStore(fakeStore(null, { currentUser: pat, refresh: jest.fn().mockRejectedValue(new Error('Network request failed')) }));
    await render(<App />);
    await fireEvent.press(screen.getByRole('button', { name: 'Check again' }));
    expect(screen.getByText('Network request failed')).toBeTruthy();
    expect(screen.getByText('Waiting for approval')).toBeTruthy();
  });

  it('once accepted, the next check shows the app', async () => {
    setStore(fakeStore(null, { currentUser: pat }));
    const view = await render(<App />);
    setStore(fakeStore(null, { currentUser: { ...pat, accessStatus: 'approved' } }));
    await view.rerender(<App />);
    expect(screen.getByText('The app')).toBeTruthy();
    expect(screen.queryByText('Waiting for approval')).toBeNull();
  });

  it('a declined account sees "Request declined" with Sign out only', async () => {
    setStore(fakeStore(null, { currentUser: rae }));
    await render(<App />);
    expect(screen.getByText('Request declined')).toBeTruthy();
    expect(screen.getByText(DECLINED_TEXT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.queryByText('The app')).toBeNull();
  });

  it.each(['T', 'M', 'S1'] as const)('approved %s gets the app', async (who) => {
    setStore(fakeStore(who));
    await render(<App />);
    expect(screen.getByText('The app')).toBeTruthy();
  });

  it('signed out: the sign-in screen is not blocked', async () => {
    setStore(fakeStore(null));
    await render(<App />);
    expect(screen.getByText('The app')).toBeTruthy();
  });
});

describe('Requests on Manage roles (AC 5–7)', () => {
  it('Requests come first (oldest first), Declined last, with name, email and sign-up date', async () => {
    setStore(fakeStore('T', { accessRequests: requests }));
    await render(<RolesScreen />);
    expect(labels()).toEqual(['REQUESTS', 'TEACHER', 'MENTORS', 'STUDENTS', 'DECLINED']);
    const names = screen.getAllByText(/^(Pending|Rejected) /).map((n) => n.props.children);
    expect(names).toEqual(['Pending Pat', 'Pending Quinn', 'Rejected Rae']);
    expect(screen.getByText('p@x.test')).toBeTruthy();
    expect(screen.getAllByText(/^Signed up /)).toHaveLength(3);
  });

  it('no requests: no Requests or Declined section', async () => {
    setStore(fakeStore('T'));
    await render(<RolesScreen />);
    expect(labels()).toEqual(['TEACHER', 'MENTORS', 'STUDENTS']);
  });

  it('Accept accepts at once', async () => {
    const store = fakeStore('T', { accessRequests: requests });
    setStore(store);
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Accept Pending Pat' }));
    expect(store.setAccessStatus).toHaveBeenCalledWith('P', 'approved');
  });

  it('Reject asks first, then declines', async () => {
    const store = fakeStore('T', { accessRequests: requests });
    setStore(store);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Reject Pending Quinn' }));
    expect(alert).toHaveBeenCalledWith(
      'Reject request',
      "Reject Pending Quinn? They won't be able to use Sham.",
      expect.any(Array),
      expect.any(Object),
    );
    expect(store.setAccessStatus).not.toHaveBeenCalled();
    const reject = alert.mock.lastCall![2]!.find((b) => b.text === 'Reject')!;
    await act(async () => reject.onPress!());
    expect(store.setAccessStatus).toHaveBeenCalledWith('Q', 'rejected');
  });

  it('a declined account can still be accepted, but not rejected again', async () => {
    const store = fakeStore('T', { accessRequests: [requests[2]] });
    setStore(store);
    await render(<RolesScreen />);
    expect(screen.queryByRole('button', { name: /^Reject/ })).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: 'Accept Rejected Rae' }));
    expect(store.setAccessStatus).toHaveBeenCalledWith('R', 'approved');
  });

  it('a failed accept shows the error', async () => {
    setStore(fakeStore('T', { accessRequests: requests, setAccessStatus: jest.fn().mockRejectedValue(new Error('Network request failed')) }));
    await render(<RolesScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Accept Pending Pat' }));
    expect(screen.getByText('Network request failed')).toBeTruthy();
  });

  it('search filters requests and declined accounts by name', async () => {
    setStore(fakeStore('T', { accessRequests: requests }));
    await render(<RolesScreen />);
    await fireEvent.changeText(screen.getByLabelText('Search users'), 'quinn');
    expect(labels()).toEqual(['REQUESTS']);
    expect(screen.getByText('Pending Quinn')).toBeTruthy();
    expect(screen.queryByText('Pending Pat')).toBeNull();
  });

  it.each(['M', 'S1'] as const)('%s can\'t manage roles at all', async (who) => {
    setStore(fakeStore(who, { accessRequests: requests }));
    await render(<RolesScreen />);
    expect(screen.getByText('Only the teacher can manage roles')).toBeTruthy();
    expect(screen.queryByText('Pending Pat')).toBeNull();
  });
});

describe('Count on the Profile tab (AC 5)', () => {
  it('shows the number of pending requests', async () => {
    setStore(fakeStore('T', { accessRequests: requests }));
    await render(<ProfileScreen />);
    expect(screen.getByRole('button', { name: 'Manage roles (2)' })).toBeTruthy();
  });

  it('no count without pending requests (declined ones don\'t count)', async () => {
    setStore(fakeStore('T', { accessRequests: [requests[2]] }));
    await render(<ProfileScreen />);
    expect(screen.getByRole('button', { name: 'Manage roles' })).toBeTruthy();
  });
});

it('fixture sanity: the fake store\'s users are approved (no status means approved)', () => {
  expect(Object.values(users).every((u) => u.accessStatus === undefined || u.accessStatus === 'approved')).toBe(true);
});
