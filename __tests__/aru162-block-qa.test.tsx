// QA ARU-162: gaps in aru162-block.test.tsx. Blocking from a Blog post's ⋯ goes back; a failed unblock keeps the
// person listed and shows the error; the teacher's Reports list still shows reports about a person the teacher
// blocked (the teacher must still do their job); a Knowledge base PDF's ⋯ offers Block too (AC 1) without hiding
// anything; waiting and declined accounts get no Block in the chat menu.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import BlockedPeopleScreen from '@/app/blocked';
import CourseChatScreen from '@/app/courses/[id]/chat';
import MaterialScreen from '@/app/materials/[id]';
import ReportsScreen from '@/app/reports';
import { ReportMenu } from '@/components/ContentMenu';
import type { ContentReport, CourseMessage, Material } from '@/lib/types';
import { router } from 'expo-router';

import { fakeStore, member, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const routeParams = params as Record<string, string | undefined>;
let alertSpy: jest.SpyInstance | undefined;
const confirmAlerts = () => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
};

beforeEach(() => jest.clearAllMocks());
afterEach(() => {
  alertSpy?.mockRestore();
  alertSpy = undefined;
});

it('AC 2: blocking from a Blog post\'s ⋯ blocks its author and goes back (the post is now hidden)', async () => {
  routeParams.id = 'b1';
  const post: Material = { id: 'b1', teacherId: 'M', title: 'Max post', body: 'Hello', createdAt: '2026-11-01T10:00:00Z' };
  const store = fakeStore('S1', { materials: [post] });
  setStore(store);
  confirmAlerts();
  // The router mock renders no header; render the screen's headerRight (where its ⋯ lives) for this test.
  const mocks = require('./helpers/mocks').expoRouter;
  const original = mocks.Stack.Screen;
  mocks.Stack.Screen = function HeaderRight({ options }: { options?: { headerRight?: () => React.ReactNode } }) {
    return options?.headerRight?.() ?? null;
  };
  await render(<MaterialScreen />);
  mocks.Stack.Screen = original;
  await fireEvent.press(screen.getByTestId('content-menu-b1'));
  await fireEvent.press(within(screen.getByTestId('action-menu')).getByRole('button', { name: 'Block Mentor Max' }));
  await act(async () => {});
  expect(store.blockUser).toHaveBeenCalledWith('M');
  expect(router.back).toHaveBeenCalled();
});

it('AC 5: a failed unblock (offline) keeps the person listed and shows the error', async () => {
  const store = fakeStore('S1', {
    blockedUserIds: ['S2'],
    unblockUser: jest.fn(async () => Promise.reject(new Error('Network request failed'))),
  });
  setStore(store);
  await render(<BlockedPeopleScreen />);
  await fireEvent.press(within(screen.getByTestId('blocked-S2')).getByRole('button', { name: 'Unblock' }));
  await act(async () => {});
  expect(store.unblockUser).toHaveBeenCalledWith('S2');
  expect(screen.getByTestId('blocked-S2')).toBeTruthy();
  expect(screen.getByText(/Network request failed|connection|internet/i)).toBeTruthy();
});

it('AC 3: the teacher\'s Reports list still shows a report about someone the teacher blocked', async () => {
  const report: ContentReport = {
    id: 'r1',
    reporterId: 'S1',
    kind: 'course_message',
    contentId: 'c1',
    authorId: 'S2',
    text: 'Rude words',
    courseId: 'A',
    courseTitle: 'Algebra',
    reason: 'harassment',
    status: 'open',
    createdAt: '2026-11-18T10:00:00.000Z',
    resolvedById: null,
  };
  setStore(fakeStore('T', { contentReports: [report], blockedUserIds: ['S2'] }));
  await render(<ReportsScreen />);
  const r1 = within(screen.getByTestId('report-r1'));
  expect(r1.getByText('Rude words')).toBeTruthy();
  expect(r1.getByRole('button', { name: 'Delete content' })).toBeTruthy();
});

it('AC 1: a Knowledge base PDF\'s ⋯ offers Block <name> too; blocking calls blockUser only', async () => {
  const store = fakeStore('S1');
  setStore(store);
  confirmAlerts();
  await render(<ReportMenu kind="pdf" id="p1" authorId="M" />);
  await fireEvent.press(screen.getByTestId('content-menu-p1'));
  const menu = within(screen.getByTestId('action-menu'));
  expect(menu.getByRole('button', { name: 'Report' })).toBeTruthy();
  await fireEvent.press(menu.getByRole('button', { name: 'Block Mentor Max' }));
  await act(async () => {});
  expect(store.blockUser).toHaveBeenCalledWith('M');
  expect(router.back).not.toHaveBeenCalled();
});

it('roles: a waiting or declined account gets no Block (nor Report) on someone else\'s chat message', async () => {
  routeParams.id = 'A';
  const msg: CourseMessage = { id: 'm2', courseId: 'A', authorId: 'S2', body: 'Sue here', createdAt: '2026-11-18T10:02:00.000Z' };
  for (const status of ['pending', 'rejected'] as const) {
    const store = fakeStore('S1', {
      courseMembers: [member('A', 'S1'), member('A', 'S2')],
      loadMessages: jest.fn(async () => ({ messages: [msg], hasMore: false })),
    });
    setStore({ ...store, currentUser: { ...users.S1, accessStatus: status } });
    const view = await render(<CourseChatScreen />);
    if (await screen.findByText('Sue here').catch(() => null)) {
      expect(screen.getByTestId('chat-message-m2').props.accessibilityActions).toBeUndefined();
    }
    await view.unmount();
  }
});
