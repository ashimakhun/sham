// QA ARU-63: the real StoreProvider against a fake Supabase client. Disciplines are sorted A–Z ignoring case, a new
// discipline is sent trimmed with only id / name / hidden, blank and 101-character names never reach the network, a
// duplicate (23505) gives the AC 1 message, hiding a discipline that's gone is an error, set_course_discipline gets
// null for "No discipline", a new course sends discipline_id only when one is chosen, and a database without the
// table (0031 not run yet) still loads.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

type Write = { table: string; op: string; row?: Record<string, unknown>; eq: [string, unknown][] };
const mockState = {
  disciplines: [] as Record<string, unknown>[],
  disciplinesError: null as null | { code: string; message: string },
  writes: [] as Write[],
  rpcs: [] as [string, unknown][],
  insertError: null as null | { code: string; message: string },
  updateRows: [{ id: 'D1' }] as unknown[],
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
    q.insert = (row: Record<string, unknown>) => {
      write = { table, op: 'insert', row, eq: eqs };
      return q;
    };
    q.update = (row: Record<string, unknown>) => {
      write = { table, op: 'update', row, eq: eqs };
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (write) {
        mockState.writes.push(write);
        if (write.op === 'insert' && mockState.insertError) return resolve({ data: null, error: mockState.insertError });
        if (write.op === 'update') return resolve({ data: mockState.updateRows, error: null });
        return resolve({ data: null, error: null });
      }
      if (table === 'profiles')
        return resolve({
          data: [
            { id: 'T', full_name: 'Teacher Tess', role: 'teacher', access_status: 'approved' },
            { id: 'M', full_name: 'Mentor Max', role: 'mentor', access_status: 'approved' },
          ],
          error: null,
        });
      if (table === 'disciplines')
        return resolve(
          mockState.disciplinesError
            ? { data: null, error: mockState.disciplinesError }
            : { data: mockState.disciplines, error: null },
        );
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
        getSession: () => ok({ session: { user: { id: 'T' } } }),
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
  return <Text>{store.disciplines.length}</Text>;
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
const row = (id: string, name: string, hidden = false) => ({ id, name, hidden, created_by: 'T', created_at: '2026-11-01T10:00:00Z' });
const disciplineWrites = () => mockState.writes.filter((w) => w.table === 'disciplines');

beforeEach(() => {
  mockState.disciplines = [row('D1', 'biology'), row('D2', 'Art'), row('D3', 'algebra', true), row('D4', 'Chemistry')];
  mockState.disciplinesError = null;
  mockState.writes = [];
  mockState.rpcs = [];
  mockState.insertError = null;
  mockState.updateRows = [{ id: 'D1' }];
});

it('AC 9: disciplines are sorted A–Z ignoring case, and getDiscipline resolves only loaded ones', async () => {
  await mount();
  expect(store.disciplines.map((d) => d.name)).toEqual(['algebra', 'Art', 'biology', 'Chemistry']);
  expect(store.disciplines.find((d) => d.id === 'D3')).toMatchObject({ hidden: true, createdById: 'T' });
  expect(store.getDiscipline('D2')?.name).toBe('Art');
  expect(store.getDiscipline('HIDDEN-FROM-ME')).toBeUndefined();
  expect(store.getDiscipline(undefined)).toBeUndefined();
});

it('AC 1: a new discipline is sent trimmed with only id, name and hidden (the server sets owner and time)', async () => {
  await mount();
  await act(() => store.addDiscipline({ id: 'N1', name: '   Music  ', hidden: true }));
  expect(disciplineWrites()).toEqual([{ table: 'disciplines', op: 'insert', row: { id: 'N1', name: 'Music', hidden: true }, eq: [] }]);
});

it.each([
  ['blank', '   '],
  ['tabs and non-breaking spaces only', '\t \n'],
  ['101 characters', 'x'.repeat(101)],
])('AC 1: a %s name is refused without a network call', async (_k, name) => {
  await mount();
  await expect(store.addDiscipline({ id: 'N1', name, hidden: false })).rejects.toThrow();
  expect(disciplineWrites()).toEqual([]);
});

it('AC 1: exactly 100 characters (after trimming) is sent', async () => {
  await mount();
  await act(() => store.addDiscipline({ id: 'N1', name: ` ${'x'.repeat(100)} `, hidden: false }));
  expect(disciplineWrites()[0].row?.name).toBe('x'.repeat(100));
});

it('AC 1 / edge offline retry: a duplicate (23505) shows "A discipline with this name already exists."', async () => {
  await mount();
  mockState.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "disciplines_name_key"' };
  await expect(store.addDiscipline({ id: 'N1', name: 'art', hidden: false })).rejects.toThrow(
    'A discipline with this name already exists.',
  );
});

it('AC 2: hiding sends only hidden for that id; a discipline that is gone is an error', async () => {
  await mount();
  await act(() => store.setDisciplineHidden('D1', true));
  expect(disciplineWrites()).toEqual([{ table: 'disciplines', op: 'update', row: { hidden: true }, eq: [['id', 'D1']] }]);
  mockState.updateRows = [];
  await expect(store.setDisciplineHidden('D9', false)).rejects.toThrow('Discipline not found.');
});

it('AC 5: "No discipline" is sent as null to set_course_discipline', async () => {
  await mount();
  await act(() => store.setCourseDiscipline('A', 'D1'));
  await act(() => store.setCourseDiscipline('A', null));
  expect(mockState.rpcs.filter(([n]) => n === 'set_course_discipline')).toEqual([
    ['set_course_discipline', { course: 'A', discipline: 'D1' }],
    ['set_course_discipline', { course: 'A', discipline: null }],
  ]);
});

it('AC 4: a new course sends discipline_id only when one is chosen', async () => {
  await mount();
  await act(() => store.addCourse({ id: 'C1', title: 'One', description: '' }));
  await act(() => store.addCourse({ id: 'C2', title: 'Two', description: '', disciplineId: 'D2' }));
  const rows = mockState.writes.filter((w) => w.table === 'courses' && w.op === 'insert').map((w) => w.row ?? {});
  expect(rows[0]).not.toHaveProperty('discipline_id');
  expect(rows[1]).toMatchObject({ id: 'C2', discipline_id: 'D2' });
});

it('release order: before 0031 runs (no disciplines table) the store still loads, with no disciplines', async () => {
  mockState.disciplinesError = { code: '42P01', message: 'relation "disciplines" does not exist' };
  await mount();
  expect(store.disciplines).toEqual([]);
  expect(store.currentUser?.id).toBe('T');
});
