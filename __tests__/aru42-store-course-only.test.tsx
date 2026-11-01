// ARU-42: the real StoreProvider against a fake Supabase client. course_only is saved only together with a course
// (upload and edit), and a loaded item counts as course-only only while it has a course.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { StoreProvider, useStore } from '@/lib/store';

const mockState = {
  files: [] as Record<string, unknown>[],
  writes: [] as { op: string; row: Record<string, unknown> }[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    let write: { op: string; row: Record<string, unknown> } | null = null;
    let lookup = false;
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'delete', 'limit', 'lt', 'or', 'in']) q[m] = () => q;
    q.eq = () => {
      lookup = true;
      return q;
    };
    q.insert = (row: Record<string, unknown>) => {
      write = { op: 'insert', row };
      return q;
    };
    q.update = (row: Record<string, unknown>) => {
      write = { op: 'update', row };
      return q;
    };
    q.then = (resolve: (v: unknown) => unknown) => {
      if (write) {
        mockState.writes.push(write);
        return resolve({ data: write.op === 'update' ? [{ id: 'f1' }] : null, error: null });
      }
      if (table === 'profiles') return resolve({ data: [{ id: 'M', full_name: 'Mentor Max', role: 'mentor' }], error: null });
      if (table === 'material_files') return resolve({ data: lookup ? [] : mockState.files, error: null });
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
  const bucket = { upload: (path: string) => ok({ path }), remove: () => ok([]), createSignedUrls: () => ok([]) };
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'M' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: () => ok([]),
      channel,
      removeChannel: () => {},
      storage: { from: () => bucket },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>{store.materialFiles.length}</Text>;
}
const row = (id: string, courseId: string | null, courseOnly: boolean) => ({
  id,
  author_id: 'M',
  name: id,
  description: '',
  course_id: courseId,
  course_only: courseOnly,
  storage_path: `M/${id}.pdf`,
  size_bytes: 10,
  created_at: '2026-10-20T10:00:00.000Z',
  updated_at: '2026-10-20T10:00:00.000Z',
});
const pdf = { uri: 'file:///a.pdf', name: 'a.pdf', mimeType: 'application/pdf', size: 10 };

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
  mockState.files = [row('co', 'A', true), row('ev', 'A', false), row('gone', null, true)];
  mockState.writes = [];
  globalThis.fetch = jest.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(10) })) as unknown as typeof fetch;
});

it('maps course_only, and counts an item without a course as Everyone', async () => {
  await mount();
  const by = (id: string) => store.materialFiles.find((f) => f.id === id)?.courseOnly;
  expect(by('co')).toBe(true);
  expect(by('ev')).toBe(false);
  expect(by('gone')).toBe(false);
});

it.each([
  ['course-only with a course', { courseId: 'A', courseOnly: true }, true],
  ['Everyone with a course', { courseId: 'A' }, false],
  ['course-only without a course', { courseOnly: true }, false],
])('upload: %s saves course_only = %s', async (_l, extra, expected) => {
  await mount();
  await act(() => store.addMaterialFile({ id: 'n1', file: pdf, name: 'Book', description: '', ...extra }));
  const insert = mockState.writes.find((w) => w.op === 'insert')!;
  expect(insert.row.course_only).toBe(expected);
});

it.each([
  ['course-only with a course', { courseId: 'B', courseOnly: true }, true],
  ['back to Everyone', { courseId: 'A' }, false],
  ['"No course"', { courseOnly: true }, false],
])('edit: %s saves course_only = %s', async (_l, extra, expected) => {
  await mount();
  await act(() => store.updateMaterialFile('co', { name: 'Book', description: '', ...extra }));
  const update = mockState.writes.find((w) => w.op === 'update')!;
  expect(update.row.course_only).toBe(expected);
});
