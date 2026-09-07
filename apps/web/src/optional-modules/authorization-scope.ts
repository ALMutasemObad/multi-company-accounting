import type { CurrentAuthorization } from '../types';

/** All permission/module changes invalidate page reads, even for the same actor. */
export function authorizationScope(value: CurrentAuthorization) {
  return JSON.stringify([value.user.id, value.selectedCompany?.id, [...value.permissions].sort(), [...value.modules].sort()]);
}
