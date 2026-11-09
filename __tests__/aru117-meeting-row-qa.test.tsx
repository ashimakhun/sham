// QA ARU-117: gaps in aru117-assignment-rows.test.tsx: the same three rows for the owner mentor and the teacher; every
// row keeps the muted style (AC 6) and is a separate Text, so the title can't wrap into the Meeting row (AC 5); the
// rows come before the author line and the rest of the screen is unchanged (AC 6); homework without an assignment
// shows no block; a meeting loading after the screen opens adds its row; a student outside the homework still gets
// "Homework not found".
import { render, screen, within } from "@testing-library/react-native";
import { StyleSheet } from "react-native";

import HomeworkDetailScreen from "@/app/homework/[id]";
import { styles } from "@/components/ui";
import { formatDateTime } from "@/lib/theme";
import type { HomeworkAssignment, Meeting } from "@/lib/types";

import { fakeStore, hw, member, users } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

const meeting: Meeting = {
  id: "C1",
  courseId: "A",
  startsAt: "2026-11-03T15:37:00.000Z",
  topic: "Topic",
  status: "completed",
  createdById: "M",
  createdAt: "2026-11-01T10:00:00.000Z",
};
const assignment: HomeworkAssignment = {
  id: "a1",
  courseId: "A",
  meetingId: "C1",
  title: "Write essay about yourself",
  description: "",
  createdById: "M",
  createdAt: "2026-11-03T16:00:00.000Z",
  dueAt: "2026-11-04T17:00:00.000Z",
};
const linked = hw({
  id: "h1",
  courseId: "A",
  studentId: "S1",
  assignmentId: "a1",
  title: "Mine",
  description: "My essay",
});
const meetingRow = `Meeting ${formatDateTime(meeting.startsAt)}`;

const open = async (
  who: "S1" | "M" | "T" | "S2",
  over: Parameters<typeof fakeStore>[1] = {},
) => {
  params.id = "h1";
  setStore(
    fakeStore(who, {
      courseMembers: [member("A", "S1")],
      meetings: [meeting],
      assignments: [assignment],
      visibleHomework: [linked],
      ...over,
    }),
  );
  return render(<HomeworkDetailScreen />);
};
const rowTexts = () =>
  within(screen.getByTestId("homework-assignment"))
    .getAllByText(/./)
    .map((t) => [t.props.children].flat().join(""));

beforeEach(() => jest.clearAllMocks());

it.each(["S1", "M", "T"] as const)(
  "roles: %s sees the same three rows",
  async (who) => {
    await open(who);
    expect(rowTexts()).toEqual([
      `Assignment: ${assignment.title}`,
      meetingRow,
      expect.stringMatching(/^Due /),
    ]);
  },
);

it("AC 5 / AC 6: each row is its own muted Text, and the block has no style of its own", async () => {
  await open("S1");
  const block = screen.getByTestId("homework-assignment");
  expect(block.props.style).toBeUndefined();
  const texts = within(block).getAllByText(/./);
  expect(texts).toHaveLength(3);
  for (const t of texts) {
    expect(StyleSheet.flatten(t.props.style)).toEqual(
      StyleSheet.flatten(styles.muted),
    );
    // No Text nests another, so a wrapping title can never pull the meeting date onto its line.
    expect(t.children.every((c) => typeof c === "string")).toBe(true);
    expect(String([t.props.children].flat().join(""))).not.toContain("\n");
  }
});

it("AC 6: the block sits between the course and the author line; the rest of the screen is unchanged", async () => {
  await open("S1");
  const all = screen
    .getAllByText(/./)
    .map((t) => [t.props.children].flat().join(""));
  const iCourse = all.indexOf("Algebra");
  const iAssign = all.indexOf(`Assignment: ${assignment.title}`);
  const iAuthor = all.findIndex((s) => s.startsWith(`${users.S1.name} · `));
  expect(iCourse).toBeGreaterThanOrEqual(0);
  expect(iCourse).toBeLessThan(iAssign);
  expect(iAssign).toBeLessThan(iAuthor);
  expect(screen.getByText("Mine")).toBeTruthy();
  expect(screen.getByText("My essay")).toBeTruthy();
});

it("edge case: homework sent without an assignment shows no block", async () => {
  await open("S1", {
    visibleHomework: [{ ...linked, assignmentId: undefined }],
  });
  expect(screen.queryByTestId("homework-assignment")).toBeNull();
  expect(screen.queryByText(/^Assignment: /)).toBeNull();
  expect(screen.queryByText(/^Meeting /)).toBeNull();
});

it("live: a meeting that loads after the screen opens adds its row in the middle", async () => {
  const view = await open("S1", { meetings: [] });
  expect(rowTexts()).toEqual([
    `Assignment: ${assignment.title}`,
    expect.stringMatching(/^Due /),
  ]);
  setStore(
    fakeStore("S1", {
      courseMembers: [member("A", "S1")],
      meetings: [meeting],
      assignments: [assignment],
      visibleHomework: [linked],
    }),
  );
  await view.rerender(<HomeworkDetailScreen />);
  expect(rowTexts()).toEqual([
    `Assignment: ${assignment.title}`,
    meetingRow,
    expect.stringMatching(/^Due /),
  ]);
});

it('access: a student who cannot see the homework still gets "Homework not found"', async () => {
  await open("S2", { visibleHomework: [] });
  expect(screen.getByText("Homework not found")).toBeTruthy();
  expect(screen.queryByTestId("homework-assignment")).toBeNull();
});
