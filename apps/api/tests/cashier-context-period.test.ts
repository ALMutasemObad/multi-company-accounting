import type { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { CashierContextPeriodAdapter } from "../src/core-accounting/cashier-context-period-adapter.js";
import { cashierContextDocumentDay, classifyCashierContextPeriods, CashierContextPeriodError, type CashierContextPeriodRow } from "../src/core-accounting/cashier-context-period-policy.js";

const row = (patch: Partial<CashierContextPeriodRow> = {}): CashierContextPeriodRow => ({ id: 81n, name: "August", status: "OPEN", version: 3,
  startDate: new Date("2026-08-01T00:00:00Z"), endDate: new Date("2026-08-31T00:00:00Z"), ...patch });

describe("Core Accounting cashier context period advisory (unit, no DB)", () => {
  it.each(["2026-08-31", "2024-02-29", "2000-02-29", "0001-01-01", "9999-12-31"])("accepts real ISO day %s", (date) => {
    expect(cashierContextDocumentDay(date).toISOString()).toBe(`${date}T00:00:00.000Z`);
  });
  it.each(["2026-02-29", "1900-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-08-00", "0000-01-01", "2026-8-1", "26-08-31", "2026-08-31T00:00:00Z", "2026-08-31+03:00", " 2026-08-31", "", "garbage"])("rejects invalid or ambiguous day %s", (date) => {
    expect(() => cashierContextDocumentDay(date)).toThrow(CashierContextPeriodError);
  });
  it("distinguishes missing, closed and overlap without exposing other period details", () => {
    expect(classifyCashierContextPeriods("2026-08-31", [])).toEqual({ documentDate: "2026-08-31", status: "MISSING" });
    expect(classifyCashierContextPeriods("2026-08-31", [row({ status: "CLOSED" })])).toEqual({ documentDate: "2026-08-31", status: "CLOSED" });
    for (const status of ["OPEN", "CLOSED", "REOPENED"] as const) {
      expect(classifyCashierContextPeriods("2026-08-31", [row(), row({ id: 82n, status })])).toEqual({ documentDate: "2026-08-31", status: "AMBIGUOUS" });
    }
  });
  it.each(["OPEN", "REOPENED"] as const)("returns string ids and explicit %s period metadata, without money", (status) => {
    expect(classifyCashierContextPeriods("2026-08-31", [row({ id: 9007199254740993123n, status })])).toEqual({ documentDate: "2026-08-31", status: "RESOLVED", period: {
      id: "9007199254740993123", name: "August", startDate: "2026-08-01", endDate: "2026-08-31", status, version: 3,
    } });
  });
  it("queries only the actor's company and date, includes CLOSED and bounds overlap detection at two", async () => {
    const findMany = vi.fn(async () => [row()]);
    const tx = { fiscalPeriod: { findMany } } as unknown as Prisma.TransactionClient;
    const adapter = new CashierContextPeriodAdapter();
    for (const companyId of [7n, 8n]) {
      await adapter.resolve(tx, { userId: 17n, companyId }, "2026-08-31");
      expect(findMany).toHaveBeenLastCalledWith({ where: { companyId, startDate: { lte: new Date("2026-08-31T00:00:00Z") }, endDate: { gte: new Date("2026-08-31T00:00:00Z") } },
        select: { id: true, name: true, startDate: true, endDate: true, status: true, version: true }, orderBy: [{ startDate: "asc" }, { id: "asc" }], take: 2 });
    }
    expect(findMany).toHaveBeenCalledTimes(2);
  });
  it("rejects invalid dates before IO and propagates owner-query failure, without fallback/retry", async () => {
    const findMany = vi.fn().mockRejectedValue(new Error("database unavailable"));
    const tx = { fiscalPeriod: { findMany } } as unknown as Prisma.TransactionClient;
    const adapter = new CashierContextPeriodAdapter();
    await expect(adapter.resolve(tx, { companyId: 7n, userId: 1n }, "2026-02-30")).rejects.toThrow(CashierContextPeriodError);
    expect(findMany).not.toHaveBeenCalled();
    await expect(adapter.resolve(tx, { companyId: 7n, userId: 1n }, "2026-08-31")).rejects.toThrow("database unavailable");
    expect(findMany).toHaveBeenCalledTimes(1);
  });
});
