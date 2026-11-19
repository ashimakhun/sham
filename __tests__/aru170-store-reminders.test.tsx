// ARU-170: the real StoreProvider against a fake Supabase client and the in-memory expo-notifications mock
// (jest.setup.js): reminders are scheduled after a load (AC 1), moved by a reload, a switch flip or a language change,
// not rescheduled when nothing changed, retried after a failure; nothing for a declined permission, a waiting account
// or the web, and earlier ones are cancelled (AC 2); sign-out and account deletion cancel them first, also offline,
// and the next account gets only its own (AC 3). Notifications this app didn't schedule as reminders are never touched.
import { act, render } from '@testing-library/react-native';
import * as Notifications from 'expo-notifications';
import { AppState, Platform, Text } from 'react-native';

import { __resetReminderScheduler } from '@/lib/reminderScheduler';
import { REMINDER_DEBOUNCE_MS, StoreProvider, useStore } from '@/lib/store';

const H = 60 * 60 * 1000;
const inHours = (h: number) => new Date(Date.now() + h * H).toISOString();

type Row = Record<string, unknown>;
const mockState = {
  me: 'S',
  tables: {} as Record<string, Row[]>,
  settings: [] as Row[],
  calls: [] as string[],
  rpcs: [] as { name: string; args: unknown }[],
  failRpc: null as string | null,
  authListener: null as null | ((event: string, session: unknown) => void),
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'update', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) =>
      resolve({
        data:
          table === 'notification_settings'
            ? mockState.settings
            : table === 'profiles'
              ? (mockState.tables.profiles ?? []).filter((p) => p.id === mockState.me || p.access_status === 'approved')
              : (mockState.tables[table] ?? []),
        error: null,
      });
    return q;
  };
  const channel = () => {
    const c: Record<string, unknown> = {};
    c.on = () => c;
    c.subscribe = () => c;
    return c;
  };
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: mockState.me } } }),
        onAuthStateChange: (listener: (event: string, session: unknown) => void) => {
          mockState.authListener = listener;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        getUser: () => ok({ user: { id: mockState.me } }),
        signOut: () => {
          mockState.calls.push('auth.signOut');
          return Promise.resolve({ error: null });
        },
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: unknown) => {
        mockState.rpcs.push({ name, args });
        mockState.calls.push(name);
        if (name === mockState.failRpc) return Promise.reject(new TypeError('Network request failed'));
        return ok(name.endsWith('unread_counts') || name.endsWith('unread_count') ? [] : null);
      },
      functions: {
        invoke: () => {
          mockState.calls.push('delete-account');
          return ok({ ok: true });
        },
      },
      channel,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
    },
  };
});

type Scheduled = { identifier: string; content: { title?: string; body?: string; data?: Row }; trigger: Row };
const N = Notifications as unknown as {
  __setPermission: (p: Record<string, unknown>) => void;
  __reset: () => void;
  __scheduled: () => Scheduled[];
  __addScheduled: (r: Scheduled) => void;
};
const scheduled = () => N.__scheduled().map((r) => r.identifier).sort();
const reminders = () => N.__scheduled().filter((r) => r.identifier.startsWith('sham-reminder:'));
const scheduleMock = Notifications.scheduleNotificationAsync as jest.Mock;

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.users.length}</Text>;
}
const flush = async (n = 4) => {
  for (let i = 0; i < n; i++) await act(async () => {});
};
/** Lets the debounce run out and the scheduler finish. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, REMINDER_DEBOUNCE_MS + 100));
  });
  await flush();
  // The switches load first (one debounce), then the reminders are scheduled (another).
  await act(async () => {
    await new Promise((r) => setTimeout(r, REMINDER_DEBOUNCE_MS + 100));
  });
  await flush();
}
async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
  await settle();
}

const FOREIGN: Scheduled = { identifier: 'push-or-other', content: { title: 'Other', data: {} }, trigger: { type: 'date' } };

beforeEach(() => {
  N.__reset();
  N.__setPermission({ status: 'granted', ios: { status: 2 } });
  N.__addScheduled({ ...FOREIGN });
  scheduleMock.mockClear();
  (Notifications.getAllScheduledNotificationsAsync as jest.Mock).mockClear();
  __resetReminderScheduler();
  mockState.me = 'S';
  mockState.settings = [];
  mockState.calls = [];
  mockState.rpcs = [];
  mockState.failRpc = null;
  mockState.tables = {
    profiles: [
      { id: 'S', full_name: 'S', role: 'student', access_status: 'approved' },
      { id: 'S2', full_name: 'S2', role: 'student', access_status: 'approved' },
      { id: 'O', full_name: 'O', role: 'mentor', access_status: 'approved' },
    ],
    courses: [
      { id: 'A', title: 'Algebra', description: '', created_by: 'O', created_at: '2026-01-01' },
      { id: 'B', title: 'Biology', description: '', created_by: 'O', created_at: '2026-01-01' },
    ],
    course_members: [
      { course_id: 'A', user_id: 'S', added_by: 'O', added_at: '2026-01-01' },
      { course_id: 'B', user_id: 'S2', added_by: 'O', added_at: '2026-01-01' },
    ],
    course_meetings: [
      { id: 'm1', course_id: 'A', starts_at: inHours(3), topic: '', status: 'scheduled', created_by: 'O', created_at: '2026-01-01' },
      { id: 'm2', course_id: 'B', starts_at: inHours(4), topic: '', status: 'scheduled', created_by: 'O', created_at: '2026-01-01' },
    ],
    homework_assignments: [],
    homework: [],
  };
  jest.spyOn(AppState, 'addEventListener').mockImplementation(
    () => ({ remove: () => {} }) as ReturnType<typeof AppState.addEventListener>,
  );
});
afterEach(() => {
  jest.restoreAllMocks();
  Platform.OS = 'ios';
});

it('AC 1 / AC 5: after the first load the listener\'s meeting reminder is scheduled (title Sham, date trigger, General channel)', async () => {
  await mount();
  expect(reminders()).toEqual([
    {
      identifier: 'sham-reminder:meeting:m1',
      content: { title: 'Sham', body: 'Algebra meeting has started', data: { sham: 'reminder' }, sound: 'default' },
      trigger: { type: 'date', date: expect.any(Date), channelId: 'default' },
    },
  ]);
  expect((reminders()[0].trigger.date as Date).toISOString()).toBe(mockState.tables.course_meetings[0].starts_at);
  // Never touched: a notification this app didn't schedule as a reminder.
  expect(scheduled()).toContain('push-or-other');
});

it('AC 1 / AC 6: a reload with a moved meeting moves the reminder; a canceled one removes it', async () => {
  await mount();
  mockState.tables.course_meetings[0].starts_at = inHours(10);
  await act(async () => {
    await store.refresh();
  });
  await settle();
  expect((reminders()[0].trigger.date as Date).toISOString()).toBe(mockState.tables.course_meetings[0].starts_at);
  mockState.tables.course_meetings[0].status = 'canceled';
  await act(async () => {
    await store.refresh();
  });
  await settle();
  expect(reminders()).toEqual([]);
  expect(scheduled()).toEqual(['push-or-other']);
});

it('AC 7-8: homework due soon is scheduled, and removed once I send homework for it', async () => {
  mockState.tables.homework_assignments = [
    { id: 'a1', meeting_id: 'm1', course_id: 'A', title: 'Fractions', description: '', due_at: inHours(30), created_by: 'O', created_at: '2026-01-01' },
  ];
  await mount();
  expect(reminders().map((r) => r.identifier).sort()).toEqual(['sham-reminder:due:a1', 'sham-reminder:meeting:m1']);
  mockState.tables.homework = [
    { id: 'h1', student_id: 'S', course_id: 'A', title: '', description: '', status: 'submitted', created_at: '2026-01-01', assignment_id: 'a1' },
  ];
  await act(async () => {
    await store.refresh();
  });
  await settle();
  expect(reminders().map((r) => r.identifier)).toEqual(['sham-reminder:meeting:m1']);
});

it('analysis note 2: a reload that changes nothing schedules nothing again', async () => {
  await mount();
  const before = scheduleMock.mock.calls.length;
  expect(before).toBe(1);
  await act(async () => {
    await store.refresh();
  });
  await settle();
  expect(scheduleMock.mock.calls.length).toBe(before);
});

it('AC 1: flipping a switch reschedules (Meeting started off → removed, on → back)', async () => {
  await mount();
  await act(async () => {
    await store.setNotification('meeting_started', false);
  });
  await settle();
  expect(reminders()).toEqual([]);
  await act(async () => {
    await store.setNotification('meeting_started', true);
  });
  await settle();
  expect(reminders().map((r) => r.identifier)).toEqual(['sham-reminder:meeting:m1']);
});

it('AC 9: a saved Homework due soon switch that is off is respected', async () => {
  mockState.settings = [{ user_id: 'S', notify_homework_due: false }];
  mockState.tables.homework_assignments = [
    { id: 'a1', meeting_id: 'm1', course_id: 'A', title: 'T', description: '', due_at: inHours(30), created_by: 'O', created_at: '2026-01-01' },
  ];
  await mount();
  expect(reminders().map((r) => r.identifier)).toEqual(['sham-reminder:meeting:m1']);
});

it('AC 1 / AC 14: changing the app language reschedules in the new language', async () => {
  await mount();
  await act(async () => {
    await store.setLanguage('ru');
  });
  await settle();
  expect(reminders()[0].content.body).toBe('Встреча курса Algebra началась');
});

it('AC 1: a failure shows nothing and the next load tries again', async () => {
  scheduleMock.mockRejectedValueOnce(new Error('native failure'));
  await mount();
  expect(reminders()).toEqual([]);
  await act(async () => {
    await store.refresh();
  });
  await settle();
  expect(reminders().map((r) => r.identifier)).toEqual(['sham-reminder:meeting:m1']);
});

it('AC 2: permission declined → nothing scheduled, and earlier reminders are cancelled on the load', async () => {
  N.__setPermission({ status: 'denied', ios: { status: 1 } });
  N.__addScheduled({ identifier: 'sham-reminder:meeting:old', content: { data: { sham: 'reminder' } }, trigger: {} });
  await mount();
  expect(scheduled()).toEqual(['push-or-other']);
  expect(scheduleMock).not.toHaveBeenCalled();
});

it('AC 2: a waiting account gets none, and earlier ones are cancelled', async () => {
  mockState.tables.profiles[0].access_status = 'pending';
  N.__addScheduled({ identifier: 'sham-reminder:photos:2027-01-01', content: { data: { sham: 'reminder' } }, trigger: {} });
  await mount();
  expect(scheduled()).toEqual(['push-or-other']);
  expect(scheduleMock).not.toHaveBeenCalled();
});

it('AC 2: on the web nothing is scheduled or cancelled', async () => {
  Platform.OS = 'web' as typeof Platform.OS;
  await mount();
  expect(scheduleMock).not.toHaveBeenCalled();
  expect(Notifications.getAllScheduledNotificationsAsync).not.toHaveBeenCalled();
});

it('AC 3: Sign out cancels every reminder before signing out; other notifications stay', async () => {
  await mount();
  expect(reminders()).toHaveLength(1);
  let atSignOut: string[] = [];
  const signOutSpy = jest.fn(() => {
    atSignOut = scheduled();
  });
  mockState.calls = [];
  const realPush = mockState.calls.push.bind(mockState.calls);
  mockState.calls.push = (...items: string[]) => {
    if (items.includes('auth.signOut')) signOutSpy();
    return realPush(...items);
  };
  await act(async () => {
    await store.signOut();
  });
  expect(signOutSpy).toHaveBeenCalled();
  expect(atSignOut).toEqual(['push-or-other']);
});

it('AC 3: offline, sign-out still cancels the reminders and signs out', async () => {
  await mount();
  mockState.failRpc = 'unregister_push_device';
  mockState.calls = [];
  await act(async () => {
    await store.signOut();
  });
  expect(reminders()).toEqual([]);
  expect(mockState.calls).toEqual(['unregister_push_device', 'auth.signOut']);
});

it('AC 3: deleting the account cancels the reminders before the local session is cleared', async () => {
  await mount();
  expect(reminders()).toHaveLength(1);
  let atSignOut: string[] | null = null;
  const realPush = mockState.calls.push.bind(mockState.calls);
  mockState.calls.push = (...items: string[]) => {
    if (items.includes('auth.signOut')) atSignOut = scheduled();
    return realPush(...items);
  };
  await act(async () => {
    await store.deleteAccount('password');
  });
  expect(atSignOut).toEqual(['push-or-other']);
});

it('AC 3: another account signing in on this phone gets only its own reminders', async () => {
  await mount();
  expect(reminders().map((r) => r.identifier)).toEqual(['sham-reminder:meeting:m1']);
  await act(async () => {
    await store.signOut();
    mockState.authListener?.('SIGNED_OUT', null);
  });
  await flush();
  mockState.me = 'S2';
  await act(async () => {
    mockState.authListener?.('SIGNED_IN', { user: { id: 'S2' } });
  });
  await flush();
  await settle();
  expect(reminders().map((r) => [r.identifier, r.content.body])).toEqual([
    ['sham-reminder:meeting:m2', 'Biology meeting has started'],
  ]);
});
