import { describe, expect, it, vi } from "vitest";
import { PosRecoveryService } from "../src/pos/recovery-service.js";
import { readPosRecoveryResult } from "../src/pos/recovery-result.js";
import { POS_RECOVERY_OPERATION, type PosRecoveryQueryPort } from "../src/pos/recovery-types.js";

const context = { companyId: 2n, userId: 1n };
const attemptKey = "550e8400-e29b-41d4-a716-446655440000";
const result = { id: "7", completedAt: "2026-08-31T08:30:00.000Z",
  invoice: { id: "8", documentNumber: "SI-0008", status: "POSTED", customerName: "Customer",
    total: "900719925474099.1234", baseTotal: "900719925474099.1234", generatedJournalEntryIds: ["10"] },
  receipt: { id: "9", documentNumber: "R-0009", status: "POSTED", generatedJournalEntryIds: ["11"] } };
const evidence = { ...context, operation: POS_RECOVERY_OPERATION, status: "COMPLETED", expiresAt: new Date(2000), responseBody: result };
function fixture() {
  const find = vi.fn<PosRecoveryQueryPort["find"]>().mockResolvedValue(evidence);
  const authorize = vi.fn().mockResolvedValue(context);
  const service = new PosRecoveryService({ find }, () => 1000);
  return { find, authorize, service };
}

describe("POS recovery read service", () => {
  it("looks up only the original user, company, fixed operation and input key, returning no correlation", async () => {
    const { find, authorize, service } = fixture();
    expect(await service.recover(authorize, attemptKey)).toEqual({ outcome: "CONFIRMED", result });
    expect(find).toHaveBeenCalledExactlyOnceWith({ ...context, operation: "COMPLETE_POS_CHECKOUT", attemptKey });
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(await service.recover(authorize, attemptKey))).not.toMatch(/attemptKey|companyId|userId|550e8400/);
  });
  it.each([null, { ...evidence, userId: 3n }, { ...evidence, companyId: 4n },
    { ...evidence, operation: "POST_RECEIPT" }, { ...evidence, status: "IN_PROGRESS" },
    { ...evidence, expiresAt: new Date(1000) }, { ...evidence, expiresAt: new Date(999) },
    { ...evidence, expiresAt: new Date(NaN) }, { ...evidence, responseBody: null }, { ...evidence, responseBody: {} },
  ])("missing, foreign, expired or incomplete evidence returns the same UNKNOWN", async value => {
    const { find, authorize, service } = fixture(); find.mockResolvedValue(value);
    expect(await service.recover(authorize, attemptKey)).toEqual({ outcome: "UNKNOWN" });
  });
  it.each([401, 403])("authorization %i fails before any result lookup", async status => {
    const { find, authorize, service } = fixture(); authorize.mockRejectedValue({ status });
    await expect(service.recover(authorize, attemptKey)).rejects.toEqual({ status }); expect(find).not.toHaveBeenCalled();
  });
  it("does not reveal a result if entitlement or permission is revoked during lookup", async () => {
    const { authorize, service } = fixture(); authorize.mockResolvedValueOnce(context).mockRejectedValueOnce({ status: 403 });
    await expect(service.recover(authorize, attemptKey)).rejects.toEqual({ status: 403 });
  });
  it("does not return the old company's result after session scope switches during lookup", async () => {
    const { authorize, service } = fixture(); authorize.mockResolvedValueOnce(context).mockResolvedValueOnce({ ...context, companyId: 9n });
    expect(await service.recover(authorize, attemptKey)).toEqual({ outcome: "UNKNOWN" });
  });
  it("cannot promote database unavailability to a known failed sale", async () => {
    const { find, authorize, service } = fixture(); find.mockRejectedValue(new Error("unavailable"));
    await expect(service.recover(authorize, attemptKey)).rejects.toThrow("unavailable");
  });
  it.each(["invalid", "", "company/key", "550e8400-e29b-11d4-a716-446655440000"])("rejects malformed correlation without echo or lookup: %s", async key => {
    const { find, authorize, service } = fixture(); expect(await service.recover(authorize, key)).toEqual({ outcome: "UNKNOWN" }); expect(find).not.toHaveBeenCalled();
  });
  it("never uses an invalid server clock to certify retained evidence", async () => {
    const service = new PosRecoveryService({ find: async () => evidence }, () => NaN);
    expect(await service.recover(async () => context, attemptKey)).toEqual({ outcome: "UNKNOWN" });
  });
});

describe("POS recovery committed-result projection", () => {
  it("strips unexpected fields at every level and preserves Decimal exactly", () => {
    expect(readPosRecoveryResult({ ...result, attemptKey, body: "secret", invoice: { ...result.invoice, password: "secret" }, receipt: { ...result.receipt, notes: "secret" } })).toEqual(result);
  });
  it.each(["1e2", "1.23", "-1.0000", "01.0000", "1000000000000000.0000", 12.0000])("rejects malformed money %s", total => {
    expect(readPosRecoveryResult({ ...result, invoice: { ...result.invoice, total } })).toBeNull();
  });
  it.each(["DRAFT", "CANCELLED", "REVERSED"])("requires original completed acknowledgement status, not %s", status => {
    expect(readPosRecoveryResult({ ...result, receipt: { ...result.receipt, status } })).toBeNull();
  });
  it("rejects partial identifiers, unbounded journal lists and malformed completion time", () => {
    expect(readPosRecoveryResult({ ...result, id: "0" })).toBeNull();
    expect(readPosRecoveryResult({ ...result, id: "18446744073709551616" })).toBeNull();
    expect(readPosRecoveryResult({ ...result, completedAt: "2026-02-30T08:30:00.000Z" })).toBeNull();
    expect(readPosRecoveryResult({ ...result, completedAt: "2026-08-31" })).toBeNull();
    expect(readPosRecoveryResult({ ...result, invoice: { ...result.invoice, generatedJournalEntryIds: [] } })).toBeNull();
    expect(readPosRecoveryResult({ ...result, receipt: { ...result.receipt, generatedJournalEntryIds: Array(101).fill("1") } })).toBeNull();
  });
});
