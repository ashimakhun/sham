// QA ARU-109: gaps in aru109-i18n-part2.test.tsx. The dev test only looks for the catalog's own English, so text that
// was never put in the catalog would pass. Here every in-scope screen not covered there is rendered in Russian and
// scanned for any Latin word that isn't user text (AC 1, AC 8): homework details (student, mentor check form),
// New / Edit course, Add listeners, Listeners (members), Change owner, Feedback, Schedule / Edit meeting, attendance,
// notes, assign homework, New discipline, discipline details and the Courses tab's Disciplines view. Also: Add
// listeners plurals on the real screen (AC 4), the delete-discipline and remove-listener confirmations with their
// counts and Cancel (AC 2, AC 4), the iOS picker locale (AC 6), the Courses tab keeping its view after a switch (AC 7),
// a database error kept as it came (AC 3) and English screens with no Cyrillic.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Alert, Platform } from "react-native";

import CoursesScreen from "@/app/(tabs)/courses";
import EditCourseScreen from "@/app/courses/[id]/edit";
import FeedbackScreen from "@/app/courses/[id]/feedback";
import AddListenersScreen from "@/app/courses/[id]/listeners";
import EditMeetingScreen from "@/app/courses/[id]/meetings/[meetingId]";
import AssignHomeworkScreen from "@/app/courses/[id]/meetings/[meetingId]/assign-homework";
import AttendanceScreen from "@/app/courses/[id]/meetings/[meetingId]/attendance";
import NotesScreen from "@/app/courses/[id]/meetings/[meetingId]/notes";
import MembersScreen from "@/app/courses/[id]/members";
import OwnerScreen from "@/app/courses/[id]/owner";
import NewCourseScreen from "@/app/courses/new";
import DisciplineScreen from "@/app/disciplines/[id]";
import NewDisciplineScreen from "@/app/disciplines/new";
import HomeworkDetailScreen from "@/app/homework/[id]";
import { ErrorText } from "@/components/ui";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import type { Course, Discipline, Meeting, User } from "@/lib/types";

import {
  courseA,
  courseB,
  fakeStore,
  hw,
  member,
  users,
} from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@/lib/store", () => require("./helpers/mocks").store);
jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ languageTag: "ru-RU", languageCode: "ru" }]),
}));
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);
jest.mock("expo-image-picker", () => ({ launchImageLibraryAsync: jest.fn() }));
jest.mock("@react-native-community/datetimepicker", () => {
  const { View } = require("react-native");
  const Picker = (props: object) => <View testID="native-picker" {...props} />;
  return {
    __esModule: true,
    default: Picker,
    DateTimePickerAndroid: { open: jest.fn() },
  };
});

const flush = () => act(async () => {});
const inApp = (ui: React.ReactElement) => (
  <LanguageProvider>{ui}</LanguageProvider>
);
const as = (who: keyof typeof users, language: "en" | "ru", over = {}) => {
  const me: User = { ...users[who], language };
  setStore(fakeStore(who, { currentUser: me, ...over }));
};

const HOUR = 3600_000;
const past = new Date(Date.now() - 2 * HOUR).toISOString();
const meeting = (over: Partial<Meeting> & { id: string }): Meeting => ({
  courseId: "A",
  startsAt: new Date(Date.now() + 24 * HOUR).toISOString(),
  topic: `Topic ${over.id}`,
  location: "Room 12",
  status: "scheduled",
  createdById: "M",
  createdAt: "2026-10-01T10:00:00.000Z",
  ...over,
});
const done = meeting({
  id: "mc",
  startsAt: past,
  status: "completed",
  notes: "Notes as typed",
});
const math: Discipline = {
  id: "DM",
  name: "Math",
  hidden: false,
  createdById: "T",
  createdAt: "2026-10-01T10:00:00.000Z",
};
const secret: Discipline = { ...math, id: "DH", name: "Secret", hidden: true };

// User text on these screens (AC 8): names, titles, topics, notes, and the Latin-only symbols of the app.
const USER = [
  ...Object.values(users).map((u) => u.name),
  courseA.title,
  courseA.description,
  courseB.title,
  "Topic m1",
  "Topic mc",
  "Room 12",
  "Notes as typed",
  "Assignment as typed",
  "Solve 1-10",
  "Fractions",
  "Great job",
  "Math",
  "Secret",
  "Homework h1",
  "Homework h2",
  "Nice course",
];

function rendered(): string[] {
  const out: string[] = [];
  const walk = (node: unknown) => {
    if (node == null) return;
    if (typeof node === "string") return void out.push(node);
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as { props?: Record<string, unknown>; children?: unknown };
    for (const key of [
      "accessibilityLabel",
      "accessibilityHint",
      "placeholder",
      "title",
    ]) {
      if (typeof n.props?.[key] === "string") out.push(n.props[key] as string);
    }
    walk(n.children);
  };
  walk(screen.toJSON());
  return out;
}
/** AC 1: no Latin word of three letters or more is left once user text (AC 8) is taken out. */
function latinLeft() {
  return rendered()
    .map((text) =>
      USER.reduce((s, u) => s.split(u).join(""), text).replace(
        /https?:\/\/\S*/g,
        "",
      ),
    )
    .filter((text) => /[A-Za-z]{3,}/.test(text));
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params)) delete params[k as keyof typeof params];
});

describe("AC 1 / AC 8: every in-scope screen in Russian has no Latin app text", () => {
  const cases: [
    string,
    keyof typeof users,
    () => React.ReactElement,
    Record<string, string>,
    object,
  ][] = [
    [
      "homework details, student, checked with a comment",
      "S1",
      () => <HomeworkDetailScreen />,
      { id: "h2" },
      {
        courseMembers: [member("A", "S1")],
        visibleHomework: [
          hw({
            id: "h2",
            courseId: "A",
            status: "checked",
            checkedById: "M",
            checkedAt: "2026-10-11T10:00:00.000Z",
            mentorComment: "Great job",
          }),
        ],
      },
    ],
    [
      "homework details, owner mentor with the check form",
      "M",
      () => <HomeworkDetailScreen />,
      { id: "h1" },
      {
        courseMembers: [member("A", "S1")],
        visibleHomework: [hw({ id: "h1", courseId: "A" })],
      },
    ],
    [
      "New course (teacher)",
      "T",
      () => <NewCourseScreen />,
      {},
      { disciplines: [math] },
    ],
    ["Edit course (owner)", "M", () => <EditCourseScreen />, { id: "A" }, {}],
    [
      "Add listeners",
      "M",
      () => <AddListenersScreen />,
      { id: "A" },
      { courseMembers: [member("A", "S1")] },
    ],
    [
      "Listeners (members)",
      "M",
      () => <MembersScreen />,
      { id: "A" },
      { courseMembers: [member("A", "S1"), member("A", "S2")] },
    ],
    ["Change owner (teacher)", "T", () => <OwnerScreen />, { id: "A" }, {}],
    [
      "Feedback (listener)",
      "S1",
      () => <FeedbackScreen />,
      { id: "A" },
      { courseMembers: [member("A", "S1")], meetings: [done] },
    ],
    [
      "Edit meeting",
      "M",
      () => <EditMeetingScreen />,
      { id: "A", meetingId: "m1" },
      { meetings: [meeting({ id: "m1" })] },
    ],
    [
      "attendance",
      "M",
      () => <AttendanceScreen />,
      { id: "A", meetingId: "mc" },
      {
        courseMembers: [member("A", "S1"), member("A", "S2")],
        meetings: [done],
      },
    ],
    [
      "notes",
      "M",
      () => <NotesScreen />,
      { id: "A", meetingId: "mc" },
      { meetings: [done] },
    ],
    [
      "assign homework",
      "M",
      () => <AssignHomeworkScreen />,
      { id: "A", meetingId: "mc" },
      { meetings: [done] },
    ],
    ["New discipline (teacher)", "T", () => <NewDisciplineScreen />, {}, {}],
    [
      "discipline details (teacher)",
      "T",
      () => <DisciplineScreen />,
      { id: "DM" },
      { disciplines: [math], courses: [{ ...courseA, disciplineId: "DM" }] },
    ],
    [
      "a hidden discipline (teacher)",
      "T",
      () => <DisciplineScreen />,
      { id: "DH" },
      { disciplines: [secret], courses: [{ ...courseA, disciplineId: "DH" }] },
    ],
  ];

  it.each(cases)("%s", async (_name, who, ui, p, over) => {
    Object.assign(params, p);
    as(who, "ru", over);
    await render(inApp(ui()));
    await flush();
    expect(rendered().length).toBeGreaterThan(0);
    expect(latinLeft()).toEqual([]);
  });

  it.each(cases)(
    "English: %s has no Cyrillic",
    async (_name, who, ui, p, over) => {
      Object.assign(params, p);
      as(who, "en", over);
      await render(inApp(ui()));
      await flush();
      expect(rendered().filter((text) => /[а-яё]/i.test(text))).toEqual([]);
    },
  );

  it("the Courses tab, Disciplines view (teacher)", async () => {
    as("T", "ru", {
      disciplines: [math, secret],
      courses: [{ ...courseA, disciplineId: "DM" }, courseB],
    });
    await render(inApp(<CoursesScreen />));
    await flush();
    await fireEvent.press(screen.getByRole("tab", { name: /^Дисциплины/ }));
    expect(latinLeft()).toEqual([]);
    expect(screen.getAllByText("Math").length).toBeGreaterThan(0);
  });
});

describe("AC 4: Add listeners counts on the real screen", () => {
  // The list renders its first rows only (FlatList), so 11 and 21 are covered on the catalog in the dev test; here the
  // screen's switch between "Add listener" and the counted form.
  const students = Array.from({ length: 5 }, (_, i): User => ({
    id: `X${i}`,
    name: `Pupil ${i}`,
    role: "student",
  }));
  const store = (language: "en" | "ru") => {
    const me: User = { ...users.M, language };
    const base = fakeStore("M", { currentUser: me });
    const all = [...base.users, ...students];
    setStore({
      ...base,
      users: all,
      getUser: (id) => all.find((u) => u.id === id),
    });
  };
  const pick = async (n: number) => {
    for (let i = 0; i < n; i++)
      await fireEvent.press(screen.getByText(`Pupil ${i}`));
  };

  it.each([
    [1, /^Добавить слушателя$/],
    [2, /^Добавить 2 слушателя$/],
    [5, /^Добавить 5 слушателей$/],
  ])("ru: %i selected", async (n, label) => {
    params.id = "A";
    store("ru");
    await render(inApp(<AddListenersScreen />));
    await flush();
    await pick(n);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it.each([
    [1, "Add listener"],
    [2, "Add 2 listeners"],
  ])("en: %i selected reads as before", async (n, label) => {
    params.id = "A";
    store("en");
    await render(inApp(<AddListenersScreen />));
    await flush();
    await pick(n);
    expect(screen.getByText(label)).toBeTruthy();
  });
});

describe("AC 2 / AC 4: native confirmations in Russian, with counts and Cancel", () => {
  const os = Platform.OS;
  afterEach(() => {
    Platform.OS = os;
  });
  const alerts = () => {
    Platform.OS = "ios";
    return jest.spyOn(Alert, "alert").mockImplementation(() => {});
  };
  const allText = (call: unknown[]) =>
    [
      call[0],
      call[1],
      ...((call[2] as { text?: string }[] | undefined) ?? []).map(
        (b) => b.text,
      ),
    ].join(" | ");

  it.each([
    [1, /1 курс(?![а-яё])/],
    [2, /2 курса/],
    [5, /5 курсов/],
  ])("delete a discipline with %i course(s)", async (n, form) => {
    const alert = alerts();
    const courses: Course[] = Array.from({ length: n }, (_, i) => ({
      ...courseA,
      id: `C${i}`,
      title: `Course ${i}`,
      disciplineId: "DM",
    }));
    params.id = "DM";
    as("T", "ru", { disciplines: [math], courses });
    await render(inApp(<DisciplineScreen />));
    await flush();
    await fireEvent.press(
      screen.getByRole("button", { name: /^Удалить дисциплину/ }),
    );
    await flush();
    expect(alert).toHaveBeenCalled();
    const text = allText(alert.mock.calls[0]);
    expect(text).toMatch(form);
    expect(text).toContain("Отмена");
    expect(text.replace("Math", "")).not.toMatch(/[A-Za-z]{3,}/);
  });

  it.each([
    [1, /1 домашн\S+ задани[ея](?![а-яё])/],
    [2, /2 домашних задания/],
    [5, /5 домашних заданий/],
  ])("remove a listener with %i homework", async (n, form) => {
    const alert = alerts();
    params.id = "A";
    as("M", "ru", {
      courseMembers: [member("A", "S1")],
      countListenerHomework: jest.fn(async () => n),
    });
    await render(inApp(<MembersScreen />));
    await flush();
    await fireEvent.press(
      screen.getByRole("button", { name: new RegExp(`${users.S1.name}`) }),
    );
    await flush();
    expect(alert).toHaveBeenCalled();
    const text = allText(alert.mock.calls[0]);
    expect(text).toMatch(form);
    expect(text).toContain("Отмена");
    expect(
      text.replace(users.S1.name, "").replace(courseA.title, ""),
    ).not.toMatch(/[A-Za-z]{3,}/);
  });
});

describe("AC 6: the iOS picker uses the chosen language", () => {
  const os = Platform.OS;
  afterEach(() => {
    Platform.OS = os;
  });
  it.each([
    ["ru", /^ru/],
    ["en", /^en/],
  ] as const)("%s", async (lang, locale) => {
    Platform.OS = "ios";
    params.id = "A";
    params.meetingId = "m1";
    as("M", lang, { meetings: [meeting({ id: "m1" })] });
    await render(inApp(<EditMeetingScreen />));
    await flush();
    const pickers = screen.queryAllByTestId("native-picker");
    expect(pickers.length).toBeGreaterThan(0);
    for (const p of pickers) expect(p.props.locale).toMatch(locale);
  });
});

describe("AC 7: the Courses tab keeps its view after a language switch", () => {
  it("Disciplines stays selected and the tab reads in Russian", async () => {
    const over = {
      disciplines: [math],
      courses: [{ ...courseA, disciplineId: "DM" }],
    };
    as("T", "en", over);
    const view = await render(inApp(<CoursesScreen />));
    await flush();
    await fireEvent.press(screen.getByRole("tab", { name: /^Disciplines/ }));
    as("T", "ru", over);
    await view.rerender(inApp(<CoursesScreen />));
    await flush();
    expect(
      screen.getByRole("tab", { name: /^Дисциплины/ }).props.accessibilityState,
    ).toMatchObject({ selected: true });
    expect(latinLeft()).toEqual([]);
  });
});

describe("AC 3: a database error is shown as it came", () => {
  it("in Russian, an RLS refusal keeps its English text", async () => {
    as("M", "ru");
    await render(
      inApp(
        <ErrorText error="new row violates row-level security policy for table homework" />,
      ),
    );
    expect(
      screen.getByText(
        "new row violates row-level security policy for table homework",
      ),
    ).toBeTruthy();
  });
});
