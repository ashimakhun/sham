// ARU-197: completeCourse() / reopenCourse() in the real StoreProvider against a fake Supabase client: the function
// called, the reload afterwards, the offline error and a database refusal; completed_at / completed_by reach Course.
import { act, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { COURSE_SAVE_FAILED } from '@/lib/courseCompletion';
import { StoreProvider, useStore } from '@/lib/store';

type Res = { data: unknown; error: null | { message: string; code?: string; hint?: string } };
const mockState = {
  role: 'mentor',
  calls: [] as string[],
  courseLoads: 0,
  /** What the next complete_course / reopen_course answers; 'throw' = the request itself fails. */
  answer: { data: null, error: null } as Res | 'throw',
  courses: [] as Record<string, unknown>[],
};

jest.mock('@/lib/supabase', () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'order', 'insert', 'delete', 'limit', 'lt', 'or', 'in', 'eq', 'update']) q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => {
      if (table === 'courses') mockState.courseLoads += 1;
      return resolve({
        data:
          table === 'profiles'
            ? [{ id: 'M', full_name: 'Mentor Max', role: mockState.role, access_status: 'approved' }]
            : table === 'courses'
              ? mockState.courses
              : [],
        error: null,
      });
    };
    return q;
  };
  const c: Record<string, unknown> = {};
  c.on = () => c;
  c.subscribe = () => c;
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: { user: { id: 'M' } } }),
        onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: Record<string, unknown>) => {
        if (name === 'complete_course' || name === 'reopen_course') {
          mockState.calls.push(`${name} ${JSON.stringify(args)}`);
          if (mockState.answer === 'throw') return Promise.reject(new TypeError('Network request failed'));
          return Promise.resolve(mockState.answer);
        }
        return ok([]);
      },
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

const row = (over: Record<string, unknown> = {}) => ({
  id: 'A',
  title: 'Algebra',
  description: '',
  created_by: 'M',
  created_at: '2026-10-01T10:00:00.000Z',
  ...over,
});
const failure = async (action: () => Promise<void>) => {
  let message = '';
  await act(async () => {
    message = await action().then(
      () => 'no error',
      (e: Error) => e.message,
    );
  });
  return message;
};

beforeEach(() => {
  mockState.role = 'mentor';
  mockState.calls = [];
  mockState.answer = { data: null, error: null };
  mockState.courses = [row()];
});

it('completed_at / completed_by become completedAt / completedById; an active course has neither', async () => {
  mockState.courses = [
    row({ completed_at: '2026-11-28T09:30:00+00:00', completed_by: 'M' }),
    row({ id: 'B', completed_at: null, completed_by: null }),
    row({ id: 'C' }), // before 0082 runs: the columns aren't there
  ];
  await mount();
  expect(store.getCourse('A')).toMatchObject({ completedAt: '2026-11-28T09:30:00+00:00', completedById: 'M' });
  expect(store.getCourse('B')?.completedAt).toBeUndefined();
  expect(store.getCourse('B')?.completedById).toBeUndefined();
  expect(store.getCourse('C')?.completedAt).toBeUndefined();
});

it('completeCourse calls complete_course(course) and reloads', async () => {
  await mount();
  const before = mockState.courseLoads;
  await act(() => store.completeCourse('A'));
  expect(mockState.calls).toEqual(['complete_course {"course":"A"}']);
  expect(mockState.courseLoads).toBeGreaterThan(before);
});

it('reopenCourse calls reopen_course(course) and reloads', async () => {
  await mount();
  const before = mockState.courseLoads;
  await act(() => store.reopenCourse('A'));
  expect(mockState.calls).toEqual(['reopen_course {"course":"A"}']);
  expect(mockState.courseLoads).toBeGreaterThan(before);
});

it.each([
  ['the request fails', 'throw' as const],
  ['supabase-js reports a fetch error without a code', { data: null, error: { message: 'TypeError: Failed to fetch' } }],
])('offline (%s): "Could not save. Please try again." and no reload', async (_label, answer) => {
  await mount();
  mockState.answer = answer;
  const before = mockState.courseLoads;
  expect(await failure(() => store.completeCourse('A'))).toBe(COURSE_SAVE_FAILED);
  expect(await failure(() => store.reopenCourse('A'))).toBe('Could not save. Please try again.');
  expect(mockState.courseLoads).toBe(before);
});

it('a database refusal shows the server message', async () => {
  await mount();
  mockState.answer = {
    data: null,
    error: { message: 'Only the course owner or the teacher can complete a course.', code: '42501', hint: 'sham:course_complete_role' },
  };
  expect(await failure(() => store.completeCourse('A'))).toBe('Only the course owner or the teacher can complete a course.');
});

it('a student never reaches the server', async () => {
  mockState.role = 'student';
  await mount();
  expect(await failure(() => store.completeCourse('A'))).toMatch(/^Only a /);
  expect(mockState.calls).toEqual([]);
});
