// QA ARU-130: gaps in aru130-store-sent-counts.test.tsx. AC 5: the realtime events that already reload the store
// (homework, homework_assignments, course_members on sham-changes) ask for the counts again, so the owner, mentors and
// the teacher see the number change live; no new realtime table or channel is added for the counts; signing out
// clears them; a hidden course the user can't see (not loaded) is never sent in the request.
import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";

import { StoreProvider, useStore } from "@/lib/store";

type Handler = (payload: unknown) => void;
const mockState = {
  courses: [] as Record<string, unknown>[],
  rpcs: [] as { name: string; args: unknown }[],
  counts: [] as Record<string, unknown>[],
  handlers: [] as { channel: string; table: string; handler: Handler }[],
  channels: [] as string[],
  authCb: null as null | ((event: string, session: unknown) => void),
  session: { user: { id: "M" } } as null | { user: { id: string } },
};

jest.mock("@/lib/supabase", () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    const q: Record<string, unknown> = {};
    for (const m of [
      "select",
      "insert",
      "delete",
      "update",
      "eq",
      "limit",
      "lt",
      "or",
      "in",
      "order",
    ])
      q[m] = () => q;
    q.then = (resolve: (v: unknown) => unknown) => {
      if (table === "profiles") {
        return resolve({
          data: [
            {
              id: "M",
              full_name: "Mentor Max",
              role: "mentor",
              access_status: "approved",
            },
          ],
          error: null,
        });
      }
      return resolve({
        data: table === "courses" ? mockState.courses : [],
        error: null,
      });
    };
    return q;
  };
  const channel = (name: string) => {
    mockState.channels.push(name);
    const c: Record<string, unknown> = {};
    c.on = (_type: string, filter: { table?: string }, handler: Handler) => {
      mockState.handlers.push({
        channel: name,
        table: filter?.table ?? "",
        handler,
      });
      return c;
    };
    c.subscribe = () => c;
    return c;
  };
  return {
    supabase: {
      auth: {
        getSession: () => ok({ session: mockState.session }),
        onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
          mockState.authCb = cb;
          return { data: { subscription: { unsubscribe: () => {} } } };
        },
        signOut: () => ok(null),
      },
      from: (table: string) => query(table),
      rpc: (name: string, args: unknown) => {
        mockState.rpcs.push({ name, args });
        if (name === "assignment_sent_counts") return ok(mockState.counts);
        return ok([]);
      },
      channel,
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
const flush = async () => {
  await act(async () => {});
  await act(async () => {});
};
const course = (id: string) => ({
  id,
  title: id,
  created_by: "M",
  created_at: "2026-11-01T00:00:00Z",
});
const countCalls = () =>
  mockState.rpcs.filter((r) => r.name === "assignment_sent_counts");
const fire = async (table: string) => {
  const h = mockState.handlers.find(
    (x) => x.channel === "sham-changes" && x.table === table,
  );
  expect(h).toBeTruthy();
  await act(async () => h!.handler({ new: {}, old: {} }));
  await flush();
};

beforeEach(() => {
  mockState.courses = [course("A"), course("B")];
  mockState.rpcs = [];
  mockState.counts = [{ assignment_id: "a1", sent: 5, listeners: 8 }];
  mockState.handlers = [];
  mockState.channels = [];
  mockState.authCb = null;
  mockState.session = { user: { id: "M" } };
});

async function mount() {
  await render(
    <StoreProvider>
      <Probe />
    </StoreProvider>,
  );
  await flush();
}

it.each(["homework", "homework_assignments", "course_members"])(
  "AC 5: a realtime %s event asks for the counts again and the new number reaches the store",
  async (table) => {
    await mount();
    expect(countCalls()).toHaveLength(1);
    expect(store.assignmentSentCounts).toEqual({
      a1: { sent: 5, listeners: 8 },
    });
    mockState.counts = [{ assignment_id: "a1", sent: 6, listeners: 9 }];
    await fire(table);
    expect(countCalls().length).toBeGreaterThanOrEqual(2);
    expect(countCalls().at(-1)?.args).toEqual({ courses: ["A", "B"] });
    expect(store.assignmentSentCounts).toEqual({
      a1: { sent: 6, listeners: 9 },
    });
  },
);

it("AC 5: no new realtime channel or table for the counts", async () => {
  await mount();
  expect(
    new Set(mockState.channels.filter((c) => /count|sent/i.test(c))),
  ).toEqual(new Set());
  expect(mockState.handlers.some((h) => /sent|count/i.test(h.table))).toBe(
    false,
  );
});

it("AC 4: only the courses the user loaded are asked for (a hidden course RLS left out is never sent)", async () => {
  mockState.courses = [course("A")];
  await mount();
  expect(countCalls()).toEqual([
    { name: "assignment_sent_counts", args: { courses: ["A"] } },
  ]);
});

it("signing out clears the counts", async () => {
  await mount();
  expect(Object.keys(store.assignmentSentCounts)).toEqual(["a1"]);
  mockState.session = null;
  await act(async () => mockState.authCb?.("SIGNED_OUT", null));
  await flush();
  expect(store.assignmentSentCounts).toEqual({});
});
