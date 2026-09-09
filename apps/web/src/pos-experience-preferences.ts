import { storageKey } from "./branding";

export type PosDisplayMode = "retail" | "tiles";
export type PosContextPanelMode = "expanded" | "collapsed";
export const posPreferenceKey = (userId: string, companyId: string) =>
  storageKey(`pos-display.v1.${encodeURIComponent(userId)}.${encodeURIComponent(companyId)}`);
export const posContextPanelPreferenceKey = (userId: string, companyId: string) =>
  storageKey(`pos-context-panel.v1.${encodeURIComponent(userId)}.${encodeURIComponent(companyId)}`);

export function readPosDisplayMode(userId: string, companyId: string): PosDisplayMode {
  try { return localStorage.getItem(posPreferenceKey(userId, companyId)) === "tiles" ? "tiles" : "retail"; }
  catch { return "retail"; }
}

export function savePosDisplayMode(userId: string, companyId: string, mode: PosDisplayMode) {
  try { localStorage.setItem(posPreferenceKey(userId, companyId), mode); } catch { /* Optional presentation preference only. */ }
}

export function readPosContextPanelMode(userId: string, companyId: string): PosContextPanelMode {
  try { return localStorage.getItem(posContextPanelPreferenceKey(userId, companyId)) === "collapsed" ? "collapsed" : "expanded"; }
  catch { return "expanded"; }
}

export function savePosContextPanelMode(userId: string, companyId: string, mode: PosContextPanelMode) {
  try { localStorage.setItem(posContextPanelPreferenceKey(userId, companyId), mode); } catch { /* Optional device layout preference only. */ }
}
