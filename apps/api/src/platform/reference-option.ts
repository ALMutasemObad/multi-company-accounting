import { createHash } from "node:crypto";
import type { ActorContext } from "./actor-context.js";

/** Advisory metadata only; a reference is not authorization for a financial command. */
export type ReferenceOption = {
  id: string;
  label: string;
  revision: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
};

export type ReferenceResult<T extends ReferenceOption = ReferenceOption> =
  | { status: "available"; reference: T }
  | { status: "unavailable" };

export type ReferenceOptionsQuery = {
  page: number;
  pageSize: number;
  search?: string | undefined;
};

export type ReferenceOptionsPage<T extends ReferenceOption = ReferenceOption> = {
  data: Array<T & { isAvailable: boolean }>;
  meta: { page: number; pageSize: number; total: number; totalPages: number };
};

export class ReferenceOptionInputError extends Error {
  constructor(readonly reason: "INVALID_REFERENCE_ID" | "INVALID_REFERENCE_ACTOR" | "INVALID_REFERENCE_QUERY") {
    super(reason);
    this.name = "ReferenceOptionInputError";
  }
}

const maxId = 18446744073709551615n;
const validId = (id: bigint): boolean => typeof id === "bigint" && id > 0n && id <= maxId;

export function assertReferenceActor(actor: ActorContext): void {
  if (!validId(actor.companyId) || !validId(actor.userId)) throw new ReferenceOptionInputError("INVALID_REFERENCE_ACTOR");
}

export function assertReferenceId(id: bigint): void {
  if (!validId(id)) throw new ReferenceOptionInputError("INVALID_REFERENCE_ID");
}

/** Recheck bounds at the owner port, including callers other than HTTP. No implicit defaults. */
export function boundedReferenceOptions(query: ReferenceOptionsQuery): ReferenceOptionsQuery & { skip: number } {
  if (!Number.isInteger(query.page) || query.page < 1 || query.page > 10_000
    || !Number.isInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100
    || (query.search !== undefined && (typeof query.search !== "string" || query.search.length > 100
      || /[\u0000-\u001f\u007f]/u.test(query.search)))) {
    throw new ReferenceOptionInputError("INVALID_REFERENCE_QUERY");
  }
  return { page: query.page, pageSize: query.pageSize, search: query.search?.trim(), skip: (query.page - 1) * query.pageSize };
}

/** This fingerprints current facts; it does not invent a row version or provide a lock. */
export function referenceRevision(kind: string, facts: readonly (string | number | boolean | null)[]): string {
  return createHash("sha256").update(JSON.stringify([kind, ...facts])).digest("hex");
}

export function referenceOptionsMeta(query: ReferenceOptionsQuery, total: number): ReferenceOptionsPage["meta"] {
  return { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) };
}
