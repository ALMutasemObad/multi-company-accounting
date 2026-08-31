/** Internal application port; HTTP schemas remain owned by OpenAPI. */
export const POS_RECOVERY_OPERATION = "COMPLETE_POS_CHECKOUT" as const;

export type PosRecoveryResult = {
  id: string;
  completedAt: string;
  invoice: {
    id: string; documentNumber: string; status: "POSTED"; customerName: string;
    total: string; baseTotal: string; generatedJournalEntryIds: string[];
  };
  receipt: {
    id: string; documentNumber: string; status: "POSTED"; generatedJournalEntryIds: string[];
  };
};

export type PosRecoveryOutcome = { outcome: "UNKNOWN" }
  | { outcome: "CONFIRMED"; result: PosRecoveryResult };

export type PosRecoveryLookup = {
  companyId: bigint; userId: bigint;
  operation: typeof POS_RECOVERY_OPERATION; attemptKey: string;
};

/** Implement at the Infrastructure owner, never by querying its table inside POS.
 * Hash the key and use companyId_userId_operation_keyHash, including original userId.
 * Do not log the key, fingerprint or response. A missing record is not a failed sale.
 */
export interface PosRecoveryQueryPort {
  find(input: PosRecoveryLookup): Promise<null | {
    companyId: bigint; userId: bigint; operation: string; status: string;
    expiresAt: Date; responseBody: unknown;
  }>;
}
