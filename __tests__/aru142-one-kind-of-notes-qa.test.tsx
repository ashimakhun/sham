// QA ARU-142: gaps in aru142-one-kind-of-notes.test.tsx: the text table (AC 12, with the approved new codes
// db.notes_add_role / db.notes_edit_role), Russian on the tile, the Notes page and the editor, scheduled and canceled
// meetings, the teacher who owns the course (one pencil, not two), a former owner and a removed listener (no pencil),
// the header pencil's touch target (AC 11), and the database refusals shown in Russian.
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";

import CourseDetailScreen from "@/app/courses/[id]";
import MeetingNotesScreen from "@/app/courses/[id]/meetings/[meetingId]/notes";
import { I18nContext, make } from "@/i18n/context";
import en from "@/i18n/en.json";
import { dbErrorMessage } from "@/i18n/index";
import notes from "@/i18n/notes.json";
import ru from "@/i18n/ru.json";
import type { Course, Meeting, MeetingListenerNote } from "@/lib/types";

import { courseA, fakeStore, member } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

const HOUR = 60 * 60 * 1000;
const at = (h: number) => new Date(Date.now() + h * HOUR).toISOString();
const meeting = (
  id: string,
  status: Meeting["status"],
  startsIn: number,
): Meeting => ({
  id,
  courseId: "A",
  startsAt: at(startsIn),
  topic: "",
  status,
  createdById: "M",
  createdAt: at(-100),
});
const C = meeting("C", "completed", -20);
const members = [member("A", "S1"), member("A", "M2")];
const note = (
  id: string,
  authorId: string | null,
  body: string,
): MeetingListenerNote => ({
  id,
  meetingId: "C",
  courseId: "A",
  authorId,
  body,
  createdAt: at(-10),
  updatedAt: at(-10),
});
const ruUi = (ui: React.ReactElement) => (
  <I18nContext.Provider value={make("ru")}>{ui}</I18nContext.Provider>
);
const pencilsIn = (id: string) =>
  within(screen.getByTestId(`meeting-${id}`)).queryAllByRole("button", {
    name: /notes|заметки/i,
  });

beforeEach(() => {
  jest.clearAllMocks();
  for (const k of Object.keys(params) as (keyof typeof params)[])
    delete params[k];
  Object.assign(params, { id: "A" });
});

describe("AC 12: the text table", () => {
  const table: Record<string, [string, string]> = {
    "notes.title": ["Notes", "Заметки"],
    "notes.add": ["Add notes", "Добавить заметки"],
    "notes.edit": ["Edit notes", "Изменить заметки"],
    "notes.placeholder": [
      "What was covered in this meeting?",
      "Что разбирали на встрече?",
    ],
    "notes.onlyEditHint": [
      "Only the course's listeners, its owner and the teacher can write notes.",
      "Писать заметки могут только слушатели курса, его куратор и преподаватель.",
    ],
    // ANALYSIS: CRITERION CHANGE (2026-11-10): the table's wording under new codes.
    "db.notes_add_role": [
      "Only the course's listeners, its owner and the teacher can add notes.",
      "Добавлять заметки могут только слушатели курса, его куратор и преподаватель.",
    ],
    "db.notes_edit_role": [
      "Only the course's listeners, its owner and the teacher can edit notes.",
      "Изменять заметки могут только слушатели курса, его куратор и преподаватель.",
    ],
  };
  it.each(Object.entries(table))(
    "%s matches in English and Russian, with a note",
    (key, [e, r]) => {
      expect((en as Record<string, string>)[key]).toBe(e);
      expect((ru as Record<string, string>)[key]).toBe(r);
      expect((notes as Record<string, string>)[key]).toBeTruthy();
    },
  );

  it("the removed keys are gone from all three files; db.notes_role and the old listener codes stay", () => {
    for (const key of [
      "notes.addMine",
      "notes.editMine",
      "notes.myPlaceholder",
      "notes.listenersHeading",
      "notes.listenersOnlyHint",
      "notes.lastEdited",
    ]) {
      for (const file of [en, ru, notes]) expect(key in file).toBe(false);
    }
    for (const key of [
      "db.notes_role",
      "db.listener_notes_add_role",
      "db.listener_notes_edit_role",
    ]) {
      for (const file of [en, ru, notes]) expect(key in file).toBe(true);
    }
  });

  it("the refusals from the database read in Russian (sham:notes_add_role / sham:notes_edit_role)", () => {
    expect(
      dbErrorMessage(
        { code: "42501", hint: "sham:notes_add_role", message: "x" },
        "ru",
      ),
    ).toBe(
      "Добавлять заметки могут только слушатели курса, его куратор и преподаватель.",
    );
    expect(
      dbErrorMessage(
        { code: "42501", hint: "sham:notes_edit_role", message: "x" },
        "ru",
      ),
    ).toBe(
      "Изменять заметки могут только слушатели курса, его куратор и преподаватель.",
    );
  });
});

describe("AC 3 / AC 11: the tile pencil", () => {
  it("no pencil and no Notes link on scheduled or canceled meetings, even for the owner and the teacher", async () => {
    const S = meeting("S", "scheduled", 20);
    const X = meeting("X", "canceled", -30);
    for (const who of ["M", "T"] as const) {
      setStore(fakeStore(who, { courseMembers: members, meetings: [S, X] }));
      const view = await render(<CourseDetailScreen />);
      for (const id of ["S", "X"]) {
        expect(
          within(screen.getByTestId(`meeting-${id}`)).queryByRole("button", {
            name: /Add notes|Edit notes/,
          }),
        ).toBeNull();
        expect(
          within(screen.getByTestId(`meeting-${id}`)).queryByRole("link", {
            name: "Notes",
          }),
        ).toBeNull();
      }
      await view.unmount();
    }
  });

  it("the teacher who owns the course gets one pencil, not two", async () => {
    const own: Course = { ...courseA, createdById: "T" };
    setStore(
      fakeStore("T", { courses: [own], courseMembers: members, meetings: [C] }),
    );
    await render(<CourseDetailScreen />);
    expect(pencilsIn("C").map((p) => p.props.accessibilityLabel)).toEqual([
      "Add notes",
    ]);
  });

  it("a former owner (not a listener) and a removed listener get no pencil", async () => {
    const moved: Course = { ...courseA, createdById: "N" };
    setStore(
      fakeStore("M", {
        courses: [moved],
        courseMembers: members,
        meetings: [C],
      }),
    );
    const view = await render(<CourseDetailScreen />);
    expect(pencilsIn("C")).toHaveLength(0);
    await view.unmount();
    setStore(
      fakeStore("S1", { courseMembers: [member("A", "M2")], meetings: [C] }),
    );
    await render(<CourseDetailScreen />);
    expect(
      screen.queryByRole("button", { name: /Add notes|Edit notes/ }),
    ).toBeNull();
  });

  it("in Russian, with my note: one pencil labelled «Изменить заметки», the text never on screen", async () => {
    setStore(
      fakeStore("S1", {
        courseMembers: members,
        meetings: [C],
        meetingListenerNotes: [note("n1", "S1", "Моё")],
      }),
    );
    await render(ruUi(<CourseDetailScreen />));
    expect(pencilsIn("C").map((p) => p.props.accessibilityLabel)).toEqual([
      "Изменить заметки",
    ]);
    for (const text of ["Изменить заметки", "Добавить заметки"])
      expect(screen.queryByText(text)).toBeNull();
    expect(
      within(screen.getByTestId("meeting-C")).getByRole("link", {
        name: "Заметки",
      }),
    ).toBeTruthy();
  });
});

describe("AC 4 / AC 7 / AC 11: the Notes page", () => {
  // Render the Stack header's headerRight, which the shared mock leaves out (as in the ARU-126 QA test).
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

  it("in Russian the header pencil reads «Изменить заметки» once I have notes, with a 44 pt target", async () => {
    params.meetingId = "C";
    setStore(
      fakeStore("M2", {
        courseMembers: members,
        meetings: [C],
        meetingListenerNotes: [note("n1", "M2", "Мо")],
      }),
    );
    await render(ruUi(<MeetingNotesScreen />));
    const pencil = screen.getByTestId("notes-edit");
    expect(pencil.props.accessibilityLabel).toBe("Изменить заметки");
    expect(pencil.props.style.minHeight).toBeGreaterThanOrEqual(44);
    expect(screen.queryByText("Изменить заметки")).toBeNull();
  });

  it("the owner with no notes yet sees «No notes yet» and the pencil", async () => {
    params.meetingId = "C";
    setStore(fakeStore("M", { courseMembers: members, meetings: [C] }));
    await render(<MeetingNotesScreen />);
    expect(screen.getByText("No notes yet")).toBeTruthy();
    expect(screen.getByTestId("notes-edit").props.accessibilityLabel).toBe(
      "Add notes",
    );
  });

  it("the editor in Russian is titled by the catalog, has the Russian placeholder and saves through the store", async () => {
    Object.assign(params, { meetingId: "C", edit: "1" });
    const store = fakeStore("T", { courseMembers: members, meetings: [C] });
    setStore(store);
    await render(ruUi(<MeetingNotesScreen />));
    const field = screen.getByPlaceholderText("Что разбирали на встрече?");
    await fireEvent.changeText(field, "  Итоги  ");
    await fireEvent.press(screen.getByRole("button", { name: "Сохранить" }));
    expect(store.saveMyMeetingNotes).toHaveBeenCalledWith(
      "C",
      expect.stringContaining("Итоги"),
    );
  });
});
