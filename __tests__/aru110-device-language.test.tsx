// ARU-110 AC 2: the real StoreProvider against a fake Supabase client. A signed-in user who never chose a language
// gets the phone language saved on the account (profiles.device_language) once per start, only when it differs; a
// user who chose keeps theirs untouched; the save is not a choice and never shows an error.
import { act, render } from '@testing-library/react-native';
import * as Localization from 'expo-localization';
import { AppState, Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

jest.mock('expo-localization', () => ({ getLocales: jest.fn(() => [{ languageTag: 'ru-RU', languageCode: 'ru' }]) }));

const mockProfile: Record<string, unknown> = {};
const mockUpdates: Record<string, unknown>[] = [];
const mockFail = { update: false };

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    let update: Record<string, unknown> | null = null;
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'eq', 'insert', 'delete', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.update = (values: Record<string, unknown>) => {
      update = values;
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => {
      if (table === 'profiles' && update) {
        mockUpdates.push(update);
        return mockFail.update ? reject(new Error('Network request failed')) : resolve({ data: null, error: null });
      }
      if (table === 'profiles') return resolve({ data: [{ id: 'S1', full_name: 'Student Sam', role: 'student', ...mockProfile }], error: null });
      return resolve({ data: [], error: null });
    };
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
        getSession: () => ok({ session: { user: { id: 'S1' } } }),
        getUser: () => ok({ user: { id: 'S1' } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: () => ok([]),
      channel,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.currentUser?.role ?? 'none'}</Text>;
}
const flush = () => act(async () => {});
async function start() {
  const view = await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
  await flush();
  return view;
}

const phone = (code: string) =>
  (Localization.getLocales as jest.Mock).mockReturnValue([{ languageTag: `${code}-XX`, languageCode: code }]);

beforeEach(() => {
  jest.spyOn(AppState, 'addEventListener').mockImplementation(
    () => ({ remove: () => {} }) as ReturnType<typeof AppState.addEventListener>,
  );
  for (const k of Object.keys(mockProfile)) delete mockProfile[k];
  mockUpdates.length = 0;
  mockFail.update = false;
  phone('ru');
});
afterEach(() => jest.restoreAllMocks());

it('never chose, Russian phone, nothing saved: saves ru (not as a choice)', async () => {
  Object.assign(mockProfile, { language: null, device_language: null });
  await start();
  expect(mockUpdates).toEqual([{ device_language: 'ru' }]);
  expect(store.currentUser?.language).toBeUndefined();
});

it('the phone changed to English: saves en', async () => {
  phone('en');
  Object.assign(mockProfile, { language: null, device_language: 'ru' });
  await start();
  expect(mockUpdates).toEqual([{ device_language: 'en' }]);
});

it('nothing changed: writes nothing', async () => {
  Object.assign(mockProfile, { language: null, device_language: 'ru' });
  await start();
  expect(mockUpdates).toEqual([]);
});

it('a user who chose a language: their device language is never changed', async () => {
  Object.assign(mockProfile, { language: 'en', device_language: null });
  await start();
  expect(mockUpdates).toEqual([]);
  expect(store.currentUser?.language).toBe('en');
});

it('before 0051 (no column): writes nothing', async () => {
  Object.assign(mockProfile, { language: null });
  await start();
  expect(mockUpdates).toEqual([]);
});

it('offline: the failed save is silent and the app loads', async () => {
  mockFail.update = true;
  Object.assign(mockProfile, { language: null, device_language: null });
  await start();
  expect(mockUpdates).toHaveLength(1);
  expect(store.currentUser?.role).toBe('student');
});

it('once per start: a reload does not save again', async () => {
  Object.assign(mockProfile, { language: null, device_language: null });
  await start();
  await act(() => store.refresh());
  expect(mockUpdates).toHaveLength(1);
});
