/** Pure transition guards. Persistence must apply these under a versioned database lock. */
export type PayrollRunState = "DRAFT" | "CALCULATED" | "AWAITING_APPROVAL" | "APPROVED";
export type PayrollRunRecord = Readonly<{
  companyId: string;
  makerUserId: string;
  state: PayrollRunState;
  version: number;
  snapshotHash: string | null;
  approvedByUserId: string | null;
}>;
export type PayrollRunAction = "CALCULATE" | "SUBMIT" | "APPROVE" | "REJECT";
export type PayrollRunCommand = Readonly<{
  action: PayrollRunAction;
  companyId: string;
  actorUserId: string;
  expectedVersion: number;
  snapshotHash?: string;
  actorIsOwner?: boolean;
}>;

export class PayrollRunPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "PayrollRunPolicyError";
  }
}

const fail = (code: string): never => { throw new PayrollRunPolicyError(code); };
const validHash = (hash: unknown): hash is string => typeof hash === "string" && /^[0-9a-f]{64}$/.test(hash);

export function transitionPayrollRun(run: PayrollRunRecord, command: PayrollRunCommand): PayrollRunRecord {
  if (command.companyId !== run.companyId) fail("COMPANY_MISMATCH");
  if (!Number.isSafeInteger(command.expectedVersion) || command.expectedVersion !== run.version) fail("VERSION_CONFLICT");
  if (!command.actorUserId.trim()) fail("ACTOR_REQUIRED");
  const maker = command.actorUserId === run.makerUserId;
  const checker = Boolean(command.actorIsOwner) && !maker;
  if (command.action === "CALCULATE") {
    if (!maker) fail("MAKER_REQUIRED");
    if (run.state !== "DRAFT" && run.state !== "CALCULATED") fail("INVALID_TRANSITION");
    const snapshotHash = command.snapshotHash;
    if (!validHash(snapshotHash)) throw new PayrollRunPolicyError("SNAPSHOT_REQUIRED");
    return Object.freeze({ ...run, state: "CALCULATED", version: run.version + 1,
      snapshotHash, approvedByUserId: null });
  }
  if (command.action === "SUBMIT") {
    if (!maker) fail("MAKER_REQUIRED");
    if (run.state !== "CALCULATED") fail("INVALID_TRANSITION");
    if (!validHash(command.snapshotHash) || command.snapshotHash !== run.snapshotHash) fail("SNAPSHOT_MISMATCH");
    return Object.freeze({ ...run, state: "AWAITING_APPROVAL", version: run.version + 1 });
  }
  if (command.action === "APPROVE" || command.action === "REJECT") {
    if (!checker) fail("OWNER_CHECKER_REQUIRED");
    if (run.state !== "AWAITING_APPROVAL") fail("INVALID_TRANSITION");
    if (!validHash(command.snapshotHash) || command.snapshotHash !== run.snapshotHash) fail("SNAPSHOT_MISMATCH");
    return command.action === "APPROVE"
      ? Object.freeze({ ...run, state: "APPROVED", version: run.version + 1,
        approvedByUserId: command.actorUserId })
      : Object.freeze({ ...run, state: "DRAFT", version: run.version + 1,
        snapshotHash: null, approvedByUserId: null });
  }
  return fail("INVALID_ACTION");
}
