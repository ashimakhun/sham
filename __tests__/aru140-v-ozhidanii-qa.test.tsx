// QA ARU-140: gaps in the dev's one-line change to aru109-i18n-part2.test.tsx. In Russian, the sender view's middle
// filter is a tab named «В ожидании (N)» for 0, 1 and 3 sent-but-unchecked homework (AC 1, AC 2, AC 4); tapping it
// lists only submitted homework (AC 3); a mentor on the Listener side gets the same tab, while the teacher and a
// mentor on the checking side keep «Проверить (N)» (AC 5); English keeps «Waiting (N)» (AC 6); switching the
// language while the tab is open updates the label.
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import HomeworkScreen from "@/app/(tabs)/homework";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import type { Homework, User } from "@/lib/types";

import { courseA, fakeStore, hw, member, users } from "./helpers/fakeStore";
import { setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);
jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ languageTag: "ru-RU", languageCode: "ru" }]),
}));

const flush = () => act(async () => {});
const inApp = (ui: React.ReactElement) => (
  <LanguageProvider>{ui}</LanguageProvider>
);

const sent = (n: number, studentId = "S1"): Homework[] =>
  Array.from({ length: n }, (_, i) =>
    hw({
      id: `w${studentId}${i}`,
      courseId: "A",
      studentId,
      title: `Sent ${studentId} ${i}`,
      status: "submitted",
    }),
  );
const checked = (studentId = "S1") =>
  hw({
    id: `c${studentId}`,
    courseId: "A",
    studentId,
    title: `Checked ${studentId}`,
    status: "checked",
  });

function as(
  who: keyof typeof users,
  language: "en" | "ru",
  homework: Homework[],
  members = [member("A", "S1")],
) {
  const me: User = { ...users[who], language };
  setStore({
    ...fakeStore(who, {
      courses: [courseA],
      courseMembers: members,
      visibleHomework: homework,
    }),
    currentUser: me,
  });
}

beforeEach(() => jest.clearAllMocks());

it.each([0, 1, 3])(
  "AC 1 / AC 2 / AC 4: a student with %i sent homework sees the tab «В ожидании (%i)»",
  async (n) => {
    as("S1", "ru", [...sent(n), checked()]);
    await render(inApp(<HomeworkScreen />));
    await flush();
    expect(screen.getByRole("tab", { name: `В ожидании (${n})` })).toBeTruthy();
    expect(screen.queryByText(/Ждут проверки/)).toBeNull();
    // AC 5: the other two tabs keep their texts.
    expect(screen.getByRole("tab", { name: /^Новые \(\d+\)$/ })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Проверено" })).toBeTruthy();
  },
);

it("AC 3: tapping «В ожидании» lists only the submitted homework", async () => {
  as("S1", "ru", [...sent(2), checked()]);
  await render(inApp(<HomeworkScreen />));
  await flush();
  await fireEvent.press(screen.getByRole("tab", { name: "В ожидании (2)" }));
  expect(screen.getByText("Sent S1 0")).toBeTruthy();
  expect(screen.getByText("Sent S1 1")).toBeTruthy();
  expect(screen.queryByText("Checked S1")).toBeNull();
  expect(screen.queryByText(/Ждут проверки/)).toBeNull();
});

it("AC 1: a mentor switched to Listener gets the same «В ожидании (N)» tab", async () => {
  as(
    "M",
    "ru",
    [...sent(1, "M"), ...sent(2, "S1")],
    [member("A", "S1"), member("B", "M")],
  );
  await render(inApp(<HomeworkScreen />));
  await flush();
  await fireEvent.press(screen.getByRole("tab", { name: /^Слушатель/ }));
  expect(screen.getByRole("tab", { name: "В ожидании (1)" })).toBeTruthy();
  expect(screen.queryByText(/Ждут проверки/)).toBeNull();
});

it.each(["T", "M"] as const)(
  "AC 5: %s on the checking side keeps «Проверить (N)» and never sees «В ожидании»",
  async (who) => {
    as(who, "ru", sent(2, "S1"));
    await render(inApp(<HomeworkScreen />));
    await flush();
    expect(screen.getByRole("tab", { name: "Проверить (2)" })).toBeTruthy();
    expect(screen.queryByText(/В ожидании/)).toBeNull();
  },
);

it("AC 6 and the language switch: English reads «Waiting (N)»; switching to Russian updates the tab without a remount", async () => {
  as("S1", "en", sent(3));
  const view = await render(inApp(<HomeworkScreen />));
  await flush();
  expect(screen.getByRole("tab", { name: "Waiting (3)" })).toBeTruthy();
  as("S1", "ru", sent(3));
  await view.rerender(inApp(<HomeworkScreen />));
  await flush();
  expect(screen.getByRole("tab", { name: "В ожидании (3)" })).toBeTruthy();
  expect(screen.queryByText(/Waiting/)).toBeNull();
});
