import { describe, expect, it } from "vitest";
import { deliveryCopyFor, registrationDeliveryCopy } from "./copy";

describe("registration email delivery copy", () => {
  it.each(["ar", "en", "ur", "hi"] as const)("keeps the accepted and resend states honest and generic in %s", (locale) => {
    const copy = deliveryCopyFor(locale);
    expect(Object.keys(copy).sort()).toEqual(Object.keys(registrationDeliveryCopy.ar).sort());
    expect(Object.values(copy).every((value) => value.trim().length > 0)).toBe(true);
    expect(`${copy.acceptedDescription} ${copy.resendAccepted}`.toLowerCase()).not.toMatch(/successfully sent|تم الإرسال بنجاح|delivered successfully/u);
  });

  it("states that acceptance is not delivery and gives existing-account guidance", () => {
    const copy = deliveryCopyFor("en");
    expect(copy.resendAccepted).toContain("does not mean");
    expect(copy.acceptedDescription).toContain("every email gets the same result");
    expect(copy.acceptedDescription).toContain("password recovery");
    expect(copy.resendHelp).toContain("limit");
  });

  it("uses base-language then Arabic fallback for newly discovered locales", () => {
    expect(deliveryCopyFor("en-GB")).toEqual(registrationDeliveryCopy.en);
    expect(deliveryCopyFor("de-DE")).toEqual(registrationDeliveryCopy.ar);
  });
});
