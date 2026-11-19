// QA ARU-158: gaps in aru158-content-reports.test.tsx: the general chat's Delete (teacher only, not a course owner),
// Report and Delete in Russian (menu, screen readers, the Report screen, the Reports list, the operator note,
// "Deleted account", a refused delete), a hidden course's report showing its course name, waiting and declined
// accounts never seeing Report, and the ⋯ menu on someone else's note / Blog post / PDF vs my own.
import { fireEvent, render, screen, within } from '@testing-library/react-native';
import { Alert } from 'react-native';

import GeneralChatScreen from '@/app/general-chat';
import ReportScreen from '@/app/report';
import ReportsScreen from '@/app/reports';
import { ReportMenu } from '@/components/ContentMenu';
import { I18nContext, make } from '@/i18n/context';
import { canDeleteChatMessage, canReport } from '@/lib/roles';
import type { ChatMessage, ContentReport, User } from '@/lib/types';

import { courseA, courseB, fakeStore, users } from './helpers/fakeStore';
import { params, setStore } from './helpers/mocks';

jest.mock('expo-router', () => require('./helpers/mocks').expoRouter);
jest.mock('expo-router/react-navigation', () => ({ useHeaderHeight: () => 0 }));
jest.mock('@/lib/store', () => require('./helpers/mocks').store);

const ru = (ui: React.ReactElement) => <I18nContext.Provider value={make('ru')}>{ui}</I18nContext.Provider>;
const routeParams = params as Record<string, string | undefined>;
const gmsg = (id: string, authorId: string | null, body: string, minute: number): ChatMessage => ({
  id,
  authorId,
  body,
  createdAt: new Date(2026, 10, 18, 10, minute).toISOString(),
});
const general = [gmsg('g2', 'S2', 'Sue in general', 2), gmsg('g1', 'M', 'Max in general', 1)];
const report = (over: Partial<ContentReport> & { id: string }): ContentReport => ({
  reporterId: 'S2',
  kind: 'course_message',
  contentId: `c-${over.id}`,
  authorId: 'S1',
  text: 'Rude words',
  courseId: 'A',
  courseTitle: 'Algebra',
  reason: 'harassment',
  status: 'open',
  createdAt: '2026-11-18T10:00:00.000Z',
  resolvedById: null,
  ...over,
});

beforeEach(() => jest.clearAllMocks());

describe('AC 11: general chat Delete', () => {
  async function open(who: 'T' | 'M' | 'S1') {
    const store = fakeStore(who, { loadGeneralMessages: jest.fn(async () => ({ messages: general, hasMore: false })) });
    setStore(store);
    await render(<GeneralChatScreen />);
    await screen.findByText('Sue in general');
    return store;
  }

  it('the teacher gets Delete on every general message (and Report on others)', async () => {
    await open('T');
    const actions = (id: string) => screen.getByTestId(`chat-message-${id}`).props.accessibilityActions.map((a: { name: string }) => a.name);
    // ARU-162 adds Block after Report.
    expect(actions('g2')).toEqual(['report', 'block', 'delete']);
    expect(actions('g1')).toEqual(['report', 'block', 'delete']);
  });

  it('a course owner (mentor M owns Algebra) gets no Delete in the general chat, only Report on others', async () => {
    await open('M');
    expect(screen.getByTestId('chat-message-g2').props.accessibilityActions.map((a: { name: string }) => a.name)).toEqual(['report', 'block']);
    expect(screen.getByTestId('chat-message-g1').props.accessibilityActions).toBeUndefined();
  });

  it('the teacher deletes a general message after confirming', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    const store = await open('T');
    await fireEvent(screen.getByTestId('chat-message-g2'), 'longPress');
    await fireEvent.press(within(screen.getByTestId('action-menu')).getByRole('button', { name: 'Delete' }));
    expect(store.deleteChatMessage).toHaveBeenCalledWith('general_message', 'g2');
    expect(await screen.findByText('Max in general')).toBeTruthy();
    expect(screen.queryByText('Sue in general')).toBeNull();
    alert.mockRestore();
  });
});

describe('roles: Report and Delete rules', () => {
  const as = (over: Partial<User>) => ({ ...users.S1, ...over }) as User;

  it('waiting and declined accounts never get Report', () => {
    expect(canReport(as({ accessStatus: 'pending' }), 'S2')).toBe(false);
    expect(canReport(as({ accessStatus: 'rejected' }), 'S2')).toBe(false);
    expect(canReport(as({ accessStatus: 'approved' }), 'S2')).toBe(true);
    expect(canReport(as({}), 'S1')).toBe(false);
    expect(canReport(as({}), null)).toBe(false);
    expect(canReport(null, 'S2')).toBe(false);
  });

  it('Delete in a course chat: the teacher and the current owner only; never in the general chat for an owner', () => {
    expect(canDeleteChatMessage(users.T, courseA)).toBe(true);
    expect(canDeleteChatMessage(users.T)).toBe(true);
    expect(canDeleteChatMessage(users.M, courseA)).toBe(true);
    expect(canDeleteChatMessage(users.M)).toBe(false);
    expect(canDeleteChatMessage(users.N, courseA)).toBe(false);
    expect(canDeleteChatMessage(users.S1, courseA)).toBe(false);
  });
});

describe('AC 1: the ⋯ menu on notes, Blog posts and PDFs', () => {
  it.each(['meeting_note', 'blog_post', 'pdf'] as const)('%s: someone else\'s has ⋯ → Report; my own has none', async (kind) => {
    setStore(fakeStore('S1'));
    const view = await render(<ReportMenu kind={kind} id="x1" authorId="M" />);
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
    await view.unmount();
    await render(<ReportMenu kind={kind} id="x2" authorId="S1" />);
    expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  });
});

describe('AC 12: Russian', () => {
  afterAll(() => {
    delete routeParams.kind;
    delete routeParams.id;
  });

  it('the general chat menu and screen-reader actions are Russian', async () => {
    setStore(fakeStore('T', { loadGeneralMessages: jest.fn(async () => ({ messages: general, hasMore: false })) }));
    await render(ru(<GeneralChatScreen />));
    await screen.findByText('Sue in general');
    const labels = screen.getByTestId('chat-message-g2').props.accessibilityActions.map((a: { label: string }) => a.label);
    expect(labels).toEqual(['Пожаловаться', 'Заблокировать: Student Sue', 'Удалить']);
    await fireEvent(screen.getByTestId('chat-message-g2'), 'longPress');
    expect(within(screen.getByTestId('action-menu')).getByRole('button', { name: 'Пожаловаться' })).toBeTruthy();
  });

  it('the Report screen: reasons, Send and the thanks are Russian; nothing English left', async () => {
    routeParams.kind = 'course_message';
    routeParams.id = 'm2';
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const store = fakeStore('S1');
    setStore(store);
    await render(ru(<ReportScreen />));
    for (const name of ['Offensive', 'Spam', 'Harassment', 'Other', 'Send report']) expect(screen.queryByText(name)).toBeNull();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    for (const r of radios) expect(r.props.accessibilityLabel).toMatch(/[а-яё]/i);
    await fireEvent.press(radios[1]);
    await fireEvent.press(screen.getByRole('button', { name: 'Отправить жалобу' }));
    expect(store.reportContent).toHaveBeenCalledWith(expect.objectContaining({ reason: 'spam' }));
    expect(alert).toHaveBeenCalledWith('Спасибо, преподаватель рассмотрит вашу жалобу.', undefined);
    alert.mockRestore();
  });

  it('the Reports list: operator note, Deleted account and a hidden course\'s name, in Russian', async () => {
    setStore(
      fakeStore('T', {
        courses: [courseA, { ...courseB, hidden: true }],
        contentReports: [
          report({ id: 'r1', authorId: 'T', reporterId: null }),
          report({ id: 'r2', courseId: 'B', courseTitle: courseB.title, authorId: null }),
        ],
      }),
    );
    await render(ru(<ReportsScreen />));
    const r1 = within(screen.getByTestId('report-r1'));
    expect(r1.getByText('Эту жалобу рассмотрит оператор.')).toBeTruthy();
    expect(r1.getByText(/Удалённый аккаунт/)).toBeTruthy();
    expect(r1.queryByText(/Dismiss|Delete content|Operator/)).toBeNull();
    const r2 = within(screen.getByTestId('report-r2'));
    expect(r2.getByText(courseB.title)).toBeTruthy();
    expect(r2.getByText(/Удалённый аккаунт/)).toBeTruthy();
  });

  it('empty list and a refused delete are Russian', async () => {
    setStore(fakeStore('T'));
    const view = await render(ru(<ReportsScreen />));
    expect(screen.queryByText('No reports.')).toBeNull();
    await view.unmount();
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    setStore(
      fakeStore('T', {
        contentReports: [report({ id: 'r1' })],
        deleteReportedContent: jest.fn(async () => Promise.reject(new Error("You can't delete this content."))),
      }),
    );
    await render(ru(<ReportsScreen />));
    await fireEvent.press(within(screen.getByTestId('report-r1')).getByRole('button', { name: 'Удалить контент' }));
    expect(await screen.findByText('Вы не можете удалить этот контент.')).toBeTruthy();
    alert.mockRestore();
  });
});
