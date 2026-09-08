import type { PermissionPolicy } from "./authorization";

const permission = <Code extends string>(code: Code) =>
  ({ permission: code }) as const satisfies PermissionPolicy;

export const accountPermissionPolicies = {
  workspace: { anyOf: ["accounts.view", "cost_centers.manage"] },
  view: permission("accounts.view"),
  create: permission("accounts.create"),
  update: permission("accounts.update"),
  deactivate: permission("accounts.deactivate"),
  delete: permission("accounts.delete"),
  applyTemplate: permission("accounts.template.apply"),
  manageCostCenters: permission("cost_centers.manage"),
} as const satisfies Record<string, PermissionPolicy>;
