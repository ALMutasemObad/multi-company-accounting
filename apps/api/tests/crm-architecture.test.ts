import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFile(new URL(`../src/${path}`, import.meta.url), "utf8");
const projectFile = (path: string) => readFile(new URL(`../../../${path}`, import.meta.url), "utf8");

describe("CRM owner boundaries", () => {
  it("owns only CRM facts and delegates customer, workforce and currency decisions", async () => {
    const service = await source("crm/crm-service.ts");
    expect(service).toContain("this.customerProvisioning.provisionCustomer(tx, context");
    expect(service).toContain("this.customers.findActiveCustomer(tx, context.companyId");
    expect(service).toContain("this.workforce.findAssignable(tx, context.companyId");
    expect(service).toContain("this.currencies.findEnabled(tx, context.companyId");
    expect(service).not.toMatch(/\.(?:customer|employee|companyCurrency|professionalProject)\.(?:create|createMany|update|updateMany|delete|deleteMany|upsert)\s*\(/u);
    expect(service).not.toContain("ProfessionalProjectService");
    expect(service).not.toContain("PostingEngine");
  });

  it("locks and converts the lead in the same idempotent transaction without auditing contact data", async () => {
    const service = await source("crm/crm-service.ts");
    const conversion = service.slice(service.indexOf("convertLead("), service.indexOf("async listOpportunities("));
    expect(conversion).toContain("this.command(context, \"crm.convert-lead\"");
    expect(conversion).toContain("await this.lockLead(tx, context.companyId, publicId)");
    expect(conversion).toContain("this.customerProvisioning.provisionCustomer(tx, context");
    expect(conversion).toContain("convertedCustomerId: customer.customerId");
    const auditedDetails = conversion.slice(conversion.indexOf('"CRM_LEAD_CONVERTED"'), conversion.indexOf("return { leadId:"));
    expect(auditedDetails).not.toMatch(/(?:phone|email|nameAr|nameEn|taxNumber)\s*:/u);
  });

  it("keeps professional case creation explicitly absent until F2", async () => {
    const [router, openApi, page] = await Promise.all([
      source("crm/crm-router.ts"),
      projectFile("packages/contracts/openapi.yaml"),
      projectFile("apps/web/src/CrmPage.tsx"),
    ]);
    expect(router).not.toMatch(/professional-project|case|matter/iu);
    expect(openApi).toContain("إنشاء القضايا محجوب حتى تنفيذ فحص التعارض F2");
    expect(page).toContain('t("crm.legalBlocked")');
    expect(page).not.toMatch(/\/professional-projects/u);
  });
});
