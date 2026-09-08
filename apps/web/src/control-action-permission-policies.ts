import { allows, type PermissionPolicy } from "./authorization";

export const controlActionPermissionPolicies = {
  approvalsDecide: { permission: "approvals.decide" },
  auditExport: { permission: "audit_logs.export" },
  securityAcknowledge: { permission: "security_events.acknowledge" },
} as const satisfies Record<string, PermissionPolicy>;

export type ControlAction = keyof typeof controlActionPermissionPolicies;

export function canUseControlAction(
  permissions: ReadonlySet<string>,
  action: ControlAction,
) {
  return allows(permissions, controlActionPermissionPolicies[action]);
}
