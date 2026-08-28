import { afterAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { PlatformOperationsService } from "../src/platform-operations/platform-operations-service.js";
import { PrismaPlatformAnalyticsQueryAdapter } from "../src/platform-operations/prisma-platform-analytics-query-adapter.js";
import { PlatformIdentityQueryAdapter } from "../src/users/platform-identity-query-adapter.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const prisma = enabled ? createDatabase(process.env.DATABASE_URL ?? "") : null;

describe.runIf(enabled)("platform operations with MariaDB", () => {
  afterAll(async () => {
    await prisma!.$disconnect();
  });

  it("aggregates all tenants without returning personal or financial detail", async () => {
    const admin = await prisma!.user.findUniqueOrThrow({
      where: { emailNormalized: "admin@mcap.local" },
      select: { id: true },
    });
    const service = new PlatformOperationsService(
      new PlatformIdentityQueryAdapter(prisma!),
      new PrismaPlatformAnalyticsQueryAdapter(prisma!),
      ["admin@mcap.local"],
      () => new Date("2026-08-28T06:00:00.000Z"),
    );

    const result = await service.overview(admin.id, 30);

    expect(result.metrics.totalCompanies).toBeGreaterThan(0);
    expect(result.metrics.totalUsers).toBeGreaterThan(0);
    expect(result.modules).toHaveLength(9);
    expect(result.trends).toHaveLength(6);
    expect(result.topCompanies.length).toBeLessThanOrEqual(5);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/email|displayName|ipAddress|userAgent|password|amount/iu);
    expect(serialized).not.toContain("@");
  });
});
