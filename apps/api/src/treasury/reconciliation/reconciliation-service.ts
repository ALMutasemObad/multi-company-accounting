import { Buffer } from "node:buffer";
import { Prisma, type PrismaClient } from "@prisma/client";
import type { ActorContext } from "../../users/user-service.js";
import { IdempotentCommandExecutor } from "../../platform/idempotent-command-executor.js";
import {
  BankStatementParseError,
  type BankStatementParseRequest,
  type BankStatementParserPort,
  type CsvBankStatementProfile,
  type NormalizedBankStatement,
} from "./bank-statement-parser.js";
import { LocalReconciliationMatcher } from "./local-reconciliation-matcher.js";
import type {
  ReconciliationLedgerQueryPort,
  ReconciliationMatcherPort,
  ReconciliationStatementFact,
  TreasuryMovementFact,
} from "./reconciliation-types.js";

export type BankReconciliationErrorReason =
  | "NOT_FOUND"
  | "INVALID_FILE_CONTENT"
  | "INVALID_PARSE_REQUEST"
  | "INVALID_BANK_ACCOUNT"
  | "INVALID_CURRENCY"
  | "INVALID_DATE_RANGE"
  | "INVALID_STATE"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS"
  | "LINE_ALREADY_MATCHED"
  | "BOOK_MOVEMENT_ALREADY_MATCHED"
  | "MATCH_FACT_CHANGED"
  | "AMOUNT_OR_CURRENCY_MISMATCH"
  | "UNRESOLVED_LINES"
  | "CLOSING_EXPLANATION_REQUIRED";

export class BankReconciliationError extends Error {
  constructor(public readonly reason: BankReconciliationErrorReason) {
    super(reason);
    this.name = "BankReconciliationError";
  }
}

export type BankStatementFileInput = {
  cashBankAccountId: bigint;
  format: "CSV" | "CAMT053";
  contentBase64: string;
  fileName?: string | undefined;
  csvProfile?: CsvBankStatementProfile | undefined;
  expectedAccountIdentifier?: string | undefined;
  expectedCurrency?: string | undefined;
};

type SessionCommandInput = { sessionVersion: number };

const importInclude = {
  cashBankAccount: { select: { id: true, code: true, nameAr: true } },
} as const;

const sessionInclude = {
  cashBankAccount: { select: { id: true, code: true, nameAr: true } },
  statementImport: { select: { publicId: true } },
} as const;

const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const isoDate = (value: Date) => value.toISOString().slice(0, 10);
const hexBytes = (value: string) => new Uint8Array(Buffer.from(value, "hex"));
const last4 = (value?: string) => value ? value.replace(/\s/gu, "").slice(-4) || null : null;
const jsonFingerprint = (value: Record<string, unknown>) => JSON.stringify(value);

function decodeBase64(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 700_000 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    throw new BankReconciliationError("INVALID_FILE_CONTENT");
  }
  const bytes = Buffer.from(normalized, "base64");
  if (bytes.length === 0 || bytes.toString("base64") !== normalized) {
    throw new BankReconciliationError("INVALID_FILE_CONTENT");
  }
  return new Uint8Array(bytes);
}

function parseRequest(input: BankStatementFileInput): BankStatementParseRequest {
  if (input.format === "CSV") {
    if (!input.csvProfile || input.expectedAccountIdentifier || input.expectedCurrency) {
      throw new BankReconciliationError("INVALID_PARSE_REQUEST");
    }
    return {
      format: "CSV",
      ...(input.fileName ? { fileName: input.fileName } : {}),
      profile: input.csvProfile,
    };
  }
  if (input.csvProfile) throw new BankReconciliationError("INVALID_PARSE_REQUEST");
  return {
    format: "CAMT053",
    ...(input.fileName ? { fileName: input.fileName } : {}),
    ...(input.expectedAccountIdentifier
      ? { expectedAccountIdentifier: input.expectedAccountIdentifier }
      : {}),
    ...(input.expectedCurrency ? { expectedCurrency: input.expectedCurrency } : {}),
  };
}

function normalizedJson(statement: NormalizedBankStatement) {
  return {
    format: statement.format,
    sourceHashSha256: statement.sourceHashSha256,
    statementId: statement.statementId ?? null,
    accountIdentifierMasked: statement.accountIdentifier
      ? `****${last4(statement.accountIdentifier)}`
      : null,
    currency: statement.currency,
    periodStart: statement.periodStart ?? null,
    periodEnd: statement.periodEnd ?? null,
    openingBalance: statement.openingBalance ?? null,
    closingBalance: statement.closingBalance ?? null,
    netMovement: statement.netMovement,
    ignoredEntryCount: statement.ignoredEntryCount,
    sourceTimeZoneOffsets: statement.sourceTimeZoneOffsets,
    lines: statement.lines.map((line) => ({
      sourceRowNumber: line.sourceRowNumber,
      bookingDate: line.bookingDate,
      valueDate: line.valueDate ?? null,
      amount: line.amount,
      direction: line.direction,
      currency: line.currency,
      fingerprintSha256: line.fingerprintSha256,
      externalId: line.externalId ?? null,
      reference: line.reference ?? null,
      description: line.description ?? null,
    })),
  };
}

export class BankReconciliationService {
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly parser: BankStatementParserPort,
    private readonly ledger: ReconciliationLedgerQueryPort,
    private readonly matcher: ReconciliationMatcherPort = new LocalReconciliationMatcher(),
  ) {
    this.commands = new IdempotentCommandExecutor(prisma);
  }

  async preview(context: ActorContext, input: BankStatementFileInput) {
    const account = await this.requireBankAccount(this.prisma, context.companyId, input.cashBankAccountId);
    const statement = this.parse(input);
    this.assertStatementAccount(account, statement.accountIdentifier);
    await this.requireCurrency(this.prisma, context.companyId, statement.currency);
    return normalizedJson(statement);
  }

  async commitImport(context: ActorContext, input: BankStatementFileInput, key: string) {
    const statement = this.parse(input);
    if (!statement.periodStart || !statement.periodEnd || statement.lines.length === 0) {
      throw new BankReconciliationError("INVALID_DATE_RANGE");
    }
    const periodStart = statement.periodStart;
    const periodEnd = statement.periodEnd;
    const fingerprint = jsonFingerprint({
      cashBankAccountId: input.cashBankAccountId.toString(),
      format: statement.format,
      sourceHashSha256: statement.sourceHashSha256,
    });
    return this.commands.execute({
      context,
      operation: "COMMIT_BANK_STATEMENT_IMPORT",
      key,
      fingerprint,
      responseStatus: 201,
      errors: this.idempotencyErrors(),
    }, async (tx) => {
      const account = await this.requireBankAccount(tx, context.companyId, input.cashBankAccountId);
      this.assertStatementAccount(account, statement.accountIdentifier);
      await this.requireCurrency(tx, context.companyId, statement.currency);
      const sourceHashSha256 = hexBytes(statement.sourceHashSha256);
      const existing = await tx.bankStatementImport.findFirst({
        where: {
          companyId: context.companyId,
          cashBankAccountId: input.cashBankAccountId,
          sourceHashSha256,
        },
        include: importInclude,
      });
      if (existing) return BankReconciliationService.importJson(existing);

      const created = await tx.bankStatementImport.create({
        data: {
          companyId: context.companyId,
          cashBankAccountId: input.cashBankAccountId,
          createdById: context.userId,
          format: statement.format,
          sourceHashSha256,
          statementId: statement.statementId ?? null,
          accountIdentifierLast4: last4(statement.accountIdentifier),
          currencyCode: statement.currency,
          periodStart: toDate(periodStart),
          periodEnd: toDate(periodEnd),
          openingBalance: statement.openingBalance ?? null,
          closingBalance: statement.closingBalance ?? null,
          netMovement: statement.netMovement,
          lineCount: statement.lines.length,
          ignoredEntryCount: statement.ignoredEntryCount,
        },
      });
      await tx.bankStatementLine.createMany({
        data: statement.lines.map((line) => ({
          companyId: context.companyId,
          statementImportId: created.id,
          sourceRowNumber: line.sourceRowNumber,
          bookingDate: toDate(line.bookingDate),
          valueDate: line.valueDate ? toDate(line.valueDate) : null,
          amount: line.amount,
          currencyCode: line.currency,
          fingerprintSha256: hexBytes(line.fingerprintSha256),
          externalId: line.externalId ?? null,
          reference: line.reference ?? null,
          description: line.description ?? null,
        })),
      });
      const imported = await tx.bankStatementImport.findUniqueOrThrow({
        where: { id: created.id },
        include: importInclude,
      });
      await this.audit(tx, context, "BANK_STATEMENT_IMPORT_COMMITTED", "BANK_STATEMENT_IMPORT", imported.publicId, {
        cashBankAccountId: input.cashBankAccountId.toString(),
        format: statement.format,
        sourceHashSha256: statement.sourceHashSha256,
        currency: statement.currency,
        periodStart,
        periodEnd,
        lineCount: statement.lines.length,
      });
      return BankReconciliationService.importJson(imported);
    });
  }

  async listImports(context: ActorContext, input: { page: number; pageSize: number }) {
    const where = { companyId: context.companyId };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.bankStatementImport.findMany({
        where,
        include: importInclude,
        orderBy: [{ committedAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.bankStatementImport.count({ where }),
    ]);
    return { data: data.map(BankReconciliationService.importJson), total };
  }

  async getImport(context: ActorContext, publicId: string) {
    const value = await this.prisma.bankStatementImport.findFirst({
      where: { publicId, companyId: context.companyId },
      include: { ...importInclude, lines: { orderBy: { id: "asc" } } },
    });
    if (!value) throw new BankReconciliationError("NOT_FOUND");
    return {
      ...BankReconciliationService.importJson(value),
      lines: value.lines.map(BankReconciliationService.lineJson),
    };
  }

  async createSession(
    context: ActorContext,
    input: { statementImportId: string; dateFrom: string; dateTo: string },
    key: string,
  ) {
    this.assertDateRange(input.dateFrom, input.dateTo);
    return this.commands.execute({
      context,
      operation: "CREATE_BANK_RECONCILIATION_SESSION",
      key,
      fingerprint: jsonFingerprint(input),
      responseStatus: 201,
      errors: this.idempotencyErrors(),
    }, async (tx) => {
      const imported = await tx.bankStatementImport.findFirst({
        where: {
          publicId: input.statementImportId,
          companyId: context.companyId,
          status: "COMMITTED",
        },
        include: { cashBankAccount: true },
      });
      if (!imported) throw new BankReconciliationError("NOT_FOUND");
      if (
        input.dateFrom !== isoDate(imported.periodStart)
        || input.dateTo !== isoDate(imported.periodEnd)
      ) {
        throw new BankReconciliationError("INVALID_DATE_RANGE");
      }
      const existing = await tx.bankReconciliationSession.findFirst({
        where: { statementImportId: imported.id, companyId: context.companyId },
        include: sessionInclude,
      });
      if (existing) return BankReconciliationService.sessionJson(existing);

      const lines = await tx.bankStatementLine.findMany({
        where: {
          companyId: context.companyId,
          statementImportId: imported.id,
          bookingDate: { gte: toDate(input.dateFrom), lte: toDate(input.dateTo) },
        },
        orderBy: { id: "asc" },
      });
      if (lines.length === 0) throw new BankReconciliationError("INVALID_DATE_RANGE");
      const bankNet = lines.reduce((total, line) => total.plus(line.amount), new Prisma.Decimal(0));
      const book = await this.ledger.snapshot(tx, {
        companyId: context.companyId,
        ledgerAccountId: imported.cashBankAccount.ledgerAccountId,
        currencyCode: imported.currencyCode,
        range: { dateFrom: input.dateFrom, dateTo: input.dateTo },
        lockMovements: false,
      });
      const difference = bankNet.minus(book.netMovement);
      const session = await tx.bankReconciliationSession.create({
        data: {
          companyId: context.companyId,
          cashBankAccountId: imported.cashBankAccountId,
          statementImportId: imported.id,
          dateFrom: toDate(input.dateFrom),
          dateTo: toDate(input.dateTo),
          currencyCode: imported.currencyCode,
          bankOpeningBalance: imported.openingBalance,
          bankClosingBalance: imported.closingBalance,
          bankNetMovement: bankNet,
          bookOpeningBalance: book.openingBalance,
          bookClosingBalance: book.closingBalance,
          bookNetMovement: book.netMovement,
          difference,
          createdById: context.userId,
        },
        include: sessionInclude,
      });
      await this.audit(tx, context, "BANK_RECONCILIATION_SESSION_CREATED", "BANK_RECONCILIATION_SESSION", session.publicId, {
        statementImportId: imported.publicId,
        cashBankAccountId: imported.cashBankAccountId.toString(),
        dateFrom: input.dateFrom,
        dateTo: input.dateTo,
        currency: imported.currencyCode,
        difference: difference.toFixed(4),
      });
      return BankReconciliationService.sessionJson(session);
    });
  }

  async listSessions(
    context: ActorContext,
    input: { page: number; pageSize: number; status?: "OPEN" | "CLOSED" | undefined },
  ) {
    const where = { companyId: context.companyId, ...(input.status ? { status: input.status } : {}) };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.bankReconciliationSession.findMany({
        where,
        include: sessionInclude,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
      this.prisma.bankReconciliationSession.count({ where }),
    ]);
    return { data: data.map(BankReconciliationService.sessionJson), total };
  }

  async getSession(context: ActorContext, publicId: string) {
    const session = await this.prisma.bankReconciliationSession.findFirst({
      where: { publicId, companyId: context.companyId },
      include: {
        ...sessionInclude,
        matches: { orderBy: { id: "asc" } },
        statementImport: {
          select: {
            publicId: true,
            lines: {
              orderBy: { id: "asc" },
            },
          },
        },
      },
    });
    if (!session) throw new BankReconciliationError("NOT_FOUND");
    const lines = session.statementImport.lines.filter((line) =>
      line.bookingDate >= session.dateFrom && line.bookingDate <= session.dateTo,
    );
    return {
      ...BankReconciliationService.sessionJson(session),
      lines: lines.map(BankReconciliationService.lineJson),
      matches: session.matches.map(BankReconciliationService.matchJson),
    };
  }

  async listBookMovements(context: ActorContext, publicId: string) {
    return this.prisma.$transaction(async (tx) => {
      const session = await tx.bankReconciliationSession.findFirst({
        where: { publicId, companyId: context.companyId },
        include: { cashBankAccount: true },
      });
      if (!session) throw new BankReconciliationError("NOT_FOUND");
      const snapshot = await this.ledger.snapshot(tx, {
        companyId: context.companyId,
        ledgerAccountId: session.cashBankAccount.ledgerAccountId,
        currencyCode: session.currencyCode,
        range: { dateFrom: isoDate(session.dateFrom), dateTo: isoDate(session.dateTo) },
        lockMovements: false,
      });
      const active = new Set((await tx.bankReconciliationMatch.findMany({
        where: { companyId: context.companyId, status: "APPROVED" },
        select: { bookMovementKey: true },
      })).map((match) => match.bookMovementKey));
      return snapshot.movements.map((movement) => ({
        ...movement,
        reference: movement.reference ?? null,
        matched: active.has(movement.key),
      }));
    });
  }

  async generateSuggestions(
    context: ActorContext,
    publicId: string,
    input: SessionCommandInput & { dateWindowDays: number },
    key: string,
  ) {
    return this.commands.execute({
      context,
      operation: "GENERATE_BANK_RECONCILIATION_SUGGESTIONS",
      key,
      fingerprint: jsonFingerprint({ publicId, ...input }),
      errors: this.idempotencyErrors(),
    }, async (tx) => {
      const session = await this.lockSession(tx, context.companyId, publicId);
      this.requireOpenVersion(session, input.sessionVersion);
      const lines = await tx.bankStatementLine.findMany({
        where: {
          companyId: context.companyId,
          statementImportId: session.statementImportId,
          bookingDate: { gte: session.dateFrom, lte: session.dateTo },
        },
        orderBy: { id: "asc" },
      });
      await this.lockLines(tx, context.companyId, lines.map((line) => line.id));
      const snapshot = await this.ledgerSnapshotForSession(tx, session, true);
      const approved = await tx.bankReconciliationMatch.findMany({
        where: { companyId: context.companyId, status: "APPROVED" },
        select: { bankStatementLineId: true, bookMovementKey: true },
      });
      const approvedLines = new Set(approved.map((match) => match.bankStatementLineId));
      const approvedBooks = new Set(approved.map((match) => match.bookMovementKey));
      const facts: ReconciliationStatementFact[] = lines
        .filter((line) => !approvedLines.has(line.id) && line.classification === null)
        .map((line) => ({
          id: line.id,
          bookingDate: isoDate(line.bookingDate),
          amount: line.amount.toFixed(4),
          currency: line.currencyCode,
          ...(line.reference ? { reference: line.reference } : {}),
        }));
      const books = snapshot.movements.filter((movement) => !approvedBooks.has(movement.key));
      const proposals = this.matcher.propose(facts, books, { dateWindowDays: input.dateWindowDays });
      await tx.bankReconciliationMatch.deleteMany({
        where: { companyId: context.companyId, sessionId: session.id, status: "PROPOSED" },
      });
      if (proposals.length) {
        await tx.bankReconciliationMatch.createMany({
          data: proposals.map((proposal) => this.proposalData(context.companyId, session.id, proposal)),
        });
      }
      const nextVersion = await this.incrementSessionVersion(tx, session, input.sessionVersion);
      await this.audit(tx, context, "BANK_RECONCILIATION_SUGGESTIONS_GENERATED", "BANK_RECONCILIATION_SESSION", session.publicId, {
        proposalCount: proposals.length,
        dateWindowDays: input.dateWindowDays,
        fromVersion: input.sessionVersion,
        toVersion: nextVersion,
      });
      return { sessionId: session.publicId, sessionVersion: nextVersion, proposalCount: proposals.length };
    });
  }

  async approveSuggestion(
    context: ActorContext,
    publicId: string,
    matchId: bigint,
    input: SessionCommandInput & { matchVersion: number },
    key: string,
  ) {
    return this.commands.execute({
      context,
      operation: "APPROVE_BANK_RECONCILIATION_MATCH",
      key,
      fingerprint: jsonFingerprint({ publicId, matchId: matchId.toString(), ...input }),
      errors: this.idempotencyErrors(),
    }, async (tx) => {
      const session = await this.lockSession(tx, context.companyId, publicId);
      this.requireOpenVersion(session, input.sessionVersion);
      const match = await tx.bankReconciliationMatch.findFirst({
        where: { id: matchId, companyId: context.companyId, sessionId: session.id },
      });
      if (!match) throw new BankReconciliationError("NOT_FOUND");
      if (match.status !== "PROPOSED" || match.version !== input.matchVersion) {
        throw new BankReconciliationError("VERSION_CONFLICT");
      }
      await this.lockLines(tx, context.companyId, [match.bankStatementLineId]);
      const line = await tx.bankStatementLine.findFirstOrThrow({
        where: { id: match.bankStatementLineId, companyId: context.companyId },
      });
      if (line.classification) throw new BankReconciliationError("INVALID_STATE");
      const snapshot = await this.ledgerSnapshotForSession(tx, session, true);
      const movement = snapshot.movements.find((candidate) => candidate.key === match.bookMovementKey);
      if (!movement || !this.matchSnapshotEquals(match, movement)) {
        throw new BankReconciliationError("MATCH_FACT_CHANGED");
      }
      const approvedAt = new Date();
      try {
        const changed = await tx.bankReconciliationMatch.updateMany({
          where: { id: match.id, companyId: context.companyId, status: "PROPOSED", version: input.matchVersion },
          data: {
            status: "APPROVED",
            activeBankStatementLineId: match.bankStatementLineId,
            activeBookMovementKey: match.bookMovementKey,
            approvedById: context.userId,
            approvedAt,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) throw new BankReconciliationError("VERSION_CONFLICT");
      } catch (error) {
        this.translateActiveMatchConflict(error);
      }
      const nextVersion = await this.incrementSessionVersion(tx, session, input.sessionVersion);
      await this.audit(tx, context, "BANK_RECONCILIATION_MATCH_APPROVED", "BANK_RECONCILIATION_MATCH", match.id.toString(), {
        sessionId: session.publicId,
        bankStatementLineId: match.bankStatementLineId.toString(),
        bookMovementKey: match.bookMovementKey,
        rule: match.rule,
        fromVersion: input.matchVersion,
        toVersion: input.matchVersion + 1,
      });
      return { sessionId: session.publicId, sessionVersion: nextVersion, matchId: match.id.toString(), matchVersion: input.matchVersion + 1, status: "APPROVED" };
    });
  }

  async manualMatch(
    context: ActorContext,
    publicId: string,
    input: SessionCommandInput & { bankStatementLineId: bigint; bookMovementKey: string },
    key: string,
  ) {
    return this.commands.execute({
      context,
      operation: "CREATE_MANUAL_BANK_RECONCILIATION_MATCH",
      key,
      fingerprint: jsonFingerprint({ ...input, bankStatementLineId: input.bankStatementLineId.toString(), publicId }),
      responseStatus: 201,
      errors: this.idempotencyErrors(),
    }, async (tx) => {
      const session = await this.lockSession(tx, context.companyId, publicId);
      this.requireOpenVersion(session, input.sessionVersion);
      await this.lockLines(tx, context.companyId, [input.bankStatementLineId]);
      const line = await tx.bankStatementLine.findFirst({
        where: {
          id: input.bankStatementLineId,
          companyId: context.companyId,
          statementImportId: session.statementImportId,
          bookingDate: { gte: session.dateFrom, lte: session.dateTo },
        },
      });
      if (!line) throw new BankReconciliationError("NOT_FOUND");
      if (line.classification) throw new BankReconciliationError("INVALID_STATE");
      const snapshot = await this.ledgerSnapshotForSession(tx, session, true);
      const movement = snapshot.movements.find((candidate) => candidate.key === input.bookMovementKey);
      if (!movement) throw new BankReconciliationError("NOT_FOUND");
      if (
        line.currencyCode !== movement.currency
        || !line.amount.equals(new Prisma.Decimal(movement.amount))
      ) {
        throw new BankReconciliationError("AMOUNT_OR_CURRENCY_MISMATCH");
      }
      let created;
      try {
        created = await tx.bankReconciliationMatch.create({
          data: {
            ...this.movementData(context.companyId, session.id, line.id, movement),
            source: "MANUAL",
            rule: "MANUAL",
            score: 100,
            status: "APPROVED",
            activeBankStatementLineId: line.id,
            activeBookMovementKey: movement.key,
            approvedById: context.userId,
            approvedAt: new Date(),
          },
        });
      } catch (error) {
        this.translateActiveMatchConflict(error);
      }
      const nextVersion = await this.incrementSessionVersion(tx, session, input.sessionVersion);
      await this.audit(tx, context, "BANK_RECONCILIATION_MANUAL_MATCH_CREATED", "BANK_RECONCILIATION_MATCH", created!.id.toString(), {
        sessionId: session.publicId,
        bankStatementLineId: line.id.toString(),
        bookMovementKey: movement.key,
      });
      return { sessionId: session.publicId, sessionVersion: nextVersion, matchId: created!.id.toString(), matchVersion: 0, status: "APPROVED" };
    });
  }

  async releaseMatch(
    context: ActorContext,
    publicId: string,
    matchId: bigint,
    input: SessionCommandInput & { matchVersion: number; reason: string },
    key: string,
  ) {
    return this.commands.execute({
      context,
      operation: "RELEASE_BANK_RECONCILIATION_MATCH",
      key,
      fingerprint: jsonFingerprint({ publicId, matchId: matchId.toString(), ...input }),
      errors: this.idempotencyErrors(),
    }, async (tx) => {
      const session = await this.lockSession(tx, context.companyId, publicId);
      this.requireOpenVersion(session, input.sessionVersion);
      const match = await tx.bankReconciliationMatch.findFirst({
        where: { id: matchId, companyId: context.companyId, sessionId: session.id },
      });
      if (!match) throw new BankReconciliationError("NOT_FOUND");
      if (match.status !== "APPROVED" || match.version !== input.matchVersion) {
        throw new BankReconciliationError("VERSION_CONFLICT");
      }
      await this.lockLines(tx, context.companyId, [match.bankStatementLineId]);
      await this.ledgerSnapshotForSession(tx, session, true);
      const changed = await tx.bankReconciliationMatch.updateMany({
        where: { id: match.id, companyId: context.companyId, status: "APPROVED", version: input.matchVersion },
        data: {
          status: "RELEASED",
          activeBankStatementLineId: null,
          activeBookMovementKey: null,
          releasedById: context.userId,
          releasedAt: new Date(),
          releaseReason: input.reason,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new BankReconciliationError("VERSION_CONFLICT");
      const nextVersion = await this.incrementSessionVersion(tx, session, input.sessionVersion);
      await this.audit(tx, context, "BANK_RECONCILIATION_MATCH_RELEASED", "BANK_RECONCILIATION_MATCH", match.id.toString(), {
        sessionId: session.publicId,
        reason: input.reason,
        fromVersion: input.matchVersion,
        toVersion: input.matchVersion + 1,
      });
      return { sessionId: session.publicId, sessionVersion: nextVersion, matchId: match.id.toString(), matchVersion: input.matchVersion + 1, status: "RELEASED" };
    });
  }

  async classifyLine(
    context: ActorContext,
    publicId: string,
    lineId: bigint,
    input: SessionCommandInput & {
      lineVersion: number;
      classification: "PENDING_TRANSACTION" | "BANK_FEE" | "BANK_INTEREST" | "BANK_ERROR" | "NEEDS_ACCOUNTING_DOCUMENT";
      note: string;
    },
    key: string,
  ) {
    return this.commands.execute({
      context,
      operation: "CLASSIFY_BANK_STATEMENT_LINE",
      key,
      fingerprint: jsonFingerprint({ publicId, lineId: lineId.toString(), ...input }),
      errors: this.idempotencyErrors(),
    }, async (tx) => {
      const session = await this.lockSession(tx, context.companyId, publicId);
      this.requireOpenVersion(session, input.sessionVersion);
      await this.lockLines(tx, context.companyId, [lineId]);
      const line = await tx.bankStatementLine.findFirst({
        where: {
          id: lineId,
          companyId: context.companyId,
          statementImportId: session.statementImportId,
          bookingDate: { gte: session.dateFrom, lte: session.dateTo },
        },
      });
      if (!line) throw new BankReconciliationError("NOT_FOUND");
      if (await tx.bankReconciliationMatch.findFirst({
        where: { companyId: context.companyId, activeBankStatementLineId: line.id, status: "APPROVED" },
      })) {
        throw new BankReconciliationError("LINE_ALREADY_MATCHED");
      }
      const classifiedAt = new Date();
      const changed = await tx.bankStatementLine.updateMany({
        where: { id: line.id, companyId: context.companyId, version: input.lineVersion },
        data: {
          classification: input.classification,
          classificationNote: input.note,
          classifiedById: context.userId,
          classifiedAt,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new BankReconciliationError("VERSION_CONFLICT");
      const nextVersion = await this.incrementSessionVersion(tx, session, input.sessionVersion);
      await this.audit(tx, context, "BANK_STATEMENT_LINE_CLASSIFIED", "BANK_STATEMENT_LINE", line.id.toString(), {
        sessionId: session.publicId,
        classification: input.classification,
        note: input.note,
        fromVersion: input.lineVersion,
        toVersion: input.lineVersion + 1,
      });
      return { sessionId: session.publicId, sessionVersion: nextVersion, lineId: line.id.toString(), lineVersion: input.lineVersion + 1, classification: input.classification };
    });
  }

  async closeSession(
    context: ActorContext,
    publicId: string,
    input: SessionCommandInput & { explanation?: string | undefined },
    key: string,
  ) {
    return this.commands.execute({
      context,
      operation: "CLOSE_BANK_RECONCILIATION_SESSION",
      key,
      fingerprint: jsonFingerprint({ publicId, ...input }),
      errors: this.idempotencyErrors(),
    }, async (tx) => {
      const session = await this.lockSession(tx, context.companyId, publicId);
      this.requireOpenVersion(session, input.sessionVersion);
      const lines = await tx.bankStatementLine.findMany({
        where: {
          companyId: context.companyId,
          statementImportId: session.statementImportId,
          bookingDate: { gte: session.dateFrom, lte: session.dateTo },
        },
        orderBy: { id: "asc" },
      });
      await this.lockLines(tx, context.companyId, lines.map((line) => line.id));
      const snapshot = await this.ledgerSnapshotForSession(tx, session, true);
      const approved = await tx.bankReconciliationMatch.findMany({
        where: { companyId: context.companyId, sessionId: session.id, status: "APPROVED" },
        orderBy: { id: "asc" },
      });
      const approvedByLine = new Map(approved.map((match) => [match.bankStatementLineId, match]));
      if (lines.some((line) => !approvedByLine.has(line.id) && line.classification === null)) {
        throw new BankReconciliationError("UNRESOLVED_LINES");
      }
      const movementByKey = new Map(snapshot.movements.map((movement) => [movement.key, movement]));
      if (approved.some((match) => {
        const movement = movementByKey.get(match.bookMovementKey);
        return !movement || !this.matchSnapshotEquals(match, movement);
      })) {
        throw new BankReconciliationError("MATCH_FACT_CHANGED");
      }
      const bankNet = lines.reduce((total, line) => total.plus(line.amount), new Prisma.Decimal(0));
      const difference = bankNet.minus(snapshot.netMovement);
      if (!difference.isZero() && !input.explanation?.trim()) {
        throw new BankReconciliationError("CLOSING_EXPLANATION_REQUIRED");
      }
      const closedAt = new Date();
      const changed = await tx.bankReconciliationSession.updateMany({
        where: {
          id: session.id,
          companyId: context.companyId,
          status: "OPEN",
          version: input.sessionVersion,
        },
        data: {
          status: "CLOSED",
          bookOpeningBalance: snapshot.openingBalance,
          bookClosingBalance: snapshot.closingBalance,
          bookNetMovement: snapshot.netMovement,
          bankNetMovement: bankNet,
          difference,
          closedById: context.userId,
          closedAt,
          closingExplanation: difference.isZero() ? null : input.explanation!.trim(),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new BankReconciliationError("VERSION_CONFLICT");
      await this.audit(tx, context, "BANK_RECONCILIATION_SESSION_CLOSED", "BANK_RECONCILIATION_SESSION", session.publicId, {
        difference: difference.toFixed(4),
        resolvedByMatches: approved.length,
        resolvedByClassification: lines.filter((line) => line.classification !== null).length,
        explanation: difference.isZero() ? null : input.explanation!.trim(),
        fromVersion: input.sessionVersion,
        toVersion: input.sessionVersion + 1,
      });
      return {
        sessionId: session.publicId,
        sessionVersion: input.sessionVersion + 1,
        status: "CLOSED",
        difference: difference.toFixed(4),
        closedAt: closedAt.toISOString(),
      };
    });
  }

  static importJson(value: {
    publicId: string;
    cashBankAccountId: bigint;
    format: string;
    sourceHashSha256: Uint8Array;
    statementId: string | null;
    accountIdentifierLast4: string | null;
    currencyCode: string;
    periodStart: Date;
    periodEnd: Date;
    openingBalance: Prisma.Decimal | null;
    closingBalance: Prisma.Decimal | null;
    netMovement: Prisma.Decimal;
    lineCount: number;
    ignoredEntryCount: number;
    status: string;
    version: number;
    committedAt: Date;
    cancelledAt: Date | null;
    createdAt: Date;
    cashBankAccount: { id: bigint; code: string; nameAr: string };
  }) {
    return {
      id: value.publicId,
      cashBankAccount: {
        id: value.cashBankAccount.id.toString(),
        code: value.cashBankAccount.code,
        nameAr: value.cashBankAccount.nameAr,
      },
      format: value.format,
      sourceHashSha256: Buffer.from(value.sourceHashSha256).toString("hex"),
      statementId: value.statementId,
      accountIdentifierMasked: value.accountIdentifierLast4 ? `****${value.accountIdentifierLast4}` : null,
      currency: value.currencyCode,
      periodStart: isoDate(value.periodStart),
      periodEnd: isoDate(value.periodEnd),
      openingBalance: value.openingBalance?.toFixed(4) ?? null,
      closingBalance: value.closingBalance?.toFixed(4) ?? null,
      netMovement: value.netMovement.toFixed(4),
      lineCount: value.lineCount,
      ignoredEntryCount: value.ignoredEntryCount,
      status: value.status,
      version: value.version,
      committedAt: value.committedAt.toISOString(),
      cancelledAt: value.cancelledAt?.toISOString() ?? null,
      createdAt: value.createdAt.toISOString(),
    };
  }

  static lineJson(value: {
    id: bigint;
    sourceRowNumber: number;
    bookingDate: Date;
    valueDate: Date | null;
    amount: Prisma.Decimal;
    currencyCode: string;
    fingerprintSha256: Uint8Array;
    externalId: string | null;
    reference: string | null;
    description: string | null;
    classification: string | null;
    classificationNote: string | null;
    classifiedAt: Date | null;
    version: number;
  }) {
    return {
      id: value.id.toString(),
      sourceRowNumber: value.sourceRowNumber,
      bookingDate: isoDate(value.bookingDate),
      valueDate: value.valueDate ? isoDate(value.valueDate) : null,
      amount: value.amount.toFixed(4),
      direction: value.amount.isNegative() ? "DEBIT" : "CREDIT",
      currency: value.currencyCode,
      fingerprintSha256: Buffer.from(value.fingerprintSha256).toString("hex"),
      externalId: value.externalId,
      reference: value.reference,
      description: value.description,
      classification: value.classification,
      classificationNote: value.classificationNote,
      classifiedAt: value.classifiedAt?.toISOString() ?? null,
      version: value.version,
    };
  }

  static sessionJson(value: {
    publicId: string;
    cashBankAccountId: bigint;
    statementImportId: bigint;
    dateFrom: Date;
    dateTo: Date;
    currencyCode: string;
    bankOpeningBalance: Prisma.Decimal | null;
    bankClosingBalance: Prisma.Decimal | null;
    bankNetMovement: Prisma.Decimal;
    bookOpeningBalance: Prisma.Decimal;
    bookClosingBalance: Prisma.Decimal;
    bookNetMovement: Prisma.Decimal;
    difference: Prisma.Decimal;
    status: string;
    version: number;
    closedAt: Date | null;
    closingExplanation: string | null;
    createdAt: Date;
    cashBankAccount: { id: bigint; code: string; nameAr: string };
    statementImport: { publicId: string };
  }) {
    return {
      id: value.publicId,
      statementImportId: value.statementImport.publicId,
      cashBankAccount: {
        id: value.cashBankAccount.id.toString(),
        code: value.cashBankAccount.code,
        nameAr: value.cashBankAccount.nameAr,
      },
      dateFrom: isoDate(value.dateFrom),
      dateTo: isoDate(value.dateTo),
      currency: value.currencyCode,
      bankOpeningBalance: value.bankOpeningBalance?.toFixed(4) ?? null,
      bankClosingBalance: value.bankClosingBalance?.toFixed(4) ?? null,
      bankNetMovement: value.bankNetMovement.toFixed(4),
      bookOpeningBalance: value.bookOpeningBalance.toFixed(4),
      bookClosingBalance: value.bookClosingBalance.toFixed(4),
      bookNetMovement: value.bookNetMovement.toFixed(4),
      difference: value.difference.toFixed(4),
      status: value.status,
      version: value.version,
      closedAt: value.closedAt?.toISOString() ?? null,
      closingExplanation: value.closingExplanation,
      createdAt: value.createdAt.toISOString(),
    };
  }

  static matchJson(value: {
    id: bigint;
    bankStatementLineId: bigint;
    bookMovementKey: string;
    bookMovementDate: Date;
    bookAmount: Prisma.Decimal;
    currencyCode: string;
    bookReference: string | null;
    bookDocumentType: string;
    bookDocumentNumber: string;
    status: string;
    source: string;
    rule: string;
    score: number;
    version: number;
    approvedAt: Date | null;
    releasedAt: Date | null;
    releaseReason: string | null;
    createdAt: Date;
  }) {
    return {
      id: value.id.toString(),
      bankStatementLineId: value.bankStatementLineId.toString(),
      bookMovement: {
        key: value.bookMovementKey,
        occurredOn: isoDate(value.bookMovementDate),
        amount: value.bookAmount.toFixed(4),
        currency: value.currencyCode,
        reference: value.bookReference,
        documentType: value.bookDocumentType,
        documentNumber: value.bookDocumentNumber,
      },
      status: value.status,
      source: value.source,
      rule: value.rule,
      score: value.score,
      version: value.version,
      approvedAt: value.approvedAt?.toISOString() ?? null,
      releasedAt: value.releasedAt?.toISOString() ?? null,
      releaseReason: value.releaseReason,
      createdAt: value.createdAt.toISOString(),
    };
  }

  private parse(input: BankStatementFileInput) {
    try {
      return this.parser.parse(decodeBase64(input.contentBase64), parseRequest(input));
    } catch (error) {
      if (error instanceof BankStatementParseError || error instanceof BankReconciliationError) throw error;
      throw new BankReconciliationError("INVALID_FILE_CONTENT");
    }
  }

  private assertDateRange(dateFrom: string, dateTo: string) {
    if (dateFrom > dateTo) throw new BankReconciliationError("INVALID_DATE_RANGE");
  }

  private async requireBankAccount(
    client: PrismaClient | Prisma.TransactionClient,
    companyId: bigint,
    cashBankAccountId: bigint,
  ) {
    const account = await client.cashBankAccount.findFirst({
      where: { id: cashBankAccountId, companyId, accountType: "BANK", isActive: true },
    });
    if (!account) throw new BankReconciliationError("INVALID_BANK_ACCOUNT");
    return account;
  }

  private async requireCurrency(
    client: PrismaClient | Prisma.TransactionClient,
    companyId: bigint,
    code: string,
  ) {
    const currency = await client.currency.findFirst({
      where: {
        code,
        isActive: true,
        OR: [
          { scope: "GLOBAL", companyCurrencies: { some: { companyId, isActive: true } } },
          { scope: "COMPANY", ownerCompanyId: companyId, companyCurrencies: { some: { companyId, isActive: true } } },
        ],
      },
      select: { id: true },
    });
    if (!currency) throw new BankReconciliationError("INVALID_CURRENCY");
  }

  private assertStatementAccount(
    account: { accountNumberLast4: string | null; ibanLast4: string | null },
    accountIdentifier?: string,
  ) {
    if (!accountIdentifier) return;
    const configured = [account.accountNumberLast4, account.ibanLast4]
      .filter((value): value is string => value !== null);
    if (configured.length > 0 && !configured.includes(last4(accountIdentifier) ?? "")) {
      throw new BankStatementParseError("ACCOUNT_MISMATCH");
    }
  }

  private idempotencyErrors() {
    return {
      mismatch: () => new BankReconciliationError("IDEMPOTENCY_MISMATCH"),
      inProgress: () => new BankReconciliationError("IDEMPOTENCY_IN_PROGRESS"),
    };
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    entityType: string,
    entityId: string,
    details: Prisma.InputJsonValue,
  ) {
    return tx.auditLog.create({
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType,
        entityId,
        details,
      },
    });
  }

  private async lockSession(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    await tx.$queryRaw`
      SELECT id
      FROM bank_reconciliation_sessions
      WHERE company_id = ${companyId} AND public_id = ${publicId}
      FOR UPDATE
    `;
    const session = await tx.bankReconciliationSession.findFirst({
      where: { publicId, companyId },
      include: { cashBankAccount: true },
    });
    if (!session) throw new BankReconciliationError("NOT_FOUND");
    return session;
  }

  private async lockLines(tx: Prisma.TransactionClient, companyId: bigint, ids: bigint[]) {
    const ordered = [...new Set(ids)].sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
    if (!ordered.length) return;
    await tx.$queryRaw(Prisma.sql`
      SELECT id
      FROM bank_statement_lines
      WHERE company_id = ${companyId} AND id IN (${Prisma.join(ordered)})
      ORDER BY id
      FOR UPDATE
    `);
  }

  private requireOpenVersion(
    session: { status: string; version: number },
    version: number,
  ) {
    if (session.status !== "OPEN") throw new BankReconciliationError("INVALID_STATE");
    if (session.version !== version) throw new BankReconciliationError("VERSION_CONFLICT");
  }

  private async incrementSessionVersion(
    tx: Prisma.TransactionClient,
    session: { id: bigint; companyId: bigint },
    version: number,
  ) {
    const changed = await tx.bankReconciliationSession.updateMany({
      where: { id: session.id, companyId: session.companyId, status: "OPEN", version },
      data: { version: { increment: 1 } },
    });
    if (changed.count !== 1) throw new BankReconciliationError("VERSION_CONFLICT");
    return version + 1;
  }

  private ledgerSnapshotForSession(
    tx: Prisma.TransactionClient,
    session: {
      companyId: bigint;
      currencyCode: string;
      dateFrom: Date;
      dateTo: Date;
      cashBankAccount: { ledgerAccountId: bigint };
    },
    lockMovements: boolean,
  ) {
    return this.ledger.snapshot(tx, {
      companyId: session.companyId,
      ledgerAccountId: session.cashBankAccount.ledgerAccountId,
      currencyCode: session.currencyCode,
      range: { dateFrom: isoDate(session.dateFrom), dateTo: isoDate(session.dateTo) },
      lockMovements,
    });
  }

  private proposalData(
    companyId: bigint,
    sessionId: bigint,
    proposal: {
      bankStatementLineId: bigint;
      bookMovement: TreasuryMovementFact;
      rule: "EXACT_REFERENCE_AMOUNT_CURRENCY" | "EXACT_AMOUNT_CURRENCY_DATE";
      score: 100 | 70;
    },
  ) {
    return {
      ...this.movementData(companyId, sessionId, proposal.bankStatementLineId, proposal.bookMovement),
      source: "SUGGESTED" as const,
      rule: proposal.rule,
      score: proposal.score,
    };
  }

  private movementData(
    companyId: bigint,
    sessionId: bigint,
    bankStatementLineId: bigint,
    movement: TreasuryMovementFact,
  ) {
    return {
      companyId,
      sessionId,
      bankStatementLineId,
      bookMovementKey: movement.key,
      bookMovementDate: toDate(movement.occurredOn),
      bookAmount: movement.amount,
      currencyCode: movement.currency,
      bookReference: movement.reference ?? null,
      bookDocumentType: movement.documentType,
      bookDocumentNumber: movement.documentNumber,
    };
  }

  private matchSnapshotEquals(
    match: {
      bookMovementDate: Date;
      bookAmount: Prisma.Decimal;
      currencyCode: string;
      bookReference: string | null;
      bookDocumentType: string;
      bookDocumentNumber: string;
    },
    movement: TreasuryMovementFact,
  ) {
    return isoDate(match.bookMovementDate) === movement.occurredOn
      && match.bookAmount.equals(new Prisma.Decimal(movement.amount))
      && match.currencyCode === movement.currency
      && match.bookReference === (movement.reference ?? null)
      && match.bookDocumentType === movement.documentType
      && match.bookDocumentNumber === movement.documentNumber;
  }

  private translateActiveMatchConflict(error: unknown): never | void {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error;
    const target = JSON.stringify(error.meta?.target ?? "");
    if (target.includes("active_bank_statement_line_id")) {
      throw new BankReconciliationError("LINE_ALREADY_MATCHED");
    }
    if (target.includes("active_book_movement_key")) {
      throw new BankReconciliationError("BOOK_MOVEMENT_ALREADY_MATCHED");
    }
    throw error;
  }
}
