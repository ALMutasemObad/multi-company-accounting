export type SecurityActor = {
  id: bigint;
  displayName: string;
  emailNormalized: string;
};

export interface SecurityIdentityQueryPort {
  findActorsByIds(userIds: readonly bigint[]): Promise<SecurityActor[]>;
  findMatchingActorIds(userIds: readonly bigint[], search: string): Promise<bigint[]>;
}
