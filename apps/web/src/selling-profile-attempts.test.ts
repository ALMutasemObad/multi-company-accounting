import { describe, expect, it, vi } from "vitest";
import { getSellingProfileAttempt, isUnresolvedSellingAttempt, sellingProfileAttemptFields,
  sellingProfileAttemptScope, sendSellingProfileAttempt, SELLING_PROFILE_ATTEMPT_LIMIT } from "./selling-profile-attempts";
import type { SellingProfileSaveCommand, SellingProfileSaveOutcome } from "./selling-profile-editor-model";
const command: SellingProfileSaveCommand = { kind: "create", itemId: "9", body: { unitPrice: "2.0000", currencyId: "3", revenueAccountId: "4", taxRateId: null } };
const saved = { id: "20", unitPrice: "2.0000", currencyId: "3", currencyCode: "SAR", revenueAccountId: "4", taxRateId: null, version: 1, isActive: true };

describe("selling profile uncertain-write journal", () => {
  it("keeps one frozen key/body across read refresh and component remount", async () => {
    const scope = sellingProfileAttemptScope("user1:company1", "9");
    const sender = vi.fn().mockResolvedValue({ status: "unknown" });
    await sendSellingProfileAttempt(scope, command, sender);
    const first = getSellingProfileAttempt(scope)!;
    expect(Object.isFrozen(first.command.body)).toBe(true);
    // A GET may show a newer version/price, but does not prove which write committed.
    expect(sellingProfileAttemptFields({ ...saved, version: 5, unitPrice: "8.0000" }, getSellingProfileAttempt(scope)).unitPrice).toBe("2.0000");
    await expect(sendSellingProfileAttempt(scope, { ...command, body: { ...command.body, unitPrice: "8.0000" } }, sender))
      .rejects.toThrow("UNRESOLVED_SELLING_PROFILE_WRITE");
    sender.mockResolvedValue({ status: "saved", profile: saved });
    await sendSellingProfileAttempt(scope, null, sender, true);
    expect(sender).toHaveBeenCalledTimes(2);
    expect(sender.mock.calls[1]).toEqual(sender.mock.calls[0]);
    expect(getSellingProfileAttempt(scope)?.status).toBe("saved");
  });
  it("attributes late completion only to the original user/company/item", async () => {
    const original = sellingProfileAttemptScope("user1:companyA", "9");
    const other = sellingProfileAttemptScope("user1:companyB", "9");
    let finish!: (outcome: SellingProfileSaveOutcome) => void;
    const pending = sendSellingProfileAttempt(original, command, () => new Promise(resolve => { finish = resolve; }));
    expect(isUnresolvedSellingAttempt(getSellingProfileAttempt(original))).toBe(true);
    expect(getSellingProfileAttempt(other)).toBeNull();
    finish({ status: "saved", profile: saved }); await pending;
    expect(getSellingProfileAttempt(original)?.status).toBe("saved"); expect(getSellingProfileAttempt(other)).toBeNull();
  });
  it("does not send concurrently and treats transport throws as unknown", async () => {
    const scope = sellingProfileAttemptScope("user2:company1", "9");
    let fail!: () => void;
    const sender = vi.fn(() => new Promise<SellingProfileSaveOutcome>((_resolve, reject) => { fail = () => reject(new Error("NETWORK")); }));
    const pending = sendSellingProfileAttempt(scope, command, sender);
    await sendSellingProfileAttempt(scope, command, sender); expect(sender).toHaveBeenCalledTimes(1);
    fail(); await pending;
    expect(getSellingProfileAttempt(scope)?.status).toBe("unknown");
  });
  it("does not evict unresolved attempts when the bounded journal is full", async () => {
    const sender = async (): Promise<SellingProfileSaveOutcome> => ({ status: "unknown" });
    let capacityReached = false;
    for (let index = 0; index <= SELLING_PROFILE_ATTEMPT_LIMIT; index += 1) {
      try { await sendSellingProfileAttempt(sellingProfileAttemptScope("capacity-user:company", String(index)), command, sender); }
      catch (error) { expect(error).toMatchObject({ message: "SELLING_PROFILE_ATTEMPT_CAPACITY" }); capacityReached = true; break; }
    }
    expect(capacityReached).toBe(true);
    expect(getSellingProfileAttempt(sellingProfileAttemptScope("user2:company1", "9"))?.status).toBe("unknown");
  });
});
