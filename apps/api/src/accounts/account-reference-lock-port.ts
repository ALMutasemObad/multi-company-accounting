import type { Prisma } from "@prisma/client";

export type AccountReferenceEligibilityFailure = "NOT_FOUND" | "INACTIVE" | "NON_POSTING" | "HAS_CHILDREN";

export type AccountReferenceEligibility =
  | { eligible: true; accountId: bigint; companyId: bigint }
  | { eligible: false; reason: AccountReferenceEligibilityFailure };

export interface AccountReferenceLockPort {
  lockPostingAccount(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    accountId: bigint,
  ): Promise<AccountReferenceEligibility>;
}
