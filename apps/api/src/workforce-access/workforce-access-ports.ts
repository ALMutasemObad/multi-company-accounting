import type { Prisma } from "@prisma/client";

export type EmployeeAccountReference = {
  id: string;
  employeeNumber: string;
  nameAr: string;
  nameEn: string | null;
  status: "ACTIVE" | "ON_LEAVE" | "TERMINATED";
};

export type EmployeeAccountCandidate = EmployeeAccountReference & {
  internalId: bigint;
  linkedUserId: bigint | null;
};

export type IdentityAccountRecord = {
  id: bigint;
  emailNormalized: string;
  displayName: string;
  nameEn: string | null;
  isActive: boolean;
  lockedUntil: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export interface EmployeeAccountPort {
  listAvailable(
    companyId: bigint,
    input: { search?: string | undefined; limit: number },
  ): Promise<EmployeeAccountReference[]>;
  lockCandidate(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    employeePublicId: string,
  ): Promise<EmployeeAccountCandidate | null>;
  linkAccount(
    tx: Prisma.TransactionClient,
    input: { companyId: bigint; employeeId: bigint; employeePublicId: string; userId: bigint; actorUserId: bigint },
  ): Promise<boolean>;
  findByUserIds(
    companyId: bigint,
    userIds: bigint[],
  ): Promise<Array<EmployeeAccountReference & { userId: bigint }>>;
}

export interface IdentityAccountPort {
  emailExists(emailNormalized: string): Promise<boolean>;
  createForEmployee(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      actorUserId: bigint;
      employeePublicId: string;
      emailNormalized: string;
      displayName: string;
      nameEn: string | null;
      passwordHash: string;
    },
  ): Promise<IdentityAccountRecord>;
  lockActiveInCompany(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    userId: bigint,
  ): Promise<IdentityAccountRecord | null>;
  alignEmployeeProfile(
    tx: Prisma.TransactionClient,
    input: {
      companyId: bigint;
      actorUserId: bigint;
      userId: bigint;
      employeePublicId: string;
      displayName: string;
      nameEn: string | null;
    },
  ): Promise<IdentityAccountRecord>;
}
