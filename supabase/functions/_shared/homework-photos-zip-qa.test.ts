/**
 * @jest-environment node
 */
// QA ARU-107: gaps in homework-photos-zip.test.ts: the app and the function share the 50-photo cap; exactly 50
// photos make one ZIP and 51 need Download by course; names that differ only in case get " (2)"; very long course
// and homework titles are cut but keep the date and ".jpg".
import { PHOTO_ZIP_MAX as APP_MAX } from "../../../src/lib/photoRetention";
import {
  PHOTO_ZIP_MAX,
  pickPhotos,
  zipFileNames,
  type ZipPhoto,
} from "./homework-photos-zip";

const zp = (n: number, over: Partial<ZipPhoto> = {}): ZipPhoto => ({
  homework_id: `h${n}`,
  photo_path: `u/h${n}.jpg`,
  course_id: "A",
  course_title: "Algebra",
  homework_title: `Homework ${n}`,
  assignment_title: null,
  sent_at: "2026-10-05T10:00:00Z",
  ...over,
});

it("the app and the function agree on the cap", () => {
  expect(APP_MAX).toBe(PHOTO_ZIP_MAX);
});

it("exactly 50 photos come in one ZIP; 51 need Download by course", () => {
  const fifty = Array.from({ length: 50 }, (_, i) => zp(i));
  expect(pickPhotos(fifty)).toHaveLength(50);
  expect(pickPhotos([...fifty, zp(50)])).toBeNull();
  expect(
    pickPhotos([...fifty, zp(50)], "A", 2)?.map((p) => p.homework_id),
  ).toEqual(["h50"]);
});

it("names that differ only in case get (2); long titles are cut but keep the date and .jpg", () => {
  const names = zipFileNames([
    zp(1, { homework_title: "Essay" }),
    zp(2, { homework_title: "ESSAY" }),
  ]);
  expect(names).toEqual([
    "Algebra - Essay - 2026-10-05.jpg",
    "Algebra - ESSAY - 2026-10-05 (2).jpg",
  ]);
  const [long] = zipFileNames([
    zp(3, { homework_title: "x".repeat(300), course_title: "y".repeat(300) }),
  ]);
  expect(long.endsWith(" - 2026-10-05.jpg")).toBe(true);
  expect(long.length).toBeLessThan(200);
});
