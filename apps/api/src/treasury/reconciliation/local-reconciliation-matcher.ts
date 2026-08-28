import { Prisma } from "@prisma/client";
import type {
  ReconciliationMatcherPort,
  ReconciliationProposal,
  ReconciliationStatementFact,
  TreasuryMovementFact,
} from "./reconciliation-types.js";

const canonicalReference = (value?: string) => value?.normalize("NFC").trim().toUpperCase();
const dayNumber = (value: string) => Date.parse(`${value}T00:00:00.000Z`) / 86_400_000;
const sameAmountAndCurrency = (
  line: ReconciliationStatementFact,
  movement: TreasuryMovementFact,
) => line.currency === movement.currency
  && new Prisma.Decimal(line.amount).equals(new Prisma.Decimal(movement.amount));

function unambiguousBest(
  line: ReconciliationStatementFact,
  candidates: TreasuryMovementFact[],
) {
  const ranked = candidates
    .map((movement) => ({
      movement,
      distance: Math.abs(dayNumber(line.bookingDate) - dayNumber(movement.occurredOn)),
    }))
    .sort((left, right) => left.distance - right.distance || left.movement.key.localeCompare(right.movement.key));
  if (!ranked[0]) return undefined;
  if (ranked[1]?.distance === ranked[0].distance) return undefined;
  return ranked[0].movement;
}

export class LocalReconciliationMatcher implements ReconciliationMatcherPort {
  propose(
    statementLines: readonly ReconciliationStatementFact[],
    bookMovements: readonly TreasuryMovementFact[],
    options: { dateWindowDays?: number } = {},
  ): ReconciliationProposal[] {
    const dateWindowDays = options.dateWindowDays ?? 3;
    const available = new Map(
      [...bookMovements]
        .sort((left, right) => left.key.localeCompare(right.key))
        .map((movement) => [movement.key, movement]),
    );
    const proposals: ReconciliationProposal[] = [];
    const pending = [...statementLines].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

    for (const line of pending) {
      const reference = canonicalReference(line.reference);
      if (!reference) continue;
      const candidates = [...available.values()].filter((movement) =>
        sameAmountAndCurrency(line, movement)
        && canonicalReference(movement.reference) === reference,
      );
      const movement = unambiguousBest(line, candidates);
      if (!movement) continue;
      proposals.push({
        bankStatementLineId: line.id,
        bookMovement: movement,
        rule: "EXACT_REFERENCE_AMOUNT_CURRENCY",
        score: 100,
      });
      available.delete(movement.key);
    }

    const proposedLines = new Set(proposals.map((proposal) => proposal.bankStatementLineId));
    for (const line of pending) {
      if (proposedLines.has(line.id)) continue;
      const candidates = [...available.values()].filter((movement) =>
        sameAmountAndCurrency(line, movement)
        && Math.abs(dayNumber(line.bookingDate) - dayNumber(movement.occurredOn)) <= dateWindowDays,
      );
      const movement = unambiguousBest(line, candidates);
      if (!movement) continue;
      proposals.push({
        bankStatementLineId: line.id,
        bookMovement: movement,
        rule: "EXACT_AMOUNT_CURRENCY_DATE",
        score: 70,
      });
      available.delete(movement.key);
    }

    return proposals.sort((left, right) =>
      left.bankStatementLineId < right.bankStatementLineId
        ? -1
        : left.bankStatementLineId > right.bankStatementLineId
          ? 1
          : left.bookMovement.key.localeCompare(right.bookMovement.key),
    );
  }
}
