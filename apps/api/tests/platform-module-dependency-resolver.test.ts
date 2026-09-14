import { Prisma } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  ModuleDependencyResolutionError,
  resolveModuleDependencies,
  type ModuleDependencyNode,
} from "../src/platform-subscriptions/platform-module-dependency-resolver.js";

const node = (
  id: number,
  code: string,
  dependencies: number[] = [],
  overrides: Partial<ModuleDependencyNode> = {},
): ModuleDependencyNode => ({
  id: BigInt(id), code, isActive: true,
  dependencies: dependencies.map((dependencyId) => ({ id: BigInt(dependencyId) })),
  selectionMode: "INCLUDED",
  ...overrides,
});

describe("platform module dependency resolver", () => {
  it("returns a dependency-first order for a chain", () => {
    const result = resolveModuleDependencies([
      node(3, "POS", [2]), node(2, "SALES", [1]), node(1, "CORE_ACCOUNTING"),
    ]);
    expect(result.ordered.map(({ code }) => code)).toEqual(["CORE_ACCOUNTING", "SALES", "POS"]);
    expect(result.invalid).toEqual([]);
  });

  it("orders a diamond deterministically and preserves node values", () => {
    const fee = new Prisma.Decimal("12.3400");
    const result = resolveModuleDependencies([
      node(4, "POS", [2, 3]),
      node(3, "TREASURY", [1], { additionalRecurringFee: fee } as never),
      node(2, "SALES", [1]), node(1, "CORE_ACCOUNTING"),
    ]);
    expect(result.ordered.map(({ code }) => code)).toEqual(["CORE_ACCOUNTING", "SALES", "TREASURY", "POS"]);
    expect((result.ordered.find(({ code }) => code === "TREASURY") as ModuleDependencyNode & { additionalRecurringFee: Prisma.Decimal }).additionalRecurringFee).toBe(fee);
    expect(fee.toFixed(4)).toBe("12.3400");
  });

  it.each([
    ["cycle", [node(1, "SALES", [2]), node(2, "CORE_ACCOUNTING", [1])], "DEPENDENCY_CYCLE"],
    ["missing", [node(1, "SALES", [99])], "MISSING_DEPENDENCY"],
    ["inactive module", [node(1, "SALES", [], { isActive: false })], "INACTIVE_MODULE"],
    ["inactive dependency", [node(1, "CORE_ACCOUNTING"), { ...node(2, "SALES", [1]), dependencies: [{ id: 1n, isActive: false }] }], "INACTIVE_DEPENDENCY"],
    ["unknown code", [node(1, "NOT_A_PLATFORM_MODULE")], "UNKNOWN_MODULE_CODE"],
    ["included depends on optional", [node(1, "CORE_ACCOUNTING", [2]), node(2, "SALES", [], { selectionMode: "OPTIONAL" })], "OPTIONAL_DEPENDENCY"],
    ["duplicate id", [node(1, "SALES"), node(1, "CORE_ACCOUNTING")], "DUPLICATE_NODE"],
    ["duplicate code", [node(1, "SALES"), node(2, "SALES")], "DUPLICATE_NODE"],
  ] as const)("fails closed for %s", (_label, input, reason) => {
    expect(() => resolveModuleDependencies(input)).toThrowError(
      expect.objectContaining({ reason }),
    );
  });

  it("filters invalid branches for read projections without exposing them", () => {
    const result = resolveModuleDependencies([
      node(1, "CORE_ACCOUNTING"),
      node(2, "SALES", [1]),
      node(3, "POS", [99]),
    ], { strict: false });
    expect(result.valid.map(({ code }) => code)).toEqual(["CORE_ACCOUNTING", "SALES"]);
    expect(result.invalid.map(({ node: invalidNode, reason }) => [invalidNode.code, reason])).toEqual([
      ["POS", "MISSING_DEPENDENCY"],
    ]);
  });

  it("keeps strict ordering parity for the valid projection", () => {
    const input = [
      node(1, "CORE_ACCOUNTING"),
      node(2, "SALES", [1]),
      node(3, "POS", [99]),
    ];
    const strictOrder = resolveModuleDependencies(input.slice(0, 2)).ordered.map(({ id }) => id.toString());
    const projectedOrder = resolveModuleDependencies(input, { strict: false }).valid.map(({ id }) => id.toString());
    expect(projectedOrder).toEqual(strictOrder);
  });

  it("produces the same order for shuffled inputs", () => {
    const input = [
      node(1, "CORE_ACCOUNTING"), node(2, "SALES", [1]), node(3, "TREASURY", [1]),
      node(4, "INVENTORY", [1]), node(5, "POS", [2, 3, 4]),
    ];
    const expected = resolveModuleDependencies(input).ordered.map(({ id }) => id.toString());
    for (const shuffled of [
      [input[4], input[2], input[0], input[3], input[1]],
      [input[3], input[1], input[4], input[0], input[2]],
      [input[2], input[4], input[1], input[3], input[0]],
    ]) {
      expect(resolveModuleDependencies(shuffled).ordered.map(({ id }) => id.toString())).toEqual(expected);
    }
  });

  it("keeps resolver errors distinguishable from caller domain errors", () => {
    try {
      resolveModuleDependencies([node(1, "SALES", [99])]);
      throw new Error("expected resolver failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ModuleDependencyResolutionError);
      expect((error as ModuleDependencyResolutionError).reason).toBe("MISSING_DEPENDENCY");
    }
  });
});
