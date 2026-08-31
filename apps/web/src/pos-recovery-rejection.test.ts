import { describe, expect, it, vi } from "vitest";
import { ApiError } from "./api";
import { createPosRecoveryController } from "./pos-recovery-controller";
import { POS_RECOVERY_REJECTION_REASONS, posRecoveryKey, readPosRecoveryOutcome } from "./pos-recovery-model";
import { deferred, key1, key2, memoryStorage, recoveryScope, serializedLocks } from "./pos-recovery-test-fixtures";

const proof = { outcome: "REJECTED", rejection: { code: "POS_CHECKOUT_REJECTED", reason: "INSUFFICIENT_STOCK" } } as const;
const hint = () => new ApiError("stock", 422, "POS_CHECKOUT_REJECTED", "INSUFFICIENT_STOCK");
function fixture() {
  const { storage, values } = memoryStorage(); const read = vi.fn().mockResolvedValue({ outcome: "UNKNOWN" });
  const dependencies = { storage, read, exclusive: serializedLocks(), createKey: () => key1, now: () => 1000 };
  const controller = createPosRecoveryController(dependencies); controller.activate(recoveryScope);
  return { controller, dependencies, read, storage, values };
}

describe("POS rejection requires recovery endpoint proof", () => {
  it("uses a sealed HTTP rejection only as a one-shot lookup hint, never as proof by itself", async () => {
    const { controller, read, values } = fixture(); const send = vi.fn().mockRejectedValue(hint());
    await controller.begin(send);
    expect(read).toHaveBeenCalledExactlyOnceWith(key1, expect.any(AbortSignal));
    expect(send).toHaveBeenCalledTimes(1); expect(controller.getSnapshot().status).toBe("unknown");
    expect(await controller.reviewRejected()).toBe(false); expect(await controller.newSale()).toBe(false); expect(values.size).toBe(1);
  });

  it("keeps the marker after proof and releases only for explicit review, without financial retry", async () => {
    const { controller, read, values } = fixture(); read.mockResolvedValue(proof);
    const send = vi.fn().mockRejectedValue(hint()); await controller.begin(send);
    expect(controller.getSnapshot()).toEqual({ status: "rejected", rejection: proof.rejection });
    expect(values.size).toBe(1); expect(await controller.newSale()).toBe(false); expect(await controller.begin(send)).toBe(false);
    expect(await controller.reviewRejected()).toBe(true); expect(controller.getSnapshot().status).toBe("ready");
    expect(values.size).toBe(0); expect(send).toHaveBeenCalledTimes(1); expect(read).toHaveBeenCalledTimes(1);
  });

  it("recovers a lost sealed rejection after reload through read only", async () => {
    const { controller, dependencies, read, values } = fixture();
    const send = vi.fn().mockRejectedValue(new TypeError("network")); await controller.begin(send); controller.dispose();
    read.mockResolvedValue(proof); const fresh = createPosRecoveryController(dependencies); fresh.activate(recoveryScope);
    expect(fresh.getSnapshot().status).toBe("unknown"); expect(read).not.toHaveBeenCalled();
    await fresh.check(); expect(fresh.getSnapshot()).toEqual({ status: "rejected", rejection: proof.rejection });
    expect([...values.values()].join()).not.toMatch(/rejection|reason|STOCK|invoice|body/);
    expect(await fresh.reviewRejected()).toBe(true); expect(send).toHaveBeenCalledTimes(1);
  });

  it.each([new ApiError("stock", 422, "INSUFFICIENT_STOCK"), new ApiError("stock", 503, "POS_CHECKOUT_REJECTED"),
    { status: 422, code: "POS_CHECKOUT_REJECTED" }])("does not auto-read arbitrary failure %j", async cause => {
    const { controller, read } = fixture(); await controller.begin(async () => { throw cause; });
    expect(controller.getSnapshot().status).toBe("unknown"); expect(read).not.toHaveBeenCalled();
  });

  it.each([hint(), new TypeError("network")])("does not treat a failed recovery HTTP request as proof %j", async cause => {
    const { controller, read } = fixture(); read.mockRejectedValue(cause);
    await controller.begin(async () => { throw hint(); });
    expect(controller.getSnapshot().status).toBe("unknown"); expect(read).toHaveBeenCalledTimes(1);
    expect(await controller.reviewRejected()).toBe(false);
  });

  it.each([{ userId: "3" }, { companyId: "3" }, { canCheckout: false }])("discards late rejection proof after scope change %j", async change => {
    const { controller, read, values } = fixture(); const result = deferred<unknown>(); const entered = deferred<void>();
    read.mockImplementation(() => { entered.resolve(); return result.promise; });
    const sending = controller.begin(async () => { throw hint(); }); await entered.promise;
    controller.activate({ ...recoveryScope, ...change }); result.resolve(proof); await sending;
    expect(controller.getSnapshot().status).not.toBe("rejected"); expect(await controller.reviewRejected()).toBe(false);
    expect(values.has(posRecoveryKey(recoveryScope))).toBe(true);
  });

  it("does not remove a replaced marker while reviewing a rejected attempt", async () => {
    const { controller, read, values } = fixture(); read.mockResolvedValue(proof);
    await controller.begin(async () => { throw hint(); });
    values.set(posRecoveryKey(recoveryScope), JSON.stringify({ version: 1, attemptKey: key2, startedAt: 1000 }));
    expect(await controller.reviewRejected()).toBe(false); expect(controller.getSnapshot()).toEqual({ status: "blocked", reason: "storage" });
    expect(values.get(posRecoveryKey(recoveryScope))).toContain(key2);
  });

  it.each(POS_RECOVERY_REJECTION_REASONS)("accepts the bounded server reason %s", reason => {
    expect(readPosRecoveryOutcome({ ...proof, rejection: { ...proof.rejection, reason } }))
      .toEqual({ outcome: "REJECTED", rejection: { code: "POS_CHECKOUT_REJECTED", reason } });
  });
  it.each([{ ...proof, result: { id: "8" } }, { ...proof, rejection: { ...proof.rejection, companyId: "secret" } }])("fails closed for contradictory or extra rejection fields", value => {
    expect(readPosRecoveryOutcome(value)).toEqual({ outcome: "UNKNOWN" });
  });
  it.each(["DEFAULT", "IDEMPOTENCY_MISMATCH", "IDEMPOTENCY_IN_PROGRESS", "INTERNAL_ERROR", "customer@email.invalid", null])("rejects unproved reason %s", reason => {
    expect(readPosRecoveryOutcome({ ...proof, rejection: { ...proof.rejection, reason } })).toEqual({ outcome: "UNKNOWN" });
  });
});
