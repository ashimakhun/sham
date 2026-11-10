// QA ARU-139: gaps in aru139-kurator.test.ts, which only calls translate(). Here the real screens are rendered in
// Russian and scanned for any form of «владелец» / «владеет» (AC 1, AC 6): the course card, Edit course (label, screen
// reader text, Change owner row), Change owner (intro with the course title; the refusal hint for a student, AC 2),
// a course chat message by the owner (tag) and by a listener (no tag), the mentor's Homework switch, and the Roles
// page's Make student refusal for a mentor owning 1 / 2 / 5 / 21 courses (AC 5). Database errors (AC 4) go through
// dbErrorMessage() with the hint and details the server sends, for every plural form and both trigger texts. The same
// screens in English still say Owner (AC 7).
import { act, fireEvent, render, screen } from "@testing-library/react-native";

import CoursesScreen from "@/app/(tabs)/courses";
import HomeworkScreen from "@/app/(tabs)/homework";
import CourseChatScreen from "@/app/courses/[id]/chat";
import EditCourseScreen from "@/app/courses/[id]/edit";
import ChangeOwnerScreen from "@/app/courses/[id]/owner";
import RolesScreen from "@/app/roles";
import { dbErrorMessage, translate } from "@/i18n";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import ru from "@/i18n/ru.json";
import type { ChatMessage, Course, User } from "@/lib/types";

import { courseA, fakeStore, hw, member, users } from "./helpers/fakeStore";
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

const flush = () => act(async () => {});
const inApp = (ui: React.ReactElement) => (
  <LanguageProvider>{ui}</LanguageProvider>
);
const OLD = /[Вв]ладе|ладел/;

function as(who: keyof typeof users, language: "en" | "ru", over: object = {}) {
  const me: User = { ...users[who], language };
  const all = Object.values({ ...users, [who]: me });
  setStore({
    ...fakeStore(who, over),
    currentUser: me,
    users: all,
    getUser: (id?: string) => all.find((u) => u.id === id),
  });
}

/** Every text, label, hint and title on screen. */
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
const joined = () => rendered().join(" | ");

const messages: ChatMessage[] = [
  {
    id: "c1",
    authorId: "M",
    body: "From the owner",
    createdAt: "2026-11-03T09:05:00.000Z",
  },
  {
    id: "c2",
    authorId: "S1",
    body: "From a listener",
    createdAt: "2026-11-03T09:10:00.000Z",
  },
];
const extra = (n: number): Course[] =>
  Array.from({ length: n - 1 }, (_, i) => ({
    ...courseA,
    id: `X${i}`,
    title: `Course ${i + 2}`,
  }));

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params)) delete params[k as keyof typeof params];
});

describe("ARU-139 QA: rendered screens in Russian", () => {
  it("AC 1: the course card reads «Куратор: Mentor Max», with no old word", async () => {
    as("S1", "ru", { courses: [courseA], courseMembers: [member("A", "S1")] });
    await render(inApp(<CoursesScreen />));
    await flush();
    // The card line is «Куратор:» + space + the name, in separate text pieces.
    expect(
      joined()
        .replace(/ ?\| ?/g, " ")
        .replace(/\s+/g, " "),
    ).toContain("Куратор: Mentor Max");
    expect(joined()).not.toMatch(OLD);
  });

  it("AC 1 / AC 2: Edit course shows «Куратор», reads «Куратор, Mentor Max», and the row says «Сменить куратора»", async () => {
    params.id = "A";
    as("T", "ru", { courses: [courseA] });
    await render(inApp(<EditCourseScreen />));
    await flush();
    expect(screen.getByText("Куратор")).toBeTruthy();
    expect(screen.getByLabelText("Куратор, Mentor Max")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Сменить куратора" }),
    ).toBeTruthy();
    expect(joined()).not.toMatch(OLD);
  });

  it("AC 2: Change owner shows the intro with the course title, filled in", async () => {
    params.id = "A";
    as("T", "ru", { courses: [courseA] });
    await render(inApp(<ChangeOwnerScreen />));
    await flush();
    expect(
      screen.getByText(
        "Выберите нового куратора курса «Algebra». Куратор сменится сразу после нажатия на имя.",
      ),
    ).toBeTruthy();
    expect(joined()).not.toMatch(/[{}]|ладе/);
  });

  it("AC 2 / AC 3: a student on Change owner gets the refusal hint with «куратора»", async () => {
    params.id = "A";
    as("S1", "ru", { courses: [courseA], courseMembers: [member("A", "S1")] });
    await render(inApp(<ChangeOwnerScreen />));
    await flush();
    expect(
      screen.getByText(
        "Сменить куратора курса могут только преподаватель или ментор.",
      ),
    ).toBeTruthy();
    expect(joined()).not.toMatch(OLD);
  });

  it("AC 1: in the course chat the owner's message carries «Куратор», a listener's does not", async () => {
    params.id = "A";
    as("S1", "ru", {
      courses: [courseA],
      courseMembers: [member("A", "S1")],
      loadMessages: jest.fn(async () => ({ messages, hasMore: false })),
    });
    await render(inApp(<CourseChatScreen />));
    await flush();
    expect(screen.getByText("From the owner")).toBeTruthy();
    expect(screen.getByText("From a listener")).toBeTruthy();
    // Exactly one tag: on the owner's message.
    expect(screen.getAllByText("Куратор")).toHaveLength(1);
    expect(joined()).not.toMatch(OLD);
  });

  it("AC 1: the mentor's Homework switch reads «Куратор»", async () => {
    as("M", "ru", {
      courses: [
        courseA,
        { ...courseA, id: "B", title: "Biology", createdById: "N" },
      ],
      courseMembers: [member("A", "S1"), member("B", "M")],
      visibleHomework: [hw({ id: "h1", courseId: "A", studentId: "S1" })],
    });
    await render(inApp(<HomeworkScreen />));
    await flush();
    expect(screen.getAllByText(/^Куратор/).length).toBeGreaterThan(0);
    expect(joined()).not.toMatch(OLD);
  });

  it.each([
    [1, "курса"],
    [2, "курсов"],
    [5, "курсов"],
    [21, "курса"],
  ])(
    "AC 5: Roles → Make student for a mentor owning %i course(s) says «куратор %i %s» and «Сначала смените куратора»",
    async (n, word) => {
      as("T", "ru", { courses: [courseA, ...extra(n)] });
      await render(inApp(<RolesScreen />));
      await flush();
      // Mentors sorted by name: Mentor Max (owns the courses) first.
      await fireEvent.press(
        screen.getAllByRole("button", { name: "Сделать студентом" })[0],
      );
      await flush();
      const text = joined();
      expect(text).toContain(`Mentor Max — куратор ${n} ${word}: Algebra`);
      expect(text).toContain("Сначала смените куратора");
      expect(text).not.toMatch(OLD);
    },
  );
});

describe("ARU-139 QA: database errors in Russian (AC 4, AC 5)", () => {
  it.each([
    [1, "курса"],
    [2, "курсов"],
    [3, "курсов"],
    [5, "курсов"],
    [11, "курсов"],
    [21, "курса"],
    [22, "курсов"],
  ])(
    "owner_owns_courses for %i: «— куратор %i %s. Сначала смените куратора», with and without titles",
    (count, word) => {
      const base = { message: "Mentor Max owns courses", code: "P0001" };
      expect(
        dbErrorMessage(
          {
            ...base,
            hint: "sham:owner_owns_courses",
            details: JSON.stringify({ name: "Mentor Max", count }),
          },
          "ru",
        ),
      ).toBe(`Mentor Max — куратор ${count} ${word}. Сначала смените куратора`);
      expect(
        dbErrorMessage(
          {
            ...base,
            hint: "sham:owner_owns_courses_titles",
            details: JSON.stringify({
              name: "Mentor Max",
              count,
              titles: "Algebra",
            }),
          },
          "ru",
        ),
      ).toBe(
        `Mentor Max — куратор ${count} ${word}: Algebra. Сначала смените куратора`,
      );
    },
  );

  it.each([
    [
      "discipline_owner_only",
      "Изменить дисциплину курса может только его куратор.",
    ],
    [
      "owner_change_role",
      "Сменить куратора может только преподаватель или ментор.",
    ],
    [
      "owner_role",
      "Куратором курса может быть только преподаватель или ментор.",
    ],
    [
      "course_owner_staff",
      "Куратором курса может быть только преподаватель или ментор.",
    ],
    [
      "owner_not_accepted",
      "Куратором курса может быть только подтверждённый аккаунт.",
    ],
    [
      "notes_role",
      "Изменять заметки может только куратор курса или преподаватель.",
    ],
  ])("%s reads «%s»", (code, text) => {
    expect(
      dbErrorMessage(
        { message: "x", code: "P0001", hint: `sham:${code}` },
        "ru",
      ),
    ).toBe(text);
  });

  it("delete own account as an owner: «Вы куратор курсов: …»", () => {
    expect(
      dbErrorMessage(
        {
          message: "x",
          code: "P0001",
          hint: "sham:delete_owns_courses",
          details: JSON.stringify({ titles: "Algebra, Biology" }),
        },
        "ru",
      ),
    ).toBe(
      "Вы куратор курсов: Algebra, Biology. Попросите преподавателя или ментора сначала сменить куратора.",
    );
  });

  it("AC 6: no key in ru.json, whatever its case, keeps «ладе»", () => {
    for (const [key, text] of Object.entries(ru as Record<string, string>))
      expect(`${key}: ${text}`).not.toMatch(/ладе/i);
  });
});

describe("ARU-139 QA: English unchanged (AC 7)", () => {
  it("Edit course and Change owner still say Owner", async () => {
    params.id = "A";
    as("T", "en", { courses: [courseA] });
    const view = await render(inApp(<EditCourseScreen />));
    await flush();
    expect(screen.getByText("Owner")).toBeTruthy();
    expect(
      screen.getByLabelText(
        translate("en", "courses.ownerA11y", { name: "Mentor Max" }),
      ),
    ).toBeTruthy();
    expect(joined()).not.toMatch(/[а-яё]/i);
    await view.unmount();
    await render(inApp(<ChangeOwnerScreen />));
    await flush();
    expect(joined()).toContain(
      translate("en", "courses.ownerIntro", { title: "Algebra" }),
    );
    expect(joined()).not.toMatch(/[а-яё]/i);
  });
});
