/**
 * Types de base partagés par tous les modules de l'orchestrateur
 */

export type SessionId = string;
export type WorkflowId = string;
export type PhaseId = string;
export type TaskId = string;
export type AgentId = string;
export type SnapshotId = string;

export type WorkflowType = 'BUILD' | 'REVIEW' | 'OPTIMIZE' | 'DESIGN' | 'DEBUG' | 'SECURITY_AUDIT';
export type WorkflowStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
export type PhaseStatus = 'PENDING' | 'RUNNING' | 'PASS' | 'ITERATE' | 'FAIL' | 'SKIPPED';

export interface WorkflowPhase {
    id: PhaseId;
    name: string;
    description: string;
    agents: AgentId[];
    dependencies: PhaseId[];
    status: PhaseStatus;
    iteration: number;
    maxIterations: number;
    score: number | null;
    startedAt: Date | null;
    completedAt: Date | null;
    output: PhaseOutput | null;
}

export interface PhaseOutput {
    agentOutputs: Record<AgentId, AgentOutput>;
    filesModified: string[];
    errors: string[];
    warnings: string[];
}

export interface AgentOutput {
    agentId: AgentId;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    output: string;
    filesCreated: string[];
    filesModified: string[];
    duration: number;
    score: ScoreResult | null;
}

export interface Workflow {
    id: WorkflowId;
    type: WorkflowType;
    task: string;
    status: WorkflowStatus;
    phases: WorkflowPhase[];
    currentPhaseIndex: number;
    totalScore: number | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    snapshotId: SnapshotId | null;
    context: WorkflowContext;
}

export interface WorkflowContext {
    memories: string[];
    userPreferences: Record<string, unknown>;
    projectInfo: ProjectInfo;
}

export interface ProjectInfo {
    name: string;
    type: string;
    language: string;
    framework: string | null;
    rootPath: string;
}

export interface ScoreBreakdown {
    correctness: number;
    completeness: number;
    security: number;
    bestPractices: number;
    tests: number;
    documentation: number;
}

export interface ScoreResult {
    total: number;
    breakdown: ScoreBreakdown;
    decision: 'PASS' | 'ITERATE' | 'FAIL';
    blockers: Blocker[];
    feedback: string[];
    bonuses: ScoreModifier[];
    penalties: ScoreModifier[];
}

export interface ScoreModifier {
    name: string;
    value: number;
    reason: string;
}

export interface Blocker {
    type: BlockerType;
    message: string;
    file?: string;
    line?: number;
}

export type BlockerType = 'NO_OUTPUT' | 'SYNTAX_ERROR' | 'CRITICAL_SECURITY' | 'BUILD_FAILED' | 'TESTS_CRASHED' | 'MISSING_REQUIRED';

export interface Result<T, E = Error> {
    success: boolean;
    data?: T;
    error?: E;
}

export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;
