export type AuditActor = {
  id: bigint;
  displayName: string;
  emailNormalized: string;
};

export interface AuditIdentityQueryPort {
  findActorsByIds(userIds: readonly bigint[]): Promise<AuditActor[]>;
  findMatchingActorIds(userIds: readonly bigint[], search: string): Promise<bigint[]>;
}
