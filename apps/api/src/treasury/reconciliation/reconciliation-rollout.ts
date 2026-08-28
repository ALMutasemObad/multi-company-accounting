import { BankReconciliationError } from "./reconciliation-service.js";

export type BankReconciliationRolloutStage = "OFF" | "SHADOW" | "REVIEW" | "CLOSE";

const stageRank: Record<BankReconciliationRolloutStage, number> = {
  OFF: 0,
  SHADOW: 1,
  REVIEW: 2,
  CLOSE: 3,
};

export class BankReconciliationRolloutPolicy {
  private readonly companyIds: ReadonlySet<string>;
  private readonly allowAll: boolean;

  constructor(
    private readonly enabled: boolean,
    companyIds: string,
    private readonly stage: BankReconciliationRolloutStage,
  ) {
    this.allowAll = companyIds === "*";
    this.companyIds = new Set(companyIds.split(",").filter(Boolean));
  }

  capability(companyId: bigint) {
    const companyEnabled = this.enabled
      && this.stage !== "OFF"
      && (this.allowAll || this.companyIds.has(companyId.toString()));
    return {
      enabled: companyEnabled,
      stage: companyEnabled ? this.stage : "OFF" as const,
    };
  }

  require(companyId: bigint, minimum: Exclude<BankReconciliationRolloutStage, "OFF">) {
    const capability = this.capability(companyId);
    if (!capability.enabled || stageRank[capability.stage] < stageRank[minimum]) {
      throw new BankReconciliationError("FEATURE_NOT_AVAILABLE");
    }
  }
}
