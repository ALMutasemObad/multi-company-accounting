import type { Prisma } from "@prisma/client";
import { DEFAULT_CHART_TEMPLATE_CODE } from "../accounts/default-chart-template.js";
import { isSupportedCompanyCountry } from "./company-profile-policy.js";

export class BusinessProfileProvisioningError extends Error {}

export type InitialBusinessProfileInput = {
  phone: string;
  countryCode: string;
  primaryBusinessActivityCode: string;
  preferredLocale: string;
  initialChartTemplateCode: string;
};

export async function provisionCompanyBusinessProfile(
  tx: Prisma.TransactionClient,
  companyId: bigint,
  companyName: string,
  input?: InitialBusinessProfileInput,
) {
  const countryCode = input?.countryCode.trim().toUpperCase() ?? null;
  if (countryCode && !isSupportedCompanyCountry(countryCode)) throw new BusinessProfileProvisioningError("INVALID_COUNTRY");
  const activity = input ? await tx.businessActivity.findUnique({
    where: { code: input.primaryBusinessActivityCode },
    select: { id: true, isActive: true },
  }) : null;
  if (input && !activity?.isActive) throw new BusinessProfileProvisioningError("INVALID_ACTIVITY");

  return tx.companyProfile.upsert({
    where: { companyId },
    update: input ? {
      tradeName: companyName,
      phone: input.phone,
      countryCode,
      preferredLocale: input.preferredLocale,
      primaryBusinessActivityId: activity!.id,
      initialChartTemplateCode: input.initialChartTemplateCode,
    } : { tradeName: companyName },
    create: {
      companyId,
      tradeName: companyName,
      phone: input?.phone ?? null,
      countryCode,
      preferredLocale: input?.preferredLocale ?? null,
      primaryBusinessActivityId: activity?.id ?? null,
      initialChartTemplateCode: input?.initialChartTemplateCode ?? DEFAULT_CHART_TEMPLATE_CODE,
    },
  });
}
