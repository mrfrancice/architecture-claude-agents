/**
 * Types de base partagés par tous les modules de l'orchestrateur
 */

export type SessionId = string;
export type WorkflowId = string;
export type PhaseId = string;
export type TaskId = string;
export type AgentId = string;
export type SnapshotId = string;

export type WorkflowType = 'BUILD' | 'REVIEW' | 'OPTIMIZE' | 'DESIGN' | 'DEBUG' | 'SECURITY_AUDIT' | 'CUSTOM';
export type WorkflowStatus = 'PENDING' | 'RUNNING' | 'PAUSED' | 'COMPLETE' | 'FAILED' | 'CANCELLED';
export type PhaseStatus = 'PENDING' | 'RUNNING' | 'PASS' | 'ITERATE' | 'FAIL' | 'SKIPPED';

export type PhaseMode = 'interactive' | 'non-interactive';

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
    lastFeedback: string[];
    forcePromoted: boolean;
    mode: PhaseMode;
}

export interface PhaseOutput {
    agentOutputs: Record<AgentId, AgentOutput>;
    filesModified: string[];
    errors: string[];
    warnings: string[];
    consolidatedOutput?: string;
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

// ============================================================================
// AGENT DISPATCH TYPES
// ============================================================================

export type DispatchMode = 'manual' | 'cli' | 'terminal';

export interface AgentDefinition {
    id: AgentId;
    name: string;
    description: string;
    systemPrompt: string;
    capabilities: string[];
    model?: string;
    builtIn: boolean;
}

export interface AgentContext {
    agent: AgentDefinition;
    task: string;
    phase: {
        id: PhaseId;
        name: string;
        description: string;
        iteration: number;
        maxIterations: number;
        feedback: string[];
        mode: PhaseMode;
    };
    previousPhases: PreviousPhaseInfo[];
    peerOutputs: Record<AgentId, string>;
    memories: Record<string, string>;
    projectInfo: ProjectInfo;
}

export interface PreviousPhaseInfo {
    phaseId: PhaseId;
    phaseName: string;
    status: PhaseStatus;
    score: number | null;
    agentOutputs: Record<AgentId, string>;
    filesModified: string[];
}

export interface DispatchResult {
    agentId: AgentId;
    mode: DispatchMode;
    status: 'SUCCESS' | 'PARTIAL' | 'FAILED';
    output: string;
    duration: number;
    retryCount?: number;
    error?: string;
}

export interface CustomWorkflowTemplate {
    name: string;
    description: string;
    phases: Array<{
        name: string;
        description?: string;
        agents: AgentId[];
        maxIterations?: number;
        mode?: PhaseMode;
    }>;
}

export interface ManualDispatchPrompt {
    agentId: AgentId;
    agentName: string;
    systemPrompt: string;
    userPrompt: string;
    model?: string;
}

export interface PhaseDispatchResult {
    phaseId: PhaseId;
    phaseName: string;
    mode: DispatchMode;
    results: DispatchResult[];
    prompts?: ManualDispatchPrompt[];
    terminalSession?: TerminalSession;
}

// ============================================================================
// TERMINAL DISPATCH TYPES
// ============================================================================

export interface AgentTerminalInfo {
    agentId: AgentId;
    agentName: string;
    scriptPath: string;
    outputPath: string;
    donePath: string;
    transcriptPath?: string;
    pid?: number;
}

export interface TerminalSession {
    sessionId: string;
    sessionDir: string;
    agents: AgentTerminalInfo[];
    startedAt: Date;
    interactive?: boolean;
}

export interface TerminalSessionStatus {
    sessionId: string;
    completed: AgentId[];
    running: AgentId[];
    total: number;
    allDone: boolean;
    agentDetails: Record<AgentId, { status: 'running' | 'success' | 'failed'; duration?: number }>;
}
