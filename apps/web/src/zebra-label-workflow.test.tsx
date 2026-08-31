import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZebraLabelWorkflow } from "./ZebraLabelWorkflow";
import { ZebraLabelController, type ZebraLabelScope } from "./zebra-label-direct-print";
import { emptyZebraLabelDraft, validateZebraLabelArtifact, zebraLabelRequest, ZEBRA_LABEL_LIMITS, type ZebraLabelDraft } from "./zebra-label-model";
import { unavailableZebraLabelDirectPrint, type ZebraLabelArtifact, type ZebraLabelPrinter, type ZebraLabelRequest } from "./zebra-label-ports";
import { zebraLabelMessages } from "./zebra-label-messages";

// Protocol fixture only. Physical barcode and printer acceptance are NOT asserted here.
function artifact(request: ZebraLabelRequest): ZebraLabelArtifact {
  const png = Uint8Array.from(atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0MsAAAAASUVORK5CYII="), (c) => c.charCodeAt(0));
  const w = Math.floor(request.media.widthMm * request.media.dpi / 25.4), h = Math.floor(request.media.heightMm * request.media.dpi / 25.4);
  return { ...request, rendererProfile: "INVENTORY_203_DPI_V1", png, raster: { widthDots: 1, heightDots: 1 }, mediaDots: { widthDots: w, heightDots: h },
    placement: { xDots: Math.floor((w - 1) / 2), yDots: Math.floor((h - 1) / 2), widthDots: 1, heightDots: 1, rotation: request.media.orientation === "normal" ? 0 : 90 } };
}
const draft: ZebraLabelDraft = { model: "TEST-MODEL", connection: "usb", printerId: "test-device", widthMm: "80", heightMm: "50", dpi: "203", orientation: "normal", quantity: "2" };
function harness() {
  let scope: ZebraLabelScope = { actorId: "7", authorizationRevision: "session-1", source: { companyId: "1", inventoryItemId: "2", barcodeId: "3" }, permissions: new Set(["inventory_barcodes.print"]), itemIsActive: true, barcodeIsActive: true };
  let now = 10_000;
  const printers: ZebraLabelPrinter[] = [{ id: "test-device", companyId: "1", label: "Test fixture (not a device)", model: "TEST-MODEL", connection: "usb", dpi: 203, maxWidthMm: 100, maxHeightMm: 100, approved: true, supportEvidence: "test-only" }];
  const prepare = vi.fn(async (request: ZebraLabelRequest) => artifact(request));
  const authorizeSubmission = vi.fn(async (_artifact: ZebraLabelArtifact, _signal: AbortSignal) => undefined);
  const submit = vi.fn(async (_job: { printer: ZebraLabelPrinter; artifact: ZebraLabelArtifact }, _signal: AbortSignal): Promise<{ status: "sent" | "queued" }> => ({ status: "sent" }));
  const direct = { available: true, submit };
  const controller = new ZebraLabelController({ scope: () => scope, printers: () => printers, preparation: { prepare, authorizeSubmission }, direct, now: () => now });
  controller.updateDraft(draft);
  return { controller, prepare, authorizeSubmission, submit, printers, direct, scope: () => scope, setScope: (s: ZebraLabelScope) => { scope = s; }, advance: (n: number) => { now += n; }, setClock: (n: number) => { now = n; } };
}
afterEach(() => vi.useRealTimers());

describe("Zebra isolated setup and owner artifact", () => {
  it("starts with no invented device, connection, dimensions, quantity or DPI and does no I/O on mount", () => {
    expect(Object.values(emptyZebraLabelDraft()).every((v) => v === "")).toBe(true);
    const h = harness();
    const html = renderToStaticMarkup(<ZebraLabelWorkflow scope={h.scope()} locale="ar" preparation={{ prepare: h.prepare, authorizeSubmission: h.authorizeSubmission }} />);
    expect(html).toContain('dir="rtl"'); expect(html).toContain(zebraLabelMessages.ar.noPrinters);
    expect(html).toMatch(/type="button" disabled=""/u);
    expect(h.prepare).not.toHaveBeenCalled(); expect(h.submit).not.toHaveBeenCalled();
  });
  it("has all four self-contained dictionaries and no empty messages", () => {
    for (const locale of ["ar", "en", "ur", "hi"] as const) {
      expect(Object.keys(zebraLabelMessages[locale]).sort()).toEqual(Object.keys(zebraLabelMessages.ar).sort());
      expect(Object.values(zebraLabelMessages[locale]).every((m) => m.trim())).toBe(true);
      expect(renderToStaticMarkup(<ZebraLabelWorkflow scope={harness().scope()} locale={locale} />)).toContain(zebraLabelMessages[locale].title);
    }
  });
  it.each(["0", "-1", "101", "1.5", "Infinity", "1e2", ""]) ("rejects unsafe quantity %s before owner I/O", async (quantity) => {
    const h = harness(); h.controller.updateDraft({ quantity }); await h.controller.prepare();
    expect(h.prepare).not.toHaveBeenCalled(); expect(h.controller.readiness()).toBe("settings");
  });
  it("rejects huge pixel allocations and unsupported DPI without resizing", async () => {
    const h = harness(); h.controller.updateDraft({ widthMm: "300", heightMm: "300", quantity: "100" });
    await h.controller.prepare(); expect(h.prepare).not.toHaveBeenCalled();
    h.controller.updateDraft({ ...draft, dpi: "300" }); await h.controller.prepare();
    expect(h.prepare).not.toHaveBeenCalled(); expect(h.controller.readiness()).toBe("unsupportedDpi");
  });
  it("fails closed without installed/approved transport even with valid preview", async () => {
    const h = harness(); h.direct.available = false; await h.controller.prepare(); await h.controller.submit();
    expect(h.controller.readiness()).toBe("adapterUnavailable"); expect(h.submit).not.toHaveBeenCalled();
    expect(unavailableZebraLabelDirectPrint.available).toBe(false);
    await expect(unavailableZebraLabelDirectPrint.submit({ printer: h.printers[0]!, artifact: artifact(zebraLabelRequest(h.scope().source, draft)!) }, new AbortController().signal)).rejects.toThrow("UNAVAILABLE");
  });
  it("rejects output from a different company and metadata tampering before preview", async () => {
    const h = harness(); h.prepare.mockImplementation(async (r) => artifact({ ...r, source: { ...r.source, companyId: "2" } }));
    await h.controller.prepare(); expect(h.controller.getSnapshot().status).toBe("error"); expect(h.controller.getSnapshot().preview).toBeNull();
    const r = zebraLabelRequest(h.scope().source, draft)!, a = artifact(r);
    expect(() => validateZebraLabelArtifact({ ...a, placement: { ...a.placement, xDots: 0 } }, r)).toThrow();
    expect(() => validateZebraLabelArtifact({ ...a, png: new Uint8Array(ZEBRA_LABEL_LIMITS.pngBytes + 1) }, r)).toThrow();
  });
  it("removes preview on edits and never sends automatically", async () => {
    const h = harness(); await h.controller.prepare(); expect(h.controller.readiness()).toBe("ready");
    h.controller.updateDraft({ orientation: "rotate90" }); expect(h.controller.getSnapshot().preview).toBeNull();
    await h.controller.submit(); expect(h.submit).not.toHaveBeenCalled();
  });
});

describe("one-shot submission and changing authorization", () => {
  it("reauthorizes and sends only once for concurrent actions, keeping sent distinct from printed", async () => {
    const h = harness(); await h.controller.prepare(); await Promise.all([h.controller.submit(), h.controller.submit(), h.controller.submit()]);
    expect(h.authorizeSubmission).toHaveBeenCalledTimes(1); expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.controller.getSnapshot().status).toBe("sent"); await h.controller.submit(); expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.controller.getSnapshot().hasSubmissionAttempt).toBe(true);
    h.controller.updateDraft({ quantity: "3" }); expect(h.controller.getSnapshot().hasSubmissionAttempt).toBe(true);
  });
  it("does not expose its send artifact to mutable UI preview bytes", async () => {
    const h = harness(); await h.controller.prepare(); h.controller.getSnapshot().preview!.png[0] = 0;
    await h.controller.submit(); expect(h.submit.mock.calls[0]![0].artifact.png[0]).toBe(137);
  });
  it.each(["model", "company", "dpi", "connection", "evidence", "approval", "media"])("requires approved printer %s matching explicit choices", async (field) => {
    const h = harness(); const p = h.printers[0]!;
    h.printers[0] = { ...p, ...(field === "model" ? { model: "other" } : field === "company" ? { companyId: "2" } : field === "dpi" ? { dpi: 300 } : field === "connection" ? { connection: "network" as const } : field === "evidence" ? { supportEvidence: "" } : field === "approval" ? { approved: false } : { maxWidthMm: 20 }) };
    await h.controller.prepare(); await h.controller.submit(); expect(h.submit).not.toHaveBeenCalled(); expect(h.controller.readiness()).toBe("printerUnapproved");
  });
  it("rejects revoked permissions and expired previews without bridge I/O", async () => {
    const h = harness(); await h.controller.prepare(); h.advance(ZEBRA_LABEL_LIMITS.previewTtlMs);
    await h.controller.submit(); expect(h.controller.readiness()).toBe("expired"); expect(h.submit).not.toHaveBeenCalled();
    h.setScope({ ...h.scope(), permissions: new Set() }); await h.controller.prepare();
    expect(h.prepare).toHaveBeenCalledTimes(1); expect(h.controller.readiness()).toBe("unauthorized");
  });
  it("discards late preparation after company switch", async () => {
    const h = harness(); let finish!: (a: ZebraLabelArtifact) => void;
    h.prepare.mockImplementation((r) => new Promise((resolve) => { finish = () => resolve(artifact(r)); }));
    const pending = h.controller.prepare(); await Promise.resolve();
    h.setScope({ ...h.scope(), source: { ...h.scope().source, companyId: "2" } });
    finish(artifact(zebraLabelRequest(h.scope().source, draft)!)); await pending;
    expect(h.controller.getSnapshot().preview).toBeNull(); expect(h.submit).not.toHaveBeenCalled();
  });
  it("rechecks live company after async reauthorization and prevents send", async () => {
    const h = harness(); await h.controller.prepare(); let finish!: () => void;
    h.authorizeSubmission.mockImplementation(() => new Promise((resolve) => { finish = () => resolve(undefined); }));
    const pending = h.controller.submit(); await Promise.resolve();
    h.setScope({ ...h.scope(), source: { ...h.scope().source, companyId: "2" } }); finish(); await pending;
    expect(h.submit).not.toHaveBeenCalled(); expect(h.controller.getSnapshot().status).toBe("idle");
  });
  it("authorization failure remains consumed and never reaches transport", async () => {
    const h = harness(); await h.controller.prepare(); h.authorizeSubmission.mockRejectedValue(new Error("private detail"));
    await h.controller.submit(); await h.controller.submit(); expect(h.submit).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().reason).toBe("consumed"); expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("private detail");
  });
  it("does not begin a transport after authorization has consumed the common deadline", async () => {
    const h = harness(); await h.controller.prepare();
    h.authorizeSubmission.mockImplementation(async () => { h.advance(ZEBRA_LABEL_LIMITS.operationTimeoutMs); });
    await h.controller.submit(); expect(h.submit).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().status).toBe("error");
  });
  it("blocks new work during a scope-invalidated in-flight send", async () => {
    vi.useFakeTimers(); const h = harness(); await h.controller.prepare();
    h.submit.mockImplementation(() => new Promise(() => undefined));
    const pending = h.controller.submit(); await vi.advanceTimersByTimeAsync(1);
    expect(h.submit).toHaveBeenCalledTimes(1); h.controller.invalidate();
    await h.controller.prepare(); await h.controller.submit();
    expect(h.prepare).toHaveBeenCalledTimes(1); expect(h.submit).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(ZEBRA_LABEL_LIMITS.operationTimeoutMs); await pending;
    expect(h.controller.getSnapshot().status).toBe("unknown");
  });
  it("does not report success after a revoked scope or display transport error details", async () => {
    const h = harness(); await h.controller.prepare();
    h.submit.mockImplementation(async () => { h.setScope({ ...h.scope(), permissions: new Set() }); throw new Error("private device details"); });
    await h.controller.submit(); expect(h.controller.getSnapshot().status).toBe("idle");
    expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("private device details");
  });
  it("transport failure or timeout means outcome unknown, with zero automatic retries", async () => {
    vi.useFakeTimers(); const h = harness(); await h.controller.prepare();
    h.submit.mockImplementation(() => new Promise(() => undefined));
    const pending = h.controller.submit(); await vi.advanceTimersByTimeAsync(ZEBRA_LABEL_LIMITS.operationTimeoutMs + 1); await pending;
    expect(h.controller.getSnapshot().status).toBe("unknown"); expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.submit.mock.calls[0]![1].aborted).toBe(true); await h.controller.submit(); expect(h.submit).toHaveBeenCalledTimes(1);
    h.controller.updateDraft({ quantity: "3" }); h.controller.invalidate(); await h.controller.prepare();
    expect(h.prepare).toHaveBeenCalledTimes(1); expect(h.controller.getSnapshot().submissionUncertain).toBe(true);
  });
  it("preserves queued without claiming physical completion", async () => {
    const h = harness(); h.submit.mockResolvedValue({ status: "queued" }); await h.controller.prepare(); await h.controller.submit();
    expect(h.controller.getSnapshot().status).toBe("queued");
  });
});
