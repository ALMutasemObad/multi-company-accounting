import { allows, type PermissionPolicy } from "./authorization";

const permission = <Code extends string>(code: Code) =>
  ({ permission: code }) as const satisfies PermissionPolicy;

export type AdminTab = "users" | "roles" | "sessions";

export const adminPermissionPolicies = {
  navigation: {
    anyOf: ["users.view", "roles.view", "auth.sessions.view"],
  } as const satisfies PermissionPolicy,
  tabs: {
    users: permission("users.view"),
    roles: permission("roles.view"),
    sessions: permission("auth.sessions.view"),
  },
  users: {
    create: permission("users.create"),
    update: permission("users.update"),
    disable: permission("users.disable"),
    linkEmployee: {
      allOf: ["users.create", "users.update"],
    } as const satisfies PermissionPolicy,
    assignRoles: {
      allOf: ["roles.view", "roles.manage"],
    } as const satisfies PermissionPolicy,
  },
  roles: {
    manage: permission("roles.manage"),
  },
  sessions: {
    revoke: permission("auth.sessions.revoke"),
  },
} as const;

const adminTabs: readonly AdminTab[] = ["users", "roles", "sessions"];

export const visibleAdminTabs = (permissionSet: ReadonlySet<string>) =>
  adminTabs.filter((tab) => allows(permissionSet, adminPermissionPolicies.tabs[tab]));
