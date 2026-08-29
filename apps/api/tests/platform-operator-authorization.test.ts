import { describe, expect, it, vi } from "vitest";
import {
  initializePlatformOperatorAuthorization,
  PlatformOperatorInitializationError,
} from "../src/platform-operations/platform-operator-authorization.js";

const identityPort = (overrides: Partial<{
  existingUserIds: (userIds: readonly bigint[]) => Promise<bigint[]>;
  usersByNormalizedEmails: (emails: readonly string[]) => Promise<Array<{ id: bigint; emailNormalized: string }>>;
  isActiveUser: (userId: bigint) => Promise<boolean>;
}> = {}) => ({
  existingUserIds: vi.fn(async (userIds: readonly bigint[]) => [...userIds]),
  usersByNormalizedEmails: vi.fn(async () => []),
  isActiveUser: vi.fn(async () => true),
  ...overrides,
});

describe("fixed platform operator authorization", () => {
  it("authorizes only a configured user ID and checks its current active state", async () => {
    const identities = identityPort();
    const authorization = await initializePlatformOperatorAuthorization(identities, {
      operatorUserIds: [42n, 42n],
    });

    await expect(authorization.isActiveOperator(42n)).resolves.toBe(true);
    await expect(authorization.isActiveOperator(7n)).resolves.toBe(false);
    expect(identities.existingUserIds).toHaveBeenCalledWith([42n]);
    expect(identities.isActiveUser).toHaveBeenCalledTimes(1);
    expect(identities.isActiveUser).toHaveBeenCalledWith(42n);
  });

  it("denies a configured operator immediately after the identity is disabled", async () => {
    const identities = identityPort({ isActiveUser: vi.fn(async () => false) });
    const authorization = await initializePlatformOperatorAuthorization(identities, {
      operatorUserIds: [42n],
    });

    await expect(authorization.isActiveOperator(42n)).resolves.toBe(false);
  });

  it("fails startup closed when any configured user ID does not exist", async () => {
    const identities = identityPort({ existingUserIds: vi.fn(async () => [42n]) });

    await expect(initializePlatformOperatorAuthorization(identities, {
      operatorUserIds: [42n, 99n],
    })).rejects.toEqual(new PlatformOperatorInitializationError(
      "CONFIGURED_USER_IDS_NOT_FOUND",
      ["99"],
    ));
  });

  it("resolves a development email fallback once and authorizes its fixed ID thereafter", async () => {
    const identities = identityPort({
      usersByNormalizedEmails: vi.fn(async () => [{ id: 17n, emailNormalized: "operator@example.com" }]),
    });
    const authorization = await initializePlatformOperatorAuthorization(identities, {
      operatorUserIds: [],
      developmentFallbackEmails: [" Operator@Example.com "],
    });

    await expect(authorization.isActiveOperator(17n)).resolves.toBe(true);
    await expect(authorization.isActiveOperator(18n)).resolves.toBe(false);
    expect(identities.usersByNormalizedEmails).toHaveBeenCalledTimes(1);
    expect(identities.usersByNormalizedEmails).toHaveBeenCalledWith(["operator@example.com"]);
  });

  it("fails startup when a development fallback email cannot be resolved", async () => {
    const identities = identityPort();

    await expect(initializePlatformOperatorAuthorization(identities, {
      operatorUserIds: [],
      developmentFallbackEmails: ["missing@example.com"],
    })).rejects.toEqual(new PlatformOperatorInitializationError(
      "DEVELOPMENT_FALLBACK_EMAILS_NOT_FOUND",
      ["missing@example.com"],
    ));
  });
});
