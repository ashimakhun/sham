// QA ARU-96: gaps in the dev tests: no chat button on course details for every role that can use the chat (owner,
// student and mentor listeners, teacher), even with unread messages; nothing chat-related on details (AC 4; since
// ARU-103, Change owner is in Edit course); a student outside the course still gets the summary; the teacher's
// discipline page keeps the course card's chat icon, and it opens the chat (AC 3).
import { fireEvent, render, screen } from "@testing-library/react-native";
import { router } from "expo-router";

import CourseDetailScreen from "@/app/courses/[id]";
import DisciplineScreen from "@/app/disciplines/[id]";
import type { Course, Discipline } from "@/lib/types";

import { courseA, fakeStore, member } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

const hidden = { includeHiddenElements: true };
const members = [member("A", "S1"), member("A", "M2")];
const unread = () => 5;

beforeEach(() => {
  jest.clearAllMocks();
  params.id = "A";
});

it.each(["M", "S1", "M2", "T"] as const)(
  "AC 1: %s sees no chat button or badge on course details, even with 5 unread",
  async (who) => {
    setStore(
      fakeStore(who, {
        courses: [courseA],
        courseMembers: members,
        unreadCount: unread,
      }),
    );
    await render(<CourseDetailScreen />);
    expect(screen.getAllByText("Algebra").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /chat/i })).toBeNull();
    expect(screen.queryByTestId("icon-chatbubble-outline", hidden)).toBeNull();
    expect(screen.queryByTestId("unread-badge", hidden)).toBeNull();
  },
);

it("AC 4: for the teacher, nothing chat-related is on course details before the Meetings section (ARU-103 moved Change owner into Edit course)", async () => {
  setStore(
    fakeStore("T", {
      courses: [courseA],
      courseMembers: members,
      unreadCount: unread,
    }),
  );
  await render(<CourseDetailScreen />);
  expect(screen.getByRole("button", { name: "Edit course" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Change owner" })).toBeNull();
  expect(screen.queryByRole("button", { name: /chat/i })).toBeNull();
  expect(screen.queryByTestId("icon-chatbubble-outline", hidden)).toBeNull();
});

it("AC 6: a student outside the course still gets the summary view, with no chat button", async () => {
  setStore(fakeStore("S2", { courses: [courseA], courseMembers: members }));
  await render(<CourseDetailScreen />);
  expect(screen.queryByRole("button", { name: /chat/i })).toBeNull();
});

it("AC 3: the teacher's discipline page keeps the course card's chat icon, with its badge, and it opens the chat", async () => {
  const math: Discipline = {
    id: "DM",
    name: "Math",
    hidden: false,
    createdById: "T",
    createdAt: "2026-11-01T10:00:00.000Z",
  };
  const A: Course = { ...courseA, disciplineId: "DM" };
  params.id = "DM";
  setStore(
    fakeStore("T", {
      courses: [A],
      courseMembers: members,
      disciplines: [math],
      unreadCount: unread,
    }),
  );
  await render(<DisciplineScreen />);
  const icon = screen.getByRole("button", {
    name: "Open chat for Algebra, 5 new messages",
  });
  await fireEvent.press(icon);
  expect(router.push).toHaveBeenCalledWith(
    expect.objectContaining({
      pathname: "/courses/[id]/chat",
      params: { id: "A" },
    }),
  );
});
