import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import { allows, type PermissionPolicy } from "./authorization";
import { effectivePermissionSet } from './module-entitlements';
import type { CurrentAuthorization } from "./types";

type AuthorizationContextValue = CurrentAuthorization & {
  moduleSet: ReadonlySet<CurrentAuthorization['modules'][number]>;
  permissionSet: ReadonlySet<string>;
};

const AuthorizationContext = createContext<AuthorizationContextValue | null>(null);

export function AuthorizationProvider({
  authorization,
  children,
}: PropsWithChildren<{ authorization: CurrentAuthorization }>) {
  const value = useMemo<AuthorizationContextValue>(() => {
    const moduleSet = new Set(authorization.modules);
    return {
      ...authorization,
      moduleSet,
      permissionSet: effectivePermissionSet(authorization.permissions, moduleSet),
    };
  }, [authorization]);

  return (
    <AuthorizationContext.Provider value={value}>
      {children}
    </AuthorizationContext.Provider>
  );
}

export function useAuthorization() {
  const value = useContext(AuthorizationContext);
  if (!value) throw new Error("AuthorizationProvider is required");
  return value;
}

export function Can({
  policy,
  children,
  fallback = null,
}: PropsWithChildren<{
  policy: PermissionPolicy;
  fallback?: ReactNode;
}>) {
  const { permissionSet } = useAuthorization();
  return allows(permissionSet, policy) ? children : fallback;
}
