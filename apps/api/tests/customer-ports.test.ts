import type { Prisma, PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { CustomerService } from "../src/sales/customer-service.js";

describe("Sales customer ports", () => {
  it("queries an active customer through the company boundary", async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 17n });
    const service = new CustomerService({} as PrismaClient);
    const result = await service.findActiveCustomer(
      { customer: { findFirst } } as unknown as Prisma.TransactionClient,
      3n,
      17n,
    );

    expect(result).toEqual({ customerId: 17n });
    expect(findFirst).toHaveBeenCalledWith({
      where: { id: 17n, companyId: 3n, isActive: true },
      select: { id: true },
    });
  });

  it("provisions a CRM customer inside the caller transaction and returns only its id", async () => {
    const account = {
      findFirst: vi.fn().mockResolvedValue({
        id: 5n,
        companyId: 3n,
        code: "110100",
        isActive: true,
        allowsPosting: true,
        accountType: { class: "ASSET" },
        _count: { children: 0 },
      }),
    };
    const customer = {
      create: vi.fn().mockResolvedValue({
        id: 19n,
        receivableAccountId: 5n,
        code: "CUS-000001",
        nameAr: "عميل CRM",
        nameEn: null,
        phone: null,
        email: null,
        taxNumberLast4: null,
        isActive: true,
        addresses: [],
      }),
    };
    const auditLog = { create: vi.fn().mockResolvedValue({ id: 1n }) };
    const executeRaw = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(1);
    const queryRaw = vi.fn().mockResolvedValue([{ prefix: "CUS-", padding: 6, nextNumber: 2n }]);
    const tx = {
      account,
      customer,
      auditLog,
      $executeRaw: executeRaw,
      $queryRaw: queryRaw,
    } as unknown as Prisma.TransactionClient;
    const service = new CustomerService({} as PrismaClient);

    const result = await service.provisionCustomer(
      tx,
      { companyId: 3n, userId: 11n },
      { receivableAccountId: 5n, nameAr: "عميل CRM" },
    );

    expect(result).toEqual({ customerId: 19n });
    expect(customer.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ companyId: 3n, receivableAccountId: 5n, code: "CUS-000001" }),
    }));
    expect(auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        companyId: 3n,
        actorUserId: 11n,
        action: "CUSTOMER_CREATED",
        entityType: "CUSTOMER",
        entityId: "19",
        details: { source: "CRM" },
      }),
    });
  });
});
