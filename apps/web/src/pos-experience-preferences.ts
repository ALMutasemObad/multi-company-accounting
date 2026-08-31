import { storageKey } from "./branding";

export type PosDisplayMode = "retail" | "tiles";
export const posPreferenceKey = (userId: string, companyId: string) =>
  storageKey(`pos-display.v1.${encodeURIComponent(userId)}.${encodeURIComponent(companyId)}`);

export function readPosDisplayMode(userId: string, companyId: string): PosDisplayMode {
  try { return localStorage.getItem(posPreferenceKey(userId, companyId)) === "tiles" ? "tiles" : "retail"; }
  catch { return "retail"; }
}

export function savePosDisplayMode(userId: string, companyId: string, mode: PosDisplayMode) {
  try { localStorage.setItem(posPreferenceKey(userId, companyId), mode); } catch { /* Optional presentation preference only. */ }
}
