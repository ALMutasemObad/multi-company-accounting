import { describe, expect, it, vi } from "vitest";
import { AccountService } from "../src/accounts/account-service.js";

describe("account reference filters", () => {
  it("combines company, posting, class, activity, search, and pagination filters", async () => {
    const tx = {
      account: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const prisma = { $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx)) };
    const service = new AccountService(prisma as never);

    await service.listAccounts(
      { companyId: 41n, userId: 7n },
      {
        page: 3,
        pageSize: 20,
        search: "تشغيل",
        active: true,
        allowsPosting: true,
        accountClasses: ["ASSET", "EXPENSE"],
      },
    );

    const where = {
      companyId: 41n,
      isActive: true,
      allowsPosting: true,
      accountType: { class: { in: ["ASSET", "EXPENSE"] } },
      OR: [
        { code: { contains: "تشغيل" } },
        { nameAr: { contains: "تشغيل" } },
        { nameEn: { contains: "تشغيل" } },
      ],
    };
    expect(tx.account.findMany).toHaveBeenCalledWith(expect.objectContaining({ where, skip: 40, take: 20 }));
    expect(tx.account.count).toHaveBeenCalledWith({ where });
  });

  it("applies the active flag to cost-center reference queries", async () => {
    const tx = {
      costCenter: {
        findMany: vi.fn().mockResolvedValue([]),
        count: vi.fn().mockResolvedValue(0),
      },
    };
    const prisma = { $transaction: vi.fn(async (run: (client: unknown) => unknown) => run(tx)) };
    const service = new AccountService(prisma as never);

    await service.listCostCenters(
      { companyId: 41n, userId: 7n },
      { page: 1, pageSize: 20, active: true },
    );

    expect(tx.costCenter.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: 41n, isActive: true },
    }));
  });
});
