// QA ARU-112: gaps in aru112-photo-deletion.test.tsx: an open details screen switches to the "Photo removed…" note
// live when the job clears the photo (AC 6); a removed photo is no longer counted by ARU-107's banner, Download my
// photos and deletion warning (AC 6); the teacher's Telegram page has no Photo deletion switch while students and
// mentors do (AC 5). The Telegram text is checked in supabase/functions/_shared/photo-deletion-qa.test.ts.
import { render, screen } from "@testing-library/react-native";

import HomeworkDetailScreen from "@/app/homework/[id]";
import TelegramScreen from "@/app/telegram";
import {
  deletionWarning,
  PHOTO_REMOVED,
  storedOwnPhotos,
} from "@/lib/photoRetention";
import type { TelegramLink } from "@/lib/types";

import { fakeStore, hw, member } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

const linked: TelegramLink = {
  linkedAt: "2026-11-01T10:00:00.000Z",
  switches: {
    meeting_started: true,
    new_homework: true,
    homework_reviewed: true,
    chat_message: true,
  },
};

beforeEach(() => {
  jest.clearAllMocks();
  process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME = "ShamSchoolBot";
});
afterEach(() => {
  delete process.env.EXPO_PUBLIC_TELEGRAM_BOT_USERNAME;
});

const base = {
  id: "h1",
  courseId: "A",
  studentId: "S1",
  status: "checked" as const,
  checkedById: "M",
  checkedAt: "2026-05-01T10:00:00.000Z",
  title: "Old essay",
};
const stored = hw({
  ...base,
  photoPath: "S1/h1.jpg",
  photoUrl: "https://x/h1.jpg",
});
const removed = hw({ ...base, photoRemovedAt: "2026-11-01T03:17:00.000Z" });

it("AC 6: an open details screen switches from the photo to the note when the job removes it (owner M)", async () => {
  params.id = "h1";
  setStore(
    fakeStore("M", {
      courseMembers: [member("A", "S1")],
      visibleHomework: [stored],
    }),
  );
  const view = await render(<HomeworkDetailScreen />);
  expect(screen.getByTestId("homework-photo")).toBeTruthy();
  setStore(
    fakeStore("M", {
      courseMembers: [member("A", "S1")],
      visibleHomework: [removed],
    }),
  );
  await view.rerender(<HomeworkDetailScreen />);
  expect(screen.getByText(PHOTO_REMOVED)).toBeTruthy();
  expect(screen.queryByTestId("homework-photo")).toBeNull();
  expect(screen.queryByRole("imagebutton", { name: "Open photo" })).toBeNull();
  expect(screen.queryByRole("button", { name: /download/i })).toBeNull();
  // Title, status and checked time stay.
  expect(screen.getByText("Old essay")).toBeTruthy();
});

it("AC 6: homework without a photo that was never removed shows no note", async () => {
  params.id = "h9";
  setStore(
    fakeStore("S1", {
      courseMembers: [member("A", "S1")],
      visibleHomework: [hw({ ...base, id: "h9" })],
    }),
  );
  await render(<HomeworkDetailScreen />);
  expect(screen.queryByTestId("homework-photo-removed")).toBeNull();
  expect(screen.queryByText(PHOTO_REMOVED)).toBeNull();
});

it("AC 6: a removed photo no longer counts for Download my photos or the deletion warning", () => {
  expect(storedOwnPhotos([stored], "S1")).toHaveLength(1);
  expect(storedOwnPhotos([removed], "S1")).toHaveLength(0);
  expect(deletionWarning([removed], "S1", "2026-01-01")).toBeNull();
});

it.each([
  ["S1", true],
  ["M", true],
  ["T", false],
] as const)(
  "AC 5: on the Telegram page %s %s the Photo deletion switch",
  async (who, has) => {
    setStore(fakeStore(who, { telegram: linked }));
    await render(<TelegramScreen />);
    expect(!!screen.queryByRole("switch", { name: "Photo deletion" })).toBe(
      has,
    );
    if (has) {
      const names = screen
        .getAllByRole("switch")
        .map((s) => s.props.accessibilityLabel ?? "");
      const i = names.findIndex((n: string) => /Homework reviewed/.test(n));
      expect(names[i + 1]).toMatch(/Photo deletion/);
    }
  },
);
