import { isPlatformModuleCode, type PlatformModuleCode } from "./platform-entitlement-ports.js";

export type ModuleSelectionMode = "INCLUDED" | "OPTIONAL";

export type ModuleDependencyReference = {
  id?: bigint | string | undefined;
  code?: string | undefined;
  isActive?: boolean | undefined;
};

export type ModuleDependencyNode = {
  id: bigint | string;
  code: string;
  isActive: boolean;
  dependencies: readonly ModuleDependencyReference[];
  selectionMode?: ModuleSelectionMode | undefined;
};

export type ModuleDependencyFailureReason =
  | "DUPLICATE_NODE"
  | "UNKNOWN_MODULE_CODE"
  | "INACTIVE_MODULE"
  | "MISSING_DEPENDENCY"
  | "INACTIVE_DEPENDENCY"
  | "OPTIONAL_DEPENDENCY"
  | "DEPENDENCY_CYCLE";

export class ModuleDependencyResolutionError extends Error {
  constructor(
    public readonly reason: ModuleDependencyFailureReason,
    public readonly nodeId?: string,
  ) {
    super(`MODULE_DEPENDENCY_${reason}`);
  }
}

export type ModuleDependencyResolution = {
  /** Dependency-first deterministic order; ties are ordered by code then id. */
  ordered: ModuleDependencyNode[];
  /** Nodes whose complete dependency closure is active and present. */
  valid: ModuleDependencyNode[];
  /** Invalid nodes are retained for non-strict readers so they can fail closed. */
  invalid: Array<{ node: ModuleDependencyNode; reason: ModuleDependencyFailureReason }>;
};

type ResolverOptions = {
  /** Strict writers throw for the first invalid node. */
  strict?: boolean;
  /** Read-only projections may collapse duplicate rows before resolving. */
  deduplicate?: boolean;
  /** Included modules may not depend on optional modules in the selected set. */
  requireIncludedDependencies?: boolean;
};

const keyOf = (id: bigint | string) => id.toString();
const compareText = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const compareNodes = (left: ModuleDependencyNode, right: ModuleDependencyNode) =>
  compareText(left.code, right.code) || compareText(keyOf(left.id), keyOf(right.id));

function duplicateReason(nodes: readonly ModuleDependencyNode[]) {
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();
  for (const node of nodes) {
    const id = keyOf(node.id);
    if (seenIds.has(id) || seenCodes.has(node.code)) return node;
    seenIds.add(id);
    seenCodes.add(node.code);
  }
  return null;
}

function canonicalNodes(nodes: readonly ModuleDependencyNode[], deduplicate: boolean) {
  const sorted = [...nodes].sort(compareNodes);
  const result: ModuleDependencyNode[] = [];
  const seenIds = new Set<string>();
  const seenCodes = new Set<string>();
  for (const node of sorted) {
    const id = keyOf(node.id);
    if (seenIds.has(id) || seenCodes.has(node.code)) {
      if (!deduplicate) throw new ModuleDependencyResolutionError("DUPLICATE_NODE", id);
      continue;
    }
    seenIds.add(id);
    seenCodes.add(node.code);
    result.push(node);
  }
  return result;
}

/**
 * Resolves one platform-module graph for all subscription writers/readers.
 * The function is pure: it never queries or writes Prisma and never decides
 * pricing. Strict callers use the error as their domain error; projections use
 * non-strict mode and only expose the valid closure.
 */
export function resolveModuleDependencies(
  input: readonly ModuleDependencyNode[],
  options: ResolverOptions = {},
): ModuleDependencyResolution {
  const strict = options.strict ?? true;
  const deduplicate = options.deduplicate ?? false;
  const requireIncludedDependencies = options.requireIncludedDependencies ?? true;
  const duplicate = deduplicate ? null : duplicateReason(input);
  if (duplicate) throw new ModuleDependencyResolutionError("DUPLICATE_NODE", keyOf(duplicate.id));

  const nodes = canonicalNodes(input, deduplicate);
  const byId = new Map(nodes.map((node) => [keyOf(node.id), node]));
  const byCode = new Map(nodes.map((node) => [node.code, node]));
  const invalid = new Map<string, ModuleDependencyFailureReason>();
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const targetFor = (reference: ModuleDependencyReference) => {
    if (reference.id !== undefined) {
      return byId.get(keyOf(reference.id));
    }
    return reference.code === undefined ? undefined : byCode.get(reference.code);
  };

  const visit = (node: ModuleDependencyNode): boolean => {
    const nodeId = keyOf(node.id);
    if (visited.has(nodeId)) return !invalid.has(nodeId);
    if (visiting.has(nodeId)) {
      invalid.set(nodeId, "DEPENDENCY_CYCLE");
      return false;
    }
    if (!isPlatformModuleCode(node.code)) {
      invalid.set(nodeId, "UNKNOWN_MODULE_CODE");
      visited.add(nodeId);
      return false;
    }
    if (!node.isActive) {
      invalid.set(nodeId, "INACTIVE_MODULE");
      visited.add(nodeId);
      return false;
    }

    visiting.add(nodeId);
    let valid = true;
    const references = [...node.dependencies].sort((left, right) =>
      compareText(left.code ?? "", right.code ?? "")
      || compareText(keyOf(left.id ?? ""), keyOf(right.id ?? "")),
    );
    for (const reference of references) {
      if (reference.code !== undefined && !isPlatformModuleCode(reference.code)) {
        invalid.set(nodeId, "UNKNOWN_MODULE_CODE");
        valid = false;
        continue;
      }
      const target = targetFor(reference);
      if (!target) {
        invalid.set(nodeId, "MISSING_DEPENDENCY");
        valid = false;
        continue;
      }
      if (reference.isActive === false || !target.isActive) {
        invalid.set(nodeId, "INACTIVE_DEPENDENCY");
        valid = false;
        continue;
      }
      if (reference.code !== undefined && target.code !== reference.code) {
        invalid.set(nodeId, "MISSING_DEPENDENCY");
        valid = false;
        continue;
      }
      if (requireIncludedDependencies && node.selectionMode === "INCLUDED"
        && target.selectionMode === "OPTIONAL") {
        invalid.set(nodeId, "OPTIONAL_DEPENDENCY");
        valid = false;
        continue;
      }
      if (!visit(target)) {
        valid = false;
        if (!invalid.has(nodeId)) invalid.set(nodeId, invalid.get(keyOf(target.id)) ?? "MISSING_DEPENDENCY");
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return valid && !invalid.has(nodeId);
  };

  const ordered: ModuleDependencyNode[] = [];
  const emitted = new Set<string>();
  const emit = (node: ModuleDependencyNode) => {
    const nodeId = keyOf(node.id);
    if (emitted.has(nodeId) || invalid.has(nodeId) || !visit(node)) return;
    const dependencies = [...node.dependencies]
      .map(targetFor)
      .filter((target): target is ModuleDependencyNode => target !== undefined)
      .sort(compareNodes);
    for (const dependency of dependencies) emit(dependency);
    emitted.add(nodeId);
    ordered.push(node);
  };
  for (const node of nodes.sort(compareNodes)) emit(node);

  const invalidRows = nodes
    .filter((node) => invalid.has(keyOf(node.id)))
    .map((node) => ({ node, reason: invalid.get(keyOf(node.id))! }));
  if (strict && invalidRows.length) {
    const first = invalidRows[0]!;
    throw new ModuleDependencyResolutionError(first.reason, keyOf(first.node.id));
  }

  return {
    ordered,
    valid: ordered,
    invalid: invalidRows,
  };
}

export function platformModuleCode(value: string): PlatformModuleCode | null {
  return isPlatformModuleCode(value) ? value : null;
}
