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

export type PermissionAwareRequest<T> =
  | { status: "skipped" }
  | { status: "fulfilled"; value: T }
  | { status: "rejected"; reason: unknown };

/**
 * Runs an optional client request only when its OpenAPI permission is present.
 * The explicit outcome keeps skipped and failed reference loads from rejecting a
 * page-level Promise.all while the server remains the enforcement boundary.
 */
export async function requestIfAllowed<T>(
  permissions: ReadonlySet<string>,
  policy: PermissionPolicy,
  request: () => Promise<T>,
): Promise<PermissionAwareRequest<T>> {
  if (!allows(permissions, policy)) return { status: "skipped" };
  try {
    return { status: "fulfilled", value: await request() };
  } catch (reason) {
    return { status: "rejected", reason };
  }
}

export const requestValue = <T>(result: PermissionAwareRequest<T>) =>
  result.status === "fulfilled" ? result.value : undefined;

export function firstRequestFailure(
  results: readonly PermissionAwareRequest<unknown>[],
) {
  return results.find((result) => result.status === "rejected")?.reason;
}
