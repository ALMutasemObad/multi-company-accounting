export type PermissionPolicy =
  | { permission: string }
  | { anyOf: readonly string[] }
  | { allOf: readonly string[] };

export const can = (
  permissions: ReadonlySet<string>,
  permission: string,
) => permission.length > 0 && permissions.has(permission);

export const canAny = (
  permissions: ReadonlySet<string>,
  required: readonly string[],
) => required.length > 0 && required.some((permission) => can(permissions, permission));

export const canAll = (
  permissions: ReadonlySet<string>,
  required: readonly string[],
) => required.length > 0 && required.every((permission) => can(permissions, permission));

export function allows(
  permissions: ReadonlySet<string>,
  policy: PermissionPolicy,
) {
  if ("permission" in policy) return can(permissions, policy.permission);
  if ("anyOf" in policy) return canAny(permissions, policy.anyOf);
  return canAll(permissions, policy.allOf);
}
