import { randomBytes } from 'node:crypto';
import { hash } from 'argon2';
import type { Prisma, PrismaClient } from '@prisma/client';
import { reserveMasterDataCode } from '../platform/master-data-code-service.js';

export class UserManagementError extends Error {
  constructor(public readonly reason: 'NOT_FOUND' | 'EMAIL_EXISTS' | 'SELF_ROLE_CHANGE' | 'SELF_DISABLE' | 'INVALID_ROLE' | 'ROLE_CODE_EXISTS' | 'INVALID_PERMISSION' | 'SYSTEM_ROLE_PROTECTED') { super(reason); }
}

export type ActorContext = { userId: bigint; companyId: bigint };

const userSelect = {
  id: true, emailNormalized: true, displayName: true, nameEn: true, isActive: true,
  lockedUntil: true, lastLoginAt: true, createdAt: true, updatedAt: true,
} satisfies Prisma.UserSelect;

export class UserService {
  constructor(private readonly prisma: PrismaClient) {}

  async list(context: ActorContext, input: { page: number; pageSize: number; search?: string | undefined; status?: 'ACTIVE' | 'LOCKED' | 'DISABLED' | undefined }) {
    const now = new Date();
    const where: Prisma.UserWhereInput = {
      assignments: { some: { companyId: context.companyId, isActive: true } },
      ...(input.status === 'DISABLED' ? { isActive: false } : input.status === 'LOCKED' ? { isActive: true, lockedUntil: { gt: now } } : input.status === 'ACTIVE' ? { isActive: true, AND: [{ OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }] } : {}),
      ...(input.search ? { AND: [...(input.status === 'ACTIVE' ? [{ OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }] : []), { OR: [
        { emailNormalized: { contains: input.search.toLocaleLowerCase('en-US') } },
        { displayName: { contains: input.search } },
        { nameEn: { contains: input.search } },
      ] }] } : {}),
    };
    const [data, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: userSelect, orderBy: { displayName: 'asc' }, skip: (input.page - 1) * input.pageSize, take: input.pageSize }),
      this.prisma.user.count({ where }),
    ]);
    return { data, total };
  }

  async get(context: ActorContext, userId: bigint) {
    const user = await this.prisma.user.findFirst({ where: { id: userId, assignments: { some: { companyId: context.companyId, isActive: true } } }, select: userSelect });
    if (!user) throw new UserManagementError('NOT_FOUND');
    return user;
  }

  async create(context: ActorContext, input: { email: string; nameAr: string; nameEn?: string | null | undefined; temporaryPassword?: string | null | undefined }) {
    const emailNormalized = input.email.trim().toLocaleLowerCase('en-US');
    const password = input.temporaryPassword ?? randomBytes(32).toString('base64url');
    const passwordHash = await hash(password);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.user.create({ data: { emailNormalized, displayName: input.nameAr, nameEn: input.nameEn ?? null, passwordHash }, select: userSelect });
        await tx.userCompany.create({ data: { userId: user.id, companyId: context.companyId } });
        await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'USER_CREATED', entityType: 'USER', entityId: user.id.toString(), details: { email: emailNormalized } } });
        return user;
      });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new UserManagementError('EMAIL_EXISTS');
      throw error;
    }
  }

  async update(context: ActorContext, userId: bigint, input: { nameAr?: string | undefined; nameEn?: string | null | undefined }) {
    await this.get(context, userId);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: { ...(input.nameAr !== undefined ? { displayName: input.nameAr } : {}), ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}) }, select: userSelect });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'USER_UPDATED', entityType: 'USER', entityId: userId.toString(), details: input } });
      return user;
    });
  }

  async disable(context: ActorContext, userId: bigint, reason: string) {
    if (context.userId === userId) throw new UserManagementError('SELF_DISABLE');
    await this.get(context, userId);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data: { isActive: false }, select: userSelect });
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'USER_DISABLED', entityType: 'USER', entityId: userId.toString(), details: { reason } } });
      return user;
    });
  }

  async roles(context: ActorContext, userId: bigint) {
    await this.get(context, userId);
    return this.prisma.userCompanyRole.findMany({ where: { userId, companyId: context.companyId }, include: { role: true }, orderBy: { role: { nameAr: 'asc' } } });
  }

  async replaceRoles(context: ActorContext, userId: bigint, roleIds: bigint[]) {
    if (context.userId === userId) throw new UserManagementError('SELF_ROLE_CHANGE');
    await this.get(context, userId);
    const roles = await this.prisma.role.findMany({ where: { companyId: context.companyId, id: { in: roleIds }, isActive: true } });
    if (roles.length !== roleIds.length) throw new UserManagementError('INVALID_ROLE');
    await this.prisma.$transaction(async (tx) => {
      await tx.userCompanyRole.deleteMany({ where: { userId, companyId: context.companyId } });
      if (roleIds.length) await tx.userCompanyRole.createMany({ data: roleIds.map((roleId) => ({ userId, companyId: context.companyId, roleId })) });
      await tx.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'USER_ROLES_REPLACED', entityType: 'USER', entityId: userId.toString(), details: { roleIds: roleIds.map(String) } } });
    });
    return this.roles(context, userId);
  }

  listRoles(context: ActorContext) {
    return this.prisma.role.findMany({ where: { companyId: context.companyId }, include: { permissions: { include: { permission: true } }, _count: { select: { assignments: true } } }, orderBy: [{ isActive: 'desc' }, { nameAr: 'asc' }] });
  }

  listPermissions() { return this.prisma.permission.findMany({ orderBy: [{ module: 'asc' }, { code: 'asc' }] }); }

  async createRole(context: ActorContext, input: { nameAr: string; nameEn?: string | null | undefined; permissionIds: bigint[] }) {
    await this.validatePermissions(input.permissionIds);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const code = await reserveMasterDataCode(tx, context.companyId, 'CUSTOM_ROLE');
        const role = await tx.role.create({ data: { companyId: context.companyId, code, nameAr: input.nameAr, nameEn: input.nameEn ?? null } });
        if (input.permissionIds.length) await tx.rolePermission.createMany({ data: input.permissionIds.map((permissionId) => ({ roleId: role.id, permissionId })) });
        await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'ROLE_CREATED', entityType: 'ROLE', entityId: role.id.toString(), details: { code: role.code, permissionIds: input.permissionIds.map(String) } } });
        return tx.role.findUniqueOrThrow({ where: { id: role.id }, include: { permissions: { include: { permission: true } }, _count: { select: { assignments: true } } } });
      });
    } catch (error) {
      if (typeof error === 'object' && error && 'code' in error && error.code === 'P2002') throw new UserManagementError('ROLE_CODE_EXISTS');
      throw error;
    }
  }

  async updateRole(context: ActorContext, roleId: bigint, input: { nameAr?: string | undefined; nameEn?: string | null | undefined }) {
    const role = await this.getEditableRole(context, roleId);
    const data = { ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}), ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}) };
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id: roleId }, data });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'ROLE_UPDATED', entityType: 'ROLE', entityId: roleId.toString(), details: input } });
    });
    return this.getRole(context, roleId);
  }

  async replaceRolePermissions(context: ActorContext, roleId: bigint, permissionIds: bigint[]) {
    await this.getEditableRole(context, roleId);
    await this.validatePermissions(permissionIds);
    const affected = await this.prisma.userCompanyRole.findMany({ where: { companyId: context.companyId, roleId }, select: { userId: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.rolePermission.deleteMany({ where: { roleId } });
      if (permissionIds.length) await tx.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId, permissionId })) });
      if (affected.length) await tx.session.updateMany({ where: { userId: { in: affected.map((item) => item.userId) }, selectedCompanyId: context.companyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'ROLE_PERMISSIONS_REPLACED', entityType: 'ROLE', entityId: roleId.toString(), details: { permissionIds: permissionIds.map(String) } } });
    });
    return this.getRole(context, roleId);
  }

  async deactivateRole(context: ActorContext, roleId: bigint, reason: string) {
    await this.getEditableRole(context, roleId);
    const affected = await this.prisma.userCompanyRole.findMany({ where: { companyId: context.companyId, roleId }, select: { userId: true } });
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({ where: { id: roleId }, data: { isActive: false } });
      await tx.userCompanyRole.deleteMany({ where: { companyId: context.companyId, roleId } });
      if (affected.length) await tx.session.updateMany({ where: { userId: { in: affected.map((item) => item.userId) }, selectedCompanyId: context.companyId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { companyId: context.companyId, actorUserId: context.userId, action: 'ROLE_DEACTIVATED', entityType: 'ROLE', entityId: roleId.toString(), details: { reason, affectedUsers: affected.length } } });
    });
    return this.getRole(context, roleId);
  }

  private async validatePermissions(permissionIds: bigint[]) {
    if (!permissionIds.length) return;
    if (await this.prisma.permission.count({ where: { id: { in: permissionIds } } }) !== permissionIds.length) throw new UserManagementError('INVALID_PERMISSION');
  }

  private async getRole(context: ActorContext, roleId: bigint) {
    const role = await this.prisma.role.findFirst({ where: { id: roleId, companyId: context.companyId }, include: { permissions: { include: { permission: true } }, _count: { select: { assignments: true } } } });
    if (!role) throw new UserManagementError('NOT_FOUND');
    return role;
  }

  private async getEditableRole(context: ActorContext, roleId: bigint) {
    const role = await this.getRole(context, roleId);
    if (role.isSystemRole) throw new UserManagementError('SYSTEM_ROLE_PROTECTED');
    return role;
  }
}
