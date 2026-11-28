// QA ARU-190: gaps in aru190-auto-history.test.tsx: denied roles on an auto-history tile, Mark checked still offered
// inside the day, meetings with homework on the page, canceled / checked meetings unchanged, empty groups, the
// device-clock edge cases, and notes / attendance on auto-history tiles. Course A owned by mentor M; S1 a student
// listener and M2 a mentor listener of A; N a mentor not in A; teacher T.
import { act, render, screen, within } from "@testing-library/react-native";

import CourseDetailScreen from "@/app/courses/[id]";
import { AUTO_HISTORY_MS, groupMeetings, isAutoHistory } from "@/lib/meetings";
import type {
  HomeworkAssignment,
  Meeting,
  MeetingAttendance,
  MeetingListenerNote,
} from "@/lib/types";

import { fakeStore, member } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const NOW = Date.parse("2026-11-28T12:00:00.000Z");
const ago = (ms: number, now = NOW) => new Date(now - ms).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: "A",
  startsAt: ago(30 * HOUR),
  topic: `Topic ${over.id}`,
  status: "completed",
  createdById: "M",
  createdAt: ago(100 * HOUR),
  ...over,
});
const asg = (meetingId: string): HomeworkAssignment => ({
  id: `a-${meetingId}`,
  meetingId,
  courseId: "A",
  title: `Homework for ${meetingId}`,
  description: "",
  createdById: "M",
  createdAt: ago(HOUR),
});
const ids = (ms: Meeting[]) => ms.map((m) => m.id);
const members = [member("A", "S1"), member("A", "M2")];
const headings = () =>
  screen.getAllByRole("header").map((h) => [h.props.children].flat().join(""));
const inMeeting = (id: string) => within(screen.getByTestId(`meeting-${id}`));
const live = (ms: number) => ago(ms, Date.now());

beforeEach(() => {
  jest.clearAllMocks();
  params.id = "A";
});

describe("isAutoHistory / groupMeetings edge cases (ARU-190)", () => {
  const none = new Set<string>();

  it("device clock behind: statusChangedAt in the future → stays in Awaiting homework check", () => {
    const m = meeting({ id: "F", statusChangedAt: ago(-2 * HOUR) });
    expect(ids(groupMeetings([m], NOW, none).awaitingCheck)).toEqual(["F"]);
  });

  it("an unreadable statusChangedAt → stays in Awaiting homework check", () => {
    const m = meeting({ id: "B", statusChangedAt: "not a date" });
    expect(isAutoHistory(m, NOW, none)).toBe(false);
    expect(ids(groupMeetings([m], NOW, none).awaitingCheck)).toEqual(["B"]);
  });

  it("homework on another meeting does not keep this one in Awaiting homework check", () => {
    const m = meeting({ id: "X", statusChangedAt: ago(25 * HOUR) });
    expect(ids(groupMeetings([m], NOW, new Set(["OTHER"])).history)).toEqual([
      "X",
    ]);
  });

  it("AC 9: canceled and scheduled meetings are never auto-moved; canceled stays in history", () => {
    const c = meeting({
      id: "C",
      status: "canceled",
      statusChangedAt: ago(48 * HOUR),
    });
    const s = meeting({
      id: "S",
      status: "scheduled",
      startsAt: ago(-HOUR),
      statusChangedAt: ago(48 * HOUR),
    });
    expect(isAutoHistory(c, NOW, none)).toBe(false);
    expect(isAutoHistory(s, NOW, none)).toBe(false);
    const g = groupMeetings([c, s], NOW, none);
    expect(ids(g.history)).toEqual(["C"]);
    expect(ids(g.upcoming)).toEqual(["S"]);
    expect(g.awaitingCheck).toHaveLength(0);
  });

  it("every meeting is in exactly one group", () => {
    const list = [
      meeting({ id: "AU", statusChangedAt: ago(25 * HOUR) }),
      meeting({ id: "WA", statusChangedAt: ago(HOUR) }),
      meeting({ id: "HW", statusChangedAt: ago(72 * HOUR) }),
      meeting({
        id: "K",
        statusChangedAt: ago(72 * HOUR),
        homeworkCheckedAt: ago(HOUR),
        homeworkCheckedById: "T",
      }),
      meeting({ id: "C", status: "canceled" }),
    ];
    const g = groupMeetings(list, NOW, new Set(["HW"]));
    const all = [
      ...g.inProgress,
      ...g.upcoming,
      ...g.awaitingCheck,
      ...g.history,
    ]
      .map((m) => m.id)
      .sort();
    expect(all).toEqual(["AU", "C", "HW", "K", "WA"]);
    expect(ids(g.awaitingCheck).sort()).toEqual(["HW", "WA"]);
  });

  it("the auto-move saves nothing: the meeting object keeps homeworkCheckedAt empty", () => {
    const m = meeting({ id: "AU", statusChangedAt: ago(25 * HOUR) });
    groupMeetings([m], NOW, none);
    expect(m.homeworkCheckedAt).toBeUndefined();
    expect(m.homeworkCheckedById).toBeUndefined();
  });
});

describe("course page (ARU-190 QA)", () => {
  it.each(["S1", "M2", "N"] as const)(
    "%s: an auto-history tile has neither Assign homework nor Mark checked (access unchanged)",
    async (who) => {
      const auto = meeting({ id: "AU", statusChangedAt: live(25 * HOUR) });
      setStore(
        fakeStore(who, {
          courseMembers: members,
          meetings: [auto],
          assignments: [],
        }),
      );
      await render(<CourseDetailScreen />);
      expect(
        within(screen.getByTestId("meeting-history")).getByTestId("meeting-AU"),
      ).toBeTruthy();
      expect(
        inMeeting("AU").queryByRole("button", { name: "Assign homework" }),
      ).toBeNull();
      expect(
        inMeeting("AU").queryByRole("button", {
          name: "Mark homework checked",
        }),
      ).toBeNull();
    },
  );

  it("AC 2: inside the day, the teacher still sees Mark checked and the owner Assign homework", async () => {
    const fresh = meeting({ id: "WA", statusChangedAt: live(23 * HOUR) });
    setStore(
      fakeStore("T", {
        courseMembers: members,
        meetings: [fresh],
        assignments: [],
      }),
    );
    const view = await render(<CourseDetailScreen />);
    expect(headings()).toEqual(["AWAITING HOMEWORK CHECK (1)"]);
    expect(screen.queryByTestId("meeting-history")).toBeNull();
    expect(
      inMeeting("WA").getByRole("button", { name: "Mark homework checked" }),
    ).toBeTruthy();
    await view.unmount();

    setStore(
      fakeStore("M", {
        courseMembers: members,
        meetings: [fresh],
        assignments: [],
      }),
    );
    await render(<CourseDetailScreen />);
    expect(
      inMeeting("WA").getByRole("button", { name: "Assign homework" }),
    ).toBeTruthy();
  });

  it.each(["S1", "M", "T"] as const)(
    "%s: AC 4 — with homework 7 days after Completed it is still under Awaiting homework check",
    async (who) => {
      const hw = meeting({
        id: "HW",
        startsAt: live(8 * 24 * HOUR),
        statusChangedAt: live(7 * 24 * HOUR),
      });
      setStore(
        fakeStore(who, {
          courseMembers: members,
          meetings: [hw],
          assignments: [asg("HW")],
        }),
      );
      await render(<CourseDetailScreen />);
      expect(headings()).toEqual(["AWAITING HOMEWORK CHECK (1)"]);
      expect(screen.queryByTestId("meeting-history")).toBeNull();
      const check = inMeeting("HW").queryByRole("button", {
        name: "Mark homework checked",
      });
      if (who === "T") expect(check).toBeTruthy();
      else if (who === "S1") expect(check).toBeNull();
    },
  );

  it("AC 8 / AC 9: history count mixes canceled, checked and auto-history meetings", async () => {
    const auto = meeting({
      id: "AU",
      startsAt: live(40 * HOUR),
      statusChangedAt: live(30 * HOUR),
    });
    const x = meeting({
      id: "X",
      startsAt: live(20 * HOUR),
      status: "canceled",
    });
    const k = meeting({
      id: "K",
      startsAt: live(60 * HOUR),
      statusChangedAt: live(59 * HOUR),
      homeworkCheckedAt: live(HOUR),
      homeworkCheckedById: "T",
    });
    setStore(
      fakeStore("T", {
        courseMembers: members,
        meetings: [k, auto, x],
        assignments: [asg("K")],
      }),
    );
    await render(<CourseDetailScreen />);
    expect(headings()).toEqual(["MEETING HISTORY (3)"]);
    const order = within(screen.getByTestId("meeting-history"))
      .getAllByTestId(/^meeting-(AU|X|K)$/)
      .map((n) => n.props.testID);
    expect(order).toEqual(["meeting-X", "meeting-AU", "meeting-K"]);
    expect(inMeeting("X").getByText("Canceled")).toBeTruthy();
    expect(inMeeting("K").getByText("Completed")).toBeTruthy();
    expect(inMeeting("AU").getByText("Completed")).toBeTruthy();
  });

  it('edge: the move empties the current groups → "No current meetings" shows', async () => {
    const auto = meeting({ id: "AU", statusChangedAt: live(25 * HOUR) });
    setStore(
      fakeStore("S1", {
        courseMembers: members,
        meetings: [auto],
        assignments: [],
      }),
    );
    await render(<CourseDetailScreen />);
    expect(screen.getByText("No current meetings")).toBeTruthy();
    expect(screen.queryByText(/AWAITING HOMEWORK CHECK/)).toBeNull();
  });

  it("AC 3: the teacher loses Mark checked on the tile the moment it moves, without new data", async () => {
    jest.useFakeTimers({ now: Date.now() });
    try {
      const m = meeting({
        id: "TK",
        statusChangedAt: live(AUTO_HISTORY_MS - 20 * 1000),
      });
      setStore(
        fakeStore("T", {
          courseMembers: members,
          meetings: [m],
          assignments: [],
        }),
      );
      await render(<CourseDetailScreen />);
      expect(
        inMeeting("TK").getByRole("button", { name: "Mark homework checked" }),
      ).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(90 * 1000);
      });
      expect(
        within(screen.getByTestId("meeting-history")).getByTestId("meeting-TK"),
      ).toBeTruthy();
      expect(
        inMeeting("TK").queryByRole("button", {
          name: "Mark homework checked",
        }),
      ).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });

  it("regression: a public note on an auto-history meeting still shows its Notes link", async () => {
    const auto = meeting({ id: "AU", statusChangedAt: live(25 * HOUR) });
    const note: MeetingListenerNote = {
      id: "n1",
      meetingId: "AU",
      courseId: "A",
      authorId: "S1",
      body: "Sam wrote",
      createdAt: live(HOUR),
      updatedAt: live(HOUR),
      isPublic: true,
    };
    setStore(
      fakeStore("M2", {
        courseMembers: members,
        meetings: [auto],
        assignments: [],
        meetingListenerNotes: [note],
      }),
    );
    await render(<CourseDetailScreen />);
    expect(
      within(screen.getByTestId("meeting-history")).getByTestId("meeting-AU"),
    ).toBeTruthy();
    expect(inMeeting("AU").getByRole("link", { name: "Notes" })).toBeTruthy();
  });

  it('regression: a listener who attended still sees "You attended" on the auto-history tile', async () => {
    const auto = meeting({ id: "AU", statusChangedAt: live(25 * HOUR) });
    const mark: MeetingAttendance = {
      meetingId: "AU",
      userId: "S1",
      markedAt: live(26 * HOUR),
    };
    setStore(
      fakeStore("S1", {
        courseMembers: members,
        meetings: [auto],
        assignments: [],
        attendance: [mark],
      }),
    );
    await render(<CourseDetailScreen />);
    expect(
      within(screen.getByTestId("meeting-history")).getByTestId("meeting-AU"),
    ).toBeTruthy();
    expect(inMeeting("AU").getByText("✓ You attended")).toBeTruthy();
  });
});
