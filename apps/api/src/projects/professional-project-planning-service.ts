import {
  Prisma,
  type PrismaClient,
  type ProfessionalProject,
  type ProfessionalProjectStage,
  type ProfessionalProjectTask,
  type ProfessionalTaskDependency,
} from "@prisma/client";
import { IdempotentCommandExecutor } from "../platform/idempotent-command-executor.js";
import { TransactionExecutor } from "../platform/transaction-executor.js";
import type { ActorContext } from "../users/user-service.js";

export type ProfessionalPlanningFailureReason =
  | "NOT_FOUND"
  | "PROJECT_INACTIVE"
  | "STAGE_NOT_FOUND"
  | "STAGE_INACTIVE"
  | "STAGE_EMPTY"
  | "STAGE_TASKS_INCOMPLETE"
  | "TASK_NOT_FOUND"
  | "TASK_INACTIVE"
  | "TASK_OUTSIDE_STAGE"
  | "TASK_DEPENDENCIES_INCOMPLETE"
  | "ASSIGNEE_NOT_ACTIVE_MEMBER"
  | "TASK_PROGRESS_FORBIDDEN"
  | "DEPENDENCY_NOT_FOUND"
  | "DEPENDENCY_INACTIVE"
  | "DEPENDENCY_SELF"
  | "DEPENDENCY_DUPLICATE"
  | "DEPENDENCY_CYCLE"
  | "DEPENDENCY_SUCCESSOR_OPEN"
  | "INVALID_TRANSITION"
  | "INVALID_DATE_RANGE"
  | "VERSION_CONFLICT"
  | "IDEMPOTENCY_MISMATCH"
  | "IDEMPOTENCY_IN_PROGRESS";

export class ProfessionalPlanningError extends Error {
  constructor(public readonly reason: ProfessionalPlanningFailureReason) {
    super(reason);
  }
}

type StageStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
type TaskStatus = "TODO" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";

type PlanTaskStats = { actualMinutes: number; approvedMinutes: number };

const stageTransitions: Record<StageStatus, readonly StageStatus[]> = {
  PLANNED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const taskTransitions: Record<TaskStatus, readonly TaskStatus[]> = {
  TODO: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

const terminalTaskStatuses = new Set<TaskStatus>(["COMPLETED", "CANCELLED"]);
const asDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateString = (value: Date) => value.toISOString().slice(0, 10);
const addUtcDays = (value: Date, days: number) => new Date(value.getTime() + days * 86_400_000);
const weekStart = (value: Date) => addUtcDays(value, -value.getUTCDay());
const timesheetKey = (userId: bigint, periodStart: Date) => `${userId}:${dateString(periodStart)}`;

const taskJson = (task: ProfessionalProjectTask, stageId: string, stats: PlanTaskStats) => ({
  id: task.publicId,
  stageId,
  sequence: task.sequence,
  titleAr: task.titleAr,
  titleEn: task.titleEn,
  description: task.description,
  status: task.status,
  assigneeUserId: task.assigneeUserId.toString(),
  estimatedMinutes: task.estimatedMinutes,
  plannedStartDate: task.plannedStartDate ? dateString(task.plannedStartDate) : null,
  dueDate: task.dueDate ? dateString(task.dueDate) : null,
  completedAt: task.completedAt?.toISOString() ?? null,
  actualMinutes: stats.actualMinutes,
  approvedMinutes: stats.approvedMinutes,
  version: task.version,
});

const dependencyJson = (
  dependency: ProfessionalTaskDependency,
  taskIds: Map<bigint, string>,
) => ({
  id: dependency.publicId,
  successorTaskId: taskIds.get(dependency.taskId)!,
  predecessorTaskId: taskIds.get(dependency.dependsOnTaskId)!,
  isActive: dependency.isActive,
  version: dependency.version,
});

export class ProfessionalProjectPlanningService {
  private readonly transactions: TransactionExecutor;
  private readonly commands: IdempotentCommandExecutor;

  constructor(private readonly prisma: PrismaClient) {
    this.transactions = new TransactionExecutor(prisma);
    this.commands = new IdempotentCommandExecutor(prisma, this.transactions);
  }

  async getPlan(context: ActorContext, projectPublicId: string) {
    const result = await this.prisma.$transaction(async (tx) => {
      const project = await tx.professionalProject.findFirst({
        where: { publicId: projectPublicId, companyId: context.companyId },
      });
      if (!project) throw new ProfessionalPlanningError("NOT_FOUND");
      const [stages, tasks, dependencies, entries] = await Promise.all([
        tx.professionalProjectStage.findMany({
          where: { companyId: context.companyId, projectId: project.id },
          orderBy: [{ sequence: "asc" }, { id: "asc" }],
        }),
        tx.professionalProjectTask.findMany({
          where: { companyId: context.companyId, projectId: project.id },
          orderBy: [{ stageId: "asc" }, { sequence: "asc" }, { id: "asc" }],
        }),
        tx.professionalTaskDependency.findMany({
          where: { companyId: context.companyId, projectId: project.id, isActive: true },
          orderBy: [{ taskId: "asc" }, { dependsOnTaskId: "asc" }],
        }),
        tx.professionalTimeEntry.findMany({
          where: { companyId: context.companyId, projectId: project.id },
          select: { taskId: true, userId: true, workDate: true, minutes: true },
        }),
      ]);
      const userIds = [...new Set(entries.map((entry) => entry.userId.toString()))].map(BigInt);
      const periodStarts = [...new Set(entries.map((entry) => dateString(weekStart(entry.workDate))))].map(asDate);
      const approved = userIds.length && periodStarts.length
        ? await tx.professionalTimesheet.findMany({
            where: {
              companyId: context.companyId,
              status: "APPROVED",
              userId: { in: userIds },
              periodStart: { in: periodStarts },
            },
            select: { userId: true, periodStart: true },
          })
        : [];
      return { project, stages, tasks, dependencies, entries, approved };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });

    const approvedKeys = new Set(result.approved.map((row) => timesheetKey(row.userId, row.periodStart)));
    const taskStats = new Map<bigint, PlanTaskStats>();
    let actualMinutes = 0;
    let approvedMinutes = 0;
    let allocatedActualMinutes = 0;
    for (const entry of result.entries) {
      actualMinutes += entry.minutes;
      const isApproved = approvedKeys.has(timesheetKey(entry.userId, weekStart(entry.workDate)));
      if (isApproved) approvedMinutes += entry.minutes;
      if (entry.taskId === null) continue;
      allocatedActualMinutes += entry.minutes;
      const stats = taskStats.get(entry.taskId) ?? { actualMinutes: 0, approvedMinutes: 0 };
      stats.actualMinutes += entry.minutes;
      if (isApproved) stats.approvedMinutes += entry.minutes;
      taskStats.set(entry.taskId, stats);
    }

    const taskIds = new Map(result.tasks.map((task) => [task.id, task.publicId]));
    const stageIds = new Map(result.stages.map((stage) => [stage.id, stage.publicId]));
    const tasksByStage = new Map<bigint, ProfessionalProjectTask[]>();
    for (const task of result.tasks) {
      const rows = tasksByStage.get(task.stageId) ?? [];
      rows.push(task);
      tasksByStage.set(task.stageId, rows);
    }
    const estimatedMinutes = result.tasks
      .filter((task) => task.status !== "CANCELLED")
      .reduce((sum, task) => sum + task.estimatedMinutes, 0);
    const taskCounts = { TODO: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 };
    for (const task of result.tasks) taskCounts[task.status] += 1;

    return {
      projectId: result.project.publicId,
      planningVersion: result.project.planningVersion,
      summary: {
        timeBudgetMinutes: result.project.timeBudgetMinutes,
        estimatedMinutes,
        actualMinutes,
        approvedMinutes,
        allocatedActualMinutes,
        unallocatedActualMinutes: actualMinutes - allocatedActualMinutes,
        remainingBudgetMinutes: result.project.timeBudgetMinutes === null
          ? null
          : Math.max(result.project.timeBudgetMinutes - actualMinutes, 0),
        overBudgetMinutes: result.project.timeBudgetMinutes === null
          ? 0
          : Math.max(actualMinutes - result.project.timeBudgetMinutes, 0),
        taskCounts,
      },
      stages: result.stages.map((stage) => {
        const tasks = tasksByStage.get(stage.id) ?? [];
        const taskRows = tasks.map((task) => taskJson(
          task,
          stage.publicId,
          taskStats.get(task.id) ?? { actualMinutes: 0, approvedMinutes: 0 },
        ));
        const stageTaskCounts = { TODO: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 };
        for (const task of tasks) stageTaskCounts[task.status] += 1;
        return {
          id: stage.publicId,
          sequence: stage.sequence,
          nameAr: stage.nameAr,
          nameEn: stage.nameEn,
          description: stage.description,
          status: stage.status,
          plannedStartDate: stage.plannedStartDate ? dateString(stage.plannedStartDate) : null,
          targetEndDate: stage.targetEndDate ? dateString(stage.targetEndDate) : null,
          version: stage.version,
          summary: {
            estimatedMinutes: tasks.filter((task) => task.status !== "CANCELLED").reduce((sum, task) => sum + task.estimatedMinutes, 0),
            actualMinutes: taskRows.reduce((sum, task) => sum + task.actualMinutes, 0),
            approvedMinutes: taskRows.reduce((sum, task) => sum + task.approvedMinutes, 0),
            taskCounts: stageTaskCounts,
          },
          tasks: taskRows,
        };
      }),
      dependencies: result.dependencies.map((dependency) => dependencyJson(dependency, taskIds)),
    };
  }

  updateTimeBudget(context: ActorContext, projectPublicId: string, input: {
    planningVersion: number;
    timeBudgetMinutes: number | null;
  }) {
    return this.transactions.execute({ operation: "UPDATE_PROFESSIONAL_PROJECT_TIME_BUDGET", companyId: context.companyId }, async (tx) => {
      const project = await this.lockMutableProject(tx, context.companyId, projectPublicId, input.planningVersion);
      await this.bumpPlanningVersion(tx, context, project, input.planningVersion, { timeBudgetMinutes: input.timeBudgetMinutes });
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_TIME_BUDGET_UPDATED", "PROFESSIONAL_PROJECT", projectPublicId, {
        timeBudgetMinutes: input.timeBudgetMinutes,
      });
      return {
        project: { projectId: projectPublicId, timeBudgetMinutes: input.timeBudgetMinutes },
        planningVersion: input.planningVersion + 1,
      };
    });
  }

  createStage(context: ActorContext, projectPublicId: string, input: {
    planningVersion: number;
    nameAr: string;
    nameEn?: string | null;
    description?: string | null;
    plannedStartDate?: string | null;
    targetEndDate?: string | null;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "CREATE_PROFESSIONAL_PROJECT_STAGE", input.idempotencyKey, { projectPublicId, ...input }, 201, async (tx) => {
      const project = await this.lockMutableProject(tx, context.companyId, projectPublicId, input.planningVersion);
      const dates = this.stageDates(project, input.plannedStartDate ?? null, input.targetEndDate ?? null);
      const sequence = (await tx.professionalProjectStage.aggregate({
        where: { companyId: context.companyId, projectId: project.id },
        _max: { sequence: true },
      }))._max.sequence ?? 0;
      const stage = await tx.professionalProjectStage.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          sequence: sequence + 1,
          nameAr: input.nameAr,
          nameEn: input.nameEn ?? null,
          description: input.description ?? null,
          plannedStartDate: dates.start,
          targetEndDate: dates.end,
          createdById: context.userId,
          updatedById: context.userId,
        },
      });
      await this.bumpPlanningVersion(tx, context, project, input.planningVersion);
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_STAGE_CREATED", "PROFESSIONAL_PROJECT_STAGE", stage.publicId, { projectId: projectPublicId });
      return { stage: await this.stageJson(tx, context.companyId, stage), planningVersion: input.planningVersion + 1 };
    });
  }

  updateStage(context: ActorContext, stagePublicId: string, input: {
    planningVersion: number;
    version: number;
    nameAr?: string;
    nameEn?: string | null;
    description?: string | null;
    plannedStartDate?: string | null;
    targetEndDate?: string | null;
  }) {
    return this.transactions.execute({ operation: "UPDATE_PROFESSIONAL_PROJECT_STAGE", companyId: context.companyId }, async (tx) => {
      const candidate = await this.stageCandidate(tx, context.companyId, stagePublicId);
      const project = await this.lockMutableProject(tx, context.companyId, candidate.project.publicId, input.planningVersion);
      const stage = await tx.professionalProjectStage.findFirst({ where: { id: candidate.id, companyId: context.companyId } });
      if (!stage) throw new ProfessionalPlanningError("STAGE_NOT_FOUND");
      if (stage.version !== input.version) throw new ProfessionalPlanningError("VERSION_CONFLICT");
      if (["COMPLETED", "CANCELLED"].includes(stage.status)) throw new ProfessionalPlanningError("STAGE_INACTIVE");
      const dates = this.stageDates(
        project,
        input.plannedStartDate === undefined ? stage.plannedStartDate : input.plannedStartDate,
        input.targetEndDate === undefined ? stage.targetEndDate : input.targetEndDate,
      );
      await this.assertTasksInsideStage(tx, context.companyId, stage.id, dates.start, dates.end);
      const changed = await tx.professionalProjectStage.updateMany({
        where: { id: stage.id, companyId: context.companyId, version: input.version },
        data: {
          ...(input.nameAr !== undefined ? { nameAr: input.nameAr } : {}),
          ...(input.nameEn !== undefined ? { nameEn: input.nameEn } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.plannedStartDate !== undefined ? { plannedStartDate: dates.start } : {}),
          ...(input.targetEndDate !== undefined ? { targetEndDate: dates.end } : {}),
          updatedById: context.userId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ProfessionalPlanningError("VERSION_CONFLICT");
      await this.bumpPlanningVersion(tx, context, project, input.planningVersion);
      const updated = await tx.professionalProjectStage.findUniqueOrThrow({ where: { id: stage.id } });
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_STAGE_UPDATED", "PROFESSIONAL_PROJECT_STAGE", stagePublicId);
      return { stage: await this.stageJson(tx, context.companyId, updated), planningVersion: input.planningVersion + 1 };
    });
  }

  transitionStage(context: ActorContext, stagePublicId: string, input: {
    planningVersion: number;
    version: number;
    status: StageStatus;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "TRANSITION_PROFESSIONAL_PROJECT_STAGE", input.idempotencyKey, { stagePublicId, ...input }, 200, async (tx) => {
      const candidate = await this.stageCandidate(tx, context.companyId, stagePublicId);
      const project = await this.lockMutableProject(tx, context.companyId, candidate.project.publicId, input.planningVersion);
      const stage = await tx.professionalProjectStage.findFirst({ where: { id: candidate.id, companyId: context.companyId } });
      if (!stage) throw new ProfessionalPlanningError("STAGE_NOT_FOUND");
      if (stage.version !== input.version) throw new ProfessionalPlanningError("VERSION_CONFLICT");
      if (!stageTransitions[stage.status].includes(input.status)) throw new ProfessionalPlanningError("INVALID_TRANSITION");
      if (input.status === "COMPLETED" || input.status === "CANCELLED") {
        const tasks = await tx.professionalProjectTask.findMany({
          where: { companyId: context.companyId, stageId: stage.id },
          select: { status: true },
        });
        if (input.status === "COMPLETED" && tasks.length === 0) throw new ProfessionalPlanningError("STAGE_EMPTY");
        if (tasks.some((task) => !terminalTaskStatuses.has(task.status))) throw new ProfessionalPlanningError("STAGE_TASKS_INCOMPLETE");
      }
      const changed = await tx.professionalProjectStage.updateMany({
        where: { id: stage.id, companyId: context.companyId, version: input.version, status: stage.status },
        data: { status: input.status, updatedById: context.userId, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ProfessionalPlanningError("VERSION_CONFLICT");
      await this.bumpPlanningVersion(tx, context, project, input.planningVersion);
      const updated = await tx.professionalProjectStage.findUniqueOrThrow({ where: { id: stage.id } });
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_STAGE_STATUS_CHANGED", "PROFESSIONAL_PROJECT_STAGE", stagePublicId, {
        from: stage.status,
        to: input.status,
        reason: input.reason,
      });
      return { stage: await this.stageJson(tx, context.companyId, updated), planningVersion: input.planningVersion + 1 };
    });
  }

  createTask(context: ActorContext, stagePublicId: string, input: {
    planningVersion: number;
    titleAr: string;
    titleEn?: string | null;
    description?: string | null;
    assigneeUserId: bigint;
    estimatedMinutes: number;
    plannedStartDate?: string | null;
    dueDate?: string | null;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "CREATE_PROFESSIONAL_PROJECT_TASK", input.idempotencyKey, { stagePublicId, ...input }, 201, async (tx) => {
      const candidate = await this.stageCandidate(tx, context.companyId, stagePublicId);
      const project = await this.lockMutableProject(tx, context.companyId, candidate.project.publicId, input.planningVersion);
      const stage = await tx.professionalProjectStage.findFirst({ where: { id: candidate.id, companyId: context.companyId } });
      if (!stage) throw new ProfessionalPlanningError("STAGE_NOT_FOUND");
      if (["COMPLETED", "CANCELLED"].includes(stage.status)) throw new ProfessionalPlanningError("STAGE_INACTIVE");
      await this.requireActiveMember(tx, context.companyId, project.id, input.assigneeUserId);
      const dates = this.taskDates(project, stage, input.plannedStartDate ?? null, input.dueDate ?? null);
      const sequence = (await tx.professionalProjectTask.aggregate({
        where: { companyId: context.companyId, stageId: stage.id },
        _max: { sequence: true },
      }))._max.sequence ?? 0;
      const task = await tx.professionalProjectTask.create({
        data: {
          companyId: context.companyId,
          projectId: project.id,
          stageId: stage.id,
          sequence: sequence + 1,
          titleAr: input.titleAr,
          titleEn: input.titleEn ?? null,
          description: input.description ?? null,
          assigneeUserId: input.assigneeUserId,
          estimatedMinutes: input.estimatedMinutes,
          plannedStartDate: dates.start,
          dueDate: dates.end,
          createdById: context.userId,
          updatedById: context.userId,
        },
      });
      await this.bumpPlanningVersion(tx, context, project, input.planningVersion);
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_TASK_CREATED", "PROFESSIONAL_PROJECT_TASK", task.publicId, { stageId: stagePublicId });
      return { task: taskJson(task, stage.publicId, { actualMinutes: 0, approvedMinutes: 0 }), planningVersion: input.planningVersion + 1 };
    });
  }

  updateTask(context: ActorContext, taskPublicId: string, input: {
    planningVersion: number;
    version: number;
    titleAr?: string;
    titleEn?: string | null;
    description?: string | null;
    assigneeUserId?: bigint;
    estimatedMinutes?: number;
    plannedStartDate?: string | null;
    dueDate?: string | null;
  }) {
    return this.transactions.execute({ operation: "UPDATE_PROFESSIONAL_PROJECT_TASK", companyId: context.companyId }, async (tx) => {
      const candidate = await this.taskCandidate(tx, context.companyId, taskPublicId);
      const project = await this.lockMutableProject(tx, context.companyId, candidate.project.publicId, input.planningVersion);
      const task = await tx.professionalProjectTask.findFirst({ where: { id: candidate.id, companyId: context.companyId }, include: { stage: true } });
      if (!task) throw new ProfessionalPlanningError("TASK_NOT_FOUND");
      if (task.version !== input.version) throw new ProfessionalPlanningError("VERSION_CONFLICT");
      if (terminalTaskStatuses.has(task.status)) throw new ProfessionalPlanningError("TASK_INACTIVE");
      if (input.assigneeUserId !== undefined) await this.requireActiveMember(tx, context.companyId, project.id, input.assigneeUserId);
      const dates = this.taskDates(
        project,
        task.stage,
        input.plannedStartDate === undefined ? task.plannedStartDate : input.plannedStartDate,
        input.dueDate === undefined ? task.dueDate : input.dueDate,
      );
      const changed = await tx.professionalProjectTask.updateMany({
        where: { id: task.id, companyId: context.companyId, version: input.version },
        data: {
          ...(input.titleAr !== undefined ? { titleAr: input.titleAr } : {}),
          ...(input.titleEn !== undefined ? { titleEn: input.titleEn } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.assigneeUserId !== undefined ? { assigneeUserId: input.assigneeUserId } : {}),
          ...(input.estimatedMinutes !== undefined ? { estimatedMinutes: input.estimatedMinutes } : {}),
          ...(input.plannedStartDate !== undefined ? { plannedStartDate: dates.start } : {}),
          ...(input.dueDate !== undefined ? { dueDate: dates.end } : {}),
          updatedById: context.userId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ProfessionalPlanningError("VERSION_CONFLICT");
      await this.bumpPlanningVersion(tx, context, project, input.planningVersion);
      const updated = await tx.professionalProjectTask.findUniqueOrThrow({ where: { id: task.id } });
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_TASK_UPDATED", "PROFESSIONAL_PROJECT_TASK", taskPublicId);
      return { task: taskJson(updated, task.stage.publicId, await this.taskStats(tx, context.companyId, task.id)), planningVersion: input.planningVersion + 1 };
    });
  }

  transitionTask(context: ActorContext, taskPublicId: string, input: {
    planningVersion: number;
    version: number;
    status: TaskStatus;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "TRANSITION_PROFESSIONAL_PROJECT_TASK", input.idempotencyKey, { taskPublicId, ...input }, 200, async (tx) => {
      const candidate = await this.taskCandidate(tx, context.companyId, taskPublicId);
      const project = await this.lockMutableProject(tx, context.companyId, candidate.project.publicId, input.planningVersion);
      const task = await tx.professionalProjectTask.findFirst({ where: { id: candidate.id, companyId: context.companyId }, include: { stage: true } });
      if (!task) throw new ProfessionalPlanningError("TASK_NOT_FOUND");
      if (task.version !== input.version) throw new ProfessionalPlanningError("VERSION_CONFLICT");
      if (!taskTransitions[task.status].includes(input.status)) throw new ProfessionalPlanningError("INVALID_TRANSITION");
      await this.assertTaskProgressActor(tx, context, task);
      if (input.status === "IN_PROGRESS" || input.status === "COMPLETED") {
        if (project.status !== "ACTIVE" || task.stage.status !== "IN_PROGRESS") throw new ProfessionalPlanningError("PROJECT_INACTIVE");
        await this.assertDependenciesCompleted(tx, context.companyId, task.id);
      }
      if (input.status === "CANCELLED") await this.assertNoOpenDependents(tx, context.companyId, task.id);
      const completedAt = input.status === "COMPLETED" ? new Date() : null;
      const changed = await tx.professionalProjectTask.updateMany({
        where: { id: task.id, companyId: context.companyId, version: input.version, status: task.status },
        data: { status: input.status, completedAt, updatedById: context.userId, version: { increment: 1 } },
      });
      if (changed.count !== 1) throw new ProfessionalPlanningError("VERSION_CONFLICT");
      await this.bumpPlanningVersion(tx, context, project, input.planningVersion);
      const updated = await tx.professionalProjectTask.findUniqueOrThrow({ where: { id: task.id } });
      await this.audit(tx, context, "PROFESSIONAL_PROJECT_TASK_STATUS_CHANGED", "PROFESSIONAL_PROJECT_TASK", taskPublicId, {
        from: task.status,
        to: input.status,
        reason: input.reason,
      });
      return { task: taskJson(updated, task.stage.publicId, await this.taskStats(tx, context.companyId, task.id)), planningVersion: input.planningVersion + 1 };
    });
  }

  addDependency(context: ActorContext, input: {
    planningVersion: number;
    successorTaskId: string;
    predecessorTaskId: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "ADD_PROFESSIONAL_TASK_DEPENDENCY", input.idempotencyKey, input, 201, async (tx) => {
      const successorCandidate = await this.taskCandidate(tx, context.companyId, input.successorTaskId);
      const project = await this.lockMutableProject(
        tx,
        context.companyId,
        successorCandidate.project.publicId,
        input.planningVersion,
      );
      const tasks = await tx.professionalProjectTask.findMany({
        where: {
          companyId: context.companyId,
          projectId: project.id,
          publicId: { in: [input.successorTaskId, input.predecessorTaskId] },
        },
      });
      const successor = tasks.find((task) => task.publicId === input.successorTaskId);
      const predecessor = tasks.find((task) => task.publicId === input.predecessorTaskId);
      if (!successor || !predecessor) throw new ProfessionalPlanningError("TASK_NOT_FOUND");
      if (successor.id === predecessor.id) throw new ProfessionalPlanningError("DEPENDENCY_SELF");
      if (successor.status !== "TODO" || predecessor.status === "CANCELLED") throw new ProfessionalPlanningError("TASK_INACTIVE");
      const existing = await tx.professionalTaskDependency.findUnique({
        where: { taskId_dependsOnTaskId: { taskId: successor.id, dependsOnTaskId: predecessor.id } },
      });
      if (existing?.isActive) throw new ProfessionalPlanningError("DEPENDENCY_DUPLICATE");
      await this.assertNoDependencyCycle(tx, context.companyId, project.id, predecessor.id, successor.id);
      const dependency = existing
        ? await tx.professionalTaskDependency.update({
            where: { id: existing.id },
            data: {
              isActive: true,
              removalReason: null,
              removedById: null,
              removedAt: null,
              updatedById: context.userId,
              version: { increment: 1 },
            },
          })
        : await tx.professionalTaskDependency.create({
            data: {
              companyId: context.companyId,
              projectId: project.id,
              taskId: successor.id,
              dependsOnTaskId: predecessor.id,
              createdById: context.userId,
              updatedById: context.userId,
            },
          });
      await this.bumpPlanningVersion(tx, context, project, input.planningVersion);
      const taskIds = new Map([[successor.id, successor.publicId], [predecessor.id, predecessor.publicId]]);
      await this.audit(tx, context, "PROFESSIONAL_TASK_DEPENDENCY_ADDED", "PROFESSIONAL_TASK_DEPENDENCY", dependency.publicId, {
        projectId: project.publicId,
        successorTaskId: input.successorTaskId,
        predecessorTaskId: input.predecessorTaskId,
      });
      return { dependency: dependencyJson(dependency, taskIds), planningVersion: input.planningVersion + 1 };
    });
  }

  removeDependency(context: ActorContext, dependencyPublicId: string, input: {
    planningVersion: number;
    version: number;
    reason: string;
    idempotencyKey: string;
  }) {
    return this.executeCommand(context, "REMOVE_PROFESSIONAL_TASK_DEPENDENCY", input.idempotencyKey, { dependencyPublicId, ...input }, 200, async (tx) => {
      const candidate = await tx.professionalTaskDependency.findFirst({
        where: { publicId: dependencyPublicId, companyId: context.companyId },
        include: { project: { select: { publicId: true } }, task: { select: { publicId: true } }, dependsOnTask: { select: { publicId: true } } },
      });
      if (!candidate) throw new ProfessionalPlanningError("DEPENDENCY_NOT_FOUND");
      const project = await this.lockMutableProject(tx, context.companyId, candidate.project.publicId, input.planningVersion);
      const dependency = await tx.professionalTaskDependency.findFirst({ where: { id: candidate.id, companyId: context.companyId } });
      if (!dependency) throw new ProfessionalPlanningError("DEPENDENCY_NOT_FOUND");
      if (!dependency.isActive) throw new ProfessionalPlanningError("DEPENDENCY_INACTIVE");
      if (dependency.version !== input.version) throw new ProfessionalPlanningError("VERSION_CONFLICT");
      const changed = await tx.professionalTaskDependency.updateMany({
        where: { id: dependency.id, companyId: context.companyId, isActive: true, version: input.version },
        data: {
          isActive: false,
          removalReason: input.reason,
          removedById: context.userId,
          removedAt: new Date(),
          updatedById: context.userId,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw new ProfessionalPlanningError("VERSION_CONFLICT");
      await this.bumpPlanningVersion(tx, context, project, input.planningVersion);
      const updated = await tx.professionalTaskDependency.findUniqueOrThrow({ where: { id: dependency.id } });
      const taskIds = new Map([[dependency.taskId, candidate.task.publicId], [dependency.dependsOnTaskId, candidate.dependsOnTask.publicId]]);
      await this.audit(tx, context, "PROFESSIONAL_TASK_DEPENDENCY_REMOVED", "PROFESSIONAL_TASK_DEPENDENCY", dependencyPublicId, { reason: input.reason });
      return { dependency: dependencyJson(updated, taskIds), planningVersion: input.planningVersion + 1 };
    });
  }

  private async stageJson(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    stage: ProfessionalProjectStage,
  ) {
    const tasks = await tx.professionalProjectTask.findMany({
      where: { companyId, stageId: stage.id },
      orderBy: [{ sequence: "asc" }, { id: "asc" }],
    });
    const taskRows = await Promise.all(tasks.map(async (task) => taskJson(
      task,
      stage.publicId,
      await this.taskStats(tx, companyId, task.id),
    )));
    const taskCounts = { TODO: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0 };
    for (const task of tasks) taskCounts[task.status] += 1;
    return {
      id: stage.publicId,
      sequence: stage.sequence,
      nameAr: stage.nameAr,
      nameEn: stage.nameEn,
      description: stage.description,
      status: stage.status,
      plannedStartDate: stage.plannedStartDate ? dateString(stage.plannedStartDate) : null,
      targetEndDate: stage.targetEndDate ? dateString(stage.targetEndDate) : null,
      version: stage.version,
      summary: {
        estimatedMinutes: tasks
          .filter((task) => task.status !== "CANCELLED")
          .reduce((sum, task) => sum + task.estimatedMinutes, 0),
        actualMinutes: taskRows.reduce((sum, task) => sum + task.actualMinutes, 0),
        approvedMinutes: taskRows.reduce((sum, task) => sum + task.approvedMinutes, 0),
        taskCounts,
      },
      tasks: taskRows,
    };
  }

  private async lockMutableProject(tx: Prisma.TransactionClient, companyId: bigint, publicId: string, planningVersion: number) {
    const rows = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM professional_projects
      WHERE public_id=${publicId} AND company_id=${companyId}
      FOR UPDATE`;
    if (rows.length !== 1) throw new ProfessionalPlanningError("NOT_FOUND");
    const project = await tx.professionalProject.findFirstOrThrow({ where: { id: rows[0]!.id, companyId } });
    if (project.planningVersion !== planningVersion) throw new ProfessionalPlanningError("VERSION_CONFLICT");
    if (!["ACTIVE", "ON_HOLD"].includes(project.status)) throw new ProfessionalPlanningError("PROJECT_INACTIVE");
    return project;
  }

  private bumpPlanningVersion(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    project: ProfessionalProject,
    expected: number,
    extra: Prisma.ProfessionalProjectUpdateManyMutationInput = {},
  ) {
    return tx.professionalProject.updateMany({
      where: { id: project.id, companyId: context.companyId, planningVersion: expected },
      data: { ...extra, updatedById: context.userId, planningVersion: { increment: 1 } },
    }).then((changed) => {
      if (changed.count !== 1) throw new ProfessionalPlanningError("VERSION_CONFLICT");
    });
  }

  private async stageCandidate(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    const stage = await tx.professionalProjectStage.findFirst({
      where: { publicId, companyId },
      include: { project: { select: { publicId: true } } },
    });
    if (!stage) throw new ProfessionalPlanningError("STAGE_NOT_FOUND");
    return stage;
  }

  private async taskCandidate(tx: Prisma.TransactionClient, companyId: bigint, publicId: string) {
    const task = await tx.professionalProjectTask.findFirst({
      where: { publicId, companyId },
      include: { project: { select: { publicId: true } } },
    });
    if (!task) throw new ProfessionalPlanningError("TASK_NOT_FOUND");
    return task;
  }

  private async requireActiveMember(tx: Prisma.TransactionClient, companyId: bigint, projectId: bigint, userId: bigint) {
    const member = await tx.professionalProjectMember.findFirst({
      where: { companyId, projectId, userId, isActive: true },
      select: { id: true },
    });
    if (!member) throw new ProfessionalPlanningError("ASSIGNEE_NOT_ACTIVE_MEMBER");
  }

  private async assertTaskProgressActor(tx: Prisma.TransactionClient, context: ActorContext, task: ProfessionalProjectTask) {
    if (task.assigneeUserId === context.userId) return;
    const manager = await tx.professionalProjectMember.findFirst({
      where: { companyId: context.companyId, projectId: task.projectId, userId: context.userId, role: "MANAGER", isActive: true },
      select: { id: true },
    });
    if (!manager) throw new ProfessionalPlanningError("TASK_PROGRESS_FORBIDDEN");
  }

  private async assertDependenciesCompleted(tx: Prisma.TransactionClient, companyId: bigint, taskId: bigint) {
    const incomplete = await tx.professionalTaskDependency.findFirst({
      where: { companyId, taskId, isActive: true, dependsOnTask: { status: { not: "COMPLETED" } } },
      select: { id: true },
    });
    if (incomplete) throw new ProfessionalPlanningError("TASK_DEPENDENCIES_INCOMPLETE");
  }

  private async assertNoOpenDependents(tx: Prisma.TransactionClient, companyId: bigint, taskId: bigint) {
    const open = await tx.professionalTaskDependency.findFirst({
      where: {
        companyId,
        dependsOnTaskId: taskId,
        isActive: true,
        task: { status: { in: ["TODO", "IN_PROGRESS"] } },
      },
      select: { id: true },
    });
    if (open) throw new ProfessionalPlanningError("DEPENDENCY_SUCCESSOR_OPEN");
  }

  private async assertNoDependencyCycle(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    projectId: bigint,
    predecessorId: bigint,
    successorId: bigint,
  ) {
    const edges = await tx.professionalTaskDependency.findMany({
      where: { companyId, projectId, isActive: true },
      select: { dependsOnTaskId: true, taskId: true },
    });
    const outgoing = new Map<bigint, bigint[]>();
    for (const edge of edges) {
      const rows = outgoing.get(edge.dependsOnTaskId) ?? [];
      rows.push(edge.taskId);
      outgoing.set(edge.dependsOnTaskId, rows);
    }
    const pending = [successorId];
    const visited = new Set<bigint>();
    while (pending.length) {
      const current = pending.pop()!;
      if (current === predecessorId) throw new ProfessionalPlanningError("DEPENDENCY_CYCLE");
      if (visited.has(current)) continue;
      visited.add(current);
      pending.push(...(outgoing.get(current) ?? []));
    }
  }

  private stageDates(
    project: Pick<ProfessionalProject, "startDate" | "targetEndDate">,
    startValue: string | Date | null,
    endValue: string | Date | null,
  ) {
    const start = typeof startValue === "string" ? asDate(startValue) : startValue;
    const end = typeof endValue === "string" ? asDate(endValue) : endValue;
    this.assertDateWindow(project.startDate, project.targetEndDate, start, end);
    return { start, end };
  }

  private taskDates(
    project: Pick<ProfessionalProject, "startDate" | "targetEndDate">,
    stage: Pick<ProfessionalProjectStage, "plannedStartDate" | "targetEndDate">,
    startValue: string | Date | null,
    endValue: string | Date | null,
  ) {
    const start = typeof startValue === "string" ? asDate(startValue) : startValue;
    const end = typeof endValue === "string" ? asDate(endValue) : endValue;
    this.assertDateWindow(project.startDate, project.targetEndDate, start, end);
    if (stage.plannedStartDate && ((start && start < stage.plannedStartDate) || (end && end < stage.plannedStartDate))) {
      throw new ProfessionalPlanningError("TASK_OUTSIDE_STAGE");
    }
    if (stage.targetEndDate && ((start && start > stage.targetEndDate) || (end && end > stage.targetEndDate))) {
      throw new ProfessionalPlanningError("TASK_OUTSIDE_STAGE");
    }
    return { start, end };
  }

  private assertDateWindow(projectStart: Date, projectEnd: Date | null, start: Date | null, end: Date | null) {
    if (start && end && end < start) throw new ProfessionalPlanningError("INVALID_DATE_RANGE");
    if ((start && start < projectStart) || (end && end < projectStart)) throw new ProfessionalPlanningError("INVALID_DATE_RANGE");
    if (projectEnd && ((start && start > projectEnd) || (end && end > projectEnd))) throw new ProfessionalPlanningError("INVALID_DATE_RANGE");
  }

  private async assertTasksInsideStage(
    tx: Prisma.TransactionClient,
    companyId: bigint,
    stageId: bigint,
    stageStart: Date | null,
    stageEnd: Date | null,
  ) {
    const outside = await tx.professionalProjectTask.findFirst({
      where: {
        companyId,
        stageId,
        OR: [
          ...(stageStart ? [{ plannedStartDate: { lt: stageStart } }, { dueDate: { lt: stageStart } }] : []),
          ...(stageEnd ? [{ plannedStartDate: { gt: stageEnd } }, { dueDate: { gt: stageEnd } }] : []),
        ],
      },
      select: { id: true },
    });
    if (outside) throw new ProfessionalPlanningError("TASK_OUTSIDE_STAGE");
  }

  private async taskStats(tx: Prisma.TransactionClient, companyId: bigint, taskId: bigint): Promise<PlanTaskStats> {
    const entries = await tx.professionalTimeEntry.findMany({
      where: { companyId, taskId },
      select: { userId: true, workDate: true, minutes: true },
    });
    if (!entries.length) return { actualMinutes: 0, approvedMinutes: 0 };
    const periodStarts = [...new Set(entries.map((entry) => dateString(weekStart(entry.workDate))))].map(asDate);
    const userIds = [...new Set(entries.map((entry) => entry.userId.toString()))].map(BigInt);
    const approved = await tx.professionalTimesheet.findMany({
      where: { companyId, status: "APPROVED", userId: { in: userIds }, periodStart: { in: periodStarts } },
      select: { userId: true, periodStart: true },
    });
    const keys = new Set(approved.map((row) => timesheetKey(row.userId, row.periodStart)));
    return {
      actualMinutes: entries.reduce((sum, entry) => sum + entry.minutes, 0),
      approvedMinutes: entries.filter((entry) => keys.has(timesheetKey(entry.userId, weekStart(entry.workDate)))).reduce((sum, entry) => sum + entry.minutes, 0),
    };
  }

  private executeCommand<T>(
    context: ActorContext,
    operation: string,
    key: string,
    fingerprint: Record<string, unknown>,
    responseStatus: number,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ) {
    return this.commands.execute({
      context,
      operation,
      key,
      fingerprint: JSON.stringify(fingerprint, (_name, value) => typeof value === "bigint" ? value.toString() : value),
      responseStatus,
      errors: {
        mismatch: () => new ProfessionalPlanningError("IDEMPOTENCY_MISMATCH"),
        inProgress: () => new ProfessionalPlanningError("IDEMPOTENCY_IN_PROGRESS"),
      },
    }, work);
  }

  private audit(
    tx: Prisma.TransactionClient,
    context: ActorContext,
    action: string,
    entityType: string,
    entityId: string,
    details?: Prisma.InputJsonObject,
  ) {
    return tx.auditLog.create({
      data: {
        companyId: context.companyId,
        actorUserId: context.userId,
        action,
        entityType,
        entityId,
        ...(details ? { details } : {}),
      },
    });
  }
}
