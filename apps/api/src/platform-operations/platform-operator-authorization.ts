import type {
  PlatformOperatorAuthorizationPort,
  PlatformOperatorIdentityQueryPort,
} from "./platform-operations-ports.js";

export class PlatformOperatorInitializationError extends Error {
  constructor(
    public readonly reason:
      | "CONFIGURED_USER_IDS_NOT_FOUND"
      | "DEVELOPMENT_FALLBACK_EMAILS_NOT_FOUND",
    public readonly missingReferences: readonly string[],
  ) {
    super(`${reason}: ${missingReferences.join(", ")}`);
    this.name = "PlatformOperatorInitializationError";
  }
}

const uniqueUserIds = (userIds: readonly bigint[]) => [
  ...new Map(userIds.map((userId) => [userId.toString(), userId])).values(),
];

const normalizedEmails = (emails: readonly string[]) => [
  ...new Set(
    emails
      .map((email) => email.trim().toLocaleLowerCase("en-US"))
      .filter(Boolean),
  ),
];

class FixedPlatformOperatorAuthorization implements PlatformOperatorAuthorizationPort {
  private readonly operatorIds: ReadonlySet<string>;

  constructor(
    private readonly identities: PlatformOperatorIdentityQueryPort,
    operatorUserIds: readonly bigint[],
  ) {
    this.operatorIds = new Set(operatorUserIds.map((userId) => userId.toString()));
  }

  async isActiveOperator(userId: bigint) {
    if (!this.operatorIds.has(userId.toString())) return false;
    return this.identities.isActiveUser(userId);
  }
}

export async function initializePlatformOperatorAuthorization(
  identities: PlatformOperatorIdentityQueryPort,
  options: {
    operatorUserIds: readonly bigint[];
    developmentFallbackEmails?: readonly string[];
  },
): Promise<PlatformOperatorAuthorizationPort> {
  let operatorUserIds = uniqueUserIds(options.operatorUserIds);

  if (operatorUserIds.length) {
    const existing = new Set(
      (await identities.existingUserIds(operatorUserIds)).map((userId) => userId.toString()),
    );
    const missing = operatorUserIds
      .filter((userId) => !existing.has(userId.toString()))
      .map((userId) => userId.toString());
    if (missing.length) {
      throw new PlatformOperatorInitializationError("CONFIGURED_USER_IDS_NOT_FOUND", missing);
    }
  } else {
    const fallbackEmails = normalizedEmails(options.developmentFallbackEmails ?? []);
    if (fallbackEmails.length) {
      const users = await identities.usersByNormalizedEmails(fallbackEmails);
      const byEmail = new Map(users.map((user) => [user.emailNormalized, user.id]));
      const missing = fallbackEmails.filter((email) => !byEmail.has(email));
      if (missing.length) {
        throw new PlatformOperatorInitializationError("DEVELOPMENT_FALLBACK_EMAILS_NOT_FOUND", missing);
      }
      operatorUserIds = uniqueUserIds(fallbackEmails.map((email) => byEmail.get(email)!));
    }
  }

  return new FixedPlatformOperatorAuthorization(identities, operatorUserIds);
}
