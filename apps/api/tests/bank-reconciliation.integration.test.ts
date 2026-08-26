import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDatabase } from "../src/database.js";
import { BankStatementParser } from "../src/treasury/reconciliation/bank-statement-parser.js";
import { PrismaReconciliationLedgerQueryAdapter } from "../src/treasury/reconciliation/adapters/prisma-reconciliation-ledger-query-adapter.js";
import {
  BankReconciliationError,
  BankReconciliationService,
  type BankStatementFileInput,
} from "../src/treasury/reconciliation/reconciliation-service.js";

const enabled = process.env.RUN_DB_TESTS === "true";
const prisma = enabled ? createDatabase(process.env.DATABASE_URL ?? "") : null;

describe.runIf(enabled)("bank reconciliation persistence, idempotency, isolation and concurrency", () => {
  let service: BankReconciliationService;
  let companyId: bigint;
  let foreignCompanyId: bigint;
  let userId: bigint;
  let currencyId: bigint;
  let currencyCode: string;
  let fiscalPeriodId: bigint;
  let bankLedgerAccountId: bigint;
  let counterAccountId: bigint;
  let cashBankAccountId: bigint;
  const context = () => ({ companyId, userId });

  const statement = (thirdAmount = "5.0000"): BankStatementFileInput => ({
    cashBankAccountId,
    format: "CSV",
    fileName: "synthetic-reconciliation.csv",
    contentBase64: Buffer.from([
      "booking_date,amount,currency,reference,description",
      "2052-03-01,100.0000,SAR,REF-100,Synthetic incoming transfer",
      "2052-03-02,-25.0000,SAR,REF-25,Synthetic outgoing transfer",
      `2052-03-03,${thirdAmount},SAR,BANK-FEE,Synthetic bank exception`,
    ].join("\n")).toString("base64"),
    csvProfile: {
      delimiter: ",",
      dateFormat: "YYYY-MM-DD",
      decimalSeparator: ".",
      defaultCurrency: "SAR",
      positiveAmountDirection: "CREDIT",
      columns: {
        bookingDate: "booking_date",
        amount: "amount",
        currency: "currency",
        reference: "reference",
        description: "description",
      },
    },
  });

  beforeAll(async () => {
    const user = await prisma!.user.findUniqueOrThrow({
      where: { emailNormalized: "admin@mcap.local" },
    });
    userId = user.id;
    companyId = (await prisma!.userCompany.findFirstOrThrow({
      where: { userId, isActive: true },
    })).companyId;
    const company = await prisma!.company.findUniqueOrThrow({
      where: { id: companyId },
      include: { baseCurrency: true },
    });
    currencyId = company.baseCurrencyId;
    currencyCode = company.baseCurrency.code;
    if (currencyCode !== "SAR") throw new Error("The reconciliation integration fixture requires the synthetic SAR seed company");
    await prisma!.companyCurrency.upsert({
      where: { companyId_currencyId: { companyId, currencyId } },
      update: { isActive: true },
      create: { companyId, currencyId, isActive: true },
    });

    await cleanupFixture();
    const assetType = await prisma!.accountType.findUniqueOrThrow({ where: { code: "ASSET" } });
    const expenseType = await prisma!.accountType.findUniqueOrThrow({ where: { code: "EXPENSE" } });
    bankLedgerAccountId = (await prisma!.account.create({
      data: {
        companyId,
        accountTypeId: assetType.id,
        code: "IT-BANK-RECON-LEDGER",
        nameAr: "حساب بنك مطابقة اصطناعي",
        level: 1,
        allowsPosting: true,
      },
    })).id;
    counterAccountId = (await prisma!.account.create({
      data: {
        companyId,
        accountTypeId: expenseType.id,
        code: "IT-BANK-RECON-COUNTER",
        nameAr: "حساب مقابل مطابقة اصطناعي",
        level: 1,
        allowsPosting: true,
      },
    })).id;
    cashBankAccountId = (await prisma!.cashBankAccount.create({
      data: {
        companyId,
        ledgerAccountId: bankLedgerAccountId,
        accountType: "BANK",
        code: "IT-BANK-RECON",
        nameAr: "بنك مطابقة اصطناعي",
        bankName: "Synthetic Test Bank",
      },
    })).id;

    const year = await prisma!.fiscalYear.create({
      data: {
        companyId,
        name: "IT-BANK-RECON-2052",
        startDate: new Date("2052-01-01T00:00:00.000Z"),
        endDate: new Date("2052-12-31T00:00:00.000Z"),
        periods: {
          create: {
            periodNumber: 1,
            name: "فترة مطابقة اصطناعية",
            startDate: new Date("2052-01-01T00:00:00.000Z"),
            endDate: new Date("2052-12-31T00:00:00.000Z"),
          },
        },
      },
      include: { periods: true },
    });
    fiscalPeriodId = year.periods[0]!.id;
    await createPostedMovement("IT-BR-001", "2052-03-01", "REF-100", "100.0000", true);
    await createPostedMovement("IT-BR-002", "2052-03-02", "REF-25", "25.0000", false);

    foreignCompanyId = (await prisma!.company.create({
      data: {
        organizationId: company.organizationId,
        baseCurrencyId: currencyId,
        code: "IT-BANK-RECON-FOREIGN",
        name: "Synthetic Reconciliation Foreign Company",
        timezone: company.timezone,
      },
    })).id;
    service = new BankReconciliationService(
      prisma!,
      new BankStatementParser(),
      new PrismaReconciliationLedgerQueryAdapter(),
    );
  }, 30_000);

  afterAll(async () => {
    if (!prisma) return;
    await cleanupFixture();
    await prisma.$disconnect();
  }, 30_000);

  async function cleanupFixture() {
    if (!prisma || !companyId) return;
    await prisma.idempotencyRecord.deleteMany({
      where: { companyId, operation: { contains: "BANK_RECONCILIATION" } },
    });
    await prisma.idempotencyRecord.deleteMany({
      where: { companyId, operation: { contains: "BANK_STATEMENT" } },
    });
    await prisma.auditLog.deleteMany({
      where: {
        companyId,
        OR: [
          { entityType: { startsWith: "BANK_RECONCILIATION" } },
          { entityType: { startsWith: "BANK_STATEMENT" } },
        ],
      },
    });
    await prisma.bankReconciliationMatch.deleteMany({ where: { companyId } });
    await prisma.bankReconciliationSession.deleteMany({ where: { companyId } });
    await prisma.bankStatementLine.deleteMany({ where: { companyId } });
    await prisma.bankStatementImport.deleteMany({ where: { companyId } });
    await prisma.journalLine.deleteMany({
      where: { companyId, journalEntry: { accountingDocument: { documentNumber: { startsWith: "IT-BR-" } } } },
    });
    await prisma.journalEntry.deleteMany({
      where: { companyId, accountingDocument: { documentNumber: { startsWith: "IT-BR-" } } },
    });
    await prisma.accountingDocument.deleteMany({
      where: { companyId, documentNumber: { startsWith: "IT-BR-" } },
    });
    await prisma.cashBankAccount.deleteMany({ where: { companyId, code: "IT-BANK-RECON" } });
    await prisma.account.deleteMany({
      where: { companyId, code: { in: ["IT-BANK-RECON-LEDGER", "IT-BANK-RECON-COUNTER"] } },
    });
    const years = await prisma.fiscalYear.findMany({ where: { companyId, name: "IT-BANK-RECON-2052" } });
    if (years.length) {
      await prisma.fiscalPeriod.deleteMany({ where: { fiscalYearId: { in: years.map((year) => year.id) } } });
      await prisma.fiscalYear.deleteMany({ where: { id: { in: years.map((year) => year.id) } } });
    }
    await prisma.company.deleteMany({ where: { code: "IT-BANK-RECON-FOREIGN" } });
  }

  async function createPostedMovement(
    documentNumber: string,
    date: string,
    reference: string,
    amount: string,
    incoming: boolean,
  ) {
    const document = await prisma!.accountingDocument.create({
      data: {
        companyId,
        fiscalPeriodId,
        documentType: "MANUAL_JOURNAL",
        documentNumber,
        documentDate: new Date(`${date}T00:00:00.000Z`),
        description: "Synthetic bank reconciliation ledger fact",
        status: "POSTED",
        createdBy: userId,
        postedBy: userId,
        postedAt: new Date(),
      },
    });
    const entry = await prisma!.journalEntry.create({
      data: {
        companyId,
        accountingDocumentId: document.id,
        entryNumber: 1,
        entryDate: new Date(`${date}T00:00:00.000Z`),
        description: reference,
      },
    });
    await prisma!.journalLine.createMany({
      data: [
        {
          companyId,
          journalEntryId: entry.id,
          lineNumber: 1,
          accountId: bankLedgerAccountId,
          description: reference,
          currencyId,
          exchangeRate: "1.00000000",
          debitAmount: incoming ? amount : "0.0000",
          creditAmount: incoming ? "0.0000" : amount,
          baseDebitAmount: incoming ? amount : "0.0000",
          baseCreditAmount: incoming ? "0.0000" : amount,
        },
        {
          companyId,
          journalEntryId: entry.id,
          lineNumber: 2,
          accountId: counterAccountId,
          description: reference,
          currencyId,
          exchangeRate: "1.00000000",
          debitAmount: incoming ? "0.0000" : amount,
          creditAmount: incoming ? amount : "0.0000",
          baseDebitAmount: incoming ? "0.0000" : amount,
          baseCreditAmount: incoming ? amount : "0.0000",
        },
      ],
    });
  }

  it("completes the backend flow once without writing Ledger", async () => {
    const preview = await service.preview(context(), statement());
    expect(preview.lines).toHaveLength(3);
    expect(preview.netMovement).toBe("80.0000");

    const ledgerBefore = {
      entries: await prisma!.journalEntry.count({ where: { companyId } }),
      lines: await prisma!.journalLine.count({ where: { companyId } }),
    };
    const imported = await service.commitImport(context(), statement(), "it-bank-reconciliation-import-key");
    const replay = await service.commitImport(context(), statement(), "it-bank-reconciliation-import-key");
    expect(replay).toEqual(imported);
    const duplicate = await service.commitImport(context(), statement(), "it-bank-reconciliation-import-dedup-key");
    expect(duplicate.id).toBe(imported.id);
    expect(await prisma!.bankStatementImport.count({ where: { companyId, cashBankAccountId } })).toBe(1);
    await expect(service.commitImport(context(), statement("6.0000"), "it-bank-reconciliation-import-key"))
      .rejects.toEqual(new BankReconciliationError("IDEMPOTENCY_MISMATCH"));
    await expect(service.getImport({ companyId: foreignCompanyId, userId }, imported.id))
      .rejects.toEqual(new BankReconciliationError("NOT_FOUND"));
    await expect(service.createSession(context(), {
      statementImportId: imported.id,
      dateFrom: "2052-03-01",
      dateTo: "2052-03-02",
    }, "it-bank-reconciliation-partial-session-key"))
      .rejects.toEqual(new BankReconciliationError("INVALID_DATE_RANGE"));

    const session = await service.createSession(context(), {
      statementImportId: imported.id,
      dateFrom: "2052-03-01",
      dateTo: "2052-03-03",
    }, "it-bank-reconciliation-session-key");
    expect(session.difference).toBe("5.0000");
    const generated = await service.generateSuggestions(context(), session.id, {
      sessionVersion: 0,
      dateWindowDays: 3,
    }, "it-bank-reconciliation-suggestions-key");
    expect(generated).toMatchObject({ proposalCount: 2, sessionVersion: 1 });

    let detail = await service.getSession(context(), session.id);
    const proposals = detail.matches.filter((match) => match.status === "PROPOSED");
    expect(proposals).toHaveLength(2);
    const raced = await Promise.allSettled([
      service.approveSuggestion(context(), session.id, BigInt(proposals[0]!.id), {
        sessionVersion: 1,
        matchVersion: 0,
      }, "it-bank-reconciliation-approve-race-a"),
      service.approveSuggestion(context(), session.id, BigInt(proposals[0]!.id), {
        sessionVersion: 1,
        matchVersion: 0,
      }, "it-bank-reconciliation-approve-race-b"),
    ]);
    expect(raced.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(raced.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(await prisma!.bankReconciliationMatch.count({
      where: { companyId, activeBankStatementLineId: BigInt(proposals[0]!.bankStatementLineId) },
    })).toBe(1);

    detail = await service.getSession(context(), session.id);
    const firstApproved = detail.matches.find((match) =>
      match.status === "APPROVED" && match.bankStatementLineId === proposals[0]!.bankStatementLineId,
    )!;
    const released = await service.releaseMatch(context(), session.id, BigInt(firstApproved.id), {
      sessionVersion: 2,
      matchVersion: firstApproved.version,
      reason: "Synthetic review correction before manual relinking",
    }, "it-bank-reconciliation-release-key");
    expect(released).toMatchObject({ status: "RELEASED", sessionVersion: 3 });
    const manual = await service.manualMatch(context(), session.id, {
      sessionVersion: 3,
      bankStatementLineId: BigInt(firstApproved.bankStatementLineId),
      bookMovementKey: firstApproved.bookMovement.key,
    }, "it-bank-reconciliation-manual-key");
    expect(manual).toMatchObject({ status: "APPROVED", sessionVersion: 4 });
    expect(await prisma!.bankReconciliationMatch.count({
      where: { companyId, bankStatementLineId: BigInt(firstApproved.bankStatementLineId) },
    })).toBe(2);

    const second = await service.approveSuggestion(context(), session.id, BigInt(proposals[1]!.id), {
      sessionVersion: 4,
      matchVersion: 0,
    }, "it-bank-reconciliation-approve-second");
    expect(second.sessionVersion).toBe(5);
    detail = await service.getSession(context(), session.id);
    const unmatched = detail.lines.find((line) => !detail.matches.some((match) =>
      match.status === "APPROVED" && match.bankStatementLineId === line.id,
    ));
    expect(unmatched).toBeDefined();
    const classified = await service.classifyLine(context(), session.id, BigInt(unmatched!.id), {
      sessionVersion: 5,
      lineVersion: unmatched!.version,
      classification: "BANK_FEE",
      note: "Synthetic bank-only fee; accounting document is intentionally outside reconciliation",
    }, "it-bank-reconciliation-classify-key");
    expect(classified.sessionVersion).toBe(6);

    const closed = await service.closeSession(context(), session.id, {
      sessionVersion: 6,
      explanation: "Approved synthetic bank fee explains the five-riyal difference",
    }, "it-bank-reconciliation-close-key");
    expect(closed).toMatchObject({ status: "CLOSED", difference: "5.0000", sessionVersion: 7 });
    expect(await service.closeSession(context(), session.id, {
      sessionVersion: 6,
      explanation: "Approved synthetic bank fee explains the five-riyal difference",
    }, "it-bank-reconciliation-close-key")).toEqual(closed);

    expect({
      entries: await prisma!.journalEntry.count({ where: { companyId } }),
      lines: await prisma!.journalLine.count({ where: { companyId } }),
    }).toEqual(ledgerBefore);
    expect(await prisma!.auditLog.count({
      where: { companyId, entityType: { startsWith: "BANK_RECONCILIATION" } },
    })).toBeGreaterThanOrEqual(5);
  }, 30_000);

  it("keeps close separate when building a custom reconciliation role", async () => {
    const role = await prisma!.role.create({
      data: {
        companyId,
        code: "IT-BANK-RECON-REVIEWER",
        nameAr: "مراجع مطابقة اصطناعي",
        isSystemRole: false,
      },
    });
    try {
      const permissions = await prisma!.permission.findMany({
        where: {
          code: {
            in: [
              "bank_reconciliation.view",
              "bank_reconciliation.import",
              "bank_reconciliation.review",
              "bank_reconciliation.close",
            ],
          },
        },
      });
      expect(permissions).toHaveLength(4);
      await prisma!.rolePermission.createMany({
        data: permissions
          .filter((permission) => permission.code !== "bank_reconciliation.close")
          .map((permission) => ({ roleId: role.id, permissionId: permission.id })),
      });
      const granted = await prisma!.rolePermission.findMany({
        where: { roleId: role.id },
        include: { permission: true },
      });
      expect(granted.map((value) => value.permission.code).sort()).toEqual([
        "bank_reconciliation.import",
        "bank_reconciliation.review",
        "bank_reconciliation.view",
      ]);
      expect(granted.some((value) => value.permission.code === "bank_reconciliation.close")).toBe(false);
    } finally {
      await prisma!.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma!.role.delete({ where: { id: role.id } });
    }
  });
});
