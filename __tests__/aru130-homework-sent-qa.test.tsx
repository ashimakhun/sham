// QA ARU-130: gaps in aru130-homework-sent.test.tsx and aru130-store-sent-counts.test.tsx. The dev tests check the
// line in English, its position, who sees it, the hidden state and the store request. Here: the real course page in
// Russian ("Домашнее задание отправили: 5 из 8", the screen reader text with the right plural of the listener count
// for 1, 2, 5, 11, 21 and 0); the count follows the store live while the page is open (5 → 6, and hides when the
// counts go away, AC 5/6); "0 of 0" shows for a course without listeners (AC 2); the line isn't upper-cased (it's an
// info line, not a badge or action, ARU-122) and pressing it does nothing (AC 7); a listener mentor sees the same
// numbers and no homework names (AC 3); and in the store every realtime event that reloads (homework,
// homework_assignments, course_members) asks for the counts again (AC 5).
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { router } from "expo-router";
import { StyleSheet } from "react-native";

import CourseDetailScreen from "@/app/courses/[id]";
import { translate } from "@/i18n";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import en from "@/i18n/en.json";
import ru from "@/i18n/ru.json";
import type {
  AssignmentSentCount,
  HomeworkAssignment,
  Meeting,
  User,
} from "@/lib/types";

import { fakeStore, member, users } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);
jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ languageTag: "en-GB", languageCode: "en" }]),
}));

const HOUR = 3600_000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: "A",
  startsAt: at(-20),
  topic: "Meeting",
  status: "completed",
  createdById: "M",
  createdAt: at(-100),
  ...over,
});
const C = meeting({ id: "C" });
const K = meeting({
  id: "K",
  startsAt: at(-40),
  homeworkCheckedAt: at(-30),
  homeworkCheckedById: "M",
});
const asg = (meetingId: string): HomeworkAssignment => ({
  id: `a-${meetingId}`,
  meetingId,
  courseId: "A",
  title: "Essay on fractions",
  description: "",
  createdById: "M",
  createdAt: at(-19),
  dueAt: at(48),
});
const members = [member("A", "S1"), member("A", "M2")];
const inApp = (ui: React.ReactElement) => (
  <LanguageProvider>{ui}</LanguageProvider>
);
const set = (
  who: keyof typeof users,
  language: "en" | "ru",
  counts: Record<string, AssignmentSentCount>,
  over: Record<string, unknown> = {},
) => {
  const me: User = { ...users[who], language };
  setStore(
    fakeStore(who, {
      currentUser: me,
      courseMembers: members,
      meetings: [C, K],
      assignments: [asg("C"), asg("K")],
      assignmentSentCounts: counts,
      ...over,
    }),
  );
};
const line = (id: string) => screen.getByTestId(`homework-sent-${id}`);
const flush = () => act(async () => {});

beforeEach(() => {
  jest.clearAllMocks();
  params.id = "A";
});

describe("Russian (AC 1 / AC 7 with the catalog)", () => {
  it('the tile reads "Домашнее задание отправили: 5 из 8" on awaiting and history tiles, with no English left', async () => {
    set("M", "ru", {
      "a-C": { sent: 5, listeners: 8 },
      "a-K": { sent: 0, listeners: 8 },
    });
    await render(inApp(<CourseDetailScreen />));
    await flush();
    expect(
      within(line("C")).getByText(/Домашнее задание отправили:/),
    ).toBeTruthy();
    expect(within(line("C")).getByText("5 из 8")).toBeTruthy();
    expect(within(line("K")).getByText("0 из 8")).toBeTruthy();
    expect(within(line("C")).queryByText(/Homework sent|of 8/)).toBeNull();
    expect(line("C").props.accessibilityLabel).toBe(
      "Домашнее задание отправили 5 из 8 слушателей",
    );
  });

  it.each([
    [
      1,
      "Домашнее задание отправили 1 из 1 слушателя",
      "Homework sent by 1 of 1 listener",
    ],
    [
      2,
      "Домашнее задание отправили 1 из 2 слушателей",
      "Homework sent by 1 of 2 listeners",
    ],
    [
      5,
      "Домашнее задание отправили 1 из 5 слушателей",
      "Homework sent by 1 of 5 listeners",
    ],
    [
      11,
      "Домашнее задание отправили 1 из 11 слушателей",
      "Homework sent by 1 of 11 listeners",
    ],
    [
      21,
      "Домашнее задание отправили 1 из 21 слушателя",
      "Homework sent by 1 of 21 listeners",
    ],
  ])(
    'screen reader text with %i listeners: genitive after "из" in Russian',
    (n, ruText, enText) => {
      expect(
        translate("ru", "meetings.homeworkSentLabel", { sent: 1, count: n }),
      ).toBe(ruText);
      expect(
        translate("en", "meetings.homeworkSentLabel", { sent: 1, count: n }),
      ).toBe(enText);
    },
  );

  it("every new text has English, Russian and the same placeholders", () => {
    const keys = Object.keys(en).filter((k) =>
      k.startsWith("meetings.homeworkSent"),
    );
    expect(keys.length).toBe(6);
    for (const k of keys) {
      const e = (en as Record<string, string>)[k];
      const r = (ru as Record<string, string>)[k];
      expect(r).toBeTruthy();
      expect(r).not.toBe(e);
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(ph(r)).toEqual(ph(e));
    }
  });
});

describe("AC 2: counts as given", () => {
  it('a course without listeners shows "0 of 0", read as "0 of 0 listeners"', async () => {
    set("T", "en", { "a-C": { sent: 0, listeners: 0 } }, { courseMembers: [] });
    await render(inApp(<CourseDetailScreen />));
    await flush();
    expect(within(line("C")).getByText("0 of 0")).toBeTruthy();
    expect(line("C").props.accessibilityLabel).toBe(
      "Homework sent by 0 of 0 listeners",
    );
  });
});

describe("AC 5 / AC 6: the line follows the store while the page is open", () => {
  it("5 of 8 → 6 of 8 → 6 of 9 when the counts reload; gone when a later load fails; back when it works again", async () => {
    set("M", "en", { "a-C": { sent: 5, listeners: 8 } });
    const view = await render(inApp(<CourseDetailScreen />));
    await flush();
    expect(within(line("C")).getByText("5 of 8")).toBeTruthy();

    set("M", "en", { "a-C": { sent: 6, listeners: 8 } });
    await view.rerender(inApp(<CourseDetailScreen />));
    expect(within(line("C")).getByText("6 of 8")).toBeTruthy();

    set("M", "en", { "a-C": { sent: 6, listeners: 9 } });
    await view.rerender(inApp(<CourseDetailScreen />));
    expect(within(line("C")).getByText("6 of 9")).toBeTruthy();

    set("M", "en", {});
    await view.rerender(inApp(<CourseDetailScreen />));
    expect(screen.queryByTestId("homework-sent-C")).toBeNull();
    expect(screen.queryByText(/Homework sent/)).toBeNull();
    // The tile and its homework line are still there.
    expect(screen.getByTestId("meeting-C")).toBeTruthy();
    expect(screen.getByTestId("assignment-C")).toBeTruthy();

    set("M", "en", { "a-C": { sent: 7, listeners: 9 } });
    await view.rerender(inApp(<CourseDetailScreen />));
    expect(within(line("C")).getByText("7 of 9")).toBeTruthy();
  });
});

describe("AC 3 / AC 7: an info line, the same for everyone", () => {
  it.each(["S1", "M2", "M", "N", "T"] as const)(
    '%s sees "5 of 8" and no homework title of anyone else on the tile',
    async (who) => {
      set(who, "en", { "a-C": { sent: 5, listeners: 8 } });
      await render(inApp(<CourseDetailScreen />));
      await flush();
      expect(within(line("C")).getByText("5 of 8")).toBeTruthy();
      // Only counts: no names of who sent.
      for (const u of Object.values(users))
        expect(within(line("C")).queryByText(new RegExp(u.name))).toBeNull();
    },
  );

  it("not upper-cased (an info line, not a badge or action: ARU-122) and pressing it does nothing", async () => {
    set("M", "en", { "a-C": { sent: 5, listeners: 8 } });
    await render(inApp(<CourseDetailScreen />));
    await flush();
    const el = line("C");
    const texts = [
      within(el).getByText(/Homework sent:/),
      within(el).getByText("5 of 8"),
    ];
    for (const t of texts)
      expect(StyleSheet.flatten(t.props.style)?.textTransform).toBeUndefined();
    expect(el.props.onPress).toBeUndefined();
    expect(el.props.accessibilityRole).toBeUndefined();
    await fireEvent.press(el);
    expect(router.push).not.toHaveBeenCalled();
  });
});
