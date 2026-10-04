/** Domain rules for general projects; no client, profession, billing, or case assumption. */
export type GeneralProjectStatus = "DRAFT" | "ACTIVE" | "ON_HOLD" | "COMPLETED" | "CANCELLED";
export type GeneralProjectPhaseStatus = "PLANNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED";
export type GeneralProjectTaskStatus = "TODO" | "IN_PROGRESS" | "BLOCKED" | "COMPLETED" | "CANCELLED";

export class GeneralProjectPolicyError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GeneralProjectPolicyError";
  }
}

function requirePolicy(condition: unknown, code: string): asserts condition {
  if (!condition) throw new GeneralProjectPolicyError(code);
}

const finalProject = (status: GeneralProjectStatus) => status === "COMPLETED" || status === "CANCELLED";
const finalPhase = (status: GeneralProjectPhaseStatus) => status === "COMPLETED" || status === "CANCELLED";
const finalTask = (status: GeneralProjectTaskStatus) => status === "COMPLETED" || status === "CANCELLED";
const reasonRequired = (reason: string | undefined) => {
  const trimmed = reason?.trim() ?? "";
  requirePolicy(trimmed.length >= 10 && trimmed.length <= 500, "REASON_REQUIRED");
};

export type ProjectTransition = Readonly<{
  from: GeneralProjectStatus;
  to: GeneralProjectStatus;
  activeManagerCount: number;
  phaseStatuses: readonly GeneralProjectPhaseStatus[];
  taskStatuses: readonly GeneralProjectTaskStatus[];
  reason?: string;
}>;

export function transitionProject(input: ProjectTransition): GeneralProjectStatus {
  requirePolicy(!finalProject(input.from), "PROJECT_FINAL");
  const allowed = (
    input.from === "DRAFT" && (input.to === "ACTIVE" || input.to === "CANCELLED") ||
    input.from === "ACTIVE" && (input.to === "ON_HOLD" || input.to === "COMPLETED" || input.to === "CANCELLED") ||
    input.from === "ON_HOLD" && (input.to === "ACTIVE" || input.to === "CANCELLED")
  );
  requirePolicy(allowed, "INVALID_PROJECT_TRANSITION");
  if (input.to === "ACTIVE") {
    requirePolicy(Number.isSafeInteger(input.activeManagerCount) && input.activeManagerCount > 0, "ACTIVE_MANAGER_REQUIRED");
  }
  if (input.to === "COMPLETED") {
    requirePolicy(input.phaseStatuses.every(finalPhase) && input.taskStatuses.every(finalTask), "PROJECT_WORK_OPEN");
  }
  if (input.to === "CANCELLED" || input.to === "ON_HOLD" || input.from === "ON_HOLD") reasonRequired(input.reason);
  return input.to;
}

export type PhaseTransition = Readonly<{
  projectStatus: GeneralProjectStatus;
  from: GeneralProjectPhaseStatus;
  to: GeneralProjectPhaseStatus;
  taskStatuses: readonly GeneralProjectTaskStatus[];
  reason?: string;
}>;

export function transitionPhase(input: PhaseTransition): GeneralProjectPhaseStatus {
  requirePolicy(!finalProject(input.projectStatus), "PROJECT_FINAL");
  requirePolicy(!finalPhase(input.from), "PHASE_FINAL");
  const allowed = input.from === "PLANNED"
    ? input.to === "IN_PROGRESS" || input.to === "CANCELLED"
    : input.to === "COMPLETED" || input.to === "CANCELLED";
  requirePolicy(allowed, "INVALID_PHASE_TRANSITION");
  if (input.to === "IN_PROGRESS") requirePolicy(input.projectStatus === "ACTIVE", "PROJECT_NOT_ACTIVE");
  if (input.to === "COMPLETED" || input.to === "CANCELLED") {
    requirePolicy(input.taskStatuses.every(finalTask), "PHASE_WORK_OPEN");
  }
  if (input.to === "CANCELLED") reasonRequired(input.reason);
  return input.to;
}

export type TaskTransition = Readonly<{
  projectStatus: GeneralProjectStatus;
  phaseStatus: GeneralProjectPhaseStatus;
  from: GeneralProjectTaskStatus;
  to: GeneralProjectTaskStatus;
  actorCanManage: boolean;
  actorCanProgress: boolean;
  actorIsActiveResponsible: boolean;
  activeResponsibleCount: number;
  predecessorStatuses: readonly GeneralProjectTaskStatus[];
  reason?: string;
}>;

export function transitionTask(input: TaskTransition): GeneralProjectTaskStatus {
  requirePolicy(!finalProject(input.projectStatus), "PROJECT_FINAL");
  requirePolicy(input.projectStatus === "ACTIVE", "PROJECT_NOT_ACTIVE");
  requirePolicy(!finalPhase(input.phaseStatus), "PHASE_FINAL");
  requirePolicy(!finalTask(input.from), "TASK_FINAL");
  const allowed = input.from === "TODO"
    ? input.to === "IN_PROGRESS" || input.to === "BLOCKED" || input.to === "CANCELLED"
    : input.from === "IN_PROGRESS"
      ? input.to === "BLOCKED" || input.to === "COMPLETED" || input.to === "CANCELLED"
      : input.to === "TODO" || input.to === "CANCELLED";
  requirePolicy(allowed, "INVALID_TASK_TRANSITION");
  if (input.to === "CANCELLED") requirePolicy(input.actorCanManage, "TASK_MANAGE_REQUIRED");
  else requirePolicy(input.actorCanManage || (input.actorCanProgress && input.actorIsActiveResponsible), "TASK_PROGRESS_DENIED");
  if (input.to === "IN_PROGRESS") {
    requirePolicy(input.phaseStatus === "IN_PROGRESS", "PHASE_NOT_IN_PROGRESS");
    requirePolicy(Number.isSafeInteger(input.activeResponsibleCount) && input.activeResponsibleCount > 0, "ACTIVE_RESPONSIBLE_REQUIRED");
    requirePolicy(input.predecessorStatuses.every((status) => status === "COMPLETED"), "DEPENDENCY_BLOCKED");
  }
  if (input.to === "BLOCKED" || input.to === "CANCELLED" || (input.from === "BLOCKED" && input.to === "TODO")) {
    reasonRequired(input.reason);
  }
  return input.to;
}

export type GeneralProjectTaskNode = Readonly<{
  id: string;
  companyId: string;
  projectId: string;
  status: GeneralProjectTaskStatus;
}>;
export type GeneralProjectDependency = Readonly<{ predecessorId: string; successorId: string; active: boolean }>;

export function validateDependencyAddition(input: Readonly<{
  predecessor: GeneralProjectTaskNode;
  successor: GeneralProjectTaskNode;
  tasks: readonly GeneralProjectTaskNode[];
  dependencies: readonly GeneralProjectDependency[];
}>): void {
  const { predecessor, successor } = input;
  requirePolicy(predecessor.id.length > 0 && successor.id.length > 0 && predecessor.id !== successor.id, "DEPENDENCY_SELF_REFERENCE");
  requirePolicy(predecessor.companyId === successor.companyId && predecessor.projectId === successor.projectId, "DEPENDENCY_SCOPE_MISMATCH");
  requirePolicy(!finalTask(predecessor.status) && !finalTask(successor.status), "DEPENDENCY_FINAL_TASK");
  const nodes = new Map(input.tasks.map((task) => [task.id, task]));
  requirePolicy(nodes.size === input.tasks.length, "DEPENDENCY_DUPLICATE_TASK_ID");
  const storedPredecessor = nodes.get(predecessor.id);
  const storedSuccessor = nodes.get(successor.id);
  requirePolicy(storedPredecessor && storedSuccessor, "DEPENDENCY_TASK_MISSING");
  requirePolicy(storedPredecessor.companyId === predecessor.companyId && storedPredecessor.projectId === predecessor.projectId
    && storedPredecessor.status === predecessor.status && storedSuccessor.companyId === successor.companyId
    && storedSuccessor.projectId === successor.projectId && storedSuccessor.status === successor.status, "DEPENDENCY_STALE_TASK");
  const outgoing = new Map<string, string[]>();
  for (const link of input.dependencies) {
    if (!link.active) continue;
    const from = nodes.get(link.predecessorId);
    const to = nodes.get(link.successorId);
    requirePolicy(from && to && from.companyId === predecessor.companyId && to.companyId === predecessor.companyId
      && from.projectId === predecessor.projectId && to.projectId === predecessor.projectId, "DEPENDENCY_SCOPE_MISMATCH");
    requirePolicy(!(link.predecessorId === predecessor.id && link.successorId === successor.id), "DEPENDENCY_DUPLICATE");
    outgoing.set(link.predecessorId, [...(outgoing.get(link.predecessorId) ?? []), link.successorId]);
  }
  const visited = new Set<string>();
  const queue = [successor.id];
  while (queue.length > 0) {
    const current = queue.pop()!;
    requirePolicy(current !== predecessor.id, "DEPENDENCY_CYCLE");
    if (visited.has(current)) continue;
    visited.add(current);
    queue.push(...(outgoing.get(current) ?? []));
  }
}

export function validateDependencyRemoval(input: Readonly<{
  projectStatus: GeneralProjectStatus;
  predecessorStatus: GeneralProjectTaskStatus;
  successorStatus: GeneralProjectTaskStatus;
  reason: string;
}>): "NORMAL" | "PREDECESSOR_CANCELLED_RECOVERY" {
  requirePolicy(!finalProject(input.projectStatus), "PROJECT_FINAL");
  reasonRequired(input.reason);
  requirePolicy(!finalTask(input.successorStatus), "DEPENDENCY_FINAL_TASK");
  if (input.predecessorStatus === "CANCELLED") return "PREDECESSOR_CANCELLED_RECOVERY";
  requirePolicy(!finalTask(input.predecessorStatus), "DEPENDENCY_FINAL_TASK");
  return "NORMAL";
}
