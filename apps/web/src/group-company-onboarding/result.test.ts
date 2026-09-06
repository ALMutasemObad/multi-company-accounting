import { describe, expect, it } from "vitest";
import { confirmedGroupCompanyResult } from "./result";

describe("company creation confirmation", () => {
  const result = { organizationId: "1", company: { id: "2", name: "Company", code: "generated", timezone: "UTC", baseCurrencyCode: "SAR" } };
  it("only confirms a complete response for the requested organization", () => {
    expect(confirmedGroupCompanyResult(result, "1")).toEqual(result);
    for (const value of [null, {}, { ...result, organizationId: "3" }, { ...result, company: { ...result.company, id: 2 } }]) {
      expect(() => confirmedGroupCompanyResult(value, "1")).toThrow();
    }
  });
});
