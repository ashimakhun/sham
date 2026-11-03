// QA ARU-85 AC 7: a mentor or student who has one of the deleted course's screens open sees a not-found state instead
// of a crash once the course (and its meetings and homework) is gone from the store: chat, listeners, owner, feedback,
// a meeting and its notes / attendance / assign-homework screens, and one of its homework.
import { render, screen } from '@testing-library/react-native';
import type { ComponentType } from 'react';

import CourseChatScreen from '@/app/courses/[id]/chat';
import FeedbackScreen from '@/app/courses/[id]/feedback';
import ListenersScreen from '@/app/courses/[id]/listeners';
import MeetingScreen from '@/app/courses/[id]/meetings/[meetingId]';
import AssignHomeworkScreen from '@/app/courses/[id]/meetings/[meetingId]/assign-homework';
import AttendanceScreen from '@/app/courses/[id]/meetings/[meetingId]/attendance';
import NotesScreen from '@/app/courses/[id]/meetings/[meetingId]/notes';
import OwnerScreen from '@/app/courses/[id]/owner';
import HomeworkScreen from '@/app/homework/[id]';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
  (params as Record<string, unknown>).meetingId = 'MEET1';
});

it('the open course chat turns into "Course not found" when the course disappears', async () => {
  setStore(fakeStore('S1', { courses: [courseA], courseMembers: [member('A', 'S1')] }));
  const view = await render(<CourseChatScreen />);
  expect(screen.queryByText('Course not found')).toBeNull();
  setStore(fakeStore('S1', { courses: [], courseMembers: [] }));
  await view.rerender(<CourseChatScreen />);
  expect(screen.getByText('Course not found')).toBeTruthy();
});

it.each<[string, ComponentType, string, 'M' | 'S1']>([
  ['listeners', ListenersScreen, 'Course not found', 'M'],
  ['owner', OwnerScreen, 'Course not found', 'M'],
  ['feedback', FeedbackScreen, 'Course not found', 'S1'],
  ['a meeting', MeetingScreen, 'Meeting not found', 'M'],
  ['meeting notes', NotesScreen, 'Meeting not found', 'M'],
  ['attendance', AttendanceScreen, 'Meeting not found', 'M'],
  ['assign homework', AssignHomeworkScreen, 'Meeting not found', 'M'],
])('%s of a deleted course shows "%s" without crashing', async (_name, Screen, text, who) => {
  setStore(fakeStore(who, { courses: [], courseMembers: [] }));
  await render(<Screen />);
  expect(screen.getByText(text)).toBeTruthy();
});

it('a homework of a deleted course shows "Homework not found"', async () => {
  params.id = 'HW_GONE';
  setStore(fakeStore('S1', { courses: [] }));
  await render(<HomeworkScreen />);
  expect(screen.getByText('Homework not found')).toBeTruthy();
});
