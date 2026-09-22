import { describe, expect, it, vi } from "vitest";
import { runAccountMutationOnce, runDefaultTemplateApplyOnce, versionedAccountBody } from "./account-version-cas";

const apiError = (message: string, status: number, code: string, reason: string) => Object.assign(new Error(message), { status, code, reason });

describe("account version CAS UI", () => {
  it("adds the displayed version to account mutation bodies", () => {
    expect(versionedAccountBody(7, { reason: "documented change" })).toEqual({ reason: "documented change", expectedVersion: 7 });
  });

  it("does not retry a conflicting command and refreshes the stale snapshot once", async () => {
    const command = vi.fn().mockRejectedValue(apiError("stale", 409, "VERSION_CONFLICT", "VERSION_CONFLICT"));
    const refresh = vi.fn().mockResolvedValue(undefined);
    await expect(runAccountMutationOnce(command, refresh)).resolves.toBe(false);
    expect(command).toHaveBeenCalledTimes(1);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("does not retry default-template apply and refreshes accounts/template status on conflict", async () => {
    const apply = vi.fn().mockRejectedValue(apiError("template changed", 409, "VERSION_CONFLICT", "VERSION_CONFLICT"));
    const refreshAccountsAndTemplate = vi.fn().mockResolvedValue(undefined);
    await expect(runDefaultTemplateApplyOnce(apply, refreshAccountsAndTemplate)).resolves.toEqual({ completed: false });
    expect(apply).toHaveBeenCalledTimes(1);
    expect(refreshAccountsAndTemplate).toHaveBeenCalledTimes(1);
  });

  it("does not absorb unrelated failures", async () => {
    const failure = apiError("invalid", 422, "BUSINESS_RULE_VIOLATION", "INVALID_PARENT");
    await expect(runAccountMutationOnce(() => Promise.reject(failure), vi.fn())).rejects.toBe(failure);
  });
});
