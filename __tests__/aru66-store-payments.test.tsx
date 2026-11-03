// ARU-66: the real StoreProvider against a fake Supabase client. Accountants and the teacher load Paid marks and
// exemptions; students and other mentors never request them (they only call my_payment_dues). Marks send only the
// course, listener and month (the server sets who and when); a duplicate is a safe retry.
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
      if (table === 'course_payments')
        return resolve({
          data: [{ course_id: 'A', user_id: 'S1', month: '2026-11-01', marked_by: 'MA', marked_at: '2026-11-02T10:00:00Z' }],
          error: null,
        });
      if (table === 'course_payment_exemptions') return resolve({ data: [{ course_id: 'A', user_id: 'S2' }], error: null });
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
        if (name === 'my_payment_dues') return ok([{ course_id: 'A', deadline: '2026-11-05' }]);
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
  return <Text>{store.coursePayments.length}</Text>;
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
const paymentWrites = () => mockState.writes.filter((w) => w.table.startsWith('course_payment'));

beforeEach(() => {
  mockState.reads = [];
  mockState.writes = [];
  mockState.rpcs = [];
  mockState.insertError = null;
});

it.each(['S1', 'M'])('AC4: %s never requests marks or exemptions', async (who) => {
  await mount(who);
  expect(mockState.reads).not.toContain('course_payments');
  expect(mockState.reads).not.toContain('course_payment_exemptions');
  expect(store.coursePayments).toEqual([]);
  expect(store.paymentExemptions).toEqual([]);
});

it.each(['T', 'MA'])('AC1 / AC6: %s loads marks and exemptions', async (who) => {
  await mount(who);
  expect(store.coursePayments).toEqual([
    { courseId: 'A', userId: 'S1', month: '2026-11-01', markedById: 'MA', markedAt: '2026-11-02T10:00:00Z' },
  ]);
  expect(store.paymentExemptions).toEqual([{ courseId: 'A', userId: 'S2' }]);
});

it('AC1: mark, undo, exempt and clear send only keys; a duplicate mark is a safe retry', async () => {
  await mount('MA');
  await act(() => store.markPaid('A', 'S2', '2026-11-01'));
  mockState.insertError = { code: '23505', message: 'duplicate key' };
  await act(() => store.markPaid('A', 'S2', '2026-11-01'));
  await act(() => store.setExempt('A', 'S1', true));
  mockState.insertError = null;
  await act(() => store.undoPaid('A', 'S1', '2026-11-01'));
  await act(() => store.setExempt('A', 'S2', false));
  expect(paymentWrites()).toEqual([
    { table: 'course_payments', op: 'insert', row: { course_id: 'A', user_id: 'S2', month: '2026-11-01' }, eq: [] },
    { table: 'course_payments', op: 'insert', row: { course_id: 'A', user_id: 'S2', month: '2026-11-01' }, eq: [] },
    { table: 'course_payment_exemptions', op: 'insert', row: { course_id: 'A', user_id: 'S1' }, eq: [] },
    {
      table: 'course_payments',
      op: 'delete',
      row: undefined,
      eq: [
        ['course_id', 'A'],
        ['user_id', 'S1'],
        ['month', '2026-11-01'],
      ],
    },
    {
      table: 'course_payment_exemptions',
      op: 'delete',
      row: undefined,
      eq: [
        ['course_id', 'A'],
        ['user_id', 'S2'],
      ],
    },
  ]);
});

it('a refused mark is an error', async () => {
  await mount('MA');
  mockState.insertError = { code: '42501', message: 'new row violates row-level security policy' };
  await expect(store.markPaid('A', 'S3', '2026-11-01')).rejects.toThrow('row-level security');
});

it('a month that is not the first day never reaches the network', async () => {
  await mount('MA');
  await expect(store.markPaid('A', 'S3', '2026-11-03')).rejects.toThrow();
  expect(paymentWrites()).toEqual([]);
});

it('a student never marks', async () => {
  await mount('S1');
  await expect(store.markPaid('A', 'S1', '2026-11-01')).rejects.toThrow();
  expect(paymentWrites()).toEqual([]);
});

it('AC9: a listener gets their dues for the local date from my_payment_dues', async () => {
  await mount('S1');
  await expect(store.loadPaymentDues('2026-11-03')).resolves.toEqual([{ courseId: 'A', deadline: '2026-11-05' }]);
  expect(mockState.rpcs).toContainEqual(['my_payment_dues', { today: '2026-11-03' }]);
});
