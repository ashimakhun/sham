// QA ARU-125: gaps in aru125-listener-notes.test.tsx:
// - Russian: the row actions, "Edited <date>", "Deleted account", the delete confirmations and the editor
//   read in Russian, with Russian dates; user text stays as written. (ARU-142: the notes list has no heading.)
// - AC 11: a removed mentor no longer sees the notes (ARU-142 AC 6) and gets no notes pencil; a removed student gets
//   no actions; the owner and the teacher can delete a removed listener's or a deleted account's notes.
// - AC 12: a deleted account's notes: the owner's confirmation names "Deleted account"; a listener gets no Delete.
// - Edge cases: leaving the editor with unsaved changes asks to discard (the owner's prompt); a meeting of another
//   course isn't shown.
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { usePreventRemove } from "expo-router";
import { Alert, StyleSheet } from "react-native";

import CourseDetailScreen from "@/app/courses/[id]";
import MeetingNotesScreen from "@/app/courses/[id]/meetings/[meetingId]/notes";
import { styles } from "@/components/ui";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { colors } from "@/lib/theme";
import type { Meeting, MeetingListenerNote, User } from "@/lib/types";

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
  startsAt: at(-30),
  topic: `Topic ${over.id}`,
  status: "completed",
  createdById: "M",
  createdAt: at(-100),
  ...over,
});
const C = meeting({ id: "C" });
const note = (
  over: Partial<MeetingListenerNote> & { id: string },
): MeetingListenerNote => ({
  meetingId: "C",
  courseId: "A",
  authorId: "S1",
  body: "Sam **wrote**",
  createdAt: "2026-10-20T10:00:00.000Z",
  updatedAt: "2026-10-20T10:00:00.000Z",
  ...over,
});
const samNote = note({ id: "n1", updatedAt: "2026-10-21T10:00:00.000Z" });
const moNote = note({
  id: "n2",
  authorId: "M2",
  body: "Mo wrote",
  createdAt: "2026-10-22T10:00:00.000Z",
  updatedAt: "2026-10-22T10:00:00.000Z",
});
const goneNote = note({
  id: "n3",
  authorId: null,
  body: "Old notes",
  createdAt: "2026-10-23T10:00:00.000Z",
  updatedAt: "2026-10-23T10:00:00.000Z",
});

const labels = (id: string) =>
  within(screen.getByTestId(`meeting-${id}`))
    .queryAllByRole(/button|link/)
    .map((b) => b.props.accessibilityLabel);

/** A store for `who`, in `language`. */
function as(
  who: keyof typeof users,
  language: "en" | "ru",
  over: Parameters<typeof fakeStore>[1] = {},
) {
  const me: User = { ...users[who], language };
  const store = { ...fakeStore(who, over), currentUser: me };
  setStore(store);
  return store;
}
const inApp = (ui: React.ReactElement) => (
  <LanguageProvider>{ui}</LanguageProvider>
);

let alert: jest.SpyInstance;
beforeEach(() => {
  jest.clearAllMocks();
  params.id = "A";
  params.meetingId = undefined;
  params.edit = undefined;
  alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
});
afterEach(() => alert.mockRestore());

describe("Russian", () => {
  // ARU-142: one pencil labelled "Добавить заметки" / "Изменить заметки"; no "… мои заметки".
  it('the meeting row: "Добавить заметки", then "Изменить заметки" and "Заметки"', async () => {
    as("S1", "ru", { courseMembers: [member("A", "S1")], meetings: [C] });
    const view = await render(inApp(<CourseDetailScreen />));
    expect(labels("C")).toContain("Добавить заметки");
    as("S1", "ru", {
      courseMembers: [member("A", "S1")],
      meetings: [C],
      meetingListenerNotes: [samNote],
    });
    await view.rerender(inApp(<CourseDetailScreen />));
    expect(labels("C")).toEqual(
      expect.arrayContaining(["Изменить заметки", "Заметки"]),
    );
    expect(labels("C").some((l) => /мои заметки|my notes/i.test(l ?? ""))).toBe(
      false,
    );
  });

  // ARU-142: the «ЗАМЕТКИ СЛУШАТЕЛЕЙ» heading is gone.
  it('the Notes page: no heading, "Изменено", Russian dates, "Удалённый аккаунт"; names and text as written', async () => {
    params.meetingId = "C";
    as("M", "ru", {
      courseMembers: [member("A", "S1"), member("A", "M2")],
      meetings: [C],
      meetingListenerNotes: [samNote, moNote, goneNote],
    });
    await render(inApp(<MeetingNotesScreen />));
    expect(screen.getByTestId("meeting-notes")).toBeTruthy();
    expect(screen.queryByText(/ЗАМЕТКИ СЛУШАТЕЛЕЙ/i)).toBeNull();
    const sam = within(screen.getByTestId("listener-note-n1"));
    expect(sam.getByText("Student Sam")).toBeTruthy();
    expect(sam.getByText(/^Изменено .*окт/)).toBeTruthy();
    expect(sam.getAllByText(/окт/).length).toBe(2);
    expect(screen.queryByText(/Edited|Oct|Deleted account/)).toBeNull();
    const gone = within(screen.getByTestId("listener-note-n3"));
    expect(gone.getByText("Удалённый аккаунт")).toBeTruthy();
    expect(gone.getByText("Old notes")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Удалить заметки пользователя Mentor Mo",
      }),
    ).toBeTruthy();
  });

  it("ARU-136: the Delete link uses the shared upper-case link style in the danger colour; the text stays as written", async () => {
    params.meetingId = "C";
    as("M", "ru", {
      courseMembers: [member("A", "S1")],
      meetings: [C],
      meetingListenerNotes: [samNote],
    });
    await render(inApp(<MeetingNotesScreen />));
    const del = screen.getByRole("button", {
      name: "Удалить заметки пользователя Student Sam",
    });
    const text = within(del).getByText("Удалить заметки");
    const s = StyleSheet.flatten(text.props.style);
    expect(s).toEqual(
      expect.objectContaining({
        ...StyleSheet.flatten(styles.linkText),
        color: colors.danger,
      }),
    );
    expect(s.textTransform).toBe("uppercase");
    expect(s.fontWeight).toBeUndefined();
  });

  it("confirmations: own notes and someone else's, in Russian", async () => {
    params.meetingId = "C";
    as("S1", "ru", {
      courseMembers: [member("A", "S1"), member("A", "M2")],
      meetings: [C],
      meetingListenerNotes: [samNote],
    });
    const view = await render(inApp(<MeetingNotesScreen />));
    await fireEvent.press(
      screen.getByRole("button", { name: "Удалить заметки" }),
    );
    expect(alert).toHaveBeenLastCalledWith(
      "Удалить заметки",
      "Удалить ваши заметки к этой встрече?",
      expect.any(Array),
      expect.anything(),
    );
    await view.unmount();
    as("T", "ru", {
      courseMembers: [member("A", "M2")],
      meetings: [C],
      meetingListenerNotes: [moNote],
    });
    await render(inApp(<MeetingNotesScreen />));
    await fireEvent.press(
      screen.getByRole("button", {
        name: "Удалить заметки пользователя Mentor Mo",
      }),
    );
    expect(alert).toHaveBeenLastCalledWith(
      "Удалить заметки",
      "Удалить заметки пользователя Mentor Mo к этой встрече?",
      expect.any(Array),
      expect.anything(),
    );
  });

  // ARU-142: one editor for everyone, with the notes.placeholder text.
  it("the editor: Russian placeholder and Save", async () => {
    Object.assign(params, { meetingId: "C", edit: "1" });
    as("S1", "ru", { courseMembers: [member("A", "S1")], meetings: [C] });
    await render(inApp(<MeetingNotesScreen />));
    expect(screen.getByPlaceholderText("Что разбирали на встрече?")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /Сохранить/ }).length,
    ).toBeGreaterThan(0);
  });
});

describe("AC 11: removed listeners", () => {
  // ARU-142 AC 6: a mentor outside the course no longer reads notes, their own included (the database sends none);
  // the owner and the teacher can still delete them (below).
  it('a removed mentor no longer sees their old note, and gets no "Add/Edit notes" pencil on the row', async () => {
    as("M2", "en", { courseMembers: [member("A", "S1")], meetings: [C] });
    const view = await render(inApp(<CourseDetailScreen />));
    expect(labels("C")).not.toContain("Notes");
    expect(labels("C")).not.toContain("Add notes");
    expect(labels("C")).not.toContain("Edit notes");
    await view.unmount();
    params.meetingId = "C";
    await render(inApp(<MeetingNotesScreen />));
    expect(screen.getByText("No notes yet")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it("a removed mentor opening the editor directly is told only listeners, the owner and the teacher write notes", async () => {
    Object.assign(params, { meetingId: "C", edit: "1" });
    as("M2", "en", { courseMembers: [member("A", "S1")], meetings: [C] });
    await render(inApp(<MeetingNotesScreen />));
    expect(
      screen.getByText(
        "Only the course's listeners, its owner and the teacher can write notes.",
      ),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Notes")).toBeNull();
  });

  it("a removed student sees no meetings, so no Notes page", async () => {
    params.meetingId = "C";
    as("S3", "en", {
      courseMembers: [member("A", "S1")],
      meetings: [C],
      meetingListenerNotes: [note({ id: "n4", authorId: "S3" })],
    });
    await render(inApp(<MeetingNotesScreen />));
    expect(screen.queryByTestId("meeting-notes")).toBeNull();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });

  it.each(["M", "T"] as const)(
    "%s can delete a removed student's or a removed mentor's notes",
    async (who) => {
      params.meetingId = "C";
      as(who, "en", {
        courseMembers: [member("A", "S1")],
        meetings: [C],
        meetingListenerNotes: [note({ id: "n4", authorId: "S3" }), moNote],
      });
      await render(inApp(<MeetingNotesScreen />));
      expect(
        screen.getByRole("button", { name: `Delete ${users.S3.name}'s notes` }),
      ).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Delete Mentor Mo's notes" }),
      ).toBeTruthy();
    },
  );
});

describe("AC 12: a deleted account's notes", () => {
  it('the owner\'s confirmation names "Deleted account"', async () => {
    params.meetingId = "C";
    const store = as("M", "en", {
      courseMembers: [member("A", "S1")],
      meetings: [C],
      meetingListenerNotes: [goneNote],
    });
    alert.mockImplementation((_t, _m, buttons) => buttons?.[1]?.onPress?.());
    await render(inApp(<MeetingNotesScreen />));
    await fireEvent.press(
      screen.getByRole("button", { name: "Delete Deleted account's notes" }),
    );
    expect(alert).toHaveBeenLastCalledWith(
      "Delete notes",
      "Delete Deleted account's notes for this meeting?",
      expect.any(Array),
      expect.anything(),
    );
    expect(store.deleteMeetingListenerNotes).toHaveBeenCalledWith("n3");
  });

  it("a listener gets no Delete on it", async () => {
    params.meetingId = "C";
    as("S1", "en", {
      courseMembers: [member("A", "S1")],
      meetings: [C],
      meetingListenerNotes: [goneNote],
    });
    await render(inApp(<MeetingNotesScreen />));
    expect(screen.getByText("Deleted account")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Delete/ })).toBeNull();
  });
});

describe("edge cases", () => {
  it("leaving the editor with unsaved changes asks to discard", async () => {
    Object.assign(params, { meetingId: "C", edit: "1" });
    as("S1", "en", {
      courseMembers: [member("A", "S1")],
      meetings: [C],
      meetingListenerNotes: [samNote],
    });
    await render(inApp(<MeetingNotesScreen />));
    const prevent = usePreventRemove as jest.Mock;
    expect(prevent).toHaveBeenLastCalledWith(false, expect.any(Function));
    await fireEvent.changeText(screen.getByLabelText("Notes"), "changed");
    const [on, onRemove] = prevent.mock.lastCall;
    expect(on).toBe(true);
    onRemove({ repeat: jest.fn() });
    expect(alert).toHaveBeenLastCalledWith(
      "Discard changes?",
      expect.any(String),
      expect.any(Array),
      expect.anything(),
    );
  });

  it("a meeting of another course is not found", async () => {
    params.meetingId = "C";
    params.id = "B";
    as("S1", "en", {
      courseMembers: [member("A", "S1"), member("B", "S1")],
      meetings: [C],
      meetingListenerNotes: [samNote],
    });
    await render(inApp(<MeetingNotesScreen />));
    expect(screen.queryByTestId("meeting-notes")).toBeNull();
  });
});
