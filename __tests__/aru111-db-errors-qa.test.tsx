// QA ARU-111: gaps in aru111-db-errors.test.ts:
// - AC 1: one message has one code and one code one message, and a code's English catalog text is the server's
//   message.
// - AC 7: every db.* text has Russian (all plural forms) and a note, with the same placeholders as English, and every
//   code in the catalog is raised somewhere.
// - AC 2 / AC 5 through the real store: Russian / English for a coded error, a 42501 without a code, and the app's
//   own feedback rewording kept.
// - AC 3: the scheduled status word, values that aren't strings or numbers, and a count of 0 or 11.
import { act, render } from "@testing-library/react-native";
import { Text } from "react-native";

import { dbErrorMessage, setCurrentLanguage } from "@/i18n";
import en from "@/i18n/en.json";
import notes from "@/i18n/notes.json";
import ru from "@/i18n/ru.json";
import { StoreProvider, useStore } from "@/lib/store";

const fs = jest.requireActual<{
  readFileSync: (file: string, encoding: "utf8") => string;
  readdirSync: (dir: string) => string[];
}>("fs");
// 0053 and every later migration: later stories (ARU-112, ARU-125) raise their own sham: codes.
const sql = fs
  .readdirSync("supabase/migrations")
  .filter((f) => /^\d{4}_.*\.sql$/.test(f) && Number(f.slice(0, 4)) >= 53)
  .sort()
  .map((f) => fs.readFileSync(`supabase/migrations/${f}`, "utf8"))
  .join("\n");

const EN = en as Record<string, string>;
const RU = ru as Record<string, string>;
const NOTES = notes as Record<string, string>;

// Each raise in 0053 with a fixed code: [English message as raised, code]. The message is a plain string literal
// ('' unescaped); messages built with % are kept with their % markers.
const raises = [
  ...sql.matchAll(
    /raise exception\s+'((?:[^']|'')*)'([^;]*?)hint\s*=\s*'sham:([a-z0-9_]+)'/g,
  ),
].map((m) => [m[1].replace(/''/g, "'"), m[3]] as const);
const sqlCodes = new Set(
  [...sql.matchAll(/'sham:([a-z0-9_]+)'/g)].map((m) => m[1]),
);
const catalogCodes = new Set(
  Object.keys(EN)
    .filter(
      (k) =>
        k.startsWith("db.") &&
        !k.startsWith("db.status.") &&
        k !== "db.noAccess",
    )
    .map((k) => k.slice(3).replace(/_(one|few|many|other)$/, "")),
);
const placeholders = (s: string) =>
  [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("AC 1: codes are stable and one-to-one with messages", () => {
  it("the scan finds the raises", () => {
    expect(raises.length).toBeGreaterThanOrEqual(80);
  });

  it("the same message always carries the same code, and a code always one message", () => {
    const byMessage = new Map<string, Set<string>>();
    const byCode = new Map<string, Set<string>>();
    for (const [msg, code] of raises) {
      byMessage.set(msg, (byMessage.get(msg) ?? new Set()).add(code));
      byCode.set(code, (byCode.get(code) ?? new Set()).add(msg));
    }
    expect(
      [...byMessage]
        .filter(([, c]) => c.size > 1)
        .map(([m, c]) => `${m} -> ${[...c]}`),
    ).toEqual([]);
    expect(
      [...byCode]
        .filter(([, m]) => m.size > 1)
        .map(([c, m]) => `${c} -> ${[...m]}`),
    ).toEqual([]);
  });

  it("a code's English catalog text reads as the server's message (fixed messages)", () => {
    const wrong = raises
      .filter(([msg]) => !msg.includes("%"))
      .filter(([msg, code]) => EN[`db.${code}`] !== msg)
      .map(
        ([msg, code]) =>
          `${code}: catalog "${EN[`db.${code}`]}" vs server "${msg}"`,
      );
    expect(wrong).toEqual([]);
  });

  it("a message with values reads the same once the values are in (English)", () => {
    expect(EN["db.accept_first"].replace("{name}", "%")).toBe(
      "Accept % first.",
    );
    expect(EN["db.meeting_already_status"].replace("{status}", "%")).toBe(
      "This meeting is already %; its status can't change.",
    );
    expect(EN["db.meeting_already_edit"].replace("{status}", "%")).toBe(
      "This meeting is already %; it can't be edited.",
    );
    expect(EN["db.owner_owns_courses_other"].replace(/\{\w+\}/g, "%")).toBe(
      "% owns % course(s). Reassign them first",
    );
    expect(
      EN["db.owner_owns_courses_titles_other"].replace(/\{\w+\}/g, "%"),
    ).toBe("% owns % course(s): %. Reassign them first");
  });
});

describe("AC 7: catalog", () => {
  it("every code in the migration has a catalog text, and every catalog code is raised", () => {
    expect([...sqlCodes].filter((c) => !catalogCodes.has(c))).toEqual([]);
    expect([...catalogCodes].filter((c) => !sqlCodes.has(c))).toEqual([]);
  });

  const keys = Object.keys(EN).filter((k) => k.startsWith("db."));
  it.each(keys)(
    "%s: Russian, a note, the same placeholders, no leftover English",
    (key) => {
      expect(RU[key]).toBeTruthy();
      expect(NOTES[key]).toBeTruthy();
      expect(placeholders(RU[key])).toEqual(placeholders(EN[key]));
      expect(RU[key]).not.toBe(EN[key]);
      expect(RU[key]).toMatch(/[а-яё]/i);
    },
  );

  it("plural texts have all four Russian forms", () => {
    const plural = [
      ...new Set(
        keys
          .filter((k) => /_(one|few|many|other)$/.test(k))
          .map((k) => k.replace(/_(one|few|many|other)$/, "")),
      ),
    ];
    expect(plural.length).toBeGreaterThan(0);
    for (const base of plural)
      for (const form of ["one", "few", "many", "other"])
        expect(RU[`${base}_${form}`]).toBeTruthy();
  });
});

describe("AC 3: values", () => {
  it("the scheduled status word is translated too", () => {
    const text = dbErrorMessage(
      {
        message: "x",
        hint: "sham:meeting_already_status",
        details: '{"status":"scheduled"}',
      },
      "ru",
    );
    expect(text).toContain(RU["db.status.scheduled"]);
    expect(text).not.toMatch(/scheduled|\{status\}/);
  });

  it.each([
    // ARU-139: «куратор N курса/курсов» (1/21 → курса; 0/2/3/5/11 → курсов).
    [0, "курсов"],
    [1, "курса"],
    [2, "курсов"],
    [3, "курсов"],
    [5, "курсов"],
    [11, "курсов"],
    [21, "курса"],
  ])(
    "owner with %i course(s): a Russian form, no placeholder left",
    (count, word) => {
      const details = JSON.stringify({
        name: "Анна",
        count,
        titles: "Алгебра, Physics",
      });
      const text = dbErrorMessage(
        { message: "x", hint: "sham:owner_owns_courses_titles", details },
        "ru",
      );
      expect(text).toContain(
        `Анна — куратор ${count} ${word}: Алгебра, Physics. Сначала смените куратора`,
      );
      expect(text).not.toMatch(/[{}]/);
    },
  );

  it("owner without titles (the trigger form) keeps the name and count", () => {
    const details = JSON.stringify({ name: "Mentor Max", count: 2 });
    const text = dbErrorMessage(
      { message: "x", hint: "sham:owner_owns_courses", details },
      "ru",
    );
    expect(text).toBe("Mentor Max — куратор 2 курсов. Сначала смените куратора");
    expect(text).not.toMatch(/[{}]/);
  });

  it("a value that is not a string or number is ignored, not shown as [object Object]", () => {
    const text = dbErrorMessage(
      { message: "x", hint: "sham:accept_first", details: '{"name":{"a":1}}' },
      "ru",
    );
    expect(text).not.toMatch(/object/);
  });

  it("a JSON array or null as details still gives the text", () => {
    expect(
      dbErrorMessage(
        { message: "x", hint: "sham:not_approved", details: "[1]" },
        "ru",
      ),
    ).toBe(RU["db.not_approved"]);
    expect(
      dbErrorMessage(
        { message: "x", hint: "sham:not_approved", details: "null" },
        "ru",
      ),
    ).toBe(RU["db.not_approved"]);
  });
});

describe("AC 4: hint shapes", () => {
  it.each(["SHAM:not_approved", "sham:not_approved ", "not_approved", "sham:"])(
    '"%s" is not a code: the fallback',
    (hint) => {
      expect(
        dbErrorMessage(
          { message: "Your account is not approved.", code: "42501", hint },
          "ru",
        ),
      ).toBe(RU["db.noAccess"]);
    },
  );
  it("no message at all in English: the generic text, not empty", () => {
    expect(dbErrorMessage({ code: "23514" }, "en")).toBe(
      EN["common.genericError"],
    );
  });
});

// AC 2 / AC 5 through the real store and a fake Supabase client.
const mockState = {
  rpcError: null as null | Record<string, string>,
  insertError: null as null | Record<string, string>,
};
jest.mock("@/lib/supabase", () => {
  const ok = (data: unknown) => Promise.resolve({ data, error: null });
  const query = (table: string): unknown => {
    let writing = false;
    const q: Record<string, unknown> = {};
    for (const m of [
      "select",
      "order",
      "limit",
      "lt",
      "or",
      "in",
      "eq",
      "is",
      "gte",
      "lte",
      "range",
      "maybeSingle",
      "single",
    ])
      q[m] = () => q;
    q.insert = () => {
      writing = true;
      return q;
    };
    q.upsert = q.insert;
    q.then = (resolve: (v: unknown) => unknown) => {
      if (writing) return resolve({ data: null, error: mockState.insertError });
      if (table === "profiles")
        return resolve({
          data: [
            {
              id: "S1",
              full_name: "Student Sam",
              role: "student",
              access_status: "approved",
            },
          ],
          error: null,
        });
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
        getSession: () => ok({ session: { user: { id: "S1" } } }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
      },
      from: (table: string) => query(table),
      rpc: () =>
        Promise.resolve(
          mockState.rpcError
            ? { data: null, error: mockState.rpcError }
            : { data: [], error: null },
        ),
      channel,
      removeChannel: () => {},
      storage: {
        from: () => ({ remove: () => ok([]), createSignedUrls: () => ok([]) }),
      },
    },
  };
});

let store: ReturnType<typeof useStore>;
function Probe() {
  store = useStore();
  return <Text>probe</Text>;
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

const notStarted = {
  message: "Attendance can be marked once the meeting has started.",
  code: "23514",
  hint: "sham:attendance_not_started",
  details: "",
};

describe("AC 2 / AC 5 / AC 8: through the store", () => {
  beforeEach(() => {
    mockState.rpcError = null;
    mockState.insertError = null;
  });
  afterEach(() => setCurrentLanguage("en"));

  it("Russian: marking attendance before the start shows the Russian text", async () => {
    setCurrentLanguage("ru");
    await mount();
    mockState.rpcError = notStarted;
    await expect(store.markAttendance("MEET")).rejects.toThrow(
      RU["db.attendance_not_started"],
    );
  });

  it("English: the same refusal shows today's message exactly", async () => {
    await mount();
    mockState.rpcError = notStarted;
    await expect(store.markAttendance("MEET")).rejects.toThrow(
      new Error(notStarted.message),
    );
  });

  it("switching the language and repeating the action shows the new language", async () => {
    await mount();
    mockState.rpcError = notStarted;
    await expect(store.markAttendance("MEET")).rejects.toThrow(
      new Error(notStarted.message),
    );
    setCurrentLanguage("ru");
    await expect(store.markAttendance("MEET")).rejects.toThrow(
      new Error(RU["db.attendance_not_started"]),
    );
  });

  it('Russian: an RLS refusal without a code shows "no access"; English keeps the server text', async () => {
    const rls = {
      message: "permission denied for function mark_attendance",
      code: "42501",
    };
    setCurrentLanguage("ru");
    await mount();
    mockState.rpcError = rls;
    await expect(store.markAttendance("MEET")).rejects.toThrow(
      new Error(RU["db.noAccess"]),
    );
    setCurrentLanguage("en");
    await expect(store.markAttendance("MEET")).rejects.toThrow(
      new Error(rls.message),
    );
  });

  it("Russian: the app's own feedback rewording wins over the generic mapping (42501 and 23505)", async () => {
    setCurrentLanguage("ru");
    await mount();
    mockState.insertError = {
      message:
        'new row violates row-level security policy for table "course_feedback"',
      code: "42501",
    };
    await expect(
      store.saveFeedback({ courseId: "A", rating: 5, body: "Good" }),
    ).rejects.toThrow(new Error(EN["errors.noLongerListener"]));
    mockState.insertError = {
      message: "duplicate key value violates unique constraint",
      code: "23505",
    };
    await expect(
      store.saveFeedback({ courseId: "A", rating: 5, body: "Good" }),
    ).rejects.toThrow(new Error(EN["errors.feedbackExists"]));
  });
});
