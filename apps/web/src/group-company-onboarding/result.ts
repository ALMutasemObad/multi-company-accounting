import { RequestError } from "../request-scope";

export type GroupCompanyResult = { organizationId: string; company: { id: string; name: string; code: string; timezone: string; baseCurrencyCode: string } };

export function confirmedGroupCompanyResult(value: unknown, organizationId: string): GroupCompanyResult {
  const object = (input: unknown): input is Record<string, unknown> => Boolean(input) && typeof input === "object" && !Array.isArray(input);
  if (!object(value) || value.organizationId !== organizationId || !object(value.company)) throw new RequestError("response");
  const company = value.company;
  if (typeof company.id !== "string" || !/^[1-9][0-9]*$/.test(company.id)
    || typeof company.name !== "string" || !company.name
    || typeof company.code !== "string" || !company.code
    || typeof company.timezone !== "string" || !company.timezone
    || typeof company.baseCurrencyCode !== "string" || !/^[A-Z]{3}$/.test(company.baseCurrencyCode)) throw new RequestError("response");
  return { organizationId, company: { id: company.id, name: company.name, code: company.code, timezone: company.timezone, baseCurrencyCode: company.baseCurrencyCode } };
}
