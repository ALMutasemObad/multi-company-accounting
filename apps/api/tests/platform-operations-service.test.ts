import { describe, expect, it, vi } from "vitest";
import {
  PlatformOperationsError,
  PlatformOperationsService,
} from "../src/platform-operations/platform-operations-service.js";

describe("PlatformOperationsService", () => {
  it("normalizes the explicit operator allowlist and returns only a capability boolean", async () => {
    const identities = { activeEmailForUser: vi.fn().mockResolvedValue("Operator@Example.com") };
    const analytics = { overview: vi.fn() };
    const service = new PlatformOperationsService(identities, analytics as never, [" operator@example.com "]);

    await expect(service.capabilities(42n)).resolves.toEqual({ platformOperations: true });
    expect(identities.activeEmailForUser).toHaveBeenCalledWith(42n);
    expect(analytics.overview).not.toHaveBeenCalled();
  });

  it("denies a company administrator who is not an explicit platform operator", async () => {
    const identities = { activeEmailForUser: vi.fn().mockResolvedValue("admin@customer.example") };
    const analytics = { overview: vi.fn() };
    const service = new PlatformOperationsService(identities, analytics as never, ["operator@example.com"]);

    await expect(service.capabilities(7n)).resolves.toEqual({ platformOperations: false });
    await expect(service.overview(7n, 30)).rejects.toEqual(new PlatformOperationsError("FORBIDDEN"));
    expect(analytics.overview).not.toHaveBeenCalled();
  });

  it("delegates an authorized overview with the fixed clock and selected window", async () => {
    const now = new Date("2026-08-28T06:00:00.000Z");
    const expected = { generatedAt: now.toISOString() };
    const analytics = { overview: vi.fn().mockResolvedValue(expected) };
    const service = new PlatformOperationsService(
      { activeEmailForUser: vi.fn().mockResolvedValue("operator@example.com") },
      analytics as never,
      ["operator@example.com"],
      () => now,
    );

    await expect(service.overview(9n, 90)).resolves.toBe(expected);
    expect(analytics.overview).toHaveBeenCalledWith({ now, days: 90 });
  });

  it("delegates a scoped analytics range only after platform-operator authorization", async () => {
    const now = new Date("2026-08-29T09:00:00.000Z");
    const expected = { generatedAt: now.toISOString(), scope: { company: null } };
    const analytics = { analytics: vi.fn().mockResolvedValue(expected) };
    const service = new PlatformOperationsService(
      { activeEmailForUser: vi.fn().mockResolvedValue("operator@example.com") },
      analytics as never,
      ["operator@example.com"],
      () => now,
    );
    const input = {
      from: new Date("2026-08-01T00:00:00.000Z"),
      toExclusive: new Date("2026-08-30T00:00:00.000Z"),
      comparison: "PREVIOUS_PERIOD" as const,
      comparisonFrom: new Date("2026-07-03T00:00:00.000Z"),
      comparisonToExclusive: new Date("2026-08-01T00:00:00.000Z"),
      companyId: 11n,
    };

    await expect(service.analyticsDashboard(9n, input)).resolves.toBe(expected);
    expect(analytics.analytics).toHaveBeenCalledWith({ ...input, now });
  });
});
