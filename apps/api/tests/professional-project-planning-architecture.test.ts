import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (relativePath: string) =>
  readFile(new URL(`../src/${relativePath}`, import.meta.url), "utf8");

describe("professional project planning architecture", () => {
  it("owns only planning facts and derives actual time without foreign financial writes", async () => {
    const service = await source("projects/professional-project-planning-service.ts");
    const foreignWrite = /\.(?:approvalRequest|approvalDecision|purchaseInvoice|purchaseInvoiceLine|salesInvoice|salesInvoiceLine|receipt|payment|accountingDocument|journalEntry|journalLine|inventoryMovement|outboxEvent)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u;

    expect(service).not.toMatch(foreignWrite);
    expect(service).not.toContain("PostingEngine");
    expect(service).not.toContain("Outbox");
    expect(service).toContain("professionalTimeEntry.findMany");
    expect(service).not.toMatch(/professionalProjectTask\.(?:create|update|updateMany)\([\s\S]{0,500}\bactualMinutes\b/u);
  });

  it("locks the project aggregate before mutating the dependency graph", async () => {
    const service = await source("projects/professional-project-planning-service.ts");
    expect(service).toContain("SELECT id FROM professional_projects");
    expect(service).toContain("FOR UPDATE");
    expect(service).toContain("planningVersion: { increment: 1 }");
    expect(service).toContain("assertNoDependencyCycle");
    expect(service).toContain("isActive: false");
  });
});
