import type { Prisma } from "@prisma/client";
import {
  ACCOUNT_USAGE_CATEGORIES_BY_OWNER,
  ACCOUNT_USAGE_OWNER_ORDER,
  type AccountUsageCategory,
  type AccountUsageFact,
  type AccountUsageOwner,
  type AccountUsageQueryPort,
} from "./account-usage-query-port.js";

export type AccountUsageGuardErrorReason =
  | "DUPLICATE_OWNER"
  | "INCOMPLETE_COMPOSITION"
  | "OWNER_QUERY_FAILED"
  | "INVALID_OWNER_RESULT";

export class AccountUsageGuardError extends Error {
  constructor(
    public readonly reason: AccountUsageGuardErrorReason,
    public readonly owner?: AccountUsageOwner,
    options?: { cause?: unknown },
  ) {
    super(reason, options);
  }
}

export type AccountUsageComposition = {
  complete: boolean;
  missingOwners: AccountUsageOwner[];
  duplicateOwners: AccountUsageOwner[];
  enforcementEnabled: boolean;
};

declare const activatedAccountUsageGuard: unique symbol;
export type ActivatedAccountUsageGuard = AccountUsageGuard & {
  readonly [activatedAccountUsageGuard]: true;
};

export class AccountUsageGuard {
  private readonly portsByOwner = new Map<AccountUsageOwner, AccountUsageQueryPort[]>();
  private enforcementEnabled = false;

  constructor(ports: readonly AccountUsageQueryPort[]) {
    for (const port of ports) {
      const registered = this.portsByOwner.get(port.owner) ?? [];
      registered.push(port);
      this.portsByOwner.set(port.owner, registered);
    }
    const composition = this.completeness();
    if (composition.duplicateOwners.length > 0) {
      throw new AccountUsageGuardError("DUPLICATE_OWNER", composition.duplicateOwners[0]);
    }
    if (composition.missingOwners.length > 0) {
      throw new AccountUsageGuardError("INCOMPLETE_COMPOSITION", composition.missingOwners[0]);
    }
  }

  completeness(): AccountUsageComposition {
    const missingOwners = ACCOUNT_USAGE_OWNER_ORDER.filter((owner) => !this.portsByOwner.has(owner));
    const duplicateOwners = ACCOUNT_USAGE_OWNER_ORDER.filter((owner) => (this.portsByOwner.get(owner)?.length ?? 0) > 1);
    return {
      complete: missingOwners.length === 0 && duplicateOwners.length === 0,
      missingOwners: [...missingOwners],
      duplicateOwners: [...duplicateOwners],
      enforcementEnabled: this.enforcementEnabled && missingOwners.length === 0 && duplicateOwners.length === 0,
    };
  }

  activate(): ActivatedAccountUsageGuard {
    this.enforcementEnabled = true;
    return this as unknown as ActivatedAccountUsageGuard;
  }

  async inspect(tx: Prisma.TransactionClient, companyId: bigint, accountId: bigint) {
    const facts: AccountUsageFact[] = [];
    for (const owner of ACCOUNT_USAGE_OWNER_ORDER) {
      const port = this.portsByOwner.get(owner)![0]!;
      let ownerFacts: readonly AccountUsageFact[];
      try {
        ownerFacts = await port.queryAccountUsage(tx, companyId, accountId);
      } catch (cause) {
        throw new AccountUsageGuardError("OWNER_QUERY_FAILED", owner, { cause });
      }
      facts.push(...this.validateOwnerResult(owner, ownerFacts));
    }
    return {
      inUse: facts.some((fact) => fact.count > 0 || fact.hasImmutableHistory),
      facts,
    };
  }

  private validateOwnerResult(owner: AccountUsageOwner, facts: readonly AccountUsageFact[]) {
    const expected = ACCOUNT_USAGE_CATEGORIES_BY_OWNER[owner] as readonly AccountUsageCategory[];
    const byCategory = new Map<AccountUsageCategory, AccountUsageFact>();
    for (const fact of facts) {
      if (
        !expected.includes(fact.category)
        || byCategory.has(fact.category)
        || !Number.isSafeInteger(fact.count)
        || fact.count < 0
        || typeof fact.hasImmutableHistory !== "boolean"
      ) {
        throw new AccountUsageGuardError("INVALID_OWNER_RESULT", owner);
      }
      byCategory.set(fact.category, fact);
    }
    if (byCategory.size !== expected.length) {
      throw new AccountUsageGuardError("INVALID_OWNER_RESULT", owner);
    }
    return expected.map((category) => byCategory.get(category)!);
  }
}
