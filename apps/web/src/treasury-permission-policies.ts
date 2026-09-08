import type { PermissionPolicy } from "./authorization";

const permission = <Code extends string>(code: Code) =>
  ({ permission: code }) as const satisfies PermissionPolicy;

export const treasuryPermissionPolicies = {
  view: permission("cash_bank_accounts.view"),
  manage: permission("cash_bank_accounts.manage"),
} as const;

export function ledgerAccountReferenceLabel(reference: { code: string; name: string } | null | undefined) {
  return reference ? `${reference.code} — ${reference.name}` : "—";
}
