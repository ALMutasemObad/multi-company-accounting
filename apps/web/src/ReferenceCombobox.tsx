import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { api } from "./api";
import { translate as t } from "./i18n";
import type { ListResponse } from "./types";

type ReferenceRecord = { id: string };

export function referenceOptionsPath(
  endpoint: string,
  input: { page: number; pageSize: number; search: string },
) {
  const url = new URL(endpoint, "https://reference.local");
  url.searchParams.set("page", String(input.page));
  url.searchParams.set("pageSize", String(input.pageSize));
  if (input.search.trim()) url.searchParams.set("search", input.search.trim());
  else url.searchParams.delete("search");
  return `${url.pathname}?${url.searchParams.toString()}`;
}

export function mergeReferenceOptions<T extends ReferenceRecord>(current: T[], next: T[]) {
  const values = new Map(current.map((value) => [value.id, value]));
  for (const value of next) values.set(value.id, value);
  return [...values.values()];
}

export function ReferenceCombobox<T extends ReferenceRecord>({
  endpoint,
  value,
  selectedLabel = "",
  onChange,
  optionLabel,
  placeholder,
  searchLabel,
  optionalLabel,
  required = false,
  disabled = false,
  optionDisabled,
}: {
  endpoint: string;
  value: string;
  selectedLabel?: string;
  onChange: (value: T | null) => void;
  optionLabel: (value: T) => string;
  placeholder: string;
  searchLabel: string;
  optionalLabel?: string;
  required?: boolean;
  disabled?: boolean;
  optionDisabled?: (value: T) => boolean;
}) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(selectedLabel);
  const [selectionLabel, setSelectionLabel] = useState(selectedLabel);
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [options, setOptions] = useState<T[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (!open && !value) {
      setSelectionLabel("");
      setQuery("");
    } else if (!open && value && selectedLabel && !selectionLabel) {
      setSelectionLabel(selectedLabel);
      setQuery(selectedLabel);
    }
  }, [open, selectedLabel, selectionLabel, value]);

  useEffect(() => {
    inputRef.current?.setCustomValidity(
      required && !value ? t("referencePicker.required") : "",
    );
  }, [required, value]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const request = ++requestRef.current;
    const controller = new AbortController();
    setLoading(true);
    setError("");
    setActiveIndex(-1);
    void api<ListResponse<T>>(
      referenceOptionsPath(endpoint, { page: 1, pageSize: 20, search: debouncedQuery }),
      { signal: controller.signal },
    ).then((result) => {
      if (request !== requestRef.current) return;
      setOptions(result.data);
      setPage(result.meta.page);
      setTotalPages(result.meta.totalPages);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted || request !== requestRef.current) return;
      setOptions([]);
      setError(cause instanceof Error ? cause.message : t("referencePicker.loadError"));
    }).finally(() => {
      if (request === requestRef.current) setLoading(false);
    });
    return () => controller.abort();
  }, [debouncedQuery, endpoint, open]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    document.addEventListener("mousedown", closeOutside);
    return () => document.removeEventListener("mousedown", closeOutside);
  });

  function close() {
    setOpen(false);
    setActiveIndex(-1);
    setQuery(value ? selectionLabel : "");
  }

  function select(option: T | null) {
    const label = option ? optionLabel(option) : "";
    setSelectionLabel(label);
    setQuery(label);
    onChange(option);
    setOpen(false);
    setActiveIndex(-1);
  }

  async function loadMore() {
    if (loading || page >= totalPages) return;
    const nextPage = page + 1;
    const request = ++requestRef.current;
    setLoading(true);
    setError("");
    try {
      const result = await api<ListResponse<T>>(
        referenceOptionsPath(endpoint, {
          page: nextPage,
          pageSize: 20,
          search: debouncedQuery,
        }),
      );
      if (request !== requestRef.current) return;
      setOptions((current) => mergeReferenceOptions(current, result.data));
      setPage(result.meta.page);
      setTotalPages(result.meta.totalPages);
    } catch (cause) {
      if (request !== requestRef.current) return;
      setError(cause instanceof Error ? cause.message : t("referencePicker.loadError"));
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }

  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => {
        if (!options.length) return -1;
        let next = current;
        for (let offset = 0; offset < options.length; offset += 1) {
          next = (next + direction + options.length) % options.length;
          if (!optionDisabled?.(options[next]!)) return next;
        }
        return -1;
      });
      return;
    }
    if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      const option = options[activeIndex];
      if (option && !optionDisabled?.(option)) select(option);
    }
  }

  return <div className={`reference-combobox${open ? " open" : ""}`} ref={rootRef}>
    <div className="reference-combobox-input">
      <input
        ref={inputRef}
        type="search"
        role="combobox"
        autoComplete="off"
        aria-autocomplete="list"
        aria-controls={listboxId}
        aria-expanded={open}
        aria-activedescendant={activeIndex >= 0 ? `${listboxId}-${options[activeIndex]?.id}` : undefined}
        aria-label={searchLabel}
        aria-required={required}
        disabled={disabled}
        placeholder={placeholder}
        value={query}
        onFocus={() => setOpen(true)}
        onClick={() => setOpen(true)}
        onKeyDown={keyDown}
        onChange={(event) => {
          if (value) onChange(null);
          setSelectionLabel("");
          setQuery(event.target.value);
          setOpen(true);
        }}
      />
      {value && !disabled && <button type="button" className="reference-combobox-clear" aria-label={t("referencePicker.clear")} onClick={() => select(null)}>×</button>}
    </div>
    {open && <div className="reference-combobox-panel">
      <div id={listboxId} role="listbox" aria-label={searchLabel} className="reference-combobox-options">
        {optionalLabel && <button type="button" role="option" aria-selected={!value} className="reference-combobox-option optional" onMouseDown={(event) => event.preventDefault()} onClick={() => select(null)}>{optionalLabel}</button>}
        {options.map((option, index) => {
          const isDisabled = optionDisabled?.(option) ?? false;
          return <button
            id={`${listboxId}-${option.id}`}
            key={option.id}
            type="button"
            role="option"
            aria-selected={option.id === value}
            aria-disabled={isDisabled}
            className={`reference-combobox-option${index === activeIndex ? " active" : ""}`}
            disabled={isDisabled}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => setActiveIndex(index)}
            onClick={() => select(option)}
          >{optionLabel(option)}</button>;
        })}
      </div>
      {loading && <span className="reference-combobox-status" role="status">{t("referencePicker.loading")}</span>}
      {!loading && !error && options.length === 0 && <span className="reference-combobox-status">{t("referencePicker.empty")}</span>}
      {error && <span className="reference-combobox-status error" role="alert">{error}</span>}
      {page < totalPages && <button type="button" className="reference-combobox-more" disabled={loading} onMouseDown={(event) => event.preventDefault()} onClick={() => void loadMore()}>{t("referencePicker.more")}</button>}
    </div>}
  </div>;
}
