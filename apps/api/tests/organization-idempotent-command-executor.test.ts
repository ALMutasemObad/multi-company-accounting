import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { OrganizationIdempotentCommandExecutor } from "../src/platform/organization-idempotent-command-executor.js";

const fingerprint = "canonical-request";
const saved = { requestFingerprint: new Uint8Array(createHash("sha256").update(fingerprint).digest()), status: "COMPLETED", responseBody: { id: "9" }, expiresAt: new Date("2020-01-01") };
function fixture() {
  const store = { findUnique: vi.fn(), create: vi.fn().mockResolvedValue({ id: 1n }), update: vi.fn() };
  const tx = { organizationIdempotencyRecord: store };
  const prisma = { $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)) } as unknown as PrismaClient;
  const authorize = vi.fn().mockResolvedValue(undefined);
  const decode = (body: Prisma.JsonValue) => {
    if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.id !== "string") throw new Error("Invalid saved result");
    return { id: body.id };
  };
  const options = { organizationId: 2n, userId: 3n, operation: "CREATE_GROUP_COMPANY", key: "test-idempotency-key", fingerprint, authorize, decode };
  return { executor: new OrganizationIdempotentCommandExecutor(prisma), options, store, authorize };
}
describe("organization idempotency exceptional paths", () => {
  it("reauthorizes in a fresh transaction after a unique race", async () => {
    const f = fixture();
    f.store.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(saved);
    f.store.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique race", { code: "P2002", clientVersion: "7" }));
    const work = vi.fn();
    expect(await f.executor.execute(f.options, work)).toEqual({ id: "9" });
    expect(f.authorize).toHaveBeenCalledTimes(2);
    expect(work).not.toHaveBeenCalled();
  });
  it("does not disclose the winner after authorization is revoked during a unique race", async () => {
    const f = fixture();
    f.store.findUnique.mockResolvedValueOnce(null);
    f.store.create.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("unique race", { code: "P2002", clientVersion: "7" }));
    f.authorize.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("revoked"));
    await expect(f.executor.execute(f.options, vi.fn())).rejects.toThrow("revoked");
    expect(f.store.findUnique).toHaveBeenCalledTimes(1);
  });
  it("does not reset an expired key or execute work when replaying", async () => {
    const f = fixture(); f.store.findUnique.mockResolvedValue(saved);
    const work = vi.fn();
    expect(await f.executor.execute(f.options, work)).toEqual({ id: "9" });
    expect(work).not.toHaveBeenCalled(); expect(f.store.create).not.toHaveBeenCalled();
    await expect(f.executor.execute({ ...f.options, fingerprint: "different" }, work)).rejects.toMatchObject({ reason: "IDEMPOTENCY_MISMATCH" });
  });
  it("rejects invalid saved results without pretending success", async () => {
    const f = fixture(); f.store.findUnique.mockResolvedValue({ ...saved, responseBody: { secret: "invalid" } });
    await expect(f.executor.execute(f.options, vi.fn())).rejects.toThrow("Invalid saved result");
  });
});
