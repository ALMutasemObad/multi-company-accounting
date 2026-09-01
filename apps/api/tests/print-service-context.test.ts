import type { PrismaClient } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PrintService } from "../src/printing/print-service.js";
import { assertRequestActive, ClientDisconnectedError, runWithRequestContext } from "../src/operations/request-context.js";
import { printSnapshotFixture } from "./fixtures/print-snapshot.js";

const dependencies = vi.hoisted(() => ({ archiveDocument: vi.fn(), snapshotHashMatches: vi.fn(), render: vi.fn(), appendAudit: vi.fn() }));
vi.mock("../src/printing/print-archive.js", () => ({ archiveDocument: dependencies.archiveDocument, snapshotHashMatches: dependencies.snapshotHashMatches }));
vi.mock("../src/printing/pdf-renderer.js", () => ({ renderDocumentPdf: dependencies.render }));
vi.mock("../src/audit/prisma-audit-append-adapter.js", () => ({ appendAudit: dependencies.appendAudit }));

const actor = { userId: 7n, companyId: 1n };

function fixture() {
  const trace: string[] = [];
  const state = { insideTransaction: false, archived: false, printCount: 0 };
  const archived = { id: 91n, snapshotHash: "stored-hash", snapshot: printSnapshotFixture,
    createdAt: new Date("2026-08-11T10:30:00.000Z"), lastPrintedAt: null as Date | null, printCount: 0 };
  const updateMany = vi.fn(async () => { trace.push("first-print"); return { count: 1 }; });
  const update = vi.fn(async () => {
    trace.push("print-count"); state.printCount += 1;
    return { ...archived, printCount: state.printCount, lastPrintedAt: new Date("2026-08-31T10:30:00.000Z") };
  });
  const tx = { documentPrintArchive: { updateMany, update } };
  const transaction = vi.fn(async (work: (value: typeof tx) => Promise<unknown>) => {
    trace.push("transaction-start"); state.insideTransaction = true;
    try { return await work(tx); } finally { state.insideTransaction = false; trace.push("transaction-end"); }
  });
  dependencies.archiveDocument.mockImplementation(async () => { trace.push("archive"); state.archived = true; return archived; });
  dependencies.snapshotHashMatches.mockReturnValue(true);
  dependencies.render.mockImplementation(async () => { trace.push("render"); return Buffer.from("fixture PDF"); });
  dependencies.appendAudit.mockImplementation(async () => { trace.push("audit"); });
  const resolve = vi.fn(async () => { trace.push("resolve"); return 118n; });
  const printing = new PrintService({ $transaction: transaction } as unknown as PrismaClient, { resolve });
  return { printing, trace, state, archived, tx, transaction, updateMany, update, resolve };
}

describe("Printing optional authorization checkpoints (isolated transaction/renderer ports, no DB/PDF)", () => {
  beforeEach(() => vi.resetAllMocks());

  it("preserves archive, render and original printCount/Audit effects for a legacy caller", async () => {
    const f = fixture(); const result = await f.printing.print(actor, "SALES_INVOICE", 801n);
    expect(f.resolve).toHaveBeenCalledExactlyOnceWith(1n, "SALES_INVOICE", 801n);
    expect(f.transaction).toHaveBeenCalledTimes(2); expect(dependencies.archiveDocument).toHaveBeenCalledExactlyOnceWith(f.tx, actor, 118n);
    expect(dependencies.render).toHaveBeenCalledExactlyOnceWith(printSnapshotFixture);
    expect(f.updateMany).toHaveBeenCalledExactlyOnceWith({ where: { id: 91n, firstPrintedAt: null }, data: { firstPrintedAt: expect.any(Date) } });
    expect(f.update).toHaveBeenCalledExactlyOnceWith({ where: { id: 91n }, data: { printCount: { increment: 1 }, lastPrintedAt: expect.any(Date) } });
    expect(dependencies.appendAudit).toHaveBeenCalledExactlyOnceWith(f.tx, { data: {
      companyId: 1n, actorUserId: 7n, action: "DOCUMENT_PDF_PRINTED", entityType: "ACCOUNTING_DOCUMENT", entityId: "118",
      details: { archiveId: "91", printNumber: 1 },
    } });
    expect(result).toMatchObject({ buffer: Buffer.from("fixture PDF"), filename: "sales_invoice-REC-2026-000118.pdf", archive: { id: "91", hash: "stored-hash", printCount: 1 } });
  });

  it("reauthorizes outside each transaction and only after render before print effects", async () => {
    const f = fixture(); const authorize = vi.fn(async () => {
      expect(f.state.insideTransaction).toBe(false); f.trace.push("authorize");
    });
    await f.printing.print(actor, "SALES_INVOICE", 801n, authorize);
    expect(authorize).toHaveBeenCalledTimes(2);
    expect(f.trace).toEqual(["resolve", "authorize", "transaction-start", "archive", "transaction-end", "render", "authorize",
      "transaction-start", "first-print", "print-count", "audit", "transaction-end"]);
  });

  it("does not start archive creation, render or effects when initial authorization is rejected", async () => {
    const f = fixture(); const denied = new Error("AUTH_REVOKED"); const authorize = vi.fn(async () => { throw denied; });
    await expect(f.printing.print(actor, "SALES_INVOICE", 801n, authorize)).rejects.toBe(denied);
    expect(f.state.archived).toBe(false); expect(f.transaction).not.toHaveBeenCalled();
    expect(dependencies.render).not.toHaveBeenCalled(); expect(dependencies.appendAudit).not.toHaveBeenCalled();
  });

  it("rejects after render without printCount/Audit, while retaining the earlier archive commit", async () => {
    const f = fixture(); const denied = new Error("CONTEXT_CHANGED");
    const authorize = vi.fn<() => Promise<void>>().mockResolvedValueOnce(undefined).mockRejectedValueOnce(denied);
    await expect(f.printing.print(actor, "SALES_INVOICE", 801n, authorize)).rejects.toBe(denied);
    expect(f.state.archived).toBe(true); expect(f.state.printCount).toBe(0);
    expect(f.transaction).toHaveBeenCalledTimes(1); expect(dependencies.render).toHaveBeenCalledTimes(1);
    expect(f.updateMany).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled(); expect(dependencies.appendAudit).not.toHaveBeenCalled();
  });

  it.each(["before-archive", "after-render"])("honors a disconnected request at %s without starting the following transaction", async stage => {
    const f = fixture(); const controller = new AbortController(); const disconnected = new ClientDisconnectedError("PRINT_SALES_INVOICE");
    if (stage === "before-archive") controller.abort(disconnected);
    else dependencies.render.mockImplementation(async () => { controller.abort(disconnected); return Buffer.from("fixture PDF"); });
    const printing = runWithRequestContext({ requestId: "print-fixture", requestClass: "READ", startedAt: Date.now(),
      deadlineAt: Date.now() + 10_000, signal: controller.signal, deadlineMetricRecorded: false },
    () => f.printing.print(actor, "SALES_INVOICE", 801n, async () => assertRequestActive("PRINT_SALES_INVOICE")));
    await expect(printing).rejects.toBe(disconnected);
    expect(f.transaction).toHaveBeenCalledTimes(stage === "before-archive" ? 0 : 1);
    expect(f.state.archived).toBe(stage === "after-render"); expect(f.state.printCount).toBe(0);
    expect(f.updateMany).not.toHaveBeenCalled(); expect(f.update).not.toHaveBeenCalled(); expect(dependencies.appendAudit).not.toHaveBeenCalled();
  });

  it("does not start print effects when the renderer fails", async () => {
    const f = fixture(); const failed = new Error("render failed"); dependencies.render.mockRejectedValue(failed);
    const authorize = vi.fn(async () => {});
    await expect(f.printing.print(actor, "SALES_INVOICE", 801n, authorize)).rejects.toBe(failed);
    expect(authorize).toHaveBeenCalledTimes(1); expect(f.transaction).toHaveBeenCalledTimes(1);
    expect(f.update).not.toHaveBeenCalled(); expect(dependencies.appendAudit).not.toHaveBeenCalled();
  });
});
