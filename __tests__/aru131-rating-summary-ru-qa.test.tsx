// QA ARU-131: the dev test renders RatingSummary on its own. Here the four real places that show it (course details'
// Feedback section, the course card, the Disciplines list, discipline details) are rendered in Russian through the
// app's LanguageProvider: the summary and its label are the Russian ones (plural "отзыва"), no English "reviews" /
// "Rated" is left, the ★ keeps colors.star, and each review's stars read their Russian label. English is unchanged.
// (Through the provider the default `lang` already follows the app language, so these pass with or without the
// explicit `lang` the fix adds; they guard the screens, the dev test guards the component.)
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";

import CoursesScreen from "@/app/(tabs)/courses";
import CourseDetailScreen from "@/app/courses/[id]";
import DisciplineScreen from "@/app/disciplines/[id]";
import { CourseCard } from "@/components/CourseCard";
import { LanguageProvider } from "@/i18n/LanguageProvider";
import { ratingSummary, ratingSummaryLabel, starsLabel } from "@/lib/feedback";
import { colors } from "@/lib/theme";
import type {
  Course,
  CourseFeedback,
  Discipline,
  Meeting,
  User,
} from "@/lib/types";

import { courseA, fakeStore, member, users } from "./helpers/fakeStore";
import { params, setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("expo-router/react-navigation", () => ({ useHeaderHeight: () => 0 }));
jest.mock("@/lib/store", () => require("./helpers/mocks").store);
jest.mock("expo-localization", () => ({
  getLocales: jest.fn(() => [{ languageTag: "en-US", languageCode: "en" }]),
}));
jest.mock(
  "react-native-safe-area-context",
  () => require("react-native-safe-area-context/jest/mock").default,
);

const math: Discipline = {
  id: "DM",
  name: "Math",
  hidden: false,
  createdById: "T",
  createdAt: "2026-11-01T10:00:00.000Z",
};
const A: Course = { ...courseA, disciplineId: "DM" };
const done: Meeting = {
  id: "D",
  courseId: "A",
  startsAt: "2026-10-20T10:00:00.000Z",
  topic: "Intro",
  status: "completed",
  createdById: "M",
  createdAt: "2026-10-01T10:00:00.000Z",
};
const fb = (id: string, userId: string, rating: number): CourseFeedback => ({
  id,
  courseId: "A",
  userId,
  rating,
  body: `Review ${id}`,
  createdAt: "2026-11-02T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
});
const feedback = [fb("f1", "S1", 5), fb("f2", "M2", 2)];

const as = (who: "T" | "S1", language: "en" | "ru") => {
  const me: User = { ...users[who], language };
  setStore(
    fakeStore(who, {
      currentUser: me,
      courses: [A],
      courseMembers: [member("A", "S1"), member("A", "M2")],
      meetings: [done],
      courseFeedback: feedback,
      disciplines: [math],
    }),
  );
};
const inApp = async (ui: React.ReactElement) => {
  await render(<LanguageProvider>{ui}</LanguageProvider>);
  await act(async () => {});
};

function expectSummary(lang: "en" | "ru") {
  const text = ratingSummary(feedback, lang)!;
  const label = ratingSummaryLabel(feedback, lang)!;
  if (lang === "ru") {
    expect(text).toMatch(/3[.,]5 · 2 отзыва$/);
    expect(label).toMatch(/^Оценка 3[.,]5 из 5, 2 отзыва$/);
    expect(screen.queryByText(/reviews?$/)).toBeNull();
    expect(screen.queryByLabelText(/^Rated /)).toBeNull();
  } else {
    expect(text).toBe("★ 3.5 · 2 reviews");
    expect(label).toBe("Rated 3.5 out of 5, 2 reviews");
  }
  const line = screen.getByText(text);
  expect(screen.getByLabelText(label)).toBeTruthy();
  expect(within(line).getByTestId("rating-summary-star")).toHaveStyle({
    color: colors.star,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  params.id = "A";
});

describe.each(["ru", "en"] as const)("in %s", (lang) => {
  it("course details: the Feedback summary and each review's stars", async () => {
    as("T", lang);
    await inApp(<CourseDetailScreen />);
    expectSummary(lang);
    const stars = within(screen.getByTestId("feedback-f2")).getByLabelText(
      starsLabel(2, lang),
    );
    expect(stars).toHaveStyle({ color: colors.star });
  });

  it("course card", async () => {
    as("T", lang);
    await inApp(<CourseCard course={A} />);
    expectSummary(lang);
  });

  it("Disciplines list", async () => {
    as("T", lang);
    await inApp(<CoursesScreen />);
    await fireEvent.press(
      screen.getByRole("tab", {
        name: lang === "ru" ? /^Дисциплины/ : /^Disciplines/,
      }),
    );
    expectSummary(lang);
  });

  it("discipline details: the summary and each review's stars", async () => {
    params.id = "DM";
    as("S1", lang);
    await inApp(<DisciplineScreen />);
    expectSummary(lang);
    const stars = within(screen.getByTestId("review-f1")).getByLabelText(
      starsLabel(5, lang),
    );
    expect(stars).toHaveStyle({ color: colors.star });
  });
});

it("the Russian star labels are Russian", () => {
  expect(starsLabel(5, "ru")).not.toMatch(/star/i);
  expect(starsLabel(2, "ru")).not.toMatch(/star/i);
});
