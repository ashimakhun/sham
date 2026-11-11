// ARU-149: tiles in MEETING HISTORY show no meeting link; a plain-text location stays, and current meetings keep
// their tappable link. Display only: the stored location isn't touched.
import { render, screen, within } from '@testing-library/react-native';
import { Linking } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import { I18nContext, make } from '@/i18n/context';
import type { Meeting } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const LINK = 'https://meet.example.com/abc';
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(24),
  topic: `Topic ${over.id}`,
  status: 'scheduled',
  createdById: 'M',
  createdAt: at(-100),
  location: LINK,
  ...over,
});
const checked = { status: 'completed' as const, homeworkCheckedAt: at(-1), homeworkCheckedById: 'M' };
const canceled = meeting({ id: 'CX', startsAt: at(-30), status: 'canceled' });
const done = meeting({ id: 'CK', startsAt: at(-40), ...checked });
const spaced = meeting({ id: 'CS', startsAt: at(-50), ...checked, location: '  https://meet.example.com/x  ' });
const room = meeting({ id: 'CR', startsAt: at(-60), ...checked, location: 'Room 12' });
const none = meeting({ id: 'CN', startsAt: at(-70), ...checked, location: undefined });
const awaiting = meeting({ id: 'AW', startsAt: at(-20), status: 'completed' });
const upcoming = meeting({ id: 'UP', startsAt: at(24) });
const live = meeting({ id: 'IP', startsAt: at(-0.5) });
const meetings = [canceled, done, spaced, room, none, awaiting, upcoming, live];
const members = [member('A', 'S1'), member('A', 'M2')];
const tileOf = (id: string) => within(screen.getByTestId(`meeting-${id}`));
// Other things on a tile are links too (Notes, the attendance pill); the meeting link is named by its address.
const MEET = { name: /meet\.example\.com/ };

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params) as (keyof typeof params)[]) delete params[k];
  Object.assign(params, { id: 'A' });
});

describe.each(['S1', 'M', 'T', 'N'] as const)('as %s', (who) => {
  it('AC 1 / AC 3: history tiles have no link; plain text stays; no location, no line', async () => {
    setStore(fakeStore(who, { courseMembers: members, meetings }));
    await render(<CourseDetailScreen />);
    for (const id of ['CX', 'CK', 'CS']) {
      expect(tileOf(id).queryByRole('link', MEET)).toBeNull();
      expect(tileOf(id).queryByText(/meet\.example\.com/)).toBeNull();
    }
    const plain = tileOf('CR').getByText('Room 12');
    expect(plain.props.accessibilityRole).toBeUndefined();
    expect(plain.props.onPress).toBeUndefined();
    expect(tileOf('CN').queryByRole('link', MEET)).toBeNull();
  });

  it('AC 4: current meetings keep the tappable link', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    setStore(fakeStore(who, { courseMembers: members, meetings }));
    await render(<CourseDetailScreen />);
    for (const id of ['AW', 'UP', 'IP']) {
      const link = tileOf(id).getByRole('link', MEET);
      expect(link.props.children).toBe(LINK);
    }
    tileOf('UP').getByRole('link', MEET).props.onPress();
    expect(open).toHaveBeenCalledWith(LINK);
  });
});

it('AC 2: the rest of a history tile is unchanged (title, badge, Rescheduled)', async () => {
  const moved = meeting({ id: 'RS', startsAt: at(-45), ...checked, rescheduledAt: at(-46) } as Meeting);
  setStore(fakeStore('M', { courseMembers: members, meetings: [moved, canceled] }));
  await render(<CourseDetailScreen />);
  expect(tileOf('RS').getByText('Completed')).toBeTruthy();
  expect(tileOf('CX').getByText('Canceled')).toBeTruthy();
  expect(tileOf('RS').queryByRole('link', MEET)).toBeNull();
});

it('a meeting whose homework gets checked loses its link at once', async () => {
  setStore(fakeStore('S1', { courseMembers: members, meetings: [awaiting] }));
  const view = await render(<CourseDetailScreen />);
  expect(tileOf('AW').getByRole('link', MEET)).toBeTruthy();
  setStore(fakeStore('S1', { courseMembers: members, meetings: [{ ...awaiting, ...checked }] }));
  await view.rerender(<CourseDetailScreen />);
  expect(tileOf('AW').queryByRole('link', MEET)).toBeNull();
});

it('AC 6: the same in Russian', async () => {
  setStore(fakeStore('S1', { courseMembers: members, meetings }));
  await render(
    <I18nContext.Provider value={make('ru')}>
      <CourseDetailScreen />
    </I18nContext.Provider>,
  );
  expect(tileOf('CK').queryByRole('link', MEET)).toBeNull();
  expect(tileOf('CR').getByText('Room 12')).toBeTruthy();
  expect(tileOf('UP').getByRole('link', MEET)).toBeTruthy();
});
