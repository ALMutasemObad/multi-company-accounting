import { canPrintInventoryBarcode } from "./barcode";
import { copyZebraLabelArtifact, emptyZebraLabelDraft, validateZebraLabelArtifact, zebraLabelRequest, zebraLabelSourceKey, ZEBRA_LABEL_LIMITS, type ZebraLabelDraft } from "./zebra-label-model";
import { unavailableZebraLabelDirectPrint, type ZebraLabelArtifact, type ZebraLabelDirectPrintPort, type ZebraLabelPreparationPort, type ZebraLabelPrinter, type ZebraLabelSource } from "./zebra-label-ports";

export type ZebraLabelScope = {
  /** Local invalidation keys only, never authority in an HTTP body. The host must
   * change authorizationRevision on session/authorization replacement. */
  actorId: string; authorizationRevision: string;
  source: ZebraLabelSource; permissions: ReadonlySet<string>; itemIsActive: boolean; barcodeIsActive: boolean;
};
export function zebraLabelScopeKey(scope: ZebraLabelScope) {
  return JSON.stringify([scope.actorId, scope.authorizationRevision, zebraLabelSourceKey(scope.source),
    [...scope.permissions].sort(), scope.itemIsActive, scope.barcodeIsActive]);
}
export type ZebraLabelStatus = "idle" | "preparing" | "preview" | "sending" | "sent" | "queued" | "unknown" | "error";
export type ZebraLabelReason = "ready" | "unauthorized" | "settings" | "unsupportedDpi" | "adapterUnavailable" | "printerUnapproved" | "previewRequired" | "expired" | "busy" | "consumed" | "prepareFailed" | "authorizationFailed" | "clockInvalid";
export type ZebraLabelState = { scopeKey: string; draft: ZebraLabelDraft; status: ZebraLabelStatus; reason: ZebraLabelReason; preview: ZebraLabelArtifact | null; hasSubmissionAttempt: boolean; submissionUncertain: boolean };

/** One-shot UI coordinator. Not server authorization, durable device idempotency or
 * evidence that physical labels printed. No SDK/network access exists in this class. */
export class ZebraLabelController {
  private state: ZebraLabelState;
  private artifact: ZebraLabelArtifact | null = null;
  private expiresAt = 0;
  private previewStartedAt = 0;
  private lastClock: number | null = null;
  private clockFault = false;
  private consumed = false;
  private submitting = false;
  private revision = 0;
  private pending: AbortController | null = null;
  private listeners = new Set<() => void>();
  constructor(private readonly options: {
    scope: () => ZebraLabelScope;
    printers: () => readonly ZebraLabelPrinter[];
    preparation: ZebraLabelPreparationPort;
    direct?: ZebraLabelDirectPrintPort;
    now?: () => number;
  }) {
    this.state = { scopeKey: this.scopeKey(), draft: emptyZebraLabelDraft(), status: "idle", reason: "previewRequired", preview: null, hasSubmissionAttempt: false, submissionUncertain: false };
    this.readClock();
  }
  getSnapshot = () => { this.synchronizeScope(); return this.state; };
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(patch: Partial<ZebraLabelState>) { this.state = { ...this.state, ...patch }; this.listeners.forEach((f) => f()); }
  private allowed() { const s = this.options.scope(); return typeof s.actorId === "string" && /^[1-9][0-9]*$/u.test(s.actorId)
    && typeof s.authorizationRevision === "string" && s.authorizationRevision.trim().length > 0
    && canPrintInventoryBarcode(s.permissions, s.itemIsActive, s.barcodeIsActive); }
  private readClock(): number | null {
    if (this.clockFault) return null;
    let value: number;
    try { value = (this.options.now ?? Date.now)(); } catch { this.clockFault = true; return null; }
    if (!Number.isFinite(value) || value < 0 || value > Number.MAX_SAFE_INTEGER - ZEBRA_LABEL_LIMITS.previewTtlMs
      || (this.lastClock !== null && value < this.lastClock)) { this.clockFault = true; return null; }
    this.lastClock = value; return value;
  }
  private now() { const value = this.readClock(); if (value === null) throw new Error("ZEBRA_CLOCK_INVALID"); return value; }
  private scopeKey() { return zebraLabelScopeKey(this.options.scope()); }
  private isCurrent(revision: number, scope: string) { return revision === this.revision && scope === this.scopeKey(); }
  /** Clear tenant/user data synchronously at the controller boundary. */
  synchronizeScope() {
    const scopeKey = this.scopeKey();
    if (scopeKey === this.state.scopeKey) return false;
    ++this.revision; this.pending?.abort(); this.artifact = null; this.consumed = false; this.expiresAt = 0; this.previewStartedAt = 0;
    this.publish({ scopeKey, draft: emptyZebraLabelDraft(), status: "idle", reason: "previewRequired", preview: null, hasSubmissionAttempt: false, submissionUncertain: false });
    return true;
  }
  private direct() { return this.options.direct ?? unavailableZebraLabelDirectPrint; }
  private printer() { return this.options.printers().find((p) => p.id === this.state.draft.printerId); }
  invalidate() {
    if (this.synchronizeScope()) return;
    ++this.revision; this.pending?.abort(); this.artifact = null;
    const uncertain = this.submitting || this.state.submissionUncertain;
    this.publish({ preview: null, status: uncertain ? "unknown" : "idle", reason: uncertain ? "consumed" : "previewRequired", submissionUncertain: uncertain });
  }
  updateDraft(patch: Partial<ZebraLabelDraft>) {
    this.synchronizeScope();
    if (this.submitting || this.state.submissionUncertain) return;
    this.invalidate(); this.publish({ draft: { ...this.state.draft, ...patch } });
  }
  readiness(): ZebraLabelReason {
    this.synchronizeScope();
    if (!this.allowed()) return "unauthorized";
    const now = this.readClock(); if (now === null) return "clockInvalid";
    if (this.submitting || this.state.status === "preparing") return "busy";
    const request = zebraLabelRequest(this.options.scope().source, this.state.draft);
    if (!request) return "settings";
    if (request.media.dpi !== 203) return "unsupportedDpi";
    if (this.consumed) return "consumed";
    if (!this.artifact || zebraLabelSourceKey(this.artifact.source) !== zebraLabelSourceKey(this.options.scope().source)) return "previewRequired";
    if (now < this.previewStartedAt || now >= this.expiresAt) return "expired";
    if (this.direct().available !== true) return "adapterUnavailable";
    const p = this.printer(), d = this.state.draft;
    if (p?.approved !== true || typeof p.supportEvidence !== "string" || !p.supportEvidence.trim() || p.companyId !== request.source.companyId
      || p.model !== d.model.trim() || p.connection !== d.connection || p.dpi !== request.media.dpi
      || !Number.isFinite(p.maxWidthMm) || !Number.isFinite(p.maxHeightMm)
      || request.media.widthMm > p.maxWidthMm || request.media.heightMm > p.maxHeightMm) return "printerUnapproved";
    return "ready";
  }
  private async bounded<T>(work: (signal: AbortSignal) => Promise<T>, controller: AbortController, deadlineAt = this.now() + ZEBRA_LABEL_LIMITS.operationTimeoutMs): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error("ZEBRA_TIMEOUT")); }, Math.max(0, deadlineAt - this.now()));
    });
    try { const result = await Promise.race([Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      if (this.now() >= deadlineAt) throw new Error("ZEBRA_TIMEOUT");
      return work(controller.signal);
    }), timeout]);
      if (this.now() >= deadlineAt) { controller.abort(); throw new Error("ZEBRA_TIMEOUT"); }
      return result;
    }
    finally { clearTimeout(timer); }
  }
  async prepare() {
    this.synchronizeScope();
    if (this.submitting || this.state.status === "preparing" || this.state.submissionUncertain) return;
    if (!this.allowed()) { this.publish({ reason: "unauthorized" }); return; }
    const startedAt = this.readClock();
    if (startedAt === null) { this.publish({ status: "error", reason: "clockInvalid" }); return; }
    const request = zebraLabelRequest(this.options.scope().source, this.state.draft);
    if (!request || request.media.dpi !== 203) { this.publish({ reason: request ? "unsupportedDpi" : "settings" }); return; }
    this.invalidate(); const revision = this.revision, scope = this.scopeKey();
    const controller = new AbortController(); this.pending = controller;
    this.publish({ status: "preparing", reason: "busy" });
    try {
      const result = await this.bounded((signal) => this.options.preparation.prepare({ ...request, source: { ...request.source }, media: { ...request.media } }, signal), controller, startedAt + ZEBRA_LABEL_LIMITS.operationTimeoutMs);
      if (revision !== this.revision || scope !== this.scopeKey() || !this.allowed() || controller.signal.aborted) return;
      validateZebraLabelArtifact(result, request);
      this.artifact = copyZebraLabelArtifact(result); this.consumed = false;
      this.previewStartedAt = startedAt; this.expiresAt = startedAt + ZEBRA_LABEL_LIMITS.previewTtlMs;
      if (this.now() >= this.expiresAt) throw new Error("ZEBRA_EXPIRED");
      this.publish({ status: "preview", reason: "previewRequired", preview: copyZebraLabelArtifact(result), hasSubmissionAttempt: false });
    } catch { if (this.isCurrent(revision, scope)) this.publish({ status: "error", reason: this.clockFault ? "clockInvalid" : "prepareFailed", preview: null }); }
    finally { if (this.pending === controller) this.pending = null; this.synchronizeScope(); if (this.getSnapshot().status === "preparing" && this.isCurrent(revision, scope)) this.publish({ status: "idle", reason: "previewRequired" }); }
  }
  async submit() {
    const reason = this.readiness();
    if (reason !== "ready") { this.publish({ reason }); return; }
    const artifact = this.artifact!, printer = { ...this.printer()! };
    const scope = this.scopeKey(), revision = this.revision;
    const startedAt = this.readClock();
    if (startedAt === null) { this.publish({ status: "error", reason: "clockInvalid" }); return; }
    const deadlineAt = startedAt + ZEBRA_LABEL_LIMITS.operationTimeoutMs;
    const controller = new AbortController(); this.pending = controller;
    // Consume BEFORE any await: even simultaneous click/Enter cannot duplicate send.
    this.consumed = true; this.submitting = true; this.publish({ status: "sending", reason: "busy", hasSubmissionAttempt: true });
    let handedOff = false;
    try {
      await this.bounded((signal) => this.options.preparation.authorizeSubmission(copyZebraLabelArtifact(artifact), signal), controller, deadlineAt);
      const result = await this.bounded((signal) => {
        // Run live checks in the same microtask as the actual handoff: no await
        // or scheduled work may intervene between this fence and submit().
        if (signal.aborted || revision !== this.revision || scope !== this.scopeKey() || !this.allowed() || this.now() >= this.expiresAt
          || JSON.stringify(this.printer()) !== JSON.stringify(printer) || this.direct().available !== true) throw new Error("ZEBRA_STALE");
        validateZebraLabelArtifact(artifact, zebraLabelRequest(this.options.scope().source, this.state.draft)!);
        const job = { printer, artifact: copyZebraLabelArtifact(artifact) };
        if (this.now() >= deadlineAt) throw new Error("ZEBRA_TIMEOUT");
        handedOff = true;
        return this.direct().submit(job, signal);
      }, controller, deadlineAt);
      if (revision !== this.revision || scope !== this.scopeKey() || !this.allowed() || !["sent", "queued"].includes(result.status)) throw new Error("ZEBRA_OUTCOME_UNKNOWN");
      this.publish({ status: result.status, reason: "consumed" });
    } catch { if (this.isCurrent(revision, scope)) this.publish({ status: handedOff ? "unknown" : "error", reason: handedOff ? "consumed" : this.clockFault ? "clockInvalid" : "authorizationFailed", submissionUncertain: handedOff }); }
    finally { this.submitting = false; if (this.pending === controller) this.pending = null; this.synchronizeScope(); this.publish({}); }
  }
}
