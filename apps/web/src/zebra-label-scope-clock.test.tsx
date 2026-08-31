import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ZebraLabelWorkflow } from "./ZebraLabelWorkflow";
import {
  ZebraLabelController,
  zebraLabelScopeKey,
  type ZebraLabelScope,
} from "./zebra-label-direct-print";
import { zebraLabelMessages } from "./zebra-label-messages";
import { emptyZebraLabelDraft, type ZebraLabelDraft } from "./zebra-label-model";
import type {
  ZebraLabelArtifact,
  ZebraLabelDirectPrintPort,
  ZebraLabelPreparationPort,
  ZebraLabelPrinter,
  ZebraLabelRequest,
} from "./zebra-label-ports";

// A one-pixel protocol fixture. This is not a barcode scan, device, or physical
// print acceptance test. Real renderer coverage lives in the API owner tests.
function artifact(request: ZebraLabelRequest): ZebraLabelArtifact {
  const png = Uint8Array.from(
    atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0MsAAAAASUVORK5CYII="),
    (character) => character.charCodeAt(0),
  );
  const widthDots = Math.floor(request.media.widthMm * request.media.dpi / 25.4);
  const heightDots = Math.floor(request.media.heightMm * request.media.dpi / 25.4);
  return {
    ...request,
    rendererProfile: "INVENTORY_203_DPI_V1",
    png,
    raster: { widthDots: 1, heightDots: 1 },
    mediaDots: { widthDots, heightDots },
    placement: {
      xDots: Math.floor((widthDots - 1) / 2),
      yDots: Math.floor((heightDots - 1) / 2),
      widthDots: 1,
      heightDots: 1,
      rotation: request.media.orientation === "normal" ? 0 : 90,
    },
  };
}

const draft: ZebraLabelDraft = {
  model: "TEST-MODEL",
  connection: "usb",
  printerId: "test-device",
  widthMm: "80",
  heightMm: "50",
  dpi: "203",
  orientation: "normal",
  quantity: "2",
};

function harness() {
  let scope: ZebraLabelScope = {
    actorId: "7",
    authorizationRevision: "session-1",
    source: { companyId: "1", inventoryItemId: "2", barcodeId: "3" },
    permissions: new Set(["inventory_barcodes.print"]),
    itemIsActive: true,
    barcodeIsActive: true,
  };
  let clock = 10_000;
  const now = vi.fn(() => clock);
  const printers: ZebraLabelPrinter[] = [{
    id: "test-device",
    companyId: "1",
    label: "Protocol fixture only",
    model: "TEST-MODEL",
    connection: "usb",
    dpi: 203,
    maxWidthMm: 100,
    maxHeightMm: 100,
    approved: true,
    supportEvidence: "test-only-not-a-device",
  }];
  const prepare = vi.fn<ZebraLabelPreparationPort["prepare"]>(async (request) => artifact(request));
  const authorizeSubmission = vi.fn<ZebraLabelPreparationPort["authorizeSubmission"]>(async () => undefined);
  const submit = vi.fn<ZebraLabelDirectPrintPort["submit"]>(async () => ({ status: "sent" }));
  const controller = new ZebraLabelController({
    scope: () => scope,
    printers: () => printers,
    now,
    preparation: { prepare, authorizeSubmission },
    direct: { available: true, submit },
  });
  controller.updateDraft(draft);
  return {
    controller, prepare, authorizeSubmission, submit, printers, now,
    scope: () => scope,
    setScope: (value: ZebraLabelScope) => { scope = value; },
    setClock: (value: number) => { clock = value; },
  };
}

function deferred<T>() {
  let resolve: (value: T) => void = () => { throw new Error("Deferred not initialized"); };
  let reject: (reason: Error) => void = () => { throw new Error("Deferred not initialized"); };
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}

type ScopeChange = "actorId" | "authorizationRevision";
const scopeChanges: ScopeChange[] = ["actorId", "authorizationRevision"];

function changedScope(scope: ZebraLabelScope, change: ScopeChange): ZebraLabelScope {
  return { ...scope, ...(change === "actorId" ? { actorId: "8" } : { authorizationRevision: "session-2" }) };
}

function expectEmptyScope(h: ReturnType<typeof harness>) {
  const state = h.controller.getSnapshot();
  expect(state.scopeKey).toBe(zebraLabelScopeKey(h.scope()));
  expect(state.draft).toEqual(emptyZebraLabelDraft());
  expect(state.draft.printerId).toBe("");
  expect(state.preview).toBeNull();
  expect(state.hasSubmissionAttempt).toBe(false);
  expect(state.status).toBe("idle");
  expect(state.reason).toBe("previewRequired");
  return state;
}

const invalidClocks = [
  { name: "NaN", value: Number.NaN },
  { name: "backward", value: 9_999 },
];

describe("Zebra clock failure closes preparation and handoff", () => {
  it.each(invalidClocks)("resolves safely and does no owner I/O with a $name clock before preparation", async ({ value }) => {
    const h = harness();
    h.setClock(value);
    await expect(h.controller.prepare()).resolves.toBeUndefined();
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().preview).toBeNull();
    expect(h.controller.getSnapshot().reason).toBe("clockInvalid");
    h.setClock(10_001);
    await expect(h.controller.prepare()).resolves.toBeUndefined();
    expect(h.prepare).not.toHaveBeenCalled();
    expect(h.controller.readiness()).toBe("clockInvalid");
  });

  it.each(invalidClocks)("does not authorize or send when the clock becomes $name before submit", async ({ value }) => {
    const h = harness();
    await h.controller.prepare();
    expect(h.controller.readiness()).toBe("ready");
    h.setClock(value);
    await expect(h.controller.submit()).resolves.toBeUndefined();
    expect(h.authorizeSubmission).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().hasSubmissionAttempt).toBe(false);
    expect(h.controller.getSnapshot().reason).toBe("clockInvalid");
  });

  it.each(invalidClocks)("contains a $name clock fault between readiness and the submission deadline", async ({ value }) => {
    const h = harness();
    await h.controller.prepare();
    h.now.mockReturnValueOnce(10_000).mockReturnValueOnce(value);
    // The returned promise must resolve: an exception outside submit's catch
    // would otherwise escape a UI event handler's `void controller.submit()`.
    await expect(h.controller.submit()).resolves.toBeUndefined();
    expect(h.authorizeSubmission).not.toHaveBeenCalled();
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot().reason).toBe("clockInvalid");
  });

  it.each(invalidClocks)("stops before direct handoff when reauthorization observes a $name clock", async ({ value }) => {
    const h = harness();
    await h.controller.prepare();
    h.authorizeSubmission.mockImplementationOnce(async () => { h.setClock(value); });
    await expect(h.controller.submit()).resolves.toBeUndefined();
    expect(h.authorizeSubmission).toHaveBeenCalledTimes(1);
    expect(h.submit).not.toHaveBeenCalled();
    expect(h.controller.getSnapshot()).toMatchObject({
      status: "error", reason: "clockInvalid", hasSubmissionAttempt: true,
    });
    await expect(h.controller.submit()).resolves.toBeUndefined();
    expect(h.authorizeSubmission).toHaveBeenCalledTimes(1);
    expect(h.submit).not.toHaveBeenCalled();
  });

  it.each(invalidClocks)("does not release a preview when the owner completes after a $name clock fault", async ({ value }) => {
    const h = harness();
    h.prepare.mockImplementationOnce(async (request) => {
      h.setClock(value);
      return artifact(request);
    });
    await expect(h.controller.prepare()).resolves.toBeUndefined();
    expect(h.prepare).toHaveBeenCalledTimes(1);
    expect(h.controller.getSnapshot()).toMatchObject({ status: "error", reason: "clockInvalid", preview: null });
    expect(h.submit).not.toHaveBeenCalled();
  });
});

describe("Zebra actor and authorization scope isolation", () => {
  it.each(scopeChanges)("synchronously removes draft, printer, preview and attempted status on %s replacement", async (change) => {
    const h = harness();
    await h.controller.prepare();
    await h.controller.submit();
    expect(h.controller.getSnapshot().status).toBe("sent");
    expect(h.controller.getSnapshot().hasSubmissionAttempt).toBe(true);
    const before = h.scope();
    h.setScope(changedScope(before, change));
    expect(h.scope().source).toEqual(before.source);
    expect(h.scope().permissions).toEqual(before.permissions);

    expect(h.controller.synchronizeScope()).toBe(true);
    expectEmptyScope(h);
    expect(h.controller.synchronizeScope()).toBe(false);
    h.controller.updateDraft(draft);
    await h.controller.submit();
    expect(h.submit).toHaveBeenCalledTimes(1);
    expect(h.controller.getSnapshot().preview).toBeNull();
  });

  it.each(scopeChanges)("getSnapshot clears %s replacement before any framework effect is needed", async (change) => {
    const h = harness();
    await h.controller.prepare();
    expect(h.controller.getSnapshot().preview).not.toBeNull();
    h.setScope(changedScope(h.scope(), change));
    expectEmptyScope(h);
    expect(h.submit).not.toHaveBeenCalled();
  });

  for (const outcome of ["resolve", "reject"] as const) {
    it.each(scopeChanges)(`late preparation ${outcome} under old %s cannot overwrite the new scope's preview`, async (change) => {
      const h = harness();
      const started = deferred<ZebraLabelRequest>();
      const oldResult = deferred<ZebraLabelArtifact>();
      h.prepare.mockImplementationOnce((request) => {
        started.resolve(request);
        return oldResult.promise;
      });
      const oldPreparation = h.controller.prepare();
      const oldRequest = await started.promise;
      h.setScope(changedScope(h.scope(), change));
      h.controller.synchronizeScope();
      expectEmptyScope(h);
      expect(h.prepare.mock.calls[0]![1].aborted).toBe(true);
      h.controller.updateDraft({ ...draft, widthMm: "70", quantity: "3" });
      await h.controller.prepare();
      const newState = h.controller.getSnapshot();
      expect(newState.status).toBe("preview");
      expect(newState.preview?.quantity).toBe(3);

      if (outcome === "resolve") oldResult.resolve(artifact(oldRequest));
      else oldResult.reject(new Error("private error from obsolete preparation"));
      await expect(oldPreparation).resolves.toBeUndefined();
      expect(h.controller.getSnapshot()).toEqual(newState);
      expect(h.controller.getSnapshot().preview?.media.widthMm).toBe(70);
      expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("private error");
      expect(h.submit).not.toHaveBeenCalled();
    });

    it.each(scopeChanges)(`reauthorization ${outcome} after %s replacement never hands off or restores old state`, async (change) => {
      const h = harness();
      await h.controller.prepare();
      const started = deferred<void>();
      const authorization = deferred<void>();
      h.authorizeSubmission.mockImplementationOnce(() => {
        started.resolve(undefined);
        return authorization.promise;
      });
      const oldSubmission = h.controller.submit();
      await started.promise;
      h.setScope(changedScope(h.scope(), change));
      h.controller.synchronizeScope();
      const clearedState = expectEmptyScope(h);
      expect(h.authorizeSubmission.mock.calls[0]![1].aborted).toBe(true);

      if (outcome === "resolve") authorization.resolve(undefined);
      else authorization.reject(new Error("private obsolete authorization error"));
      await expect(oldSubmission).resolves.toBeUndefined();
      expect(h.submit).not.toHaveBeenCalled();
      expectEmptyScope(h);
      expect(h.controller.getSnapshot()).toEqual(clearedState);
      expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("private obsolete");
    });

    it.each(scopeChanges)(`in-flight send ${outcome} after %s replacement cannot expose the previous outcome`, async (change) => {
      const h = harness();
      await h.controller.prepare();
      const started = deferred<void>();
      const sending = deferred<{ status: "sent" | "queued" }>();
      h.submit.mockImplementationOnce(() => {
        started.resolve(undefined);
        return sending.promise;
      });
      const oldSubmission = h.controller.submit();
      await started.promise;
      expect(h.controller.getSnapshot().status).toBe("sending");
      h.setScope(changedScope(h.scope(), change));
      h.controller.synchronizeScope();
      const clearedState = expectEmptyScope(h);
      expect(h.submit.mock.calls[0]![1].aborted).toBe(true);

      if (outcome === "resolve") sending.resolve({ status: "sent" });
      else sending.reject(new Error("private obsolete transport error"));
      await expect(oldSubmission).resolves.toBeUndefined();
      expect(h.submit).toHaveBeenCalledTimes(1);
      expectEmptyScope(h);
      expect(h.controller.getSnapshot()).toEqual(clearedState);
      expect(JSON.stringify(h.controller.getSnapshot())).not.toContain("private obsolete");
    });
  }
});

describe("Zebra session identity and fresh server rendering", () => {
  it.each(["actorId", "authorizationRevision", "companyId"] as const)(
    "changes the session key for %s replacement even with the same barcode identifiers and permissions", (change) => {
      const h = harness();
      const next = change === "companyId"
        ? { ...h.scope(), source: { ...h.scope().source, companyId: "9" } }
        : changedScope(h.scope(), change);
      expect(next.source.inventoryItemId).toBe(h.scope().source.inventoryItemId);
      expect(next.source.barcodeId).toBe(h.scope().source.barcodeId);
      expect(next.permissions).toEqual(h.scope().permissions);
      expect(zebraLabelScopeKey(next)).not.toBe(zebraLabelScopeKey(h.scope()));
    },
  );

  it.each(scopeChanges)("fresh SSR for a replacement %s contains no previous setup, image, attempt or result", async (change) => {
    const h = harness();
    await h.controller.prepare();
    await h.controller.submit();
    expect(h.controller.getSnapshot().status).toBe("sent");
    const next = changedScope(h.scope(), change);
    const prepareCalls = h.prepare.mock.calls.length;
    const sendCalls = h.submit.mock.calls.length;
    // This exercises actual React server rendering with no passive effects. It
    // cannot prove DOM remount timing or stale DOM removal in a real browser.
    const html = renderToStaticMarkup(<ZebraLabelWorkflow
      scope={next}
      locale="en"
      printers={h.printers}
      preparation={{ prepare: h.prepare, authorizeSubmission: h.authorizeSubmission }}
      direct={{ available: true, submit: h.submit }}
    />);
    const values = Array.from(html.matchAll(/<input\b[^>]*\bvalue="([^"]*)"/gu), (match) => match[1]);
    expect(values.length).toBeGreaterThan(0);
    expect(values.every((value) => value === "")).toBe(true);
    expect(html).not.toContain("TEST-MODEL");
    expect(html).not.toContain("data:image/png");
    expect(html).not.toContain(zebraLabelMessages.en.repeatWarning);
    expect(html).not.toContain(zebraLabelMessages.en.sent);
    expect(html).not.toContain(zebraLabelMessages.en.unknown);
    expect(html).toContain(zebraLabelMessages.en.settings);
    expect(h.prepare).toHaveBeenCalledTimes(prepareCalls);
    expect(h.submit).toHaveBeenCalledTimes(sendCalls);
  });
});
