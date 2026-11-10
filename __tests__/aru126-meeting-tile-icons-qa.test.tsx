// QA ARU-126: gaps in aru126-meeting-tile-icons.test.tsx: the ✓ for the teacher and a non-listener mentor and none for
// a mentor listener (AC 2, today's canCheckMeetingHomework rule); the icon pills' colours and a 44 × 44 pt touch area
// on both axes; the people icon with "x of y" and its label, opening Attendance, not before the start or on a canceled
// meeting, hidden from listeners (AC 4); no pencil for a mentor who neither owns nor listens to the course on the tile
// or the Notes page, and ?edit=1 still "Not allowed" (AC 5, 6; ARU-142: listeners write notes, so they get one); the two ✓ never on one tile, each with its own confirmation (AC 2, 10); the edit and
// notes pencils never on one tile (AC 11); footer order; and the icon pills' labels in Russian from the catalog.
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { router } from "expo-router";
import { Alert, StyleSheet } from "react-native";

import CourseDetailScreen from "@/app/courses/[id]";
import MeetingNotesScreen from "@/app/courses/[id]/meetings/[meetingId]/notes";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { colors } from "@/lib/theme";
import type {
  HomeworkAssignment,
  Meeting,
  MeetingAttendance,
  MeetingListenerNote,
  User,
} from "@/lib/types";

import { fakeStore, member, users } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@/lib/store", () => require("./helpers/mocks").store);
jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ languageTag: "en-US", languageCode: "en" }]),
}));

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: "A",
  startsAt: at(24),
  topic: `Topic ${over.id}`,
  status: "scheduled",
  createdById: "M",
  createdAt: at(-100),
  ...over,
});
const P = meeting({ id: "P", startsAt: at(-1), topic: "Started" });
const F = meeting({ id: "F", startsAt: at(5), topic: "Future" });
const C = meeting({
  id: "C",
  startsAt: at(-20),
  status: "completed",
  topic: "Done",
});
// ARU-142: official notes are gone; C's notes are the owner M's own entry.
const mNote: MeetingListenerNote = {
  id: "n-C",
  meetingId: "C",
  courseId: "A",
  authorId: "M",
  body: "Covered",
  createdAt: at(-19),
  updatedAt: at(-19),
};
const notes = [mNote];
const X = meeting({
  id: "X",
  startsAt: at(-3),
  status: "canceled",
  topic: "Dropped",
});
const asg: HomeworkAssignment = {
  id: "a-C",
  meetingId: "C",
  courseId: "A",
  title: "Essay",
  description: "",
  createdById: "M",
  createdAt: at(-19),
  dueAt: at(30),
};
// S1 and M2 listen to A (owner M); N is a mentor who neither owns nor listens.
const members = [member("A", "S1"), member("A", "M2")];
const mark = (meetingId: string, userId: string): MeetingAttendance => ({
  meetingId,
  userId,
  markedAt: at(-1),
});

const flat = (s: unknown) =>
  (StyleSheet.flatten(
    (typeof s === "function" ? s({ pressed: false }) : s) as never,
  ) ?? {}) as Record<string, unknown>;
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));
const labels = (id: string) =>
  within(screen.getByTestId(`actions-${id}`))
    .getAllByRole(/button|link/)
    .map((n) => n.props.accessibilityLabel as string);
const inApp = (ui: React.ReactElement) => (
  <LanguageProvider>{ui}</LanguageProvider>
);
const flush = () => act(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  params.id = "A";
  delete params.meetingId;
  delete params.edit;
});

describe("AC 2: who gets the ✓ for Mark homework checked (unchanged rule)", () => {
  it.each(["M", "T", "N"] as const)(
    "%s gets the ✓ on a completed meeting awaiting the check",
    async (who) => {
      setStore(fakeStore(who, { courseMembers: members, meetings: [C] }));
      await render(<CourseDetailScreen />);
      expect(
        inMeeting("C").getByRole("button", { name: "Mark homework checked" }),
      ).toBeTruthy();
    },
  );

  it.each(["M2", "S1"] as const)("%s (a listener) gets no ✓", async (who) => {
    setStore(fakeStore(who, { courseMembers: members, meetings: [C] }));
    await render(<CourseDetailScreen />);
    expect(
      inMeeting("C").queryByRole("button", { name: "Mark homework checked" }),
    ).toBeNull();
  });
});

describe("icon pills: colours and a 44 × 44 pt touch area", () => {
  const check = (pill: Parameters<typeof within>[0]) => {
    const s = flat(pill.props.style) as {
      width?: number;
      minHeight?: number;
      height?: number;
    };
    const slop = (pill.props.hitSlop ?? {}) as {
      top?: number;
      bottom?: number;
      left?: number;
      right?: number;
    };
    const h =
      (s.minHeight ?? s.height ?? 0) + (slop.top ?? 0) + (slop.bottom ?? 0);
    const w = (s.width ?? 0) + (slop.left ?? 0) + (slop.right ?? 0);
    expect(h).toBeGreaterThanOrEqual(44);
    expect(w).toBeGreaterThanOrEqual(44);
    return s as Record<string, unknown>;
  };

  it("✓ (homework and completed) is green on successSoft, ✕ is red, pencils are indigo; none shows text", async () => {
    setStore(
      fakeStore("M", {
        courseMembers: members,
        meetings: [P, F, C],
        meetingListenerNotes: notes,
      }),
    );
    await render(<CourseDetailScreen />);
    const pills = [
      {
        pill: inMeeting("C").getByRole("button", {
          name: "Mark homework checked",
        }),
        icon: "checkmark",
        fg: colors.success,
        bg: colors.successSoft,
      },
      {
        pill: inMeeting("P").getByRole("button", { name: "Mark completed" }),
        icon: "checkmark",
        fg: colors.success,
        bg: colors.successSoft,
      },
      {
        pill: inMeeting("P").getByRole("button", { name: "Cancel meeting" }),
        icon: "close",
        fg: colors.danger,
      },
      {
        pill: inMeeting("F").getByRole("button", { name: "Edit meeting" }),
        icon: "create-outline",
        fg: colors.primary,
        bg: colors.primarySoft,
      },
      {
        pill: inMeeting("C").getByRole("button", { name: "Edit notes" }),
        icon: "create-outline",
        fg: colors.primary,
        bg: colors.primarySoft,
      },
    ];
    for (const { pill, icon, fg, bg } of pills) {
      const s = check(pill);
      if (bg) expect(s.backgroundColor).toBe(bg);
      const glyph = within(pill).getByTestId(`icon-${icon}`, {
        includeHiddenElements: true,
      });
      expect(glyph.props.color).toBe(fg);
      // Icon only: no visible text inside the pill.
      expect(within(pill).queryAllByText(/./)).toHaveLength(0);
    }
  });
});

describe("AC 4: the people count", () => {
  it('owner: people icon then "x of y", label "Attended x of y", opens Attendance', async () => {
    setStore(
      fakeStore("M", {
        courseMembers: members,
        meetings: [P],
        attendance: [mark("P", "S1")],
      }),
    );
    await render(<CourseDetailScreen />);
    const count = inMeeting("P").getByRole("link", { name: "Attended 1 of 2" });
    expect(
      within(count).getByTestId("icon-people-outline", {
        includeHiddenElements: true,
      }),
    ).toBeTruthy();
    expect(within(count).getByText("1 of 2")).toBeTruthy();
    expect(screen.queryByText(/Attended: /)).toBeNull();
    await fireEvent.press(count);
    expect(router.push).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ id: "A", meetingId: "P" }),
      }),
    );
  });

  it("no count before the start or on a canceled meeting; a listener never sees it", async () => {
    setStore(fakeStore("M", { courseMembers: members, meetings: [F, X] }));
    const view = await render(<CourseDetailScreen />);
    expect(screen.queryByRole("link", { name: /^Attended / })).toBeNull();
    expect(
      screen.queryByTestId("icon-people-outline", {
        includeHiddenElements: true,
      }),
    ).toBeNull();
    await view.unmount();
    setStore(fakeStore("S1", { courseMembers: members, meetings: [P, C] }));
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole("link", { name: /^Attended / })).toBeNull();
  });
});

describe("AC 5 / AC 6: no pencil for a mentor who neither owns nor listens to the course", () => {
  // Render the Stack header's headerRight, which the shared mock leaves out (as in the dev test).
  const { Stack } = jest.requireMock("expo-router") as {
    Stack: { Screen: unknown };
  };
  const original = Stack.Screen;
  beforeAll(() => {
    Stack.Screen = ({
      options,
    }: {
      options?: { headerRight?: () => React.ReactNode };
    }) => options?.headerRight?.() ?? null;
  });
  afterAll(() => {
    Stack.Screen = original;
  });

  // ARU-142 AC 6: N no longer reads notes (the database sends none), so N gets no Notes link either.
  it("tile: N gets neither Notes nor a pencil", async () => {
    setStore(
      fakeStore("N", {
        courseMembers: members,
        meetings: [C, { ...C, id: "C2" }],
      }),
    );
    await render(<CourseDetailScreen />);
    expect(screen.queryByRole("link", { name: "Notes" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Add notes|Edit notes/ }),
    ).toBeNull();
  });

  it('Notes page: N gets no header pencil, and ?edit=1 is still "Not allowed"', async () => {
    params.meetingId = "C";
    // ARU-142 AC 6: N reads no notes (the database sends none).
    setStore(fakeStore("N", { courseMembers: members, meetings: [C] }));
    const view = await render(<MeetingNotesScreen />);
    expect(screen.getByText("No notes yet")).toBeTruthy();
    expect(screen.queryByTestId("notes-edit")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Add notes|Edit notes/ }),
    ).toBeNull();
    await view.unmount();
    params.edit = "1";
    setStore(fakeStore("N", { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByText("Not allowed")).toBeTruthy();
  });

  it("Notes page: the teacher (not the owner) gets the pencil, labelled Add notes when there are none", async () => {
    params.meetingId = "C";
    setStore(fakeStore("T", { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    const pencil = screen.getByTestId("notes-edit");
    expect(pencil.props.accessibilityLabel).toBe("Add notes");
    expect(pencil.props.accessibilityRole).toBe("button");
    await fireEvent.press(pencil);
    expect(router.replace).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ id: "A", meetingId: "C", edit: "1" }),
      }),
    );
  });
});

describe("AC 2 / AC 10 / AC 11: icons that look alike never share a tile", () => {
  // In progress keeps the Edit pencil: Edit / reschedule is offered on any scheduled meeting today (ARU-15), and AC 12
  // keeps who sees each action. It never meets the notes pencil, which is on completed meetings only.
  it("in progress: one ✓ (Mark completed), the ✕ last, no notes pencil; completed: one ✓ (homework), no ✕", async () => {
    setStore(
      fakeStore("T", {
        courseMembers: members,
        meetings: [P, C],
        assignments: [asg],
      }),
    );
    await render(<CourseDetailScreen />);
    const p = labels("P");
    expect(p.filter((l) => l === "Mark completed")).toHaveLength(1);
    expect(p).not.toContain("Mark homework checked");
    expect(p).not.toContain("Edit notes");
    expect(p).not.toContain("Add notes");
    expect(p[p.length - 1]).toBe("Cancel meeting");
    expect(
      within(screen.getByTestId("actions-P")).getAllByTestId("icon-checkmark", {
        includeHiddenElements: true,
      }),
    ).toHaveLength(1);
    const c = labels("C");
    expect(c).toContain("Mark homework checked");
    expect(c).not.toContain("Mark completed");
    expect(c).not.toContain("Cancel meeting");
    expect(c).not.toContain("Edit meeting");
    expect(
      within(screen.getByTestId("actions-C")).getAllByTestId("icon-checkmark", {
        includeHiddenElements: true,
      }),
    ).toHaveLength(1);
  });

  it("each ✓ confirmation names its own action", async () => {
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    setStore(fakeStore("M", { courseMembers: members, meetings: [P] }));
    const view = await render(<CourseDetailScreen />);
    await fireEvent.press(
      inMeeting("P").getByRole("button", { name: "Mark completed" }),
    );
    await view.unmount();
    setStore(fakeStore("M", { courseMembers: members, meetings: [C] }));
    await render(<CourseDetailScreen />);
    await fireEvent.press(
      inMeeting("C").getByRole("button", { name: "Mark homework checked" }),
    );
    expect(alert.mock.calls[0][1]).toMatch(/as completed\?$/);
    expect(alert.mock.calls[1][1]).toMatch(/as checked\?$/);
  });

  it("upcoming: the Edit pencil and the ✕ only; owner footer order is Edit meeting first, Cancel meeting last", async () => {
    setStore(fakeStore("M", { courseMembers: members, meetings: [F] }));
    await render(<CourseDetailScreen />);
    expect(labels("F")).toEqual(["Edit meeting", "Cancel meeting"]);
  });

  it("completed (owner, with notes and homework): Notes, then the notes pencil, Assign/…, then the ✓", async () => {
    setStore(
      fakeStore("M", {
        courseMembers: members,
        meetings: [C],
        meetingListenerNotes: notes,
      }),
    );
    await render(<CourseDetailScreen />);
    const c = labels("C");
    expect(c.indexOf("Notes")).toBe(0);
    expect(c.indexOf("Edit notes")).toBe(1);
    expect(c.indexOf("Mark homework checked")).toBeGreaterThan(1);
    expect(c).not.toContain("Edit meeting");
  });
});

describe("AC 12: listeners and students see none of the managing icons", () => {
  // ARU-142: a listener writes their own notes, so the notes pencil ("Add notes": no note of theirs) is no longer a
  // managing icon; it is their only pencil, on the completed tile only.
  it.each(["S1", "M2"] as const)(
    "%s on upcoming, in-progress and completed tiles",
    async (who) => {
      setStore(fakeStore(who, { courseMembers: members, meetings: [P, F, C] }));
      await render(<CourseDetailScreen />);
      for (const name of [
        "Mark homework checked",
        "Mark completed",
        "Cancel meeting",
        "Edit meeting",
        "Edit notes",
      ])
        expect(screen.queryByRole("button", { name })).toBeNull();
      expect(screen.getAllByRole("button", { name: "Add notes" })).toEqual([
        inMeeting("C").getByRole("button", { name: "Add notes" }),
      ]);
    },
  );
});

describe("Russian: the icon pills read their labels from the catalog", () => {
  const ru = (who: keyof typeof users, over = {}) => {
    const me: User = { ...users[who], language: "ru" };
    setStore(fakeStore(who, { currentUser: me, ...over }));
  };

  it("owner: ✓, ✕, pencils and the people count in Russian", async () => {
    ru("M", {
      courseMembers: members,
      meetings: [P, F, C],
      attendance: [mark("P", "S1")],
      meetingListenerNotes: notes,
    });
    await render(inApp(<CourseDetailScreen />));
    await flush();
    expect(
      inMeeting("C").getByRole("button", {
        name: "Отметить домашнее задание проверенным",
      }),
    ).toBeTruthy();
    expect(
      inMeeting("C").getByRole("button", { name: "Изменить заметки" }),
    ).toBeTruthy();
    expect(
      inMeeting("P").getByRole("button", { name: "Отметить завершённой" }),
    ).toBeTruthy();
    expect(
      inMeeting("P").getByRole("button", { name: "Отменить встречу" }),
    ).toBeTruthy();
    expect(
      inMeeting("F").getByRole("button", { name: "Изменить встречу" }),
    ).toBeTruthy();
    const count = inMeeting("P").getByRole("link", {
      name: "Присутствовали 1 из 2",
    });
    expect(within(count).getByText("1 из 2")).toBeTruthy();
    expect(screen.queryByText(/Присутствовали: /)).toBeNull();
  });
});
