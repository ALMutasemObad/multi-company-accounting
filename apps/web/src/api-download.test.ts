import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, downloadFile, downloadPdf } from "./api";
import { loadLocale } from "./i18n/core";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function fixture() {
  const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const createElement = vi.fn(() => anchor);
  const appendChild = vi.fn();
  const createObjectURL = vi.fn(() => "blob:fixture");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("document", { createElement, body: { appendChild } });
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.stubGlobal("window", { setTimeout });
  const fetchMock = vi.fn< typeof fetch >();
  vi.stubGlobal("fetch", fetchMock);
  const response = new Response("fixture pdf", { status: 200, headers: {
    "Content-Type": "application/pdf", "Content-Disposition": 'attachment; filename="sales-invoice-118.pdf"',
    "X-POS-User-Id": "1", "X-POS-Company-Id": "2", "X-Sales-Invoice-Id": "801",
  } });
  fetchMock.mockResolvedValue(response);
  return { anchor, createElement, appendChild, createObjectURL, revokeObjectURL, fetchMock, response };
}

describe("existing download owner with optional context guard (no browser or HTTP)", () => {
  // Match main.tsx bootstrap and the recovery-page harness before real messageForError runs.
  beforeAll(async () => { await loadLocale("ar"); });
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("keeps the legacy PDF path, cookie credentials, server filename and delayed URL cleanup without options", async () => {
    const f = fixture();
    await downloadPdf("/sales-invoices/801/pdf");
    expect(f.fetchMock).toHaveBeenCalledExactlyOnceWith("/api/v1/sales-invoices/801/pdf", expect.objectContaining({ credentials: "include" }));
    expect(f.anchor.href).toBe("blob:fixture"); expect(f.anchor.download).toBe("sales-invoice-118.pdf");
    expect(f.anchor.click).toHaveBeenCalledTimes(1); expect(f.anchor.remove).toHaveBeenCalledTimes(1);
    expect(f.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000); expect(f.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:fixture");
  });

  it.each(["file", "pdf"])("retains the %s fallback filename", async kind => {
    const f = fixture(); f.fetchMock.mockResolvedValue(new Response("fixture"));
    if (kind === "file") await downloadFile("/export", "export.csv");
    else await downloadPdf("/receipts/12/pdf");
    expect(f.anchor.download).toBe(kind === "file" ? "export.csv" : "accounting-document.pdf");
  });

  it("sends caller headers and guards response identity before allocating or saving the blob", async () => {
    const f = fixture(); const headers = { "X-POS-Expected-User-Id": "1", "X-POS-Expected-Company-Id": "2" };
    const beforeSave = vi.fn((response: Response, signal: AbortSignal) => {
      expect(signal.aborted).toBe(false); expect(response).toBe(f.response);
      expect(response.headers.get("X-Sales-Invoice-Id")).toBe("801");
      expect(f.createObjectURL).not.toHaveBeenCalled(); expect(f.anchor.click).not.toHaveBeenCalled();
    });
    await downloadPdf("/sales-invoices/801/pdf", { headers, beforeSave });
    expect(f.fetchMock.mock.calls[0]![1]?.headers).toBe(headers);
    expect(beforeSave).toHaveBeenCalledTimes(1); expect(f.anchor.click).toHaveBeenCalledTimes(1);
  });

  it("does not allocate or save a response rejected as another identity", async () => {
    const f = fixture(); const mismatch = new Error("RETAIL_RECEIPT_SOURCE_MISMATCH");
    const beforeSave = vi.fn((response: Response) => {
      if (response.headers.get("X-POS-Company-Id") !== "3") throw mismatch;
    });
    await expect(downloadPdf("/sales-invoices/801/pdf", { beforeSave })).rejects.toBe(mismatch);
    expect(f.createObjectURL).not.toHaveBeenCalled(); expect(f.createElement).not.toHaveBeenCalled();
  });

  it("preserves HTTP business errors without consuming a PDF blob or calling the save guard", async () => {
    const f = fixture(); const response = new Response(JSON.stringify({ code: "POS_CONTEXT_CHANGED" }), { status: 409 });
    const blob = vi.spyOn(response, "blob"); const beforeSave = vi.fn(); f.fetchMock.mockResolvedValue(response);
    await expect(downloadPdf("/sales-invoices/801/pdf", { beforeSave })).rejects.toMatchObject({ status: 409, code: "POS_CONTEXT_CHANGED" } satisfies Partial<ApiError>);
    expect(blob).not.toHaveBeenCalled(); expect(beforeSave).not.toHaveBeenCalled(); expect(f.createObjectURL).not.toHaveBeenCalled();
  });

  it("does not start a request for a signal that was already cancelled", async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort();
    await expect(downloadPdf("/sales-invoices/801/pdf", { signal: controller.signal })).rejects.toMatchObject({ kind: "cancelled" });
    expect(f.fetchMock).not.toHaveBeenCalled(); expect(f.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects a late fetch even when its transport ignores cancellation", async () => {
    const f = fixture(); const pending = deferred<Response>(); const controller = new AbortController();
    const blob = vi.spyOn(f.response, "blob"); f.fetchMock.mockReturnValue(pending.promise);
    const downloading = downloadPdf("/sales-invoices/801/pdf", { signal: controller.signal });
    const rejected = expect(downloading).rejects.toMatchObject({ kind: "cancelled" });
    controller.abort(); pending.resolve(f.response); await rejected;
    expect(blob).not.toHaveBeenCalled(); expect(f.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects a late blob after cancellation without running the guard or saving", async () => {
    const f = fixture(); const pending = deferred<Blob>(); const entered = deferred<void>();
    const controller = new AbortController(); const beforeSave = vi.fn();
    vi.spyOn(f.response, "blob").mockImplementation(() => { entered.resolve(); return pending.promise; });
    const downloading = downloadPdf("/sales-invoices/801/pdf", { signal: controller.signal, beforeSave });
    const rejected = expect(downloading).rejects.toMatchObject({ kind: "cancelled" });
    await entered.promise; controller.abort(); pending.resolve(new Blob(["late"])); await rejected;
    expect(beforeSave).not.toHaveBeenCalled(); expect(f.createObjectURL).not.toHaveBeenCalled();
  });

  it("checks cancellation again after an asynchronous beforeSave guard", async () => {
    const f = fixture(); const pending = deferred<void>(); const entered = deferred<void>(); const controller = new AbortController();
    const beforeSave = vi.fn(() => { entered.resolve(); return pending.promise; });
    const downloading = downloadPdf("/sales-invoices/801/pdf", { signal: controller.signal, beforeSave });
    const rejected = expect(downloading).rejects.toMatchObject({ kind: "cancelled" });
    await entered.promise; controller.abort(); pending.resolve(); await rejected;
    expect(f.createObjectURL).not.toHaveBeenCalled(); expect(f.anchor.click).not.toHaveBeenCalled();
  });

  it("keeps blob consumption in the same deadline and blocks its late result", async () => {
    const f = fixture(); const pending = deferred<Blob>(); const entered = deferred<void>();
    vi.spyOn(f.response, "blob").mockImplementation(() => { entered.resolve(); return pending.promise; });
    const downloading = downloadPdf("/sales-invoices/801/pdf", { timeoutMs: 30 });
    const rejected = expect(downloading).rejects.toMatchObject({ kind: "timeout" });
    await entered.promise; vi.advanceTimersByTime(30); pending.resolve(new Blob(["late"])); await rejected;
    expect(f.createObjectURL).not.toHaveBeenCalled(); expect(f.anchor.click).not.toHaveBeenCalled();
  });

  it("removes the temporary anchor and immediately revokes its URL if saving fails", async () => {
    const f = fixture(); const failure = new Error("save failed"); f.anchor.click.mockImplementation(() => { throw failure; });
    await expect(downloadPdf("/sales-invoices/801/pdf")).rejects.toBe(failure);
    expect(f.anchor.remove).toHaveBeenCalledTimes(1); expect(f.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:fixture");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("checks cancellation before clicking and cleans resources allocated before that cancellation", async () => {
    const f = fixture(); const controller = new AbortController(); f.appendChild.mockImplementation(() => controller.abort());
    await expect(downloadPdf("/sales-invoices/801/pdf", { signal: controller.signal })).rejects.toMatchObject({ kind: "cancelled" });
    expect(f.anchor.click).not.toHaveBeenCalled(); expect(f.anchor.remove).toHaveBeenCalledTimes(1);
    expect(f.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:fixture");
  });
});
