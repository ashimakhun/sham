// QA ARU-65: the real StoreProvider against a fake Supabase client. AC 8: students and mentors without Accountant
// never request course_billing; accountants and the teacher load it. Selecting sends only the course and the days
// (the server sets who and when), a duplicate select (another accountant was first) is a success, a bad period never
// reaches the network, changing a course that's no longer paid is an error, and the switch calls set_accountant.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Write = { table: string; op: string; row?: Record<string, unknown>; eq: [string, unknown][] };
const mockState = {
  me: 'T',
  reads: [] as string[],
  writes: [] as Write[],
  rpcs: [] as [string, unknown][],
  insertError: null as null | { code: string; message: string },
  updateRows: [{ course_id: 'A' }] as unknown[],
  billing: [{ course_id: 'A', start_day: 1, end_day: 5, selected_by: 'MA', selected_at: '2026-11-01T10:00:00Z' }],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    let write: Write | null = null;
    const eqs: [string, unknown][] = [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.eq = (col: string, v: unknown) => {
      eqs.push([col, v]);
      return q;
    };
    for (const op of ['insert', 'update', 'delete'])
      q[op] = (row?: Record<string, unknown>) => {
        write = { table, op, row, eq: eqs };
        return q;
      };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (write) {
        mockState.writes.push(write);
        if (write.op === 'insert' && mockState.insertError) return resolve({ data: null, error: mockState.insertError });
        if (write.op === 'update') return resolve({ data: mockState.updateRows, error: null });
        return resolve({ data: null, error: null });
      }
      mockState.reads.push(table);
      if (table === 'profiles')
        return resolve({
          data: [
            { id: 'T', full_name: 'Teacher Tess', role: 'teacher', access_status: 'approved' },
            { id: 'MA', full_name: 'Accountant Ann', role: 'mentor', access_status: 'approved', is_accountant: true },
            { id: 'M', full_name: 'Mentor Max', role: 'mentor', access_status: 'approved', is_accountant: false },
            { id: 'S1', full_name: 'Student Sam', role: 'student', access_status: 'approved' },
          ],
          error: null,
        });
      if (table === 'course_billing') return resolve({ data: mockState.billing, error: null });
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
        getSession: () => ok({ session: { user: { id: mockState.me } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: unknown) => {
        mockState.rpcs.push([name, args]);
        return ok([]);
      },
      channel,
      removeChannel: () => {},
      storage: { from: () => ({ remove: () => ok([]), createSignedUrls: () => ok([]) }) },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.courseBilling.length}</Text>;
}
async function mount(me: string) {
  mockState.me = me;
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await act(async () => {});
  await act(async () => {});
}
const billingWrites = () => mockState.writes.filter((w) => w.table === 'course_billing');

beforeEach(() => {
  mockState.reads = [];
  mockState.writes = [];
  mockState.rpcs = [];
  mockState.insertError = null;
  mockState.updateRows = [{ course_id: 'A' }];
});

it.each(['S1', 'M'])('AC 8: %s (no Accountant) never requests course_billing and has no paid courses', async (who) => {
  await mount(who);
  expect(store.currentUser?.id).toBe(who);
  expect(mockState.reads).not.toContain('course_billing');
  expect(store.courseBilling).toEqual([]);
});

it.each(['T', 'MA'])('AC 2 / AC 6: %s loads the paid courses', async (who) => {
  await mount(who);
  expect(mockState.reads).toContain('course_billing');
  expect(store.courseBilling).toEqual([
    { courseId: 'A', startDay: 1, endDay: 5, selectedById: 'MA', selectedAt: '2026-11-01T10:00:00Z' },
  ]);
  expect(store.users.find((u) => u.id === 'MA')?.isAccountant).toBe(true);
});

it('AC 3: selecting sends only the course and the days', async () => {
  await mount('MA');
  await act(() => store.selectPaidCourse('B', 10, 15));
  expect(billingWrites()).toEqual([
    { table: 'course_billing', op: 'insert', row: { course_id: 'B', start_day: 10, end_day: 15 }, eq: [] },
  ]);
});

it('edge: a duplicate select (another accountant was first) is a success', async () => {
  await mount('MA');
  mockState.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "course_billing_pkey"' };
  await expect(act(() => store.selectPaidCourse('A', 1, 5))).resolves.toBeUndefined();
});

it.each([
  [16, 15],
  [0, 5],
  [1, 29],
  [1.5, 5],
])('AC 4: a period %i–%i never reaches the network', async (s, e) => {
  await mount('MA');
  await expect(store.selectPaidCourse('B', s, e)).rejects.toThrow();
  await expect(store.setBillingPeriod('A', s, e)).rejects.toThrow();
  expect(billingWrites()).toEqual([]);
});

it('AC 4 / AC 6: the teacher changes a period (only the days); a course no longer paid is an error', async () => {
  await mount('T');
  await act(() => store.setBillingPeriod('A', 3, 7));
  expect(billingWrites()).toEqual([
    { table: 'course_billing', op: 'update', row: { start_day: 3, end_day: 7 }, eq: [['course_id', 'A']] },
  ]);
  mockState.updateRows = [];
  await expect(store.setBillingPeriod('A', 3, 7)).rejects.toThrow('This course is no longer a paid course.');
});

it('AC 5: unselect deletes that course\'s row only', async () => {
  await mount('MA');
  await act(() => store.unselectPaidCourse('A'));
  expect(billingWrites()).toEqual([{ table: 'course_billing', op: 'delete', row: undefined, eq: [['course_id', 'A']] }]);
});

it('AC 1: the teacher\'s switch calls set_accountant with the target and the value', async () => {
  await mount('T');
  await act(() => store.setAccountant('M', true));
  await act(() => store.setAccountant('M', false));
  expect(mockState.rpcs.filter(([n]) => n === 'set_accountant')).toEqual([
    ['set_accountant', { target: 'M', on_off: true }],
    ['set_accountant', { target: 'M', on_off: false }],
  ]);
});
