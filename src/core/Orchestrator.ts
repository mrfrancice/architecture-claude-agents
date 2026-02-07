/**
 * Orchestrator - Moteur principal d'orchestration
 *
 * Responsabilités :
 * - Coordonner les workflows multi-agents
 * - Interfacer avec StateManager, ConfigLoader, EventBus
 * - Gérer les phases et itérations
 */

import type {
    Workflow,
    WorkflowType,
    WorkflowPhase,
    Result,
    ScoreResult,
} from '../types/core.js';

// ============================================================================
// TYPES
// ============================================================================

export interface SystemStatus {
    initialized: boolean;
    sessionId: string | null;
    currentWorkflow: {
        id: string;
        type: string;
        status: string;
        currentPhase: string | null;
        progress: number;
    } | null;
    hooksLoaded: number;
    memoriesLoaded: number;
    stats: {
        workflowsCompleted: number;
        workflowsFailed: number;
        averageScore: number;
        totalHooksTriggered: number;
    };
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

export class Orchestrator {
    private initialized = false;
    private currentWorkflow: Workflow | null = null;
    private projectRoot: string;

    constructor(projectRoot?: string) {
        this.projectRoot = projectRoot || process.cwd();
    }

    /**
     * Initialise l'orchestrateur
     */
    async initialize(): Promise<void> {
        if (this.initialized) return;
        // TODO: Initialiser StateManager, ConfigLoader, HookEngine
        // Ces imports seront ajoutés une fois les modules compilés
        this.initialized = true;
        console.error('Orchestrator initialized');
    }

    /**
     * Démarre un nouveau workflow
     */
    async startWorkflow(type: WorkflowType, task: string): Promise<Result<Workflow>> {
        this.ensureInitialized();

        if (this.currentWorkflow && this.currentWorkflow.status === 'RUNNING') {
            return {
                success: false,
                error: new Error('A workflow is already running. Cancel or complete it first.'),
            };
        }

        // Créer le workflow
        const workflowId = `wf_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

        // Créer les phases selon le type
        const phases = this.createPhasesForType(type, workflowId);

        const workflow: Workflow = {
            id: workflowId,
            type,
            task,
            status: 'RUNNING',
            phases,
            currentPhaseIndex: 0,
            totalScore: null,
            createdAt: new Date(),
            startedAt: new Date(),
            completedAt: null,
            snapshotId: null,
            context: {
                memories: [],
                userPreferences: {},
                projectInfo: {
                    name: 'project',
                    type: 'unknown',
                    language: 'typescript',
                    framework: null,
                    rootPath: this.projectRoot,
                },
            },
        };

        this.currentWorkflow = workflow;
        return { success: true, data: workflow };
    }

    /**
     * Crée les phases pour un type de workflow
     */
    private createPhasesForType(type: WorkflowType, workflowId: string): WorkflowPhase[] {
        const phaseTemplates: Record<WorkflowType, Array<{ name: string; agents: string[] }>> = {
            BUILD: [
                { name: 'Design', agents: ['fullstack-ui-architect'] },
                { name: 'Code', agents: ['fullstack-ui-architect'] },
                { name: 'Tests', agents: ['test-automation-strategist'] },
                { name: 'Security', agents: ['security-expert'] },
                { name: 'Review', agents: ['senior-code-reviewer'] },
            ],
            REVIEW: [
                { name: 'Analysis', agents: ['senior-code-reviewer'] },
                { name: 'Security Check', agents: ['security-expert'] },
                { name: 'Report', agents: ['technical-writer'] },
            ],
            OPTIMIZE: [
                { name: 'Profiling', agents: ['database-optimization-expert'] },
                { name: 'Optimization', agents: ['distributed-systems-architect'] },
                { name: 'Verification', agents: ['test-automation-strategist'] },
            ],
            DESIGN: [
                { name: 'Requirements', agents: ['ux-design-strategist'] },
                { name: 'Architecture', agents: ['distributed-systems-architect'] },
                { name: 'Documentation', agents: ['technical-writer'] },
            ],
            DEBUG: [
                { name: 'Investigation', agents: ['senior-code-reviewer'] },
                { name: 'Fix', agents: ['fullstack-ui-architect'] },
                { name: 'Verification', agents: ['test-automation-strategist'] },
            ],
            SECURITY_AUDIT: [
                { name: 'Scan', agents: ['security-expert'] },
                { name: 'Analysis', agents: ['security-expert'] },
                { name: 'Remediation', agents: ['security-expert', 'fullstack-ui-architect'] },
                { name: 'Report', agents: ['technical-writer'] },
            ],
        };

        const templates = phaseTemplates[type] || phaseTemplates.BUILD;

        return templates.map((template, index) => ({
            id: `${workflowId}_phase_${index}`,
            name: template.name,
            description: `Phase ${index + 1}: ${template.name}`,
            agents: template.agents,
            dependencies: index > 0 ? [`${workflowId}_phase_${index - 1}`] : [],
            status: 'PENDING' as const,
            iteration: 0,
            maxIterations: 3,
            score: null,
            startedAt: null,
            completedAt: null,
            output: null,
        }));
    }

    /**
     * Met en pause le workflow
     */
    async pauseWorkflow(): Promise<Result<void>> {
        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow running') };
        }
        this.currentWorkflow.status = 'PAUSED';
        return { success: true };
    }

    /**
     * Reprend le workflow
     */
    async resumeWorkflow(): Promise<Result<void>> {
        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow to resume') };
        }
        if (this.currentWorkflow.status !== 'PAUSED') {
            return { success: false, error: new Error('Workflow is not paused') };
        }
        this.currentWorkflow.status = 'RUNNING';
        return { success: true };
    }

    /**
     * Annule le workflow
     */
    async cancelWorkflow(): Promise<Result<void>> {
        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow to cancel') };
        }
        this.currentWorkflow.status = 'CANCELLED';
        this.currentWorkflow.completedAt = new Date();
        return { success: true };
    }

    /**
     * Récupère le statut du workflow
     */
    async getWorkflowStatus(): Promise<Workflow | null> {
        return this.currentWorkflow;
    }

    /**
     * Valide une phase
     */
    async validatePhase(phaseId?: string, output?: string): Promise<Result<ScoreResult>> {
        if (!this.currentWorkflow) {
            return { success: false, error: new Error('No workflow running') };
        }

        const phase = phaseId
            ? this.currentWorkflow.phases.find(p => p.id === phaseId)
            : this.currentWorkflow.phases[this.currentWorkflow.currentPhaseIndex];

        if (!phase) {
            return { success: false, error: new Error('Phase not found') };
        }

        // TODO: Intégrer ScoringEngine
        const mockScore: ScoreResult = {
            total: 85,
            breakdown: {
                correctness: 90,
                completeness: 80,
                security: 85,
                bestPractices: 80,
                tests: 85,
                documentation: 70,
            },
            decision: 'PASS',
            blockers: [],
            feedback: ['Phase validated successfully'],
            bonuses: [],
            penalties: [],
        };

        return { success: true, data: mockScore };
    }

    /**
     * Calcule le score
     */
    async calculateScore(phaseId?: string, files?: string[]): Promise<Result<ScoreResult>> {
        return this.validatePhase(phaseId);
    }

    /**
     * Effectue un rollback
     */
    async rollback(snapshotId?: string): Promise<Result<void>> {
        // TODO: Intégrer SnapshotManager
        return { success: true };
    }

    /**
     * Liste les mémoires
     */
    async listMemories(): Promise<string[]> {
        // TODO: Scanner le dossier memories/
        return [];
    }

    /**
     * Lit une mémoire
     */
    async readMemory(name: string): Promise<string | null> {
        // TODO: Lire depuis memories/
        return null;
    }

    /**
     * Écrit une mémoire
     */
    async writeMemory(name: string, content: string): Promise<Result<void>> {
        // TODO: Écrire dans memories/
        return { success: true };
    }

    /**
     * Supprime une mémoire
     */
    async deleteMemory(name: string): Promise<Result<void>> {
        // TODO: Supprimer de memories/
        return { success: true };
    }

    /**
     * Récupère le statut système
     */
    async getSystemStatus(): Promise<SystemStatus> {
        return {
            initialized: this.initialized,
            sessionId: 'session_current',
            currentWorkflow: this.currentWorkflow
                ? {
                    id: this.currentWorkflow.id,
                    type: this.currentWorkflow.type,
                    status: this.currentWorkflow.status,
                    currentPhase: this.currentWorkflow.phases[this.currentWorkflow.currentPhaseIndex]?.name || null,
                    progress: this.calculateProgress(),
                }
                : null,
            hooksLoaded: 0, // TODO
            memoriesLoaded: 0, // TODO
            stats: {
                workflowsCompleted: 0,
                workflowsFailed: 0,
                averageScore: 0,
                totalHooksTriggered: 0,
            },
        };
    }

    /**
     * Calcule la progression
     */
    private calculateProgress(): number {
        if (!this.currentWorkflow) return 0;
        const completed = this.currentWorkflow.phases.filter(p => p.status === 'PASS').length;
        return Math.round((completed / this.currentWorkflow.phases.length) * 100);
    }

    /**
     * Vérifie l'initialisation
     */
    private ensureInitialized(): void {
        if (!this.initialized) {
            throw new Error('Orchestrator not initialized. Call initialize() first.');
        }
    }
}

// ============================================================================
// INSTANCE SINGLETON
// ============================================================================

let instance: Orchestrator | null = null;

export function getOrchestrator(projectRoot?: string): Orchestrator {
    if (!instance) {
        instance = new Orchestrator(projectRoot);
    }
    return instance;
}
