import type { Prisma, PrismaClient } from "@prisma/client";
import type { ActorContext } from "../platform/actor-context.js";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import {
  canonicalSellingPrice, sellingCatalogQuery, sellingProfileReadiness, SellingProfileError, validRevenueAccount,
} from "./selling-profile-policy.js";
import type {
  SellingCatalogAccountPort, SellingCatalogCurrencyPort, SellingCatalogInventoryPort,
  SellingCatalogItemJson, SellingCatalogItemReference, SellingCatalogQuery, SellingCatalogQueryPort,
  SellingCatalogTaxPort, SellingProfileAuditPort, SellingProfileCreate, SellingProfileRecord,
  SellingProfileRepository, SellingProfileUpdate, SellingProfileValues,
} from "./selling-profile-ports.js";

const ids = (values: bigint[]) => [...new Set(values.map(String))].map(BigInt)
  .sort((a, b) => a < b ? -1 : a > b ? 1 : 0);

export class SellingProfileService implements SellingCatalogQueryPort {
  private readonly transactions: TransactionExecutor;
  private readonly commands: IdempotentCommandExecutor;
  constructor(prisma: PrismaClient, private readonly ports: {
    profiles: SellingProfileRepository; inventory: SellingCatalogInventoryPort;
    accounts: SellingCatalogAccountPort; currencies: SellingCatalogCurrencyPort;
    tax: SellingCatalogTaxPort; audit: SellingProfileAuditPort;
  }) {
    this.transactions = new TransactionExecutor(prisma);
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  list(context: ActorContext, input: SellingCatalogQuery) {
    const query = sellingCatalogQuery(input);
    return this.transactions.execute({ operation: "LIST_SELLING_CATALOG", companyId: context.companyId }, async (tx) => {
      const page = await this.ports.inventory.list(tx, context.companyId, query);
      const data = await this.enrich(tx, context.companyId, page.data);
      return { data, meta: { page: query.page, pageSize: query.pageSize, total: page.total,
        totalPages: Math.ceil(page.total / query.pageSize) } };
    });
  }

  get(context: ActorContext, itemId: bigint) {
    return this.transactions.execute({ operation: "GET_SELLING_CATALOG_ITEM", companyId: context.companyId }, async (tx) => {
      const item = await this.requireItem(tx, context.companyId, itemId);
      const [data] = await this.enrich(tx, context.companyId, [item]);
      return { data: data! };
    });
  }

  create(context: ActorContext, itemId: bigint, input: SellingProfileCreate, key: string) {
    const values = this.values({ ...input, isActive: true });
    return this.write(context, itemId, values, null, key);
  }

  update(context: ActorContext, itemId: bigint, input: SellingProfileUpdate, key: string) {
    if (!Number.isSafeInteger(input.version) || input.version < 1 || input.version > 4294967294) throw new SellingProfileError("VERSION_CONFLICT");
    return this.write(context, itemId, input, input.version, key);
  }

  private write(context: ActorContext, itemId: bigint, input: SellingProfileCreate | SellingProfileUpdate,
    version: number | null, key: string) {
    const operation = version === null ? "CREATE_SELLING_PROFILE" : "UPDATE_SELLING_PROFILE";
    // Fixed field order; strings preserve exact money and bigint values in fingerprints and replay bodies.
    const fingerprint = JSON.stringify({ itemId: String(itemId), version,
      unitPrice: input.unitPrice === undefined ? undefined : canonicalSellingPrice(input.unitPrice),
      currencyId: input.currencyId?.toString(), revenueAccountId: input.revenueAccountId?.toString(),
      taxRateId: input.taxRateId === null ? null : input.taxRateId?.toString(),
      isActive: "isActive" in input ? input.isActive : true });
    return this.commands.execute({ context, key, operation, fingerprint,
      responseStatus: version === null ? 201 : 200,
      errors: { mismatch: () => new SellingProfileError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new SellingProfileError("IDEMPOTENCY_IN_PROGRESS") },
    }, async (tx) => {
      const item = await this.requireItem(tx, context.companyId, itemId);
      const [current] = await this.ports.profiles.findMany(tx, context.companyId, [itemId]);
      if (version === null && current) throw new SellingProfileError("PROFILE_EXISTS");
      if (version !== null && !current) throw new SellingProfileError("NOT_FOUND");
      if (current && current.version !== version) throw new SellingProfileError("VERSION_CONFLICT");
      const values = this.values({ ...current, ...input, isActive: "isActive" in input && input.isActive !== undefined
        ? input.isActive : current?.isActive ?? true } as SellingProfileValues);
      // Disabling a stale profile is always possible; reactivation or changing defaults validates all owners.
      const changedDefaults = current && (values.unitPrice !== current.unitPrice
        || values.currencyId !== current.currencyId || values.revenueAccountId !== current.revenueAccountId
        || values.taxRateId !== current.taxRateId);
      if (values.isActive || changedDefaults) {
        const readiness = await this.referenceState(tx, context.companyId, [values]);
        const reason = this.readiness(item, { ...values, isActive: true }, readiness);
        if (reason) throw new SellingProfileError(reason as Exclude<typeof reason, "PROFILE_MISSING" | "PROFILE_INACTIVE">);
      }
      const saved = version === null
        ? await this.ports.profiles.create(tx, context.companyId, itemId, values)
        : await this.ports.profiles.update(tx, context.companyId, itemId, version, values);
      await this.ports.audit.append(tx, context, { action: version === null ? "SELLING_PROFILE_CREATED" : "SELLING_PROFILE_UPDATED",
        profileId: saved.id, inventoryItemId: itemId, fromVersion: version, toVersion: saved.version });
      const [data] = await this.enrich(tx, context.companyId, [item]);
      return { data: data! };
    });
  }

  private values(input: SellingProfileValues): SellingProfileValues {
    if (typeof input.currencyId !== "bigint" || input.currencyId < 1n
      || typeof input.revenueAccountId !== "bigint" || input.revenueAccountId < 1n
      || (input.taxRateId !== null && (typeof input.taxRateId !== "bigint" || input.taxRateId < 1n))) {
      throw new SellingProfileError("INVALID_REFERENCE");
    }
    return { unitPrice: canonicalSellingPrice(input.unitPrice), currencyId: input.currencyId,
      revenueAccountId: input.revenueAccountId, taxRateId: input.taxRateId, isActive: input.isActive };
  }

  private async requireItem(tx: Prisma.TransactionClient, companyId: bigint, id: bigint) {
    const item = await this.ports.inventory.find(tx, companyId, id);
    if (!item) throw new SellingProfileError("NOT_FOUND");
    return item;
  }

  private async referenceState(tx: Prisma.TransactionClient, companyId: bigint, profiles: SellingProfileValues[]) {
    // Bounded batches, independent of page size; never a query inside the per-item mapping.
    const currencies = await this.ports.currencies.enabled(tx, companyId, ids(profiles.map(p => p.currencyId)));
    const accounts = await this.ports.accounts.findMany(tx, companyId, ids(profiles.map(p => p.revenueAccountId)));
    const taxes = await this.ports.tax.readyIds(tx, companyId, ids(profiles.flatMap(p => p.taxRateId === null ? [] : [p.taxRateId])));
    return { currencies, accounts, taxes };
  }

  private readiness(item: SellingCatalogItemReference, profile: SellingProfileValues | null,
    refs: Awaited<ReturnType<SellingProfileService["referenceState"]>>) {
    return sellingProfileReadiness({ itemActive: item.isActive, unitActive: item.unitOfMeasure.isActive,
      profile: profile && { isActive: profile.isActive, hasTax: profile.taxRateId !== null },
      currencyEnabled: !!profile && refs.currencies.has(String(profile.currencyId)),
      revenueAccountValid: !!profile && validRevenueAccount(refs.accounts.get(String(profile.revenueAccountId))),
      taxRateValid: !!profile && (profile.taxRateId === null || refs.taxes.has(String(profile.taxRateId))) });
  }

  private async enrich(tx: Prisma.TransactionClient, companyId: bigint, items: SellingCatalogItemReference[]): Promise<SellingCatalogItemJson[]> {
    if (!items.length) return [];
    const profiles = await this.ports.profiles.findMany(tx, companyId, items.map(item => item.id));
    const byItem = new Map<string, SellingProfileRecord>(profiles.map(p => [String(p.inventoryItemId), p]));
    const refs = await this.referenceState(tx, companyId, profiles);
    return items.map(item => {
      const profile = byItem.get(String(item.id)) ?? null;
      const reason = this.readiness(item, profile, refs);
      return { inventoryItemId: String(item.id), code: item.code, nameAr: item.nameAr, nameEn: item.nameEn,
        description: item.description, isActive: item.isActive,
        unitOfMeasure: { ...item.unitOfMeasure, id: String(item.unitOfMeasure.id) },
        sellingProfile: profile && { id: String(profile.id), unitPrice: canonicalSellingPrice(profile.unitPrice),
          currencyId: String(profile.currencyId), currencyCode: refs.currencies.get(String(profile.currencyId))?.code ?? null,
          revenueAccountId: String(profile.revenueAccountId), taxRateId: profile.taxRateId === null ? null : String(profile.taxRateId),
          isActive: profile.isActive, version: profile.version }, isReady: reason === null, readinessReason: reason };
    });
  }
}
