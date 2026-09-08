export type DocumentTab = "invoices" | "aging" | "taxes";
export type DocumentTabScope = "sales" | "purchases";
export type DocumentTabDirection = "ltr" | "rtl";

export function availableDocumentTabs(canViewAging: boolean): DocumentTab[] {
  return canViewAging ? ["invoices", "aging", "taxes"] : ["invoices", "taxes"];
}

export function resolveDocumentTab(tab: DocumentTab, available: readonly DocumentTab[]): DocumentTab {
  return available.includes(tab) ? tab : available[0] ?? "invoices";
}

export function nextDocumentTab(
  current: DocumentTab,
  available: readonly DocumentTab[],
  key: string,
  direction: DocumentTabDirection,
) {
  const currentIndex = available.indexOf(current);
  if (currentIndex < 0 || available.length === 0) return null;
  if (key === "Home") return available[0] ?? null;
  if (key === "End") return available.at(-1) ?? null;
  const delta = key === "ArrowRight" ? (direction === "rtl" ? -1 : 1)
    : key === "ArrowLeft" ? (direction === "rtl" ? 1 : -1)
      : null;
  if (delta == null) return null;
  return available[(currentIndex + delta + available.length) % available.length] ?? null;
}

export const documentTabId = (scope: DocumentTabScope, tab: DocumentTab) => `${scope}-documents-tab-${tab}`;
export const documentPanelId = (scope: DocumentTabScope) => `${scope}-documents-panel`;
