import type { PlatformModuleCode } from "./platform-entitlement-ports.js";

/**
 * These modules are a platform-wide, no-fee launch grant. Keep them separate
 * from immutable commercial plan versions so enabling them cannot rewrite a
 * company's existing price, quota, or other entitlements.
 */
export const PLATFORM_WIDE_FREE_MODULE_CODES = [
  "GENERAL_PROJECTS",
  "SERVICE_CATALOG",
  "PAYROLL",
] as const satisfies readonly PlatformModuleCode[];

export type PlatformWideFreeModuleCode = (typeof PLATFORM_WIDE_FREE_MODULE_CODES)[number];

export function isPlatformWideFreeModuleCode(value: string): value is PlatformWideFreeModuleCode {
  return (PLATFORM_WIDE_FREE_MODULE_CODES as readonly string[]).includes(value);
}
