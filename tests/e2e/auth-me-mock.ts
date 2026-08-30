import type { PlatformModuleCode } from "../../apps/web/src/types.js";

export type AuthMeResponse = {
  user: { id: string; displayName: string };
  selectedCompany: { id: string; name: string; timezone: string } | null;
  modules: PlatformModuleCode[];
  permissions: string[];
};

type SelectedCompany = NonNullable<AuthMeResponse["selectedCompany"]>;

export const e2eCompany = {
  id: "1",
  name: "E2E Company",
  timezone: "Asia/Riyadh",
};

export function authMeResponse(
  permissions: readonly string[],
  modules: readonly PlatformModuleCode[],
  selectedCompany: SelectedCompany = e2eCompany,
): AuthMeResponse {
  return {
    user: { id: "1", displayName: "E2E User" },
    selectedCompany,
    modules: [...modules],
    permissions: [...permissions],
  };
}
