import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { api } from "./api";
import {
  appendBarcodeScanToQueue,
  canApplyQueuedBarcodeScan,
  POS_BARCODE_QUEUE_LIMIT,
  type BarcodeLineApplyStatus,
  type QueuedBarcodeScan,
} from "./barcode";
import { localizedReferenceName, useI18n } from "./i18n";
import type { ResolvedInventoryBarcode } from "./types";
import { Button } from "./ui";

export type InventoryBarcodeScannerHandle = {
  hasPending: () => boolean;
  focus: () => void;
  reset: () => void;
};

type InventoryBarcodeScannerProps = {
  enabled: boolean;
  blocked?: boolean;
  autoFocus?: boolean;
  className?: string;
  maxLines: number;
  onPendingChange?: (count: number) => void;
  onResolved: (resolved: ResolvedInventoryBarcode) => BarcodeLineApplyStatus;
};

type Feedback = {
  tone: "success" | "error" | "neutral";
  message: string;
};

export const InventoryBarcodeScanner = forwardRef<
  InventoryBarcodeScannerHandle,
  InventoryBarcodeScannerProps
>(function InventoryBarcodeScanner({
  enabled,
  blocked = false,
  autoFocus = false,
  className = "",
  maxLines,
  onPendingChange,
  onResolved,
}, forwardedRef) {
  const { t } = useI18n();
  const [value, setValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const queueRef = useRef<QueuedBarcodeScan[]>([]);
  const workerRunningRef = useRef(false);
  const epochRef = useRef(0);
  const mountedRef = useRef(true);
  const blockedRef = useRef(blocked);
  const enabledRef = useRef(enabled);
  const onResolvedRef = useRef(onResolved);
  const onPendingChangeRef = useRef(onPendingChange);

  blockedRef.current = blocked;
  enabledRef.current = enabled;
  onResolvedRef.current = onResolved;
  onPendingChangeRef.current = onPendingChange;

  const updateQueue = (queue: QueuedBarcodeScan[]) => {
    queueRef.current = queue;
    onPendingChangeRef.current?.(queue.length);
  };

  const reset = () => {
    epochRef.current += 1;
    updateQueue([]);
    if (!mountedRef.current) return;
    setValue("");
    setFeedback(null);
  };

  useImperativeHandle(forwardedRef, () => ({
    hasPending: () => workerRunningRef.current || queueRef.current.length > 0,
    focus: () => inputRef.current?.focus(),
    reset,
  }));

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      epochRef.current += 1;
      queueRef.current = [];
    };
  }, []);

  useEffect(() => {
    if (!enabled) reset();
  }, [enabled]);

  async function drainQueue() {
    if (workerRunningRef.current) return;
    workerRunningRef.current = true;
    setLoading(true);
    try {
      while (queueRef.current.length > 0) {
        const entry = queueRef.current[0]!;
        if (entry.epoch === epochRef.current) {
          try {
            const resolved = await api<ResolvedInventoryBarcode>(
              "/inventory-barcodes/resolve",
              {
                method: "POST",
                body: JSON.stringify({ value: entry.value }),
              },
            );
            if (
              enabledRef.current
              && canApplyQueuedBarcodeScan(entry, epochRef.current, blockedRef.current)
            ) {
              const status = onResolvedRef.current(resolved);
              const itemName = localizedReferenceName(resolved.inventoryItem);
              if (status === "invalid-quantity") {
                setFeedback({ tone: "error", message: t("pos.barcode.quantityInvalid") });
              } else if (status === "line-limit") {
                setFeedback({
                  tone: "error",
                  message: t("pos.barcode.lineLimit", { count: maxLines }),
                });
              } else {
                setFeedback({
                  tone: "success",
                  message: t(
                    status === "incremented"
                      ? "pos.barcode.incremented"
                      : "pos.barcode.added",
                    { item: `${resolved.inventoryItem.code} — ${itemName}` },
                  ),
                });
              }
            }
          } catch (cause) {
            if (mountedRef.current && entry.epoch === epochRef.current) {
              setFeedback({
                tone: "error",
                message: cause instanceof Error
                  ? cause.message
                  : t("pos.barcode.resolveError"),
              });
            }
          }
        }
        const currentQueue = queueRef.current;
        updateQueue(currentQueue[0] === entry
          ? currentQueue.slice(1)
          : currentQueue.filter((queued) => queued !== entry));
      }
    } finally {
      workerRunningRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
        window.requestAnimationFrame(() => {
          inputRef.current?.focus();
          inputRef.current?.select();
        });
      }
    }
  }

  function enqueue(rawValue: string) {
    if (!enabledRef.current) return;
    setValue("");
    if (blockedRef.current) {
      setFeedback({ tone: "error", message: t("pos.barcode.checkoutInProgress") });
      return;
    }
    const admission = appendBarcodeScanToQueue(
      queueRef.current,
      rawValue,
      epochRef.current,
    );
    if (admission.status === "empty") {
      setFeedback({ tone: "error", message: t("pos.barcode.empty") });
      inputRef.current?.focus();
      return;
    }
    if (admission.status === "full") {
      setFeedback({
        tone: "error",
        message: t("pos.barcode.queueFull", { count: POS_BARCODE_QUEUE_LIMIT }),
      });
      inputRef.current?.focus();
      return;
    }
    updateQueue(admission.queue);
    setFeedback(admission.queue.length > 1
      ? {
          tone: "neutral",
          message: t("pos.barcode.queued", { count: admission.queue.length }),
        }
      : null);
    void drainQueue();
  }

  if (!enabled) return null;

  return <div
    className={`pos-barcode-scanner ${className}`.trim()}
    aria-busy={loading}
  >
    <div className="pos-barcode-copy">
      <strong>{t("pos.barcode.title")}</strong>
      <span>{t("pos.barcode.keyboardHint")}</span>
    </div>
    <label>
      <span>{t("pos.barcode.inputLabel")}</span>
      <input
        ref={inputRef}
        dir="ltr"
        inputMode="text"
        autoComplete="off"
        autoFocus={autoFocus}
        maxLength={255}
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          setFeedback(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            enqueue(event.currentTarget.value);
          }
        }}
        placeholder={t("pos.barcode.placeholder")}
      />
    </label>
    <Button
      type="button"
      icon="search"
      disabled={blocked || !value.trim()}
      onClick={() => enqueue(inputRef.current?.value ?? value)}
    >
      {loading ? t("pos.barcode.enqueue") : t("pos.barcode.scan")}
    </Button>
    {feedback && <div
      className={`pos-barcode-feedback ${feedback.tone}`}
      role={feedback.tone === "error" ? "alert" : "status"}
    >{feedback.message}</div>}
  </div>;
});
