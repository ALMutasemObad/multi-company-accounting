import { describe, expect, it } from "vitest";
import {
  canUseControlAction,
  controlActionPermissionPolicies,
  type ControlAction,
} from "./control-action-permission-policies";

const permissions = (...values: string[]) => new Set(values);
const actions = Object.keys(controlActionPermissionPolicies) as ControlAction[];

describe("control action permission policies", () => {
  it("maps each control to the exact API permission", () => {
    expect(controlActionPermissionPolicies).toEqual({
      approvalsDecide: { permission: "approvals.decide" },
      auditExport: { permission: "audit_logs.export" },
      securityAcknowledge: { permission: "security_events.acknowledge" },
    });
  });

  it("does not infer write abilities from the matching view permissions", () => {
    const viewOnly = permissions(
      "approvals.view",
      "audit_logs.view",
      "security_events.view",
    );

    for (const action of actions) {
      expect(canUseControlAction(viewOnly, action)).toBe(false);
    }
  });

  it.each([
    ["approvalsDecide", "approvals.decide"],
    ["auditExport", "audit_logs.export"],
    ["securityAcknowledge", "security_events.acknowledge"],
  ] as const)("grants only %s for its exact permission", (allowedAction, permission) => {
    for (const action of actions) {
      expect(canUseControlAction(permissions(permission), action)).toBe(action === allowedAction);
    }
  });
});
