// QA ARU-149: gaps in aru149-history-no-link.test.tsx: a history tile with a link renders exactly like the same tile
// with no location (AC 1 + AC 2, including "Homework sent: x of y" and the Notes actions), in English and Russian;
// no link element even among hidden elements; any http(s) link in any letter case is hidden, while text that only
// looks like an address stays as grey text (AC 3); a current meeting the owner cancels loses its link at once; Edit
// meeting for a history meeting still refuses and nothing writes the location (AC 5).
import { render, screen, within } from "@testing-library/react-native";

import CourseDetailScreen from "@/app/courses/[id]";
import EditMeetingScreen from "@/app/courses/[id]/meetings/[meetingId]";
import { I18nContext, make } from "@/i18n/context";
import type {
  HomeworkAssignment,
  Meeting,
  MeetingListenerNote,
} from "@/lib/types";

import { fakeStore, member } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

const HOUR = 60 * 60 * 1000;
const NOW = Date.now();
const at = (h: number) => new Date(NOW + h * HOUR).toISOString();
const LINK = "https://meet.example.com/abc";
const hidden = { includeHiddenElements: true };
const members = [member("A", "S1"), member("A", "M2")];

const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: "A",
  startsAt: at(-40),
  topic: "",
  status: "completed",
  homeworkCheckedAt: at(-1),
  homeworkCheckedById: "M",
  createdById: "M",
  createdAt: at(-100),
  ...over,
});
const asg: HomeworkAssignment = {
  id: "HW",
  meetingId: "H",
  courseId: "A",
  title: "Essay",
  description: "",
  createdById: "M",
  createdAt: at(-39),
  dueAt: at(-10),
};
const note: MeetingListenerNote = {
  id: "n1",
  meetingId: "H",
  courseId: "A",
  authorId: "S1",
  body: "My note",
  createdAt: at(-30),
  updatedAt: at(-30),
  isPublic: true,
};
const ru = (ui: React.ReactElement) => (
  <I18nContext.Provider value={make("ru")}>{ui}</I18nContext.Provider>
);

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params) as (keyof typeof params)[])
    delete params[k];
  params.id = "A";
});

/** The whole Course details screen for `who`, with the history meeting H at `location`. */
async function screenWith(
  who: "S1" | "M" | "T" | "N",
  location: string | undefined,
  lang: "en" | "ru",
) {
  setStore(
    fakeStore(who, {
      courseMembers: members,
      meetings: [
        meeting({ id: "H", location, rescheduledAt: at(-41) } as Meeting),
      ],
      assignments: [asg],
      assignmentSentCounts: { HW: { sent: 1, listeners: 2 } },
      meetingListenerNotes: [note],
    }),
  );
  const view = await render(
    lang === "ru" ? ru(<CourseDetailScreen />) : <CourseDetailScreen />,
  );
  // Functions (handlers) and React internals are left out; types, props, styles and text are kept.
  const seen = new WeakSet<object>();
  const tree = JSON.stringify(view.toJSON(), (key, value) => {
    if (typeof value === "function" || key.startsWith("_") || key === "ref")
      return undefined;
    if (value && typeof value === "object") {
      if (seen.has(value)) return undefined;
      seen.add(value);
    }
    return value;
  });
  await view.unmount();
  return tree;
}

describe.each(["S1", "M", "T", "N"] as const)("as %s", (who) => {
  it.each(["en", "ru"] as const)(
    "AC 1 / AC 2 / AC 6 (%s): a history tile with a link is identical to the same tile with no location",
    async (lang) => {
      const withLink = await screenWith(who, LINK, lang);
      const without = await screenWith(who, undefined, lang);
      expect(withLink).toBe(without);
      expect(withLink).not.toContain("meet.example.com");
      // The compared screen does hold the history tile with its sent line (the comparison isn't of two empty trees).
      expect(withLink).toContain('"meeting-H"');
      expect(withLink).toContain('"homework-sent-H"');
    },
  );
});

it('AC 2: the history tile keeps the title, badge, Rescheduled, "Homework sent: 1 of 2" and the Notes actions', async () => {
  setStore(
    fakeStore("S1", {
      courseMembers: members,
      meetings: [
        meeting({ id: "H", location: LINK, rescheduledAt: at(-41) } as Meeting),
      ],
      assignments: [asg],
      assignmentSentCounts: { HW: { sent: 1, listeners: 2 } },
      meetingListenerNotes: [note],
    }),
  );
  await render(<CourseDetailScreen />);
  const tile = within(screen.getByTestId("meeting-H"));
  expect(tile.getByText("Completed")).toBeTruthy();
  expect(tile.getByTestId("rescheduled-H")).toBeTruthy();
  expect(tile.getByTestId("homework-sent-H")).toBeTruthy();
  expect(tile.getByRole("link", { name: "Notes" })).toBeTruthy();
  expect(tile.getByRole("button", { name: /notes/i })).toBeTruthy();
  expect(tile.queryByText(/meet\.example\.com/, hidden)).toBeNull();
});

it.each([
  ["http, not https", "http://meet.example.com/abc"],
  ["upper-case scheme", "HTTPS://Meet.Example.com/ABC"],
  ["tabs and newlines around it", "\n\thttps://meet.example.com/x \n"],
])(
  "AC 1 / edge cases: a %s link is hidden on history tiles, even among hidden elements",
  async (_, location) => {
    setStore(
      fakeStore("S1", {
        courseMembers: members,
        meetings: [meeting({ id: "H", location })],
      }),
    );
    await render(<CourseDetailScreen />);
    const tile = within(screen.getByTestId("meeting-H"));
    expect(tile.queryByText(/meet\.example\.com/i, hidden)).toBeNull();
    expect(
      tile.queryAllByRole("link", { ...hidden, name: /meet\.example\.com/i }),
    ).toHaveLength(0);
  },
);

it.each([
  ["an address without a scheme", "meet.example.com/abc"],
  ["a link with text after a space", "https://meet.example.com/abc (room 3)"],
  ["a Zoom id", "Zoom 123 456 789"],
])(
  "AC 3: %s is plain text, so it stays on the history tile as grey, untappable text",
  async (_, location) => {
    setStore(
      fakeStore("T", {
        courseMembers: members,
        meetings: [meeting({ id: "H", location })],
      }),
    );
    await render(<CourseDetailScreen />);
    const text = within(screen.getByTestId("meeting-H")).getByText(location);
    expect(text.props.accessibilityRole).toBeUndefined();
    expect(text.props.onPress).toBeUndefined();
  },
);

it("a current meeting the owner cancels loses its link at once, without reopening the page", async () => {
  const up = meeting({
    id: "U",
    startsAt: at(24),
    status: "scheduled",
    homeworkCheckedAt: undefined,
    location: LINK,
  });
  setStore(fakeStore("M", { courseMembers: members, meetings: [up] }));
  const view = await render(<CourseDetailScreen />);
  expect(
    within(screen.getByTestId("meeting-U")).getByRole("link", {
      name: /meet\.example\.com/,
    }),
  ).toBeTruthy();
  setStore(
    fakeStore("M", {
      courseMembers: members,
      meetings: [{ ...up, status: "canceled" }],
    }),
  );
  await view.rerender(<CourseDetailScreen />);
  expect(
    within(screen.getByTestId("meeting-U")).queryByText(
      /meet\.example\.com/,
      hidden,
    ),
  ).toBeNull();
});

describe("AC 5: the stored link is untouched", () => {
  it.each(["M", "T"] as const)(
    "%s: Edit meeting for a history meeting still says it can't be edited, and nothing is saved",
    async (who) => {
      const store = fakeStore(who, {
        courseMembers: members,
        meetings: [meeting({ id: "H", location: LINK })],
      });
      setStore(store);
      params.meetingId = "H";
      await render(<EditMeetingScreen />);
      expect(screen.getByText("Can't edit this meeting")).toBeTruthy();
      expect(store.updateMeeting).not.toHaveBeenCalled();
    },
  );

  it("viewing history tiles writes nothing: no meeting update, the link stays in the store", async () => {
    const m = meeting({ id: "H", location: LINK });
    const store = fakeStore("M", { courseMembers: members, meetings: [m] });
    setStore(store);
    await render(<CourseDetailScreen />);
    expect(store.updateMeeting).not.toHaveBeenCalled();
    expect(store.meetings[0].location).toBe(LINK);
  });
});
