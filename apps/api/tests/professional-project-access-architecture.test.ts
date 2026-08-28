import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (name: string) => readFile(new URL(`../src/projects/${name}`, import.meta.url), "utf8");

describe("professional ethical-wall architecture", () => {
  it("uses one fail-closed policy in projects, planning, and billing", async () => {
    const [policy, projects, planning, billing] = await Promise.all([
      source("professional-project-access-policy.ts"),
      source("professional-project-service.ts"),
      source("professional-project-planning-service.ts"),
      source("professional-billing-service.ts"),
    ]);
    expect(policy).toContain('accessMode: "COMPANY"');
    expect(policy).toContain("members: { some:");
    expect(policy).toContain("accessGrants: { some:");
    for (const service of [projects, planning, billing]) {
      expect(service).toContain("ProfessionalProjectAccessPolicy");
      expect(service).toContain("this.access");
    }
  });

  it("does not write ledger, inventory, invoice, or outbox facts", async () => {
    const service = await source("professional-project-access-service.ts");
    expect(service).not.toMatch(/\.(?:journalEntry|journalLine|accountingDocument|inventoryMovement|inventoryBalance|salesInvoice|outboxEvent)\.(?:create|update|upsert|delete)/u);
    expect(service).not.toContain("PostingEngine");
    expect(service).not.toContain("Outbox");
    expect(service).toContain("this.people.findActiveInCompany");
  });
});
