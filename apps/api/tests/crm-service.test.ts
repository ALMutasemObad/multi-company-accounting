import { describe, expect, it, vi } from "vitest";
import { CrmError, CrmService } from "../src/crm/crm-service.js";

function fixture() {
  const records = new Map<string, Record<string, unknown>>();
  const idempotencyKey = (where: Record<string, unknown>) => {
    const value = where.companyId_userId_operation_keyHash as { companyId: bigint; userId: bigint; operation: string; keyHash: Uint8Array };
    return `${value.companyId}:${value.userId}:${value.operation}:${Buffer.from(value.keyHash).toString("hex")}`;
  };
  let recordId = 0n;
  const tx = {
    idempotencyRecord: {
      findUnique: vi.fn(async ({ where }: { where: Record<string, unknown> }) => records.get(idempotencyKey(where)) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = { id: ++recordId, ...data, responseBody: null, responseStatus: null };
        records.set(idempotencyKey({ companyId_userId_operation_keyHash: data }), record);
        return record;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: bigint }; data: Record<string, unknown> }) => {
        const entry = [...records.entries()].find(([, value]) => value.id === where.id)!;
        const updated = { ...entry[1], ...data };
        records.set(entry[0], updated);
        return updated;
      }),
    },
    $queryRaw: vi.fn(async (_strings: TemplateStringsArray, publicId: string, companyId: bigint) => companyId === 1n ? [{
      id: 41n, publicId, status: "QUALIFIED", ownerEmployeeId: 7n, phone: null, email: null,
    }] : []),
    crmLead: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    crmOpportunity: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma = {
    $transaction: vi.fn(async (work: (transaction: typeof tx) => Promise<unknown>) => work(tx)),
  };
  const customers = {
    findActiveCustomer: vi.fn(async (_tx, companyId: bigint, customerId: bigint) => companyId === 1n && customerId === 9n
      ? { customerId }
      : null),
    listActiveCustomers: vi.fn(),
  };
  const service = new CrmService(
    prisma as never,
    { findAssignable: vi.fn(), listAssignable: vi.fn(), listByInternalIds: vi.fn() },
    customers,
    { provisionCustomer: vi.fn() },
    { findEnabled: vi.fn(), listEnabled: vi.fn() },
    { append: vi.fn() },
  );
  return { service, customers, tx };
}

describe("CRM conversion command", () => {
  it("replays the same idempotent result without provisioning or relinking twice", async () => {
    const { service, customers, tx } = fixture();
    const input = { version: 2, mode: "EXISTING" as const, customerId: 9n, idempotencyKey: "crm-conversion-replay-key" };
    const first = await service.convertLead({ companyId: 1n, userId: 3n }, "19e7e8dc-125a-4d67-84c0-0dbd5ca849f4", input);
    const replay = await service.convertLead({ companyId: 1n, userId: 3n }, "19e7e8dc-125a-4d67-84c0-0dbd5ca849f4", input);

    expect(replay).toEqual(first);
    expect(customers.findActiveCustomer).toHaveBeenCalledTimes(1);
    expect(tx.crmLead.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.crmOpportunity.updateMany).toHaveBeenCalledTimes(1);
  });

  it("does not discover a lead through another company context", async () => {
    const { service, customers, tx } = fixture();
    await expect(service.convertLead(
      { companyId: 2n, userId: 3n },
      "19e7e8dc-125a-4d67-84c0-0dbd5ca849f4",
      { version: 2, mode: "EXISTING", customerId: 9n, idempotencyKey: "crm-cross-company-test-key" },
    )).rejects.toMatchObject({ reason: "NOT_FOUND" } satisfies Partial<CrmError>);
    expect(tx.$queryRaw).toHaveBeenCalledWith(expect.anything(), "19e7e8dc-125a-4d67-84c0-0dbd5ca849f4", 2n);
    expect(customers.findActiveCustomer).not.toHaveBeenCalled();
  });
});
