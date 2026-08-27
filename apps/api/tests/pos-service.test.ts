import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaPosSaleQueryAdapter } from "../src/pos/adapters/prisma-pos-sale-query-adapter.js";
import { canonicalCheckoutFingerprint, PosService } from "../src/pos/pos-service.js";
import type { PosCheckoutInput, PosSaleQueryPort } from "../src/pos/pos-types.js";
import type { PosReceiptCheckoutPort } from "../src/receipts/receipt-service.js";
import type { PosSalesCheckoutPort } from "../src/sales/sales-invoice-service.js";

type IdempotencyRow = {
  id: bigint;
  requestFingerprint: Uint8Array;
  status: string;
  responseBody: Prisma.JsonValue | null;
};

type TransactionState = {
  idempotency: Map<string, IdempotencyRow>;
  invoices: bigint[];
  receipts: bigint[];
  posSales: Array<{ id: bigint; completedAt: Date }>;
  auditActions: string[];
};

function recordKey(where: any) {
  const key = where.companyId_userId_operation_keyHash;
  return `${key.companyId}:${key.userId}:${key.operation}:${Buffer.from(key.keyHash).toString("hex")}`;
}

function cloneState(state: TransactionState): TransactionState {
  return {
    idempotency: new Map([...state.idempotency].map(([key, value]) => [key, {
      ...value,
      requestFingerprint: new Uint8Array(value.requestFingerprint),
    }])),
    invoices: [...state.invoices],
    receipts: [...state.receipts],
    posSales: [...state.posSales],
    auditActions: [...state.auditActions],
  };
}

function transactionalPrisma() {
  let committed: TransactionState = {
    idempotency: new Map(),
    invoices: [],
    receipts: [],
    posSales: [],
    auditActions: [],
  };
  let queue: Promise<unknown> = Promise.resolve();
  const prisma = {
    $transaction<T>(work: (tx: any) => Promise<T>) {
      const pending = queue.then(async () => {
        const next = cloneState(committed);
        const tx = {
          __state: next,
          idempotencyRecord: {
            findUnique: async ({ where }: any) => next.idempotency.get(recordKey(where)) ?? null,
            create: async ({ data }: any) => {
              const id = BigInt(next.idempotency.size + 1);
              const row: IdempotencyRow = {
                id,
                requestFingerprint: data.requestFingerprint,
                status: data.status,
                responseBody: null,
              };
              const key = `${data.companyId}:${data.userId}:${data.operation}:${Buffer.from(data.keyHash).toString("hex")}`;
              next.idempotency.set(key, row);
              return row;
            },
            update: async ({ where, data }: any) => {
              const pair = [...next.idempotency].find(([, row]) => row.id === where.id)!;
              pair[1].status = data.status;
              pair[1].responseBody = data.responseBody;
              return pair[1];
            },
          },
          posSale: {
            create: async () => {
              const sale = { id: 301n, completedAt: new Date("2048-08-27T12:00:00.000Z") };
              next.posSales.push(sale);
              return sale;
            },
          },
          auditLog: {
            create: async ({ data }: any) => {
              next.auditActions.push(data.action);
              return data;
            },
          },
        };
        const result = await work(tx);
        committed = next;
        return result;
      });
      queue = pending.then(() => undefined, () => undefined);
      return pending;
    },
    idempotencyRecord: {
      findUnique: async () => null,
    },
  };
  return {
    prisma: prisma as unknown as PrismaClient,
    state: () => committed,
  };
}

const context = { companyId: 7n, userId: 9n };
const input: PosCheckoutInput = {
  fiscalPeriodId: 11n,
  documentDate: "2048-08-27",
  description: "بيع نقدي اختباري",
  customerId: 13n,
  warehouseId: 17n,
  currencyId: 19n,
  exchangeRate: "1.00000000",
  cashBankAccountId: 23n,
  paymentMethodId: 29n,
  referenceNumber: null,
  customerAddress: null,
  notes: null,
  lines: [{
    inventoryItemId: 31n,
    description: "صنف اختباري",
    quantity: "2.000000",
    unitPrice: "25.0000",
    discountAmount: "0.0000",
    revenueAccountId: 37n,
    costCenterId: null,
    taxRateId: null,
  }],
};

function owners(options: { failReceipt?: boolean } = {}) {
  const sales = {
    checkoutInTransaction: vi.fn(async (tx: any) => {
      tx.__state.invoices.push(101n);
      return {
        invoiceId: 101n,
        documentId: 102n,
        documentNumber: "SI-2048-000001",
        documentStatus: "POSTED",
        customerId: input.customerId,
        customerName: "عميل الاختبار",
        currencyId: input.currencyId,
        total: new Prisma.Decimal("50.0000"),
        baseTotal: new Prisma.Decimal("50.0000"),
        receivableItemId: 103n,
        journalEntryIds: ["104"],
      };
    }),
  } satisfies PosSalesCheckoutPort;
  const receipts = {
    captureInTransaction: vi.fn(async (tx: any, _context, value) => {
      tx.__state.receipts.push(201n);
      if (options.failReceipt) throw new Error("cash instrument rejected");
      expect(value.amount).toBe("50.0000");
      expect(value.allocations).toEqual([{ receivableItemId: 103n, allocatedAmount: "50.0000" }]);
      return {
        receiptId: 201n,
        documentId: 202n,
        documentNumber: "RC-2048-000001",
        documentStatus: "POSTED",
        journalEntryIds: ["203"],
      };
    }),
  } satisfies PosReceiptCheckoutPort;
  return { sales, receipts };
}

const unusedQuery: PosSaleQueryPort = {
  list: vi.fn(async () => ({ data: [], total: 0 })),
};

describe("POS cash-sale orchestration", () => {
  it("completes concurrent retries exactly once and replays the committed response", async () => {
    const database = transactionalPrisma();
    const { sales, receipts } = owners();
    const service = new PosService(database.prisma, sales, receipts, unusedQuery);

    const [first, retry] = await Promise.all([
      service.checkout(context, input, "pos-same-command-0001"),
      service.checkout(context, input, "pos-same-command-0001"),
    ]);

    expect(retry).toEqual(first);
    expect(sales.checkoutInTransaction).toHaveBeenCalledTimes(1);
    expect(receipts.captureInTransaction).toHaveBeenCalledTimes(1);
    expect(database.state()).toMatchObject({
      invoices: [101n],
      receipts: [201n],
      auditActions: ["POS_SALE_COMPLETED"],
    });
    expect(database.state().posSales).toHaveLength(1);
  });

  it("rejects reuse of an idempotency key with a different financial request", async () => {
    const database = transactionalPrisma();
    const { sales, receipts } = owners();
    const service = new PosService(database.prisma, sales, receipts, unusedQuery);
    await service.checkout(context, input, "pos-mismatch-command-0001");

    await expect(service.checkout(context, {
      ...input,
      lines: [{ ...input.lines[0]!, quantity: "3.000000" }],
    }, "pos-mismatch-command-0001")).rejects.toMatchObject({ reason: "IDEMPOTENCY_MISMATCH" });
    expect(sales.checkoutInTransaction).toHaveBeenCalledTimes(1);
  });

  it("rolls back invoice, receipt, link and idempotency state when an owner rejects", async () => {
    const database = transactionalPrisma();
    const { sales, receipts } = owners({ failReceipt: true });
    const service = new PosService(database.prisma, sales, receipts, unusedQuery);

    await expect(service.checkout(context, input, "pos-rollback-command-0001"))
      .rejects.toThrow("cash instrument rejected");
    expect(database.state()).toMatchObject({
      invoices: [],
      receipts: [],
      posSales: [],
      auditActions: [],
    });
    expect(database.state().idempotency.size).toBe(0);
  });

  it("fingerprints BigInt references without leaking representation details", () => {
    expect(canonicalCheckoutFingerprint({ ...input })).toBe(canonicalCheckoutFingerprint({ ...input }));
    expect(canonicalCheckoutFingerprint(input)).not.toBe(canonicalCheckoutFingerprint({
      ...input,
      cashBankAccountId: 41n,
    }));
  });
});

describe("POS query adapter isolation", () => {
  it("scopes both the page and count to the actor company", async () => {
    const findMany = vi.fn(async () => []);
    const count = vi.fn(async () => 0);
    const prisma = {
      posSale: { findMany, count },
      $transaction: async (values: Array<Promise<unknown>>) => Promise.all(values),
    } as unknown as PrismaClient;
    const adapter = new PrismaPosSaleQueryAdapter(prisma);

    await adapter.list(context, { page: 2, pageSize: 10 });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { companyId: context.companyId },
      skip: 10,
      take: 10,
    }));
    expect(count).toHaveBeenCalledWith({ where: { companyId: context.companyId } });
  });
});
