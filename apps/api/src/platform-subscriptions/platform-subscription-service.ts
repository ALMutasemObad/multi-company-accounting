import {
  Prisma,
  type PlatformPlanModuleSelection,
  type PlatformPlanSelfServicePolicy,
  type PrismaClient,
} from "@prisma/client";
import type { AuditAppendPort } from "../platform/audit-append-port.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { PlatformSubscriptionPaymentEvidencePort } from "./platform-subscription-payment-evidence-port.js";

export const SUBSCRIPTION_DEFAULT_PAGE_SIZE = 20;
export const SUBSCRIPTION_MAX_PAGE_SIZE = 100;

export type SubscriptionFailureReason =
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "VERSION_CONFLICT"
  | "PUBLISHED_VERSION_IMMUTABLE"
  | "PLAN_CODE_EXISTS"
  | "DRAFT_ALREADY_EXISTS"
  | "DRAFT_INCOMPLETE"
  | "INVALID_AMOUNT"
  | "INVALID_MODULE"
  | "INACTIVE_MODULE"
  | "MODULE_NOT_AVAILABLE"
  | "MODULE_DEPENDENCY_MISSING"
  | "MODULE_DEPENDENCY_CYCLE"
  | "PLAN_NOT_PUBLISHED"
  | "PLAN_NOT_EFFECTIVE"
  | "SELF_SERVICE_DISABLED"
  | "TRIAL_ALREADY_USED"
  | "CHANGE_ALREADY_SCHEDULED"
  | "CHANGE_ALREADY_PENDING"
  | "INVALID_CHANGE_STATE"
  | "PAYMENT_REQUIRED"
  | "INVALID_EFFECTIVE_AT"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class PlatformSubscriptionError extends Error {
  constructor(public readonly reason: SubscriptionFailureReason) {
    super(reason);
  }
}

export interface PlatformSubscriptionOperatorAuthorizationPort {
  isOperator(userId: bigint): Promise<boolean>;
}

async function requireOperator(
  authorization: PlatformSubscriptionOperatorAuthorizationPort,
  userId: bigint,
) {
  if (!await authorization.isOperator(userId)) {
    throw new PlatformSubscriptionError("FORBIDDEN");
  }
}

type OperatorActor = { userId: bigint };
type Pagination = { page: number; pageSize: number };
type ModuleInput = {
  moduleId: bigint;
  selectionMode: PlatformPlanModuleSelection;
  additionalRecurringFee: string | null;
};

export type DraftVersionInput = {
  displayName: string;
  description: string | null;
  billingCycle: "MONTHLY" | "QUARTERLY" | "ANNUAL";
  currencyCode: string;
  recurringFee: string | null;
  includedUsers: number | null;
  pricePerAdditionalUser: string | null;
  includedEmployees: number | null;
  pricePerAdditionalEmployee: string | null;
  includedPostedDocuments: number | null;
  pricePerAdditionalPostedDocument: string | null;
  taxRate: string;
  paymentTermsDays: number;
  trialDays: number;
  effectiveFrom: string;
  selfServicePolicy: PlatformPlanSelfServicePolicy;
  modules: ModuleInput[];
  version: number;
};

const decimal = (value: Prisma.Decimal.Value) => new Prisma.Decimal(value);
const uniqueConflict = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
const nonNegative = (value: Prisma.Decimal) => value.isFinite() && value.gte(0);
const decimalJson = (value: Prisma.Decimal | null) => value?.toFixed(4) ?? null;
const paginationMeta = (input: Pagination, total: number) => ({
  page: input.page,
  pageSize: input.pageSize,
  total,
  totalPages: Math.ceil(total / input.pageSize),
});
const addDays = (value: Date, days: number) => new Date(value.getTime() + days * 86_400_000);

type PlanVersionGraph = Prisma.PlatformPlanVersionGetPayload<{
  include: {
    plan: true;
    entitlements: { include: { module: { include: { dependencies: true } } } };
  };
}>;

function versionJson(version: PlanVersionGraph) {
  return {
    id: version.id.toString(),
    planId: version.planId.toString(),
    planCode: version.plan.code,
    versionNumber: version.versionNumber,
    displayName: version.displayName,
    description: version.description,
    billingCycle: version.billingCycle,
    currencyCode: version.currencyCode,
    recurringFee: decimalJson(version.recurringFee),
    includedUsers: version.includedUsers,
    pricePerAdditionalUser: decimalJson(version.pricePerAdditionalUser),
    includedEmployees: version.includedEmployees,
    pricePerAdditionalEmployee: decimalJson(version.pricePerAdditionalEmployee),
    includedPostedDocuments: version.includedPostedDocuments,
    pricePerAdditionalPostedDocument: decimalJson(version.pricePerAdditionalPostedDocument),
    taxRate: version.taxRate.toFixed(4),
    paymentTermsDays: version.paymentTermsDays,
    trialDays: version.trialDays,
    effectiveFrom: version.effectiveFrom.toISOString(),
    selfServicePolicy: version.selfServicePolicy,
    publicationStatus: version.publishedAt ? "PUBLISHED" as const : "DRAFT" as const,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    retiredAt: version.retiredAt?.toISOString() ?? null,
    version: version.version,
    modules: version.entitlements.map((entitlement) => ({
      id: entitlement.module.id.toString(),
      code: entitlement.module.code,
      displayName: entitlement.module.displayName,
      active: entitlement.module.isActive,
      selectionMode: entitlement.selectionMode,
      additionalRecurringFee: decimalJson(entitlement.additionalRecurringFee),
      dependencyIds: entitlement.module.dependencies.map((dependency) => dependency.dependsOnModuleId.toString()),
    })),
  };
}

function ownerVisibleModules(version: ReturnType<typeof versionJson>) {
  const byId = new Map(version.modules.map((module) => [module.id, module]));
  const resolved = new Map<string, boolean>();
  const visiting = new Set<string>();
  const available = (id: string): boolean => {
    const cached = resolved.get(id);
    if (cached !== undefined) return cached;
    const module = byId.get(id);
    if (!module?.active || visiting.has(id)) return false;
    visiting.add(id);
    const valid = module.dependencyIds.every((dependencyId) => available(dependencyId));
    visiting.delete(id);
    resolved.set(id, valid);
    return valid;
  };
  return version.modules.filter((module) => available(module.id));
}

async function lockPlanVersion(tx: Prisma.TransactionClient, id: bigint) {
  await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM platform_plan_versions WHERE id = ${id} FOR UPDATE
  `;
}

async function lockSubscription(tx: Prisma.TransactionClient, companyId: bigint) {
  await tx.$queryRaw<Array<{ id: bigint }>>`
    SELECT id FROM platform_subscriptions WHERE company_id = ${companyId} FOR UPDATE
  `;
}

function assertNoDependencyCycle(edges: Map<string, string[]>, selected: Set<string>) {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) throw new PlatformSubscriptionError("MODULE_DEPENDENCY_CYCLE");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of edges.get(id) ?? []) if (selected.has(dependency)) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of selected) visit(id);
}

async function validatePlanModules(tx: Prisma.TransactionClient, inputs: ModuleInput[]) {
  const ids = inputs.map((module) => module.moduleId);
  const idTexts = ids.map(String);
  if (new Set(idTexts).size !== ids.length) throw new PlatformSubscriptionError("INVALID_MODULE");
  const modules = ids.length
    ? await tx.platformModule.findMany({
      where: { id: { in: ids } },
      include: { dependencies: true },
    })
    : [];
  if (modules.length !== inputs.length) throw new PlatformSubscriptionError("INVALID_MODULE");
  if (modules.some((module) => !module.isActive)) throw new PlatformSubscriptionError("INACTIVE_MODULE");

  const inputById = new Map(inputs.map((input) => [input.moduleId.toString(), input]));
  const selected = new Set(inputById.keys());
  const edges = new Map<string, string[]>();
  for (const module of modules) {
    const source = module.id.toString();
    const dependencies = module.dependencies.map((dependency) => dependency.dependsOnModuleId.toString());
    edges.set(source, dependencies);
    for (const dependency of dependencies) {
      const dependencyInput = inputById.get(dependency);
      if (!dependencyInput) throw new PlatformSubscriptionError("MODULE_DEPENDENCY_MISSING");
      if (inputById.get(source)?.selectionMode === "INCLUDED" && dependencyInput.selectionMode !== "INCLUDED") {
        throw new PlatformSubscriptionError("MODULE_DEPENDENCY_MISSING");
      }
    }
  }
  assertNoDependencyCycle(edges, selected);

  return inputs.map((input) => {
    if (input.selectionMode === "INCLUDED") {
      if (input.additionalRecurringFee !== null) throw new PlatformSubscriptionError("INVALID_AMOUNT");
      return { ...input, additionalRecurringFee: null };
    }
    if (input.additionalRecurringFee === null) throw new PlatformSubscriptionError("INVALID_AMOUNT");
    const fee = decimal(input.additionalRecurringFee);
    if (!nonNegative(fee)) throw new PlatformSubscriptionError("INVALID_AMOUNT");
    return { ...input, additionalRecurringFee: fee };
  });
}

function pricing(input: DraftVersionInput) {
  const values = [
    input.recurringFee,
    input.pricePerAdditionalUser,
    input.pricePerAdditionalEmployee,
    input.pricePerAdditionalPostedDocument,
  ].map((value) => value === null ? null : decimal(value));
  if (values.some((value) => value !== null && !nonNegative(value))) {
    throw new PlatformSubscriptionError("INVALID_AMOUNT");
  }
  const taxRate = decimal(input.taxRate);
  if (!nonNegative(taxRate) || taxRate.gt(100)) throw new PlatformSubscriptionError("INVALID_AMOUNT");
  return {
    recurringFee: values[0]!,
    pricePerAdditionalUser: values[1]!,
    pricePerAdditionalEmployee: values[2]!,
    pricePerAdditionalPostedDocument: values[3]!,
    taxRate,
  };
}

export class PlatformSubscriptionCatalogService {
  private readonly transactions: TransactionExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly operatorAuthorization: PlatformSubscriptionOperatorAuthorizationPort,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.transactions = new TransactionExecutor(prisma);
  }

  async listModules(userId: bigint) {
    await requireOperator(this.operatorAuthorization, userId);
    const modules = await this.prisma.platformModule.findMany({
      include: { dependencies: { include: { dependsOnModule: true } } },
      orderBy: [{ code: "asc" }, { id: "asc" }],
    });
    return { modules: modules.map((module) => ({
      id: module.id.toString(), code: module.code, displayName: module.displayName,
      active: module.isActive, version: module.version,
      dependencies: module.dependencies.map((item) => ({
        id: item.dependsOnModule.id.toString(),
        code: item.dependsOnModule.code,
        active: item.dependsOnModule.isActive,
      })),
    })) };
  }

  async listPlans(userId: bigint, input: Pagination & {
    search?: string | undefined;
    active?: "ALL" | "ACTIVE" | "INACTIVE" | undefined;
    publicationStatus?: "ALL" | "DRAFT" | "PUBLISHED" | undefined;
  }) {
    await requireOperator(this.operatorAuthorization, userId);
    const where: Prisma.PlatformPlanWhereInput = {
      ...(input.active === "ACTIVE" ? { isActive: true } : input.active === "INACTIVE" ? { isActive: false } : {}),
      ...(input.publicationStatus === "DRAFT" ? { versions: { some: { publishedAt: null } } }
        : input.publicationStatus === "PUBLISHED" ? { versions: { some: { publishedAt: { not: null } } } } : {}),
      ...(input.search ? { OR: [
        { code: { contains: input.search } },
        { versions: { some: { displayName: { contains: input.search } } } },
      ] } : {}),
    };
    const [total, plans] = await Promise.all([
      this.prisma.platformPlan.count({ where }),
      this.prisma.platformPlan.findMany({
        where,
        include: {
          versions: {
            include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } },
            orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
            take: 1,
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    return {
      plans: plans.map((plan) => ({
        id: plan.id.toString(), code: plan.code, active: plan.isActive, version: plan.version,
        latestVersion: plan.versions[0] ? versionJson(plan.versions[0]) : null,
        updatedAt: plan.updatedAt.toISOString(),
      })),
      meta: paginationMeta(input, total),
    };
  }

  async plan(userId: bigint, planId: bigint) {
    await requireOperator(this.operatorAuthorization, userId);
    const plan = await this.prisma.platformPlan.findUnique({
      where: { id: planId },
      include: { versions: {
        include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } },
        orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
      } },
    });
    if (!plan) throw new PlatformSubscriptionError("NOT_FOUND");
    return { plan: {
      id: plan.id.toString(), code: plan.code, active: plan.isActive, version: plan.version,
      createdAt: plan.createdAt.toISOString(), updatedAt: plan.updatedAt.toISOString(),
      versions: plan.versions.map(versionJson),
    } };
  }

  async createPlan(actor: OperatorActor, input: Omit<DraftVersionInput, "version"> & { code: string }) {
    await requireOperator(this.operatorAuthorization, actor.userId);
    const values = pricing({ ...input, version: 0 });
    return this.transactions.execute({ operation: "CREATE_PLATFORM_PLAN" }, async (tx) => {
      const modules = await validatePlanModules(tx, input.modules);
      const plan = await tx.platformPlan.create({ data: {
        code: input.code.toUpperCase(), createdById: actor.userId, updatedById: actor.userId,
      } });
      const version = await tx.platformPlanVersion.create({ data: {
        planId: plan.id, versionNumber: 1, displayName: input.displayName,
        description: input.description, billingCycle: input.billingCycle,
        currencyCode: input.currencyCode.toUpperCase(), ...values,
        includedUsers: input.includedUsers, includedEmployees: input.includedEmployees,
        includedPostedDocuments: input.includedPostedDocuments,
        paymentTermsDays: input.paymentTermsDays, trialDays: input.trialDays,
        effectiveFrom: new Date(input.effectiveFrom), selfServicePolicy: input.selfServicePolicy,
        createdById: actor.userId, updatedById: actor.userId,
        entitlements: { create: modules.map((module) => ({
          moduleId: module.moduleId, selectionMode: module.selectionMode,
          additionalRecurringFee: module.additionalRecurringFee,
        })) },
      }, include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } } });
      return { plan: { id: plan.id.toString(), code: plan.code, active: plan.isActive, version: plan.version }, version: versionJson(version) };
    }).catch((error: unknown) => {
      if (uniqueConflict(error)) throw new PlatformSubscriptionError("PLAN_CODE_EXISTS");
      throw error;
    });
  }

  async updatePlan(actor: OperatorActor, planId: bigint, input: { active: boolean; version: number }) {
    await requireOperator(this.operatorAuthorization, actor.userId);
    return this.transactions.execute({ operation: "UPDATE_PLATFORM_PLAN" }, async (tx) => {
      const updated = await tx.platformPlan.updateMany({
        where: { id: planId, version: input.version },
        data: { isActive: input.active, updatedById: actor.userId, version: { increment: 1 } },
      });
      if (updated.count !== 1) {
        if (!await tx.platformPlan.findUnique({ where: { id: planId }, select: { id: true } })) throw new PlatformSubscriptionError("NOT_FOUND");
        throw new PlatformSubscriptionError("VERSION_CONFLICT");
      }
      const plan = await tx.platformPlan.findUniqueOrThrow({ where: { id: planId } });
      return { plan: { id: plan.id.toString(), code: plan.code, active: plan.isActive, version: plan.version } };
    });
  }

  async createDraft(actor: OperatorActor, planId: bigint) {
    await requireOperator(this.operatorAuthorization, actor.userId);
    return this.transactions.execute({ operation: "CREATE_PLATFORM_PLAN_DRAFT" }, async (tx) => {
      const plan = await tx.platformPlan.findUnique({ where: { id: planId } });
      if (!plan) throw new PlatformSubscriptionError("NOT_FOUND");
      const existingDraft = await tx.platformPlanVersion.findFirst({ where: { planId, publishedAt: null }, select: { id: true } });
      if (existingDraft) throw new PlatformSubscriptionError("DRAFT_ALREADY_EXISTS");
      const source = await tx.platformPlanVersion.findFirst({
        where: { planId, publishedAt: { not: null } },
        include: { entitlements: true },
        orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
      });
      if (!source) throw new PlatformSubscriptionError("NOT_FOUND");
      const version = await tx.platformPlanVersion.create({ data: {
        planId, versionNumber: source.versionNumber + 1,
        displayName: source.displayName, description: source.description,
        billingCycle: source.billingCycle, currencyCode: source.currencyCode,
        recurringFee: source.recurringFee, includedUsers: source.includedUsers,
        pricePerAdditionalUser: source.pricePerAdditionalUser,
        includedEmployees: source.includedEmployees,
        pricePerAdditionalEmployee: source.pricePerAdditionalEmployee,
        includedPostedDocuments: source.includedPostedDocuments,
        pricePerAdditionalPostedDocument: source.pricePerAdditionalPostedDocument,
        taxRate: source.taxRate, paymentTermsDays: source.paymentTermsDays,
        trialDays: source.trialDays, effectiveFrom: this.now(),
        selfServicePolicy: "DISABLED",
        createdById: actor.userId, updatedById: actor.userId,
        entitlements: { create: source.entitlements.map((entitlement) => ({
          moduleId: entitlement.moduleId, selectionMode: entitlement.selectionMode,
          additionalRecurringFee: entitlement.additionalRecurringFee,
        })) },
      }, include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } } });
      await tx.platformPlan.update({ where: { id: planId }, data: { updatedById: actor.userId } });
      return { version: versionJson(version) };
    }).catch((error: unknown) => {
      if (uniqueConflict(error)) throw new PlatformSubscriptionError("DRAFT_ALREADY_EXISTS");
      throw error;
    });
  }

  async updateDraft(actor: OperatorActor, versionId: bigint, input: DraftVersionInput) {
    await requireOperator(this.operatorAuthorization, actor.userId);
    const values = pricing(input);
    return this.transactions.execute({ operation: "UPDATE_PLATFORM_PLAN_DRAFT" }, async (tx) => {
      await lockPlanVersion(tx, versionId);
      const existing = await tx.platformPlanVersion.findUnique({ where: { id: versionId } });
      if (!existing) throw new PlatformSubscriptionError("NOT_FOUND");
      if (existing.publishedAt) throw new PlatformSubscriptionError("PUBLISHED_VERSION_IMMUTABLE");
      if (existing.version !== input.version) throw new PlatformSubscriptionError("VERSION_CONFLICT");
      const modules = await validatePlanModules(tx, input.modules);
      const updated = await tx.platformPlanVersion.updateMany({
        where: { id: versionId, version: input.version, publishedAt: null },
        data: {
          displayName: input.displayName, description: input.description,
          billingCycle: input.billingCycle, currencyCode: input.currencyCode.toUpperCase(), ...values,
          includedUsers: input.includedUsers, includedEmployees: input.includedEmployees,
          includedPostedDocuments: input.includedPostedDocuments,
          paymentTermsDays: input.paymentTermsDays, trialDays: input.trialDays,
          effectiveFrom: new Date(input.effectiveFrom), selfServicePolicy: input.selfServicePolicy,
          updatedById: actor.userId,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) throw new PlatformSubscriptionError("VERSION_CONFLICT");
      await tx.platformPlanEntitlement.deleteMany({ where: { planVersionId: versionId } });
      if (modules.length) await tx.platformPlanEntitlement.createMany({ data: modules.map((module) => ({
        planVersionId: versionId, moduleId: module.moduleId,
        selectionMode: module.selectionMode, additionalRecurringFee: module.additionalRecurringFee,
      })) });
      await tx.platformPlan.update({ where: { id: existing.planId }, data: { updatedById: actor.userId } });
      const version = await tx.platformPlanVersion.findUniqueOrThrow({
        where: { id: versionId }, include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } },
      });
      return { version: versionJson(version) };
    });
  }

  async publish(actor: OperatorActor, versionId: bigint, expectedVersion: number) {
    await requireOperator(this.operatorAuthorization, actor.userId);
    return this.transactions.execute({ operation: "PUBLISH_PLATFORM_PLAN_VERSION" }, async (tx) => {
      await lockPlanVersion(tx, versionId);
      const version = await tx.platformPlanVersion.findUnique({
        where: { id: versionId },
        include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } },
      });
      if (!version) throw new PlatformSubscriptionError("NOT_FOUND");
      if (version.publishedAt) throw new PlatformSubscriptionError("PUBLISHED_VERSION_IMMUTABLE");
      if (version.version !== expectedVersion) throw new PlatformSubscriptionError("VERSION_CONFLICT");
      if (version.recurringFee === null || version.includedUsers === null || version.includedEmployees === null
        || version.includedPostedDocuments === null) throw new PlatformSubscriptionError("DRAFT_INCOMPLETE");
      if (version.selfServicePolicy === "IMMEDIATE_FREE" && !version.recurringFee.eq(0)) {
        throw new PlatformSubscriptionError("DRAFT_INCOMPLETE");
      }
      await validatePlanModules(tx, version.entitlements.map((entitlement) => ({
        moduleId: entitlement.moduleId, selectionMode: entitlement.selectionMode,
        additionalRecurringFee: decimalJson(entitlement.additionalRecurringFee),
      })));
      const publishedAt = this.now();
      const updated = await tx.platformPlanVersion.updateMany({
        where: { id: versionId, version: expectedVersion, publishedAt: null },
        data: { publishedAt, publishedById: actor.userId, updatedById: actor.userId, version: { increment: 1 } },
      });
      if (updated.count !== 1) throw new PlatformSubscriptionError("VERSION_CONFLICT");
      await tx.platformPlan.update({ where: { id: version.planId }, data: { updatedById: actor.userId } });
      const published = await tx.platformPlanVersion.findUniqueOrThrow({
        where: { id: versionId }, include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } },
      });
      return { version: versionJson(published) };
    });
  }
}

type Bundle = {
  version: PlanVersionGraph;
  modules: Array<{ moduleId: bigint; selectionMode: PlatformPlanModuleSelection }>;
  baseFee: Prisma.Decimal;
  optionalFee: Prisma.Decimal;
  totalFee: Prisma.Decimal;
};

async function loadBundle(
  tx: Prisma.TransactionClient,
  targetPlanVersionId: bigint,
  optionalModuleIds: bigint[],
  effectiveAt: Date,
): Promise<Bundle> {
  const version = await tx.platformPlanVersion.findUnique({
    where: { id: targetPlanVersionId },
    include: {
      plan: true,
      entitlements: { include: { module: { include: { dependencies: true } } } },
    },
  });
  if (!version || !version.plan.isActive || !version.publishedAt || version.retiredAt) {
    throw new PlatformSubscriptionError("PLAN_NOT_PUBLISHED");
  }
  if (version.effectiveFrom > effectiveAt) throw new PlatformSubscriptionError("PLAN_NOT_EFFECTIVE");
  if (version.recurringFee === null) throw new PlatformSubscriptionError("PLAN_NOT_PUBLISHED");
  const optionalTexts = optionalModuleIds.map(String);
  if (new Set(optionalTexts).size !== optionalTexts.length) throw new PlatformSubscriptionError("INVALID_MODULE");
  const entitlementById = new Map(version.entitlements.map((item) => [item.moduleId.toString(), item]));
  for (const optionalId of optionalTexts) {
    const entitlement = entitlementById.get(optionalId);
    if (!entitlement || entitlement.selectionMode !== "OPTIONAL") {
      throw new PlatformSubscriptionError("MODULE_NOT_AVAILABLE");
    }
  }
  const selectedEntitlements = version.entitlements.filter((item) =>
    item.selectionMode === "INCLUDED" || optionalTexts.includes(item.moduleId.toString()));
  if (selectedEntitlements.some((item) => !item.module.isActive)) throw new PlatformSubscriptionError("INACTIVE_MODULE");
  const selected = new Set(selectedEntitlements.map((item) => item.moduleId.toString()));
  const edges = new Map<string, string[]>();
  for (const entitlement of selectedEntitlements) {
    const dependencies = entitlement.module.dependencies.map((item) => item.dependsOnModuleId.toString());
    edges.set(entitlement.moduleId.toString(), dependencies);
    if (dependencies.some((dependency) => !selected.has(dependency))) {
      throw new PlatformSubscriptionError("MODULE_DEPENDENCY_MISSING");
    }
  }
  assertNoDependencyCycle(edges, selected);
  const optionalFee = selectedEntitlements.reduce((sum, item) =>
    item.selectionMode === "OPTIONAL" ? sum.plus(item.additionalRecurringFee ?? decimal(0)) : sum,
  decimal(0));
  const baseFee = version.recurringFee;
  return {
    version: version as PlanVersionGraph,
    modules: selectedEntitlements.map((item) => ({ moduleId: item.moduleId, selectionMode: item.selectionMode })),
    baseFee,
    optionalFee,
    totalFee: baseFee.plus(optionalFee),
  };
}

type ChangeGraph = Prisma.PlatformSubscriptionChangeGetPayload<{
  include: {
    targetPlanVersion: { include: { plan: true; entitlements: { include: { module: { include: { dependencies: true } } } } } };
    modules: { include: { module: true } };
  };
}>;

function changeJson(change: ChangeGraph) {
  return {
    id: change.publicId,
    state: change.state,
    source: change.source,
    requestedAt: change.requestedAt.toISOString(),
    effectiveAt: change.effectiveAt?.toISOString() ?? null,
    decidedAt: change.decidedAt?.toISOString() ?? null,
    decisionReason: change.decisionReason,
    quote: {
      currencyCode: change.currencyCode,
      baseRecurringFee: change.baseRecurringFee.toFixed(4),
      optionalRecurringFee: change.optionalRecurringFee.toFixed(4),
      totalRecurringFee: change.totalRecurringFee.toFixed(4),
    },
    plan: versionJson(change.targetPlanVersion),
    modules: change.modules.map((item) => ({
      id: item.module.id.toString(), code: item.module.code,
      displayName: item.module.displayName, selectionMode: item.selectionMode,
    })),
  };
}

const changeInclude = {
  targetPlanVersion: { include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } } },
  modules: { include: { module: true } },
} satisfies Prisma.PlatformSubscriptionChangeInclude;

export class PlatformSubscriptionLifecycleService {
  private readonly commands: IdempotentCommandExecutor;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly operatorAuthorization: PlatformSubscriptionOperatorAuthorizationPort,
    private readonly audit: AuditAppendPort,
    private readonly now: () => Date = () => new Date(),
    private readonly paymentEvidence?: PlatformSubscriptionPaymentEvidencePort,
  ) {
    this.commands = new IdempotentCommandExecutor(prisma);
  }

  async listSubscriptions(userId: bigint, input: Pagination & { search?: string | undefined; status?: string | undefined }) {
    await requireOperator(this.operatorAuthorization, userId);
    const now = this.now();
    const where: Prisma.PlatformSubscriptionWhereInput = {
      ...(input.status && input.status !== "ALL" ? { status: input.status as never } : {}),
      ...(input.search ? { company: { OR: [
        { name: { contains: input.search } }, { code: { contains: input.search } },
      ] } } : {}),
    };
    const [total, subscriptions] = await Promise.all([
      this.prisma.platformSubscription.count({ where }),
      this.prisma.platformSubscription.findMany({
        where,
        include: {
          company: true,
          planVersion: { include: { plan: true } },
          changes: {
            where: { state: "APPROVED", effectiveAt: { lte: now } },
            include: { targetPlanVersion: { include: { plan: true } } },
            orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
            take: 1,
          },
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    return { subscriptions: subscriptions.map((item) => {
      const effectivePlan = item.changes[0]?.targetPlanVersion ?? item.planVersion;
      return {
        company: { id: item.companyId.toString(), code: item.company.code, name: item.company.name, active: item.company.isActive },
        status: item.status, version: item.version,
        recordedPlan: { id: effectivePlan.id.toString(), code: effectivePlan.plan.code, displayName: effectivePlan.displayName },
        updatedAt: item.updatedAt.toISOString(),
      };
    }), meta: paginationMeta(input, total) };
  }

  async operatorCompany(userId: bigint, companyId: bigint, pagination: Pagination) {
    await requireOperator(this.operatorAuthorization, userId);
    return this.companySnapshot(companyId, pagination, true);
  }

  async ownerCompany(companyId: bigint, pagination: Pagination) {
    return this.companySnapshot(companyId, pagination, false);
  }

  private async companySnapshot(companyId: bigint, pagination: Pagination, includeCompany: boolean) {
    const now = this.now();
    const subscription = await this.prisma.platformSubscription.findUnique({
      where: { companyId },
      include: { company: true, planVersion: { include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } } } },
    });
    if (!subscription) throw new PlatformSubscriptionError("NOT_FOUND");
    const where = { companyId } satisfies Prisma.PlatformSubscriptionChangeWhereInput;
    const [current, scheduled, pending, historyTotal, history, effectiveEntitlements] = await Promise.all([
      this.prisma.platformSubscriptionChange.findFirst({
        where: { companyId, state: "APPROVED", effectiveAt: { lte: now } },
        include: changeInclude, orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.platformSubscriptionChange.findFirst({
        where: { companyId, state: "APPROVED", effectiveAt: { gt: now } },
        include: changeInclude, orderBy: [{ effectiveAt: "asc" }, { id: "asc" }],
      }),
      this.prisma.platformSubscriptionChange.findFirst({
        where: { companyId, state: "PENDING_APPROVAL" },
        include: changeInclude, orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
      }),
      this.prisma.platformSubscriptionChange.count({ where }),
      this.prisma.platformSubscriptionChange.findMany({
        where, include: changeInclude,
        orderBy: [{ requestedAt: "desc" }, { id: "desc" }],
        skip: (pagination.page - 1) * pagination.pageSize,
        take: pagination.pageSize,
      }),
      this.prisma.platformSubscriptionEntitlement.findMany({
        where: { companyId, effectiveFrom: { lte: now }, OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: now } }] },
        include: { module: true }, orderBy: [{ module: { code: "asc" } }, { id: "asc" }],
      }),
    ]);
    const fallback = subscription.planVersion as PlanVersionGraph;
    const currentPlan = current?.targetPlanVersion ?? fallback;
    const effectiveAt = current?.effectiveAt ?? subscription.startsAt;
    const trialEndsAt = currentPlan.trialDays > 0 ? addDays(effectiveAt, currentPlan.trialDays) : null;
    const status = trialEndsAt && trialEndsAt > now ? "TRIALING" : subscription.status === "TRIALING" ? "ACTIVE" : subscription.status;
    return {
      ...(includeCompany ? { company: { id: subscription.companyId.toString(), code: subscription.company.code, name: subscription.company.name, active: subscription.company.isActive } } : {}),
      subscription: {
        status, version: subscription.version, startsAt: subscription.startsAt.toISOString(),
        trialEndsAt: trialEndsAt?.toISOString() ?? null,
        currentPeriodStart: subscription.currentPeriodStart?.toISOString().slice(0, 10) ?? null,
        currentPeriodEnd: subscription.currentPeriodEnd?.toISOString().slice(0, 10) ?? null,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      },
      current: current ? changeJson(current) : {
        id: null, state: "APPROVED", source: "MIGRATION", requestedAt: subscription.startsAt.toISOString(),
        effectiveAt: subscription.startsAt.toISOString(), decidedAt: subscription.startsAt.toISOString(), decisionReason: null,
        quote: { currencyCode: currentPlan.currencyCode, baseRecurringFee: decimalJson(currentPlan.recurringFee) ?? "0.0000", optionalRecurringFee: "0.0000", totalRecurringFee: decimalJson(currentPlan.recurringFee) ?? "0.0000" },
        plan: versionJson(currentPlan),
        modules: effectiveEntitlements.map((item) => ({ id: item.module.id.toString(), code: item.module.code, displayName: item.module.displayName, selectionMode: "INCLUDED" })),
      },
      effectiveModules: effectiveEntitlements.map((item) => ({ id: item.module.id.toString(), code: item.module.code, displayName: item.module.displayName, source: item.source })),
      scheduled: scheduled ? changeJson(scheduled) : null,
      pending: pending ? changeJson(pending) : null,
      history: history.map(changeJson),
      meta: paginationMeta(pagination, historyTotal),
      generatedAt: now.toISOString(),
    };
  }

  async ownerCatalog(companyId: bigint, input: Pagination) {
    const now = this.now();
    if (!await this.prisma.platformSubscription.findUnique({ where: { companyId }, select: { id: true } })) {
      throw new PlatformSubscriptionError("NOT_FOUND");
    }
    const where: Prisma.PlatformPlanVersionWhereInput = {
      publishedAt: { not: null }, retiredAt: null, effectiveFrom: { lte: now },
      selfServicePolicy: { not: "DISABLED" },
      recurringFee: { not: null },
      plan: { isActive: true, code: { not: { startsWith: "LEGACY_COMPANY_" } } },
      entitlements: { none: { selectionMode: "INCLUDED", module: { isActive: false } } },
    };
    const [total, versions] = await Promise.all([
      this.prisma.platformPlanVersion.count({ where }),
      this.prisma.platformPlanVersion.findMany({
        where, include: { plan: true, entitlements: { include: { module: { include: { dependencies: true } } } } },
        orderBy: [{ effectiveFrom: "desc" }, { id: "desc" }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
      }),
    ]);
    return { plans: versions.map((version) => {
      const serialized = versionJson(version);
      return { ...serialized, modules: ownerVisibleModules(serialized) };
    }), meta: paginationMeta(input, total) };
  }

  async scheduleOperatorChange(actor: { userId: bigint }, companyId: bigint, input: {
    targetPlanVersionId: bigint; optionalModuleIds: bigint[]; effectiveAt: string;
    subscriptionVersion: number; idempotencyKey: string;
  }) {
    await requireOperator(this.operatorAuthorization, actor.userId);
    const effectiveAt = new Date(input.effectiveAt);
    if (!Number.isFinite(effectiveAt.getTime()) || effectiveAt < this.now()) throw new PlatformSubscriptionError("INVALID_EFFECTIVE_AT");
    return this.execute(companyId, actor.userId, "SCHEDULE_PLATFORM_SUBSCRIPTION_CHANGE", input.idempotencyKey, {
      targetPlanVersionId: input.targetPlanVersionId.toString(), optionalModuleIds: input.optionalModuleIds.map(String).sort(),
      effectiveAt: effectiveAt.toISOString(), subscriptionVersion: input.subscriptionVersion,
    }, 201, async (tx) => {
      const bundle = await loadBundle(tx, input.targetPlanVersionId, input.optionalModuleIds, effectiveAt);
      return this.applyApproved(tx, companyId, actor.userId, bundle, effectiveAt, input.subscriptionVersion, "PLATFORM_OPERATOR", null);
    });
  }

  async requestOwnerChange(actor: { userId: bigint; companyId: bigint }, input: {
    targetPlanVersionId: bigint; optionalModuleIds: bigint[]; subscriptionVersion: number; idempotencyKey: string;
  }) {
    return this.execute(actor.companyId, actor.userId, "REQUEST_COMPANY_SUBSCRIPTION_CHANGE", input.idempotencyKey, {
      targetPlanVersionId: input.targetPlanVersionId.toString(), optionalModuleIds: input.optionalModuleIds.map(String).sort(),
      subscriptionVersion: input.subscriptionVersion,
    }, 201, async (tx) => {
      await lockSubscription(tx, actor.companyId);
      const subscription = await tx.platformSubscription.findUnique({ where: { companyId: actor.companyId } });
      if (!subscription) throw new PlatformSubscriptionError("NOT_FOUND");
      if (subscription.version !== input.subscriptionVersion) throw new PlatformSubscriptionError("VERSION_CONFLICT");
      const now = this.now();
      const bundle = await loadBundle(tx, input.targetPlanVersionId, input.optionalModuleIds, now);
      if (bundle.version.selfServicePolicy === "DISABLED") throw new PlatformSubscriptionError("SELF_SERVICE_DISABLED");
      await this.assertTrialAvailable(tx, subscription.id, bundle.version.trialDays);
      if (bundle.version.selfServicePolicy === "IMMEDIATE_FREE" && bundle.totalFee.eq(0)) {
        return this.applyApprovedLocked(tx, subscription, actor.userId, bundle, now, "COMPANY_OWNER", null);
      }
      if (await tx.platformSubscriptionChange.findFirst({ where: { companyId: actor.companyId, state: "PENDING_APPROVAL" }, select: { id: true } })) {
        throw new PlatformSubscriptionError("CHANGE_ALREADY_PENDING");
      }
      const changed = await tx.platformSubscription.updateMany({
        where: { id: subscription.id, companyId: actor.companyId, version: input.subscriptionVersion },
        data: { version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new PlatformSubscriptionError("VERSION_CONFLICT");
      const request = await tx.platformSubscriptionChange.create({ data: {
        companyId: actor.companyId, subscriptionId: subscription.id,
        fromPlanVersionId: subscription.planVersionId, targetPlanVersionId: bundle.version.id,
        state: "PENDING_APPROVAL", source: "COMPANY_OWNER", requestedById: actor.userId,
        requestedSubscriptionVersion: input.subscriptionVersion,
        currencyCode: bundle.version.currencyCode, baseRecurringFee: bundle.baseFee,
        optionalRecurringFee: bundle.optionalFee, totalRecurringFee: bundle.totalFee,
        modules: { create: bundle.modules },
      }, include: changeInclude });
      await this.audit.append(tx, {
        companyId: actor.companyId, actorUserId: actor.userId,
        action: "PLATFORM_SUBSCRIPTION_CHANGE_REQUESTED", entityType: "PLATFORM_SUBSCRIPTION_CHANGE", entityId: request.publicId,
        details: { targetPlanVersionId: bundle.version.id.toString(), totalRecurringFee: bundle.totalFee.toFixed(4), currencyCode: bundle.version.currencyCode },
      });
      return { change: changeJson(request), subscriptionVersion: subscription.version + 1, paymentCollected: false };
    });
  }

  async decideOwnerRequest(actor: { userId: bigint }, changeId: string, input: {
    decision: "APPROVE" | "REJECT"; effectiveAt: string | null; reason: string | null;
    subscriptionVersion: number; idempotencyKey: string;
  }) {
    await requireOperator(this.operatorAuthorization, actor.userId);
    const located = await this.prisma.platformSubscriptionChange.findUnique({ where: { publicId: changeId }, select: { companyId: true } });
    if (!located) throw new PlatformSubscriptionError("NOT_FOUND");
    return this.execute(located.companyId, actor.userId, "DECIDE_COMPANY_SUBSCRIPTION_CHANGE", input.idempotencyKey, {
      changeId, decision: input.decision, effectiveAt: input.effectiveAt, reason: input.reason,
      subscriptionVersion: input.subscriptionVersion,
    }, 200, async (tx) => {
      await lockSubscription(tx, located.companyId);
      const change = await tx.platformSubscriptionChange.findUnique({
        where: { publicId: changeId }, include: { modules: true },
      });
      if (!change || change.companyId !== located.companyId) throw new PlatformSubscriptionError("NOT_FOUND");
      if (change.state !== "PENDING_APPROVAL") throw new PlatformSubscriptionError("INVALID_CHANGE_STATE");
      const subscription = await tx.platformSubscription.findUnique({ where: { companyId: located.companyId } });
      if (!subscription) throw new PlatformSubscriptionError("NOT_FOUND");
      if (subscription.version !== input.subscriptionVersion) throw new PlatformSubscriptionError("VERSION_CONFLICT");
      if (input.decision === "REJECT") {
        const updated = await tx.platformSubscription.updateMany({
          where: { id: subscription.id, version: input.subscriptionVersion }, data: { version: { increment: 1 } },
        });
        if (updated.count !== 1) throw new PlatformSubscriptionError("VERSION_CONFLICT");
        const rejected = await tx.platformSubscriptionChange.update({
          where: { id: change.id }, data: { state: "REJECTED", decidedById: actor.userId, decidedAt: this.now(), decisionReason: input.reason },
          include: changeInclude,
        });
        await this.audit.append(tx, {
          companyId: located.companyId, actorUserId: actor.userId,
          action: "PLATFORM_SUBSCRIPTION_CHANGE_REJECTED", entityType: "PLATFORM_SUBSCRIPTION_CHANGE", entityId: change.publicId,
          details: { reason: input.reason, subscriptionVersion: subscription.version + 1 },
        });
        return { change: changeJson(rejected), subscriptionVersion: subscription.version + 1, paymentCollected: false };
      }
      if (!input.effectiveAt) throw new PlatformSubscriptionError("INVALID_EFFECTIVE_AT");
      const effectiveAt = new Date(input.effectiveAt);
      if (!Number.isFinite(effectiveAt.getTime()) || effectiveAt < this.now()) throw new PlatformSubscriptionError("INVALID_EFFECTIVE_AT");
      const paymentCollected = change.totalRecurringFee.eq(0) || await this.paymentEvidence?.hasSettledPayment(tx, {
        companyId: change.companyId,
        subscriptionChangeId: change.id,
        amount: change.totalRecurringFee,
        currencyCode: change.currencyCode,
      }) === true;
      if (!paymentCollected) throw new PlatformSubscriptionError("PAYMENT_REQUIRED");
      const optionalIds = change.modules.filter((module) => module.selectionMode === "OPTIONAL").map((module) => module.moduleId);
      const bundle = await loadBundle(tx, change.targetPlanVersionId, optionalIds, effectiveAt);
      return this.applyApprovedLocked(
        tx, subscription, actor.userId, bundle, effectiveAt, "COMPANY_OWNER", change.id, input.reason, paymentCollected,
      );
    });
  }

  private async applyApproved(
    tx: Prisma.TransactionClient, companyId: bigint, actorUserId: bigint, bundle: Bundle,
    effectiveAt: Date, expectedVersion: number, source: "PLATFORM_OPERATOR" | "COMPANY_OWNER", existingChangeId: bigint | null,
  ) {
    await lockSubscription(tx, companyId);
    const subscription = await tx.platformSubscription.findUnique({ where: { companyId } });
    if (!subscription) throw new PlatformSubscriptionError("NOT_FOUND");
    if (subscription.version !== expectedVersion) throw new PlatformSubscriptionError("VERSION_CONFLICT");
    return this.applyApprovedLocked(tx, subscription, actorUserId, bundle, effectiveAt, source, existingChangeId);
  }

  private async applyApprovedLocked(
    tx: Prisma.TransactionClient,
    subscription: { id: bigint; companyId: bigint; planVersionId: bigint; version: number },
    actorUserId: bigint,
    bundle: Bundle,
    effectiveAt: Date,
    source: "PLATFORM_OPERATOR" | "COMPANY_OWNER",
    existingChangeId: bigint | null,
    decisionReason: string | null = null,
    paymentCollected = false,
  ) {
    const scheduled = await tx.platformSubscriptionChange.findFirst({
      where: { companyId: subscription.companyId, state: "APPROVED", effectiveAt: { gt: this.now() }, ...(existingChangeId ? { id: { not: existingChangeId } } : {}) },
      select: { id: true },
    });
    if (scheduled) throw new PlatformSubscriptionError("CHANGE_ALREADY_SCHEDULED");
    await this.assertTrialAvailable(tx, subscription.id, bundle.version.trialDays);
    const effectiveCurrent = await tx.platformSubscriptionChange.findFirst({
      where: { companyId: subscription.companyId, state: "APPROVED", effectiveAt: { lte: this.now() } },
      select: { targetPlanVersionId: true }, orderBy: [{ effectiveAt: "desc" }, { id: "desc" }],
    });
    const updated = await tx.platformSubscription.updateMany({
      where: { id: subscription.id, companyId: subscription.companyId, version: subscription.version },
      data: {
        ...(effectiveAt <= this.now() ? {
          planVersionId: bundle.version.id,
          status: bundle.version.trialDays > 0 ? "TRIALING" : "ACTIVE",
          trialEndsAt: bundle.version.trialDays > 0 ? addDays(effectiveAt, bundle.version.trialDays) : null,
        } : {}),
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) throw new PlatformSubscriptionError("VERSION_CONFLICT");
    await tx.platformSubscriptionEntitlement.updateMany({
      where: { companyId: subscription.companyId, subscriptionId: subscription.id, effectiveUntil: null },
      data: { effectiveUntil: effectiveAt },
    });
    if (bundle.modules.length) await tx.platformSubscriptionEntitlement.createMany({ data: bundle.modules.map((module) => ({
      companyId: subscription.companyId, subscriptionId: subscription.id, moduleId: module.moduleId,
      source: module.selectionMode === "OPTIONAL" ? "ADD_ON" : "PLAN",
      effectiveFrom: effectiveAt, reason: existingChangeId ? "Approved subscription change request" : "Scheduled subscription plan change",
    })) });
    const decidedAt = this.now();
    const change = existingChangeId
      ? await tx.platformSubscriptionChange.update({
        where: { id: existingChangeId }, data: {
          state: "APPROVED", effectiveAt, decidedAt, decidedById: actorUserId, decisionReason,
        }, include: changeInclude,
      })
      : await tx.platformSubscriptionChange.create({ data: {
        companyId: subscription.companyId, subscriptionId: subscription.id,
        fromPlanVersionId: effectiveCurrent?.targetPlanVersionId ?? subscription.planVersionId,
        targetPlanVersionId: bundle.version.id,
        state: "APPROVED", source, requestedById: actorUserId, decidedById: actorUserId,
        requestedSubscriptionVersion: subscription.version, effectiveAt, decidedAt, decisionReason,
        currencyCode: bundle.version.currencyCode, baseRecurringFee: bundle.baseFee,
        optionalRecurringFee: bundle.optionalFee, totalRecurringFee: bundle.totalFee,
        modules: { create: bundle.modules },
      }, include: changeInclude });
    await this.audit.append(tx, {
      companyId: subscription.companyId, actorUserId,
      action: "PLATFORM_SUBSCRIPTION_CHANGE_APPROVED", entityType: "PLATFORM_SUBSCRIPTION_CHANGE", entityId: change.publicId,
      details: {
        targetPlanVersionId: bundle.version.id.toString(), effectiveAt: effectiveAt.toISOString(),
        subscriptionVersion: subscription.version + 1, totalRecurringFee: bundle.totalFee.toFixed(4),
        paymentCollected,
      },
    });
    return { change: changeJson(change), subscriptionVersion: subscription.version + 1, paymentCollected };
  }

  private async assertTrialAvailable(tx: Prisma.TransactionClient, subscriptionId: bigint, trialDays: number) {
    if (trialDays <= 0) return;
    const [previousTrial, grandfatheredTrial] = await Promise.all([
      tx.platformSubscriptionChange.findFirst({
        where: { subscriptionId, state: "APPROVED", targetPlanVersion: { trialDays: { gt: 0 } } },
        select: { id: true },
      }),
      tx.platformSubscription.findFirst({
        where: { id: subscriptionId, status: "TRIALING" },
        select: { id: true },
      }),
    ]);
    if (previousTrial || grandfatheredTrial) throw new PlatformSubscriptionError("TRIAL_ALREADY_USED");
  }

  private execute<T>(
    companyId: bigint, userId: bigint, operation: string, key: string,
    fingerprint: Record<string, unknown>, responseStatus: number,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.commands.execute({
      context: { companyId, userId }, operation, key,
      fingerprint: JSON.stringify(fingerprint), responseStatus,
      errors: {
        mismatch: () => new PlatformSubscriptionError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new PlatformSubscriptionError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, work);
  }
}
