// ARU-158: report content, the teacher's Reports list, and the teacher / course owner deleting chat messages (UI side).
// Access rules are tested in supabase/tests/aru158_content_reports.test.sql. M owns A; S1 and S2 are listeners of A.
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import ProfileScreen from '@/app/(tabs)/profile';
import CourseChatScreen from '@/app/courses/[id]/chat';
import GeneralChatScreen from '@/app/general-chat';
import ReportScreen from '@/app/report';
import ReportsScreen from '@/app/reports';
import { ReportMenu } from '@/components/ContentMenu';
import { FeedbackSection } from '@/components/FeedbackSection';
import { dbErrorMessage, translate } from '@/i18n';
import en from '@/i18n/en.json';
import ru from '@/i18n/ru.json';
import { sortReports } from '@/lib/reports';
import type { ContentReport, CourseMessage } from '@/lib/types';
import { router } from 'expo-router';

import { courseA, fakeStore, member } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const members = [member('A', 'S1'), member('A', 'S2')];
const msg = (id: string, authorId: string | null, body: string, minute: number): CourseMessage => ({
  id,
  courseId: 'A',
  authorId,
  body,
  createdAt: new Date(2026, 10, 18, 10, minute).toISOString(),
});
const page = [msg('m3', null, 'From a deleted account', 3), msg('m2', 'S2', 'Sue here', 2), msg('m1', 'S1', 'Sam here', 1)];
const loadMessages = () => jest.fn(async () => ({ messages: page, hasMore: false }));
const routeParams = params as Record<string, string | undefined>;

const report = (over: Partial<ContentReport> & { id: string }): ContentReport => ({
  reporterId: 'S2',
  kind: 'course_message',
  contentId: `c-${over.id}`,
  authorId: 'S1',
  text: 'Rude words',
  courseId: 'A',
  courseTitle: 'Algebra',
  reason: 'offensive',
  status: 'open',
  createdAt: '2026-11-18T10:00:00.000Z',
  resolvedById: null,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  params.id = 'A';
});

describe('AC 1 / 11: chat message menu (long-press)', () => {
  async function openChat(who: 'S1' | 'S2' | 'M' | 'T' | 'N', over = {}) {
    const store = fakeStore(who, { courseMembers: members, loadMessages: loadMessages(), ...over });
    setStore(store);
    await render(<CourseChatScreen />);
    await screen.findByText('Sam here');
    return store;
  }
  const longPress = async (id: string) => fireEvent(screen.getByTestId(`chat-message-${id}`), 'longPress');

  it("a student sees Report on someone else's message, and nothing on their own or a deleted account's", async () => {
    await openChat('S1');
    await longPress('m2');
    const menu = screen.getByTestId('action-menu');
    expect(within(menu).getByRole('button', { name: 'Report' })).toBeTruthy();
    expect(within(menu).queryByRole('button', { name: 'Delete' })).toBeNull();
    await fireEvent.press(within(menu).getByRole('button', { name: 'Report' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/report', params: { kind: 'course_message', id: 'm2' } });
    // Own and deleted-account messages have no actions at all.
    expect(screen.getByTestId('chat-message-m1').props.accessibilityActions).toBeUndefined();
    expect(screen.getByTestId('chat-message-m3').props.accessibilityActions).toBeUndefined();
  });

  it('screen readers get the actions as accessibility actions', async () => {
    await openChat('T');
    // ARU-162 adds Block <name> after Report.
    expect(screen.getByTestId('chat-message-m2').props.accessibilityActions).toEqual([
      { name: 'report', label: 'Report' },
      { name: 'block', label: 'Block Student Sue' },
      { name: 'delete', label: 'Delete' },
    ]);
    // A deleted account's message: Delete only.
    expect(screen.getByTestId('chat-message-m3').props.accessibilityActions).toEqual([{ name: 'delete', label: 'Delete' }]);
  });

  it.each(['M', 'T'] as const)('%s (owner / teacher) deletes a message after confirming; it leaves the list', async (who) => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    const store = await openChat(who);
    await longPress('m1');
    await fireEvent.press(within(screen.getByTestId('action-menu')).getByRole('button', { name: 'Delete' }));
    expect(alert).toHaveBeenCalledWith('Delete message?', 'The message will be deleted for everyone.', expect.any(Array), expect.anything());
    expect(store.deleteChatMessage).toHaveBeenCalledWith('course_message', 'm1');
    expect(screen.queryByText('Sam here')).toBeNull();
    alert.mockRestore();
  });

  it('cancelling the confirmation deletes nothing', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[0]?.onPress?.());
    const store = await openChat('T');
    await longPress('m1');
    await fireEvent.press(within(screen.getByTestId('action-menu')).getByRole('button', { name: 'Delete' }));
    expect(store.deleteChatMessage).not.toHaveBeenCalled();
    expect(screen.getByText('Sam here')).toBeTruthy();
    alert.mockRestore();
  });

  it('a refused delete shows the error and keeps the message', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    await openChat('T', { deleteChatMessage: jest.fn(async () => Promise.reject(new Error("You can't delete this content."))) });
    await longPress('m1');
    await fireEvent.press(within(screen.getByTestId('action-menu')).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText("You can't delete this content.")).toBeTruthy();
    expect(screen.getByText('Sam here')).toBeTruthy();
    alert.mockRestore();
  });

  it('a listener (not the owner) gets no Delete', async () => {
    await openChat('S2');
    await longPress('m1');
    expect(within(screen.getByTestId('action-menu')).queryByRole('button', { name: 'Delete' })).toBeNull();
  });

  it('a message deleted elsewhere disappears live', async () => {
    let removeLive: (id: string) => void = () => {};
    await openChat('S1', {
      subscribeToMessages: jest.fn((_c: string, _m: unknown, onDelete: (id: string) => void) => {
        removeLive = onDelete;
        return () => {};
      }),
    });
    await act(async () => removeLive('m2'));
    expect(screen.queryByText('Sue here')).toBeNull();
    // An id this chat doesn't show changes nothing.
    await act(async () => removeLive('elsewhere'));
    expect(screen.getByText('Sam here')).toBeTruthy();
  });

  it('a message deleted while away is gone after the next refetch; newer ones stay', async () => {
    const load = jest
      .fn()
      .mockResolvedValueOnce({ messages: page, hasMore: false })
      .mockResolvedValue({ messages: [msg('m3', null, 'From a deleted account', 3), msg('m1', 'S1', 'Sam here', 1)], hasMore: false });
    await openChat('S1', { loadMessages: load });
    expect(screen.getByText('Sue here')).toBeTruthy();
    // Sending refetches the latest page (as focus and returning to the app do).
    await fireEvent.changeText(screen.getByLabelText('Message'), 'Hi');
    await fireEvent.press(screen.getByTestId('chat-send'));
    await act(async () => {});
    expect(screen.queryByText('Sue here')).toBeNull();
    expect(screen.getByText('Sam here')).toBeTruthy();
  });

  // ARU-162 adds Block after Report.
  it.each([
    ['T', ['report', 'block', 'delete']],
    ['M', ['report', 'block']],
    ['S2', ['report', 'block']],
  ] as const)('general chat: %s gets %j (only the teacher deletes)', async (who, actions) => {
    const general = [msg('g1', 'S1', 'General Sam', 1)];
    setStore(fakeStore(who, { loadGeneralMessages: jest.fn(async () => ({ messages: general, hasMore: false })) }));
    await render(<GeneralChatScreen />);
    await screen.findByText('General Sam');
    expect(screen.getByTestId('chat-message-g1').props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(actions);
  });
});

describe('AC 1: the ⋯ menu on notes, Blog posts, PDFs and reviews', () => {
  it("shows Report on someone else's content and opens the Report screen", async () => {
    setStore(fakeStore('S2'));
    await render(<ReportMenu kind="blog_post" id="b1" authorId="M" />);
    await fireEvent.press(screen.getByRole('button', { name: 'More actions' }));
    await fireEvent.press(within(screen.getByTestId('action-menu')).getByRole('button', { name: 'Report' }));
    expect(router.push).toHaveBeenCalledWith({ pathname: '/report', params: { kind: 'blog_post', id: 'b1' } });
  });

  it.each([
    ['own content', 'S2'],
    ['a deleted account', null],
  ])('nothing on %s', async (_what, author) => {
    setStore(fakeStore('S2'));
    await render(<ReportMenu kind="pdf" id="p1" authorId={author} />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });

  it('each review has a ⋯ menu except my own', async () => {
    const feedback = [
      { id: 'f1', courseId: 'A', userId: 'S1', rating: 4, body: 'Good', createdAt: '2026-11-01T10:00:00Z', updatedAt: '2026-11-01T10:00:00Z' },
      { id: 'f2', courseId: 'A', userId: 'S2', rating: 2, body: 'Meh', createdAt: '2026-11-02T10:00:00Z', updatedAt: '2026-11-02T10:00:00Z' },
    ];
    setStore(fakeStore('S2', { courseMembers: members, courseFeedback: feedback }));
    await render(<FeedbackSection course={courseA} />);
    expect(within(screen.getByTestId('feedback-f1')).getByRole('button', { name: 'More actions' })).toBeTruthy();
    expect(within(screen.getByTestId('feedback-f2')).queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});

describe('AC 2 / 3: Report screen', () => {
  beforeEach(() => {
    routeParams.kind = 'course_message';
    routeParams.id = 'm2';
  });
  afterAll(() => {
    delete routeParams.kind;
  });

  it('four reasons, none chosen; Send report is disabled until one is', async () => {
    setStore(fakeStore('S1'));
    await render(<ReportScreen />);
    for (const name of ['Offensive', 'Spam', 'Harassment', 'Other']) {
      expect(screen.getByRole('radio', { name }).props.accessibilityState.checked).toBe(false);
    }
    expect(screen.getByRole('button', { name: 'Send report' }).props.accessibilityState?.disabled ?? screen.getByRole('button', { name: 'Send report' }).props.disabled).toBeTruthy();
    await fireEvent.press(screen.getByRole('radio', { name: 'Spam' }));
    expect(screen.getByRole('radio', { name: 'Spam' }).props.accessibilityState.checked).toBe(true);
  });

  it('the comment has a 500-character limit and a counter', async () => {
    setStore(fakeStore('S1'));
    await render(<ReportScreen />);
    const field = screen.getByTestId('report-comment');
    expect(field.props.maxLength).toBe(500);
    expect(screen.getByTestId('report-comment-count').props.children).toBe('0 / 500');
    await fireEvent.changeText(field, 'Bad');
    expect(screen.getByTestId('report-comment-count').props.children).toBe('3 / 500');
  });

  it('sends the report, thanks the user and closes', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const store = fakeStore('S1');
    setStore(store);
    await render(<ReportScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Harassment' }));
    await fireEvent.changeText(screen.getByTestId('report-comment'), 'Please look');
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(store.reportContent).toHaveBeenCalledWith({ kind: 'course_message', contentId: 'm2', reason: 'harassment', comment: 'Please look' });
    expect(alert).toHaveBeenCalledWith('Thanks, the teacher will review your report.', undefined);
    expect(router.back).toHaveBeenCalled();
    alert.mockRestore();
  });

  it('AC 3: a duplicate shows the database message and stays open', async () => {
    setStore(fakeStore('S1', { reportContent: jest.fn(async () => Promise.reject(new Error("You've already reported this."))) }));
    await render(<ReportScreen />);
    await fireEvent.press(screen.getByRole('radio', { name: 'Spam' }));
    await fireEvent.press(screen.getByRole('button', { name: 'Send report' }));
    expect(await screen.findByText("You've already reported this.")).toBeTruthy();
    expect(router.back).not.toHaveBeenCalled();
  });

  it('an unknown kind shows "This content no longer exists."', async () => {
    routeParams.kind = 'homework';
    setStore(fakeStore('S1'));
    await render(<ReportScreen />);
    expect(screen.getByText('This content no longer exists.')).toBeTruthy();
  });
});

describe('AC 5: Profile → Reports', () => {
  it('the teacher sees Reports with the open count', async () => {
    setStore(fakeStore('T', { contentReports: [report({ id: 'r1' }), report({ id: 'r2' }), report({ id: 'r3', status: 'dismissed' })] }));
    await render(<ProfileScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Reports (2)' }));
    expect(router.push).toHaveBeenCalledWith('/reports');
  });

  it('no count when nothing is open', async () => {
    setStore(fakeStore('T'));
    await render(<ProfileScreen />);
    expect(screen.getByRole('button', { name: 'Reports' })).toBeTruthy();
  });

  it.each(['S1', 'M'] as const)('%s sees no Reports row', async (who) => {
    setStore(fakeStore(who));
    await render(<ProfileScreen />);
    expect(screen.queryByRole('button', { name: /^Reports/ })).toBeNull();
  });
});

describe('AC 6-9: Reports list', () => {
  it('open oldest first, then resolved newest first', () => {
    const list = [
      report({ id: 'new', createdAt: '2026-11-18T12:00:00Z' }),
      report({ id: 'old', createdAt: '2026-11-17T12:00:00Z' }),
      report({ id: 'res1', status: 'dismissed', resolvedAt: '2026-11-10T00:00:00Z' }),
      report({ id: 'res2', status: 'removed', resolvedAt: '2026-11-15T00:00:00Z' }),
    ];
    const { open, resolved } = sortReports(list);
    expect(open.map((r) => r.id)).toEqual(['old', 'new']);
    expect(resolved.map((r) => r.id)).toEqual(['res2', 'res1']);
  });

  it('empty: "No reports."', async () => {
    setStore(fakeStore('T'));
    await render(<ReportsScreen />);
    expect(screen.getByText('No reports.')).toBeTruthy();
  });

  it('shows kind, place, saved text, author, reporter, reason and comment; deleted accounts by name', async () => {
    const store = fakeStore('T', {
      contentReports: [
        report({ id: 'r1', comment: 'Mean', reporterId: null }),
        report({ id: 'r2', kind: 'general_message', courseId: undefined, courseTitle: undefined, authorId: null }),
        report({ id: 'r3', kind: 'review', rating: 2, text: 'Meh course' }),
        report({ id: 'r4', kind: 'blog_post', title: 'Post title', text: 'Body', courseId: undefined, courseTitle: undefined, authorId: 'M' }),
        report({ id: 'r5', kind: 'meeting_note', meetingAt: '2026-11-10T10:00:00Z', courseId: 'gone', courseTitle: 'Old course' }),
      ],
    });
    setStore(store);
    await render(<ReportsScreen />);
    expect(store.loadReports).toHaveBeenCalled();
    const r1 = within(screen.getByTestId('report-r1'));
    expect(r1.getByText('Course chat message')).toBeTruthy();
    expect(r1.getByText('Algebra')).toBeTruthy();
    expect(r1.getByText('Rude words')).toBeTruthy();
    expect(r1.getByText('Author: Student Sam')).toBeTruthy();
    expect(r1.getByText(/^Reported by Deleted account · /)).toBeTruthy();
    expect(r1.getByText('Reason: Offensive')).toBeTruthy();
    expect(r1.getByText('Comment: Mean')).toBeTruthy();
    const r2 = within(screen.getByTestId('report-r2'));
    expect(r2.getByText('General chat')).toBeTruthy();
    expect(r2.getByText('Author: Deleted account')).toBeTruthy();
    expect(within(screen.getByTestId('report-r3')).getByText('★★☆☆☆')).toBeTruthy();
    expect(within(screen.getByTestId('report-r4')).getByText('Post title')).toBeTruthy();
    expect(within(screen.getByTestId('report-r4')).getByText('Blog')).toBeTruthy();
    expect(within(screen.getByTestId('report-r5')).getByText(/^Old course · meeting /)).toBeTruthy();
  });

  it('AC 7: Delete content asks first, then deletes', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    const r = report({ id: 'r1' });
    const store = fakeStore('T', { contentReports: [r] });
    setStore(store);
    await render(<ReportsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete content' }));
    expect(alert).toHaveBeenCalledWith('Delete this content?', expect.any(String), expect.any(Array), expect.anything());
    expect(store.deleteReportedContent).toHaveBeenCalledWith(r);
    alert.mockRestore();
  });

  it('AC 7: a refused delete shows the error', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    setStore(fakeStore('T', {
      contentReports: [report({ id: 'r1' })],
      deleteReportedContent: jest.fn(async () => Promise.reject(new Error("You can't delete these notes."))),
    }));
    await render(<ReportsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Delete content' }));
    expect(await screen.findByText("You can't delete these notes.")).toBeTruthy();
    alert.mockRestore();
  });

  it('AC 8: Dismiss without a confirmation', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    const store = fakeStore('T', { contentReports: [report({ id: 'r1' })] });
    setStore(store);
    await render(<ReportsScreen />);
    await fireEvent.press(screen.getByRole('button', { name: 'Dismiss' }));
    expect(store.dismissReport).toHaveBeenCalledWith('r1');
    expect(alert).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it("AC 9: a report about the teacher's own content: operator note, Delete content, no Dismiss", async () => {
    setStore(fakeStore('T', { contentReports: [report({ id: 'r1', authorId: 'T' })] }));
    await render(<ReportsScreen />);
    const card = within(screen.getByTestId('report-r1'));
    expect(card.getByText('The operator will review this report.')).toBeTruthy();
    expect(card.getByRole('button', { name: 'Delete content' })).toBeTruthy();
    expect(card.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('resolved reports show their status and no buttons', async () => {
    setStore(fakeStore('T', { contentReports: [report({ id: 'r1', status: 'removed', resolvedAt: '2026-11-18T12:00:00Z' })] }));
    await render(<ReportsScreen />);
    const card = within(screen.getByTestId('report-r1'));
    expect(card.getByTestId('report-status').props.children).toMatch(/^Removed · /);
    expect(card.queryByRole('button')).toBeNull();
    expect(screen.getByText('Resolved')).toBeTruthy();
  });

  it('nobody but the teacher gets the list', async () => {
    setStore(fakeStore('M', { contentReports: [report({ id: 'r1' })] }));
    await render(<ReportsScreen />);
    expect(screen.queryByTestId('report-r1')).toBeNull();
  });
});

describe('AC 12: texts', () => {
  const ids = Object.keys(en).filter((id) => /^(report|reports)\.|^db\.report_|^chat\.delete/.test(id));
  it('every new text is in English and Russian', () => {
    expect(ids.length).toBeGreaterThanOrEqual(50);
    for (const id of ids) expect((ru as Record<string, string>)[id]).toBeTruthy();
  });

  it.each([
    ['report_duplicate', 'Вы уже пожаловались на это.'],
    ['report_not_allowed', 'Вы не можете пожаловаться на это.'],
    ['report_content_missing', 'Этот контент больше не существует.'],
    ['report_dismiss_own', 'Только оператор может отклонить жалобу на ваш собственный контент.'],
  ])('db.%s in Russian', (code, text) => {
    expect(dbErrorMessage({ message: 'x', code: '42501', hint: `sham:${code}` }, 'ru')).toBe(text);
  });

  it('the English database messages match the catalog', () => {
    expect(translate('en', 'db.report_duplicate')).toBe("You've already reported this.");
    expect(translate('en', 'db.report_content_missing')).toBe('This content no longer exists.');
  });
});
