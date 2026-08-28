import type {
  PlatformAnalyticsQueryPort,
  PlatformIdentityQueryPort,
} from "./platform-operations-ports.js";

export class PlatformOperationsError extends Error {
  constructor(public readonly reason: "FORBIDDEN") {
    super(reason);
  }
}

export class PlatformOperationsService {
  private readonly operators: Set<string>;

  constructor(
    private readonly identities: PlatformIdentityQueryPort,
    private readonly analytics: PlatformAnalyticsQueryPort,
    operatorEmails: Iterable<string>,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.operators = new Set(
      [...operatorEmails]
        .map((email) => email.trim().toLocaleLowerCase("en-US"))
        .filter(Boolean),
    );
  }

  async capabilities(userId: bigint) {
    return { platformOperations: await this.isOperator(userId) };
  }

  async overview(userId: bigint, days: 7 | 30 | 90) {
    if (!await this.isOperator(userId)) {
      throw new PlatformOperationsError("FORBIDDEN");
    }
    return this.analytics.overview({ now: this.now(), days });
  }

  private async isOperator(userId: bigint) {
    if (!this.operators.size) return false;
    const email = await this.identities.activeEmailForUser(userId);
    return email !== null && this.operators.has(email.toLocaleLowerCase("en-US"));
  }
}
