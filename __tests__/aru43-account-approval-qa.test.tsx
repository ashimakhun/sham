// QA ARU-43: the gate in front of real screens (deep links), the waiting screen while checking, and what the gate
// lets through once the account is accepted.
import { fireEvent, render, screen } from '@testing-library/react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import RolesScreen from '@/app/roles';
import { AccessGate, WAITING_TEXT } from '@/components/AccessGate';
import type { User } from '@/lib/types';

import { fakeStore } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const pat: User = { id: 'P', name: 'Pending Pat', role: 'student', accessStatus: 'pending' };
const rae: User = { id: 'R', name: 'Rejected Rae', role: 'student', accessStatus: 'rejected' };

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('AC 1 / AC 3: deep links behind the gate', () => {
  it.each([
    ['pending', pat, 'Waiting for approval'],
    ['declined', rae, 'Request declined'],
  ] as const)('a %s account opening /courses/A or /roles sees only its screen', async (_s, who, title) => {
    // Even if the store held data (it doesn't for them), nothing of the screens behind the gate renders.
    setStore(fakeStore(null, { currentUser: who }));
    for (const Screen of [CourseDetailScreen, RolesScreen]) {
      const view = await render(
        <AccessGate>
          <Screen />
        </AccessGate>,
      );
      expect(screen.getByRole('header', { name: title })).toBeTruthy();
      expect(screen.queryByText('Algebra')).toBeNull();
      expect(screen.queryByText('Course not found')).toBeNull();
      await view.unmount();
    }
  });

  it('the declined screen has no Check again and no pull to refresh', async () => {
    setStore(fakeStore(null, { currentUser: rae }));
    const view = await render(<AccessGate><CourseDetailScreen /></AccessGate>);
    expect(screen.queryByRole('button', { name: 'Check again' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(view.container.queryAll((n) => n.type === 'RCTScrollView' && !!n.props.refreshControl)).toHaveLength(0);
  });
});

describe('AC 1 / edge case: checking again', () => {
  it('while checking, the button says "Checking…" and is disabled; the text stays', async () => {
    let finish: () => void = () => {};
    const store = fakeStore(null, { currentUser: pat, refresh: jest.fn(() => new Promise<void>((r) => (finish = r))) });
    setStore(store);
    await render(<AccessGate><CourseDetailScreen /></AccessGate>);
    fireEvent.press(screen.getByRole('button', { name: 'Check again' }));
    const busy = await screen.findByRole('button', { name: 'Checking…' });
    expect(busy).toBeDisabled();
    expect(screen.getByText(WAITING_TEXT)).toBeTruthy();
    await fireEvent.press(busy);
    expect(store.refresh).toHaveBeenCalledTimes(1);
    finish();
  });

  it('pull to refresh on the waiting screen checks again', async () => {
    const store = fakeStore(null, { currentUser: pat });
    setStore(store);
    const view = await render(<AccessGate><CourseDetailScreen /></AccessGate>);
    const scroll = view.container.queryAll((n) => n.type === 'RCTScrollView' && !!n.props.refreshControl)[0];
    await scroll.props.refreshControl.props.onRefresh();
    expect(store.refresh).toHaveBeenCalled();
  });
});

describe('AC 2: accepted', () => {
  it('the same deep link shows the course once the account is approved', async () => {
    setStore(fakeStore(null, { currentUser: { ...pat, accessStatus: 'approved' } }));
    await render(<AccessGate><CourseDetailScreen /></AccessGate>);
    expect(screen.queryByText('Waiting for approval')).toBeNull();
    expect(screen.getByText('Algebra')).toBeTruthy();
  });
});
