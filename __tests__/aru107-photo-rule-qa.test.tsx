// QA ARU-107: gaps in aru107-photo-rule.test.tsx and homework-photos-zip.test.ts: the app's date mirror gives the
// same dates as the SQL rule for the month-end and UTC cases in aru107_homework_photo_rule_qa.test.sql; the banner's
// 30-day edge (day 30 in, day 31 out), an overdue date still warns, a missing file or an unchecked or someone else's
// photo never counts; Download by course at exactly 50 / 51 photos. The ZIP's own limits:
// supabase/functions/_shared/homework-photos-zip-qa.test.ts.
import {
  addDays,
  deletionWarning,
  photoDeletionDate,
  PHOTO_ZIP_MAX,
  storedOwnPhotos,
  zipEntries,
} from "@/lib/photoRetention";
import type { Homework } from "@/lib/types";

import { hw } from "./helpers/fakeStore";

const START = "2026-01-01";
const photo = (id: string, over: Partial<Homework> = {}): Homework =>
  hw({
    id,
    courseId: "A",
    studentId: "S1",
    photoPath: `S1/${id}.jpg`,
    photoUrl: `https://signed/${id}`,
    ...over,
  });
const checked = (id: string, checkedAt: string, over: Partial<Homework> = {}) =>
  photo(id, { status: "checked", checkedAt, ...over });

describe("AC 3: the app mirror matches the SQL rule", () => {
  it.each([
    ["2027-03-31T12:00:00Z", "2027-09-30"],
    ["2028-02-29T12:00:00Z", "2028-08-29"],
    ["2026-12-31T23:59:59Z", "2027-06-30"],
    ["2027-01-01T00:30:00+01:00", "2027-06-30"],
  ])("checked %s -> %s (same as photo_deletion_date)", (at, date) => {
    expect(photoDeletionDate(at, START)).toBe(date);
  });

  it("the start date floor: equal stays, a later 6-month date wins", () => {
    expect(photoDeletionDate("2026-11-12T10:00:00Z", "2027-05-12")).toBe(
      "2027-05-12",
    );
    expect(photoDeletionDate("2026-11-13T10:00:00Z", "2027-05-12")).toBe(
      "2027-05-13",
    );
  });
});

describe("AC 4: the banner window", () => {
  const now = new Date("2026-11-08T10:00:00Z");

  it("a date exactly 30 days away warns; 31 days does not", () => {
    const day30 = addDays("2026-11-08", 30);
    // Checked 6 months before the target day, at noon UTC.
    const sixBefore = (day: string) => {
      const [y, m, d] = day.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1 - 6, d, 12)).toISOString();
    };
    expect(photoDeletionDate(sixBefore(day30), START)).toBe(day30);
    expect(
      deletionWarning([checked("x30", sixBefore(day30))], "S1", START, now),
    ).toEqual({ count: 1, date: day30 });
    const day31 = addDays("2026-11-08", 31);
    expect(photoDeletionDate(sixBefore(day31), START)).toBe(day31);
    expect(
      deletionWarning([checked("x31", sixBefore(day31))], "S1", START, now),
    ).toBeNull();
  });

  it("an overdue date (nothing is deleted yet) still warns, with that date", () => {
    expect(
      deletionWarning(
        [checked("old", "2026-01-02T10:00:00Z")],
        "S1",
        START,
        now,
      ),
    ).toEqual({ count: 1, date: "2026-07-02" });
  });

  it("a missing file, an unchecked photo, another sender's photo or no photo never counts", () => {
    const list = [
      checked("gone", "2026-05-01T10:00:00Z", { photoUrl: undefined }),
      photo("waiting", { status: "submitted" }),
      checked("theirs", "2026-05-01T10:00:00Z", { studentId: "S2" }),
      checked("nophoto", "2026-05-01T10:00:00Z", {
        photoPath: undefined,
        photoUrl: undefined,
      }),
    ];
    expect(deletionWarning(list, "S1", START, now)).toBeNull();
    expect(storedOwnPhotos(list, "S1").map((h) => h.id)).toEqual(["waiting"]);
    expect(storedOwnPhotos(list, undefined)).toEqual([]);
  });
});

describe("AC 6: Download by course at the cap", () => {
  it("50 photos of one course are one entry; 51 are Part 1 of 2 (50) and Part 2 of 2 (1)", () => {
    const apps = Array.from({ length: PHOTO_ZIP_MAX + 1 }, (_, i) =>
      photo(`p${i}`),
    );
    expect(
      zipEntries(apps.slice(0, PHOTO_ZIP_MAX), () => "Algebra"),
    ).toHaveLength(1);
    expect(
      zipEntries(apps, () => "Algebra").map((e) => [e.part, e.parts, e.count]),
    ).toEqual([
      [1, 2, 50],
      [2, 2, 1],
    ]);
  });
});
