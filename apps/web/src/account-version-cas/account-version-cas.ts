type AccountVersionConflict = Error & { status: number; code?: string; reason?: string };

export function versionedAccountBody<T extends Record<string, unknown>>(expectedVersion: number, body: T) {
  return { ...body, expectedVersion };
}

export function isAccountVersionConflict(cause: unknown): cause is AccountVersionConflict {
  if (!(cause instanceof Error)) return false;
  const candidate = cause as Partial<AccountVersionConflict>;
  return candidate.status === 409
    && (candidate.code === "VERSION_CONFLICT" || candidate.reason === "VERSION_CONFLICT");
}

export async function runAccountMutationOnce(command: () => Promise<unknown>, onConflict: (cause: AccountVersionConflict) => Promise<void>) {
  try {
    await command();
    return true;
  } catch (cause) {
    if (!isAccountVersionConflict(cause)) throw cause;
    await onConflict(cause);
    return false;
  }
}
