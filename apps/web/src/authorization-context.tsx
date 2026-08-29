import {
  createContext,
  type PropsWithChildren,
  type ReactNode,
  useContext,
  useMemo,
} from "react";
import { allows, type PermissionPolicy } from "./authorization";
import type { CurrentAuthorization } from "./types";

type AuthorizationContextValue = CurrentAuthorization & {
  permissionSet: ReadonlySet<string>;
};

const AuthorizationContext = createContext<AuthorizationContextValue | null>(null);

export function AuthorizationProvider({
  authorization,
  children,
}: PropsWithChildren<{ authorization: CurrentAuthorization }>) {
  const value = useMemo<AuthorizationContextValue>(() => ({
    ...authorization,
    permissionSet: new Set(authorization.permissions),
  }), [authorization]);

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
