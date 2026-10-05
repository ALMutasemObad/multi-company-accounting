import { describe, expect, it } from "vitest";
import {
  isPlatformWideFreeModuleCode,
  PLATFORM_WIDE_FREE_MODULE_CODES,
} from "../src/platform-subscriptions/platform-wide-free-module-policy.js";

describe("platform-wide free module rollout", () => {
  it("grants exactly the three owner-approved modules without broadening the list", () => {
    expect(PLATFORM_WIDE_FREE_MODULE_CODES).toEqual([
      "GENERAL_PROJECTS",
      "SERVICE_CATALOG",
      "PAYROLL",
    ]);
    expect(isPlatformWideFreeModuleCode("GENERAL_PROJECTS")).toBe(true);
    expect(isPlatformWideFreeModuleCode("SERVICE_CATALOG")).toBe(true);
    expect(isPlatformWideFreeModuleCode("PAYROLL")).toBe(true);
    expect(isPlatformWideFreeModuleCode("HUMAN_RESOURCES")).toBe(false);
    expect(isPlatformWideFreeModuleCode("SALES")).toBe(false);
    expect(isPlatformWideFreeModuleCode("UNKNOWN")).toBe(false);
  });
});
