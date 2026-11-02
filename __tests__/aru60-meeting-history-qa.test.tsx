// QA ARU-60: gaps in aru60-meeting-history.test.tsx: the exact confirmation texts, accessibility of the new buttons
// and headings, the top count, and a checked meeting coming back to Awaiting homework check after a live undo.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import CourseDetailScreen from '@/app/courses/[id]';
import { formatDateTime } from '@/lib/theme';
import type { Meeting } from '@/lib/types';

import { fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: 'A',
  startsAt: at(24),
  topic: `Topic ${over.id}`,
  status: 'scheduled',
  createdById: 'M',
  createdAt: at(-100),
  ...over,
});
const C = meeting({ id: 'C', startsAt: at(-20), status: 'completed', topic: 'Fractions' });
const K = { ...C, homeworkCheckedAt: at(-1), homeworkCheckedById: 'T' };
const F = meeting({ id: 'F', startsAt: at(5) });
const members = [member('A', 'S1')];
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

it('AC5 / AC7: the confirmation texts name the topic and the meeting time', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  setStore(fakeStore('T', { courseMembers: members, meetings: [C] }));
  const view = await render(<CourseDetailScreen />);
  await fireEvent.press(inMeeting('C').getByRole('button', { name: 'Mark homework checked' }));
  expect(alert.mock.calls[0][1]).toBe(`Mark homework for Fractions on ${formatDateTime(C.startsAt)} as checked?`);
  await view.unmount();

  setStore(fakeStore('T', { courseMembers: members, meetings: [K] }));
  await render(<CourseDetailScreen />);
  await fireEvent.press(inMeeting('C').getByRole('button', { name: 'Undo check' }));
  expect(alert.mock.calls[1][1]).toBe(`Move Fractions on ${formatDateTime(C.startsAt)} back to Awaiting homework check?`);
});

it('edge a11y: group headings and MEETING HISTORY are headers; the actions are buttons', async () => {
  setStore(fakeStore('T', { courseMembers: members, meetings: [C, F, { ...K, id: 'K' }] }));
  await render(<CourseDetailScreen />);
  const headers = screen.getAllByRole('header').map((h) => [h.props.children].flat().join(''));
  expect(headers).toEqual(expect.arrayContaining(['Upcoming', 'Awaiting homework check', 'MEETING HISTORY (1)']));
  expect(screen.getByRole('button', { name: 'Mark homework checked' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Undo check' })).toBeTruthy();
});

it('AC1: the MEETINGS count leaves out history meetings', async () => {
  setStore(fakeStore('S1', { courseMembers: members, meetings: [C, F, { ...K, id: 'K' }] }));
  await render(<CourseDetailScreen />);
  expect(screen.getByText('MEETINGS (2)')).toBeTruthy();
});

it('AC7: a live undo moves the meeting back from history to Awaiting homework check', async () => {
  setStore(fakeStore('S1', { courseMembers: members, meetings: [K] }));
  const view = await render(<CourseDetailScreen />);
  expect(within(screen.getByTestId('meeting-history')).getByText('Fractions')).toBeTruthy();
  setStore(fakeStore('S1', { courseMembers: members, meetings: [C] }));
  await view.rerender(<CourseDetailScreen />);
  expect(screen.queryByTestId('meeting-history')).toBeNull();
  expect(screen.getByText('Awaiting homework check')).toBeTruthy();
  expect(screen.queryByText(/Homework checked by/)).toBeNull();
});
