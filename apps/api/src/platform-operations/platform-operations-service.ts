import type {
  PlatformAnalyticsComparison,
  PlatformAnalyticsQueryPort,
  PlatformIdentityQueryPort,
} from "./platform-operations-ports.js";

export class PlatformOperationsError extends Error {
  constructor(public readonly reason: "FORBIDDEN" | "NOT_FOUND") {
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
    await this.requireOperator(userId);
    return this.analytics.overview({ now: this.now(), days });
  }

  async analyticsDashboard(userId: bigint, input: {
    from: Date;
    toExclusive: Date;
    comparison: PlatformAnalyticsComparison;
    comparisonFrom: Date | null;
    comparisonToExclusive: Date | null;
    companyId?: bigint | undefined;
  }) {
    await this.requireOperator(userId);
    const result = await this.analytics.analytics({ ...input, now: this.now() });
    if (!result) throw new PlatformOperationsError("NOT_FOUND");
    return result;
  }

  async listCompanies(userId: bigint, input: {
    days: 7 | 30 | 90;
    search?: string | undefined;
    status?: "ALL" | "ACTIVE" | "INACTIVE" | undefined;
    page: number;
    pageSize: number;
  }) {
    await this.requireOperator(userId);
    return this.analytics.listCompanies({ ...input, now: this.now() });
  }

  async companyDetails(userId: bigint, companyId: bigint, days: 7 | 30 | 90) {
    await this.requireOperator(userId);
    const result = await this.analytics.companyDetails({ companyId, now: this.now(), days });
    if (!result) throw new PlatformOperationsError("NOT_FOUND");
    return result;
  }

  async requireOperator(userId: bigint) {
    if (!await this.isOperator(userId)) throw new PlatformOperationsError("FORBIDDEN");
  }

  private async isOperator(userId: bigint) {
    if (!this.operators.size) return false;
    const email = await this.identities.activeEmailForUser(userId);
    return email !== null && this.operators.has(email.toLocaleLowerCase("en-US"));
  }
}
