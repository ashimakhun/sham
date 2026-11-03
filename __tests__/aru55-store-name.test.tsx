// ARU-55: the real StoreProvider against a fake Supabase client. updateMyName() trims the name, updates only the own
// row, and every name on this device (currentUser and getUser) shows the new one right away (AC 10).
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  profiles: [] as Record<string, unknown>[],
  updates: [] as { values: unknown; eq: [string, unknown][] }[],
  fail: null as null | { message: string },
  matched: true,
  persist: false,
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    let update: { values: unknown; eq: [string, unknown][] } | null = null;
    for (const m of ['select', 'order', 'insert', 'delete', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.update = (values: unknown) => {
      update = { values, eq: [] };
      return q;
    };
    q.eq = (col: string, val: unknown) => {
      update?.eq.push([col, val]);
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (update) {
        mockState.updates.push(update);
        if (mockState.fail) return resolve({ data: null, error: mockState.fail });
        if (!mockState.matched) return resolve({ data: [], error: null });
        if (mockState.persist) {
          const id = update.eq.find(([col]) => col === 'id')?.[1];
          mockState.profiles = mockState.profiles.map((p) => (p.id === id ? { ...p, ...(update!.values as object) } : p));
        }
        return resolve({ data: [{ id: 'S1' }], error: null });
      }
      return resolve({ data: table === 'profiles' ? mockState.profiles : [], error: null });
    };
    return q;
  };
  const c: Record<string, unknown> = {};
  c.on = () => c;
  c.subscribe = () => c;
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'S1' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: () => ok([]),
      channel: () => c,
      removeChannel: () => {},
      storage: { from: () => ({ createSignedUrls: () => ok([]) }) },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.currentUser?.name}</Text>;
}

async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await act(async () => {});
  await act(async () => {});
}

beforeEach(() => {
  mockState.profiles = [
    { id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'approved' },
    { id: 'M', full_name: 'Mentor Max', role: 'mentor', access_status: 'approved' },
  ];
  mockState.updates = [];
  mockState.fail = null;
  mockState.matched = true;
  mockState.persist = false;
});

it('saves the trimmed name on the own row and shows it everywhere on this device right away', async () => {
  mockState.persist = true;
  await mount();
  await act(() => store.updateMyName('  Dana Serikova '));
  await act(async () => {});
  expect(mockState.updates).toEqual([{ values: { full_name: 'Dana Serikova' }, eq: [['id', 'S1']] }]);
  expect(store.currentUser?.name).toBe('Dana Serikova');
  expect(store.getUser('S1')?.name).toBe('Dana Serikova');
  expect(store.getUser('M')?.name).toBe('Mentor Max');
});

it('refuses blank and too long names without a request', async () => {
  await mount();
  await expect(store.updateMyName('   ')).rejects.toThrow();
  await expect(store.updateMyName('a'.repeat(81))).rejects.toThrow('Name must be 80 characters or fewer');
  expect(mockState.updates).toEqual([]);
});

it('a failed save keeps the old name', async () => {
  await mount();
  mockState.fail = { message: 'Network request failed' };
  await act(async () => {
    await expect(store.updateMyName('Dana')).rejects.toThrow('Network request failed');
  });
  expect(store.currentUser?.name).toBe('Student Sam');
});

it('a save that matches no row is an error, not a silent success', async () => {
  await mount();
  mockState.matched = false;
  await act(async () => {
    await expect(store.updateMyName('Dana')).rejects.toThrow();
  });
  expect(store.currentUser?.name).toBe('Student Sam');
});
