import type {
  BankReconciliationCapabilities,
  BankReconciliationMatch,
  BankReconciliationSessionDetail,
  BankStatementLine,
} from "./types";

export type ReconciliationLineState = "APPROVED" | "PROPOSED" | "CLASSIFIED" | "UNMATCHED";
export type BankReconciliationWriteAction = "IMPORT" | "SUGGEST" | "REVIEW" | "CLOSE";

export function canWriteBankReconciliation(
  capabilities: BankReconciliationCapabilities,
  action: BankReconciliationWriteAction,
) {
  if (action === "IMPORT") return capabilities.canImport;
  if (action === "SUGGEST") return capabilities.canSuggest;
  if (action === "REVIEW") return capabilities.canReview;
  return capabilities.canClose;
}

export function activeMatchForLine(matches: BankReconciliationMatch[], lineId: string) {
  return matches.find((match) => match.bankStatementLineId === lineId && match.status === "APPROVED")
    ?? matches.find((match) => match.bankStatementLineId === lineId && match.status === "PROPOSED")
    ?? null;
}

export function reconciliationLineState(line: BankStatementLine, match: BankReconciliationMatch | null): ReconciliationLineState {
  if (match?.status === "APPROVED") return "APPROVED";
  if (match?.status === "PROPOSED") return "PROPOSED";
  if (line.classification) return "CLASSIFIED";
  return "UNMATCHED";
}

export function unresolvedLineCount(session: BankReconciliationSessionDetail) {
  return session.lines.filter((line) => reconciliationLineState(line, activeMatchForLine(session.matches, line.id)) === "UNMATCHED"
    || reconciliationLineState(line, activeMatchForLine(session.matches, line.id)) === "PROPOSED").length;
}

export function isZeroDecimal(value: string) {
  return /^-?0(?:\.0+)?$/u.test(value);
}

function safeCsvCell(value: string) {
  const protectedValue = /^[=+@\t\r]/u.test(value) ? `'${value}` : value;
  return `"${protectedValue.replaceAll('"', '""')}"`;
}

export function reconciliationCsv(headers: string[], rows: string[][]) {
  return `\uFEFF${[headers, ...rows].map((row) => row.map(safeCsvCell).join(",")).join("\r\n")}`;
}
