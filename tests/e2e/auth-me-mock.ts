export type AuthMeResponse = {
  user: { id: string; displayName: string };
  selectedCompany: { id: string; name: string; timezone: string } | null;
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
  selectedCompany: SelectedCompany = e2eCompany,
): AuthMeResponse {
  return {
    user: { id: "1", displayName: "E2E User" },
    selectedCompany,
    permissions: [...permissions],
  };
}
