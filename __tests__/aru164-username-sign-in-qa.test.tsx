// QA ARU-164: gaps in aru164-username-sign-in.test.tsx: a display name of only no-break spaces or over 80 characters
// keeps Create account disabled, the username field's length limit applies to Create account only (an older account's
// long email still fits when signing in), the rule message never shows in Sign in mode, the Russian sign-up and sign-in
// texts, Manage roles shows @username and never an email, and the error texts that must stay their own (network, rate
// limit, the database refusal in each mode).
import { fireEvent, render, screen } from "@testing-library/react-native";
import type React from "react";

import SignInScreen from "@/app/index";
import RolesScreen from "@/app/roles";
import { I18nContext, make } from "@/i18n/context";
import {
  GENERIC_ERROR,
  INVITE_CODE_UNKNOWN,
  NETWORK_ERROR,
  RATE_LIMITED,
  signInErrorMessage,
  signUpErrorMessage,
  USERNAME_INVALID_CREDENTIALS,
} from "@/lib/password";
import type { AccessRequest } from "@/lib/types";
import { signInAddress, usernameFromAddress } from "@/lib/username";

import { fakeStore } from "./helpers/fakeStore";
import { setStore } from "./helpers/mocks";

jest.mock("expo-router", () => require("./helpers/mocks").expoRouter);
jest.mock("@/lib/store", () => require("./helpers/mocks").store);

beforeEach(() => jest.clearAllMocks());

const ru = (ui: React.ReactElement) => (
  <I18nContext.Provider value={make("ru")}>{ui}</I18nContext.Provider>
);
const RULE =
  "3–30 characters: letters a–z, digits, _ . -; starts and ends with a letter or digit";
const button = (name: string) =>
  screen.getAllByRole("button", { name }).at(-1)!;

async function fillSignUp(name: string, username = "dana_s") {
  await fireEvent.press(screen.getByRole("tab", { name: "Create account" }));
  await fireEvent.changeText(screen.getByPlaceholderText("Dana S."), name);
  await fireEvent.changeText(screen.getByTestId("username-field"), username);
  await fireEvent.changeText(
    screen.getByPlaceholderText("At least 6 characters"),
    "secret1",
  );
  await fireEvent.press(screen.getByRole("tab", { name: "Join a workspace" }));
  await fireEvent.changeText(
    screen.getByPlaceholderText("8 letters and digits"),
    "ABCD2345",
  );
}

it("AC 1 / AC 5: a display name of only no-break spaces keeps Create account disabled", async () => {
  setStore(fakeStore(null));
  await render(<SignInScreen />);
  await fillSignUp("  　");
  expect(button("Create account")).toBeDisabled();
  await fireEvent.changeText(screen.getByPlaceholderText("Dana S."), "Dana");
  expect(button("Create account")).toBeEnabled();
});

it("AC 1: the display name field stops at 80 characters", async () => {
  setStore(fakeStore(null));
  await render(<SignInScreen />);
  await fireEvent.press(screen.getByRole("tab", { name: "Create account" }));
  expect(screen.getByPlaceholderText("Dana S.").props.maxLength).toBe(80);
});

it("AC 2 / AC 8: the 30-character limit is for Create account only; a long older email fits when signing in", async () => {
  const signIn = jest.fn(async () => {});
  setStore(fakeStore(null, { signIn }));
  await render(<SignInScreen />);
  expect(screen.getByTestId("username-field").props.maxLength).toBeUndefined();
  const email = "a.very.long.name.from.before@school-example.kz";
  await fireEvent.changeText(screen.getByTestId("username-field"), email);
  await fireEvent.changeText(
    screen.getByPlaceholderText("At least 6 characters"),
    "secret1",
  );
  expect(screen.queryByText(RULE)).toBeNull();
  await fireEvent.press(button("Sign in"));
  expect(signIn).toHaveBeenCalledWith(email, "secret1");
  expect(signInAddress(`  ${email}  `)).toBe(email);
  await fireEvent.press(screen.getByRole("tab", { name: "Create account" }));
  expect(screen.getByTestId("username-field").props.maxLength).toBe(30);
});

it("note 5: a sign-in username with spaces or capitals never shows the sign-up rule", async () => {
  setStore(fakeStore(null));
  await render(<SignInScreen />);
  for (const text of ["John Smith", "_x", "Дана"]) {
    await fireEvent.changeText(screen.getByTestId("username-field"), text);
    expect(screen.queryByText(RULE)).toBeNull();
  }
  expect(signInAddress("  Dana_S ")).toBe("dana_s@users.sham.invalid");
});

it("AC 13: the sign-up and sign-in screens in Russian", async () => {
  setStore(fakeStore(null));
  await render(ru(<SignInScreen />));
  expect(screen.getByText("Имя пользователя")).toBeTruthy();
  expect(
    screen.getByText("Создали аккаунт с почтой? Войдите с ней."),
  ).toBeTruthy();
  const createTab = screen.getAllByRole("tab")[1];
  await fireEvent.press(createTab);
  expect(screen.getByText("Отображаемое имя")).toBeTruthy();
  expect(screen.getByText("Не обязательно настоящее имя")).toBeTruthy();
  await fireEvent.changeText(screen.getByTestId("username-field"), "da..na");
  expect(
    screen.getByText(
      "3–30 символов: латинские буквы a–z, цифры, _ . -; начинается и заканчивается буквой или цифрой",
    ),
  ).toBeTruthy();
  expect(screen.queryByText(/почт/i, { exact: false })).toBeNull();
});

it("AC 11: Manage roles shows the display name and @username, never an email or the internal address", async () => {
  const reqs: AccessRequest[] = [
    {
      id: "N",
      name: "New Dana",
      username: "dana_s",
      createdAt: "2026-11-19T10:00:00.000Z",
      status: "pending",
    },
    {
      id: "O",
      name: "Old Lee",
      username: "",
      createdAt: "2026-11-19T10:00:00.000Z",
      status: "pending",
    },
  ];
  setStore(fakeStore("T", { accessRequests: reqs }));
  await render(<RolesScreen />);
  expect(screen.getByText("New Dana")).toBeTruthy();
  expect(screen.getByText("@dana_s")).toBeTruthy();
  expect(screen.getByText("Old Lee")).toBeTruthy();
  expect(screen.queryByText(/@$/)).toBeNull();
  expect(screen.queryByText(/users\.sham\.invalid|@[a-z]+\.[a-z]/)).toBeNull();
});

it("AC 10: an address on another domain that only ends like the internal one is not a username", () => {
  expect(usernameFromAddress("dana@evilusers.sham.invalid")).toBeNull();
  expect(usernameFromAddress("DANA_S@USERS.SHAM.INVALID")).toBe("dana_s");
  expect(usernameFromAddress("@users.sham.invalid")).toBeNull();
});

it("AC 4 / AC 7 edge cases: network, rate limit and the database refusal keep their own texts", () => {
  const network = {
    name: "AuthRetryableFetchError",
    message: "Failed to fetch",
    status: 0,
  };
  expect(signInErrorMessage(network)).toBe(NETWORK_ERROR);
  expect(signUpErrorMessage(network, "join")).toBe(NETWORK_ERROR);
  const limited = {
    code: "over_request_rate_limit",
    message: "Too many requests",
    status: 429,
  };
  expect(signInErrorMessage(limited)).toBe(RATE_LIMITED);
  expect(signUpErrorMessage(limited, "create")).toBe(RATE_LIMITED);
  const refused = {
    code: "unexpected_failure",
    message: "Database error saving new user",
    status: 500,
  };
  expect(signUpErrorMessage(refused, "create")).toBe(GENERIC_ERROR);
  expect(signUpErrorMessage(refused, "join")).toBe(INVITE_CODE_UNKNOWN);
  // An older account's email with a wrong password reads the same as a wrong username (AC 7, AC 8).
  expect(
    signInErrorMessage({
      code: "invalid_credentials",
      message: "Invalid login credentials",
      status: 400,
    }),
  ).toBe(USERNAME_INVALID_CREDENTIALS);
});
