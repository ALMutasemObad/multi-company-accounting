import { describe, expect, it } from "vitest";
import { companyCalendarDate } from "./company-calendar-date";

describe("companyCalendarDate", () => {
  it("moves to the company's next day across a positive-offset midnight", () => {
    expect(companyCalendarDate("Asia/Riyadh", new Date("2026-09-08T22:30:00.000Z")))
      .toBe("2026-09-09");
  });

  it("moves to the company's previous day across a negative-offset midnight", () => {
    expect(companyCalendarDate("America/Los_Angeles", new Date("2026-09-08T01:30:00.000Z")))
      .toBe("2026-09-07");
  });

  it.each([undefined, null, "", "Not/A_Real_Zone"])(
    "falls back deterministically to UTC for %s",
    (timeZone) => {
      expect(companyCalendarDate(timeZone, new Date("2026-09-08T22:30:00.000Z")))
        .toBe("2026-09-08");
    },
  );
});
