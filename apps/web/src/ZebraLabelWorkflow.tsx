import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { ZebraLabelController, zebraLabelScopeKey, type ZebraLabelScope } from "./zebra-label-direct-print";
import { zebraLabelMessages } from "./zebra-label-messages";
import type { ZebraLabelDraft } from "./zebra-label-model";
import { zebraLabelSourceKey } from "./zebra-label-model";
import { unavailableZebraLabelDirectPrint, unavailableZebraLabelPreparation, type ZebraLabelArtifact, type ZebraLabelDirectPrintPort, type ZebraLabelPreparationPort, type ZebraLabelPrinter } from "./zebra-label-ports";
import "./zebra-label-styles.css";

export type ZebraLabelWorkflowProps = {
  scope: ZebraLabelScope;
  locale: "ar" | "en" | "ur" | "hi";
  printers?: readonly ZebraLabelPrinter[];
  preparation?: ZebraLabelPreparationPort;
  direct?: ZebraLabelDirectPrintPort;
};

function pngUrl(png: Uint8Array) {
  let bytes = "";
  for (let i = 0; i < png.length; i += 8192) bytes += String.fromCharCode(...png.subarray(i, i + 8192));
  return `data:image/png;base64,${btoa(bytes)}`;
}

export function ZebraLabelPreview({ artifact, locale }: { artifact: ZebraLabelArtifact; locale: ZebraLabelWorkflowProps["locale"] }) {
  const m = zebraLabelMessages[locale];
  const src = useMemo(() => pngUrl(artifact.png), [artifact.png]);
  const width = artifact.mediaDots.widthDots, height = artifact.mediaDots.heightDots;
  return <figure className="zebra-label-preview">
    <h3>{m.previewTitle}</h3>
    <div className="zebra-label-sheet" dir="ltr" style={{ aspectRatio: `${width} / ${height}` }}>
      <img alt={m.previewAlt} src={src} draggable={false} style={{
        width: `${artifact.raster.widthDots / width * 100}%`, height: `${artifact.raster.heightDots / height * 100}%`,
        left: `${(artifact.placement.xDots + artifact.placement.widthDots / 2) / width * 100}%`,
        top: `${(artifact.placement.yDots + artifact.placement.heightDots / 2) / height * 100}%`,
        transform: `translate(-50%, -50%) rotate(${artifact.placement.rotation}deg)`,
      }} />
    </div>
    <figcaption>{artifact.media.widthMm} × {artifact.media.heightMm} mm · {artifact.media.dpi} DPI · {m.quantity}: {artifact.quantity}</figcaption>
    <p>{m.previewHint}</p>
  </figure>;
}

/** Host mounts this with an existing authorized Inventory source; no fetch, SDK
 * discovery or print is performed on mount or by changing fields. */
export function ZebraLabelWorkflow(props: ZebraLabelWorkflowProps) {
  // The ref belongs to the stable outer component. Controllers in a previous
  // keyed session must see a new actor/company even before passive cleanup runs.
  const liveScope = useRef(props.scope); liveScope.current = props.scope;
  // React replaces the entire session BEFORE rendering when the actor, company,
  // source or authorization changes. No previous draft/image/status/ack can flash.
  return <ZebraLabelWorkflowSession key={zebraLabelScopeKey(props.scope)} {...props} liveScope={() => liveScope.current} />;
}

function ZebraLabelWorkflowSession(props: ZebraLabelWorkflowProps & { liveScope: () => ZebraLabelScope }) {
  const latest = useRef(props); latest.current = props;
  const [controller] = useState(() => new ZebraLabelController({
    scope: () => latest.current.liveScope(),
    printers: () => latest.current.printers ?? [],
    preparation: {
      prepare: (request, signal) => (latest.current.preparation ?? unavailableZebraLabelPreparation).prepare(request, signal),
      authorizeSubmission: (artifact, signal) => (latest.current.preparation ?? unavailableZebraLabelPreparation).authorizeSubmission(artifact, signal),
    },
    direct: {
      get available() { return (latest.current.direct ?? unavailableZebraLabelDirectPrint).available; },
      submit: (job, signal) => (latest.current.direct ?? unavailableZebraLabelDirectPrint).submit(job, signal),
    },
  }));
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [, tick] = useState(0);
  const [repeatAcknowledged, setRepeatAcknowledged] = useState(false);
  const scopeKey = zebraLabelScopeKey(props.scope);
  const permissionKey = [...props.scope.permissions].sort().join("|");
  useEffect(() => { controller.invalidate(); setRepeatAcknowledged(false); return () => controller.invalidate(); },
    [controller, scopeKey, permissionKey, props.scope.itemIsActive, props.scope.barcodeIsActive]);
  useEffect(() => {
    if (!state.preview) return;
    const timer = setInterval(() => tick((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [state.preview]);
  const m = zebraLabelMessages[props.locale];
  const reason = controller.readiness();
  const busy = reason === "busy";
  const attempted = state.hasSubmissionAttempt;
  const edit = (patch: Partial<ZebraLabelDraft>) => controller.updateDraft(patch);
  const numberField = (key: "widthMm" | "heightMm" | "dpi" | "quantity") => <label>
    <span>{m[key]}</span><input inputMode={key === "widthMm" || key === "heightMm" ? "decimal" : "numeric"}
      autoComplete="off" value={state.draft[key]} onChange={(event) => edit({ [key]: event.target.value })} />
  </label>;
  const visiblePreview = state.preview && state.scopeKey === scopeKey
    && zebraLabelSourceKey(state.preview.source) === zebraLabelSourceKey(props.scope.source) && reason !== "unauthorized";
  const displayedStatus = ["preparing", "sending", "sent", "queued", "unknown"].includes(state.status)
    ? m[state.status as "preparing" | "sending" | "sent" | "queued" | "unknown"]
    : m[state.status === "error" ? state.reason : reason];
  return <section className="zebra-label-workflow" dir={props.locale === "ar" || props.locale === "ur" ? "rtl" : "ltr"} aria-label={m.title}>
    <h2>{m.title}</h2><p>{m.description}</p>
    <form onSubmit={(event) => { event.preventDefault(); if (!attempted || repeatAcknowledged) void controller.prepare(); }}>
      <fieldset disabled={busy || reason === "unauthorized" || state.submissionUncertain}>
        <div className="zebra-label-fields">
          <label><span>{m.printer}</span><select value={state.draft.printerId} onChange={(event) => {
            const p = props.printers?.find((printer) => printer.id === event.target.value && printer.companyId === props.scope.source.companyId);
            edit(p ? { printerId: p.id, model: p.model, connection: p.connection, dpi: String(p.dpi) } : { printerId: "" });
          }}><option value="">{m.choose}</option>{props.printers?.filter((p) => p.companyId === props.scope.source.companyId).map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select></label>
          <label><span>{m.model}</span><input autoComplete="off" maxLength={100} value={state.draft.model} onChange={(e) => edit({ model: e.target.value, printerId: "" })} /></label>
          <label><span>{m.connection}</span><select value={state.draft.connection} onChange={(e) => edit({ connection: e.target.value as ZebraLabelDraft["connection"], printerId: "" })}>
            <option value="">{m.choose}</option><option value="usb">{m.usb}</option><option value="network">{m.network}</option>
          </select></label>
          {numberField("widthMm")}{numberField("heightMm")}{numberField("dpi")}
          <label><span>{m.orientation}</span><select value={state.draft.orientation} onChange={(e) => edit({ orientation: e.target.value as ZebraLabelDraft["orientation"] })}>
            <option value="">{m.choose}</option><option value="normal">{m.normal}</option><option value="rotate90">{m.rotate90}</option>
          </select></label>{numberField("quantity")}
        </div>
      </fieldset>
      {!props.printers?.some((p) => p.companyId === props.scope.source.companyId) && <p>{m.noPrinters}</p>}
      {props.direct?.available !== true && <p>{m.adapterUnavailable}</p>}
      <p>{m.profileHint}</p><p>{m.limitsHint}</p>
      {attempted && !state.submissionUncertain && <label className="zebra-label-repeat"><input type="checkbox" checked={repeatAcknowledged} onChange={(e) => setRepeatAcknowledged(e.target.checked)} />{m.repeatWarning}</label>}
      <div className="zebra-label-actions">
        <button type="submit" disabled={busy || reason === "unauthorized" || state.submissionUncertain || (attempted && !repeatAcknowledged)}>{attempted ? m.reviewAgain : m.preview}</button>
        <button type="button" disabled={reason !== "ready"} onClick={() => { setRepeatAcknowledged(false); void controller.submit(); }}>{m.send}</button>
      </div>
    </form>
    <p role="status" aria-live="polite">{displayedStatus}</p>
    {visiblePreview && <ZebraLabelPreview artifact={state.preview!} locale={props.locale} />}
  </section>;
}
