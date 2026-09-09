import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { RegistrationService } from "../src/registration/registration-service.js";
import type { CompanyProvisioningPort } from "../src/platform/company-provisioning-ports.js";

describe("registration remains non-enumerating when directing users to sign in", () => {
  it("returns the identical accepted state without scheduling mail for an existing identity", async () => {
    const input = { email: "owner@example.test", password: "a-long-test-password", displayName: "Owner", organizationName: "Group", companyName: "Company", phone: "+966500000000", countryCode: "SA", primaryBusinessActivityCode: "PROFESSIONAL_SERVICES", timezone: "UTC", baseCurrencyCode: "SAR", locale: "ar" as const, chartTemplateCode: "PROFESSIONAL_SERVICES" };
    const responses: unknown[] = [];
    for (const exists of [false, true]) {
      const append = vi.fn().mockResolvedValue(undefined);
      const upsert = vi.fn().mockResolvedValue({ id: 1n, publicId: "public", deliveryGeneration: 1 });
      const tx = { registrationRequest: { upsert }, registrationEvent: { create: vi.fn() } };
      const prisma = { registrationRequest: { deleteMany: vi.fn() }, $transaction: async (work: (client: typeof tx) => unknown) => work(tx) } as unknown as PrismaClient;
      const service = new RegistrationService(prisma, {} as CompanyProvisioningPort, { append }, {
        identity: { identityExists: async () => exists }, tenant: {
          listGlobalCurrencies: async () => [], listCompanyCountries: () => [], listBusinessActivities: async () => [],
          isActiveGlobalCurrency: async () => true, isSupportedCompanyCountry: () => true, isActiveBusinessActivity: async () => true,
        },
        accounting: { listChartTemplates: () => [], isAllowedOnboardingChartTemplate: () => true }, security: { recordCompletion: async () => undefined },
      }, { passwordHasher: async () => "prepared-test-hash" });
      responses.push(await service.start(input));
      expect(append).toHaveBeenCalledTimes(exists ? 0 : 1);
      expect(upsert).toHaveBeenCalledTimes(exists ? 0 : 1);
    }
    expect(responses).toEqual([{ status: "PENDING_VERIFICATION" }, { status: "PENDING_VERIFICATION" }]);
  });
});
