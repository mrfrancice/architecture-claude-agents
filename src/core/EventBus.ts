/**
 * EventBus - Système d'événements typés pour l'orchestrateur
 *
 * Permet aux composants de communiquer via des événements sans couplage direct.
 */

import type {
    WorkflowId,
    PhaseId,
    AgentId,
    WorkflowType,
    WorkflowStatus,
    PhaseStatus,
    ScoreResult,
    SnapshotId,
    DispatchMode,
    DispatchResult,
} from '../types/core.js';

// ============================================================================
// EVENT TYPES
// ============================================================================

export interface OrchestratorEvents {
    'workflow:started': { workflowId: WorkflowId; type: WorkflowType; task: string };
    'workflow:paused': { workflowId: WorkflowId };
    'workflow:resumed': { workflowId: WorkflowId };
    'workflow:cancelled': { workflowId: WorkflowId };
    'workflow:completed': { workflowId: WorkflowId; totalScore: number | null };
    'workflow:failed': { workflowId: WorkflowId; reason: string };
    'workflow:statusChanged': { workflowId: WorkflowId; from: WorkflowStatus; to: WorkflowStatus };

    'phase:started': { workflowId: WorkflowId; phaseId: PhaseId; name: string; iteration: number };
    'phase:completed': { workflowId: WorkflowId; phaseId: PhaseId; status: PhaseStatus; score: number | null };
    'phase:iterating': { workflowId: WorkflowId; phaseId: PhaseId; iteration: number; maxIterations: number; feedback: string[] };
    'phase:failed': { workflowId: WorkflowId; phaseId: PhaseId; reason: string };
    'phase:skipped': { workflowId: WorkflowId; phaseId: PhaseId; reason: string };

    'score:calculated': { workflowId: WorkflowId; phaseId: PhaseId; result: ScoreResult };

    'snapshot:created': { snapshotId: SnapshotId; workflowId: WorkflowId; phaseId: PhaseId };
    'snapshot:restored': { snapshotId: SnapshotId };

    'memory:written': { name: string };
    'memory:deleted': { name: string };

    'hook:triggered': { hookName: string; event: string };
    'hook:error': { hookName: string; error: string };

    'agent:phaseDispatchStarted': { workflowId: WorkflowId; phaseId: PhaseId; agents: AgentId[]; mode: DispatchMode };
    'agent:dispatched': { workflowId: WorkflowId; phaseId: PhaseId; agentId: AgentId; result: DispatchResult };
    'agent:phaseDispatchCompleted': { workflowId: WorkflowId; phaseId: PhaseId; agentCount: number; mode: DispatchMode };
}

export type EventName = keyof OrchestratorEvents;
export type EventPayload<E extends EventName> = OrchestratorEvents[E];
export type EventHandler<E extends EventName> = (payload: EventPayload<E>) => void | Promise<void>;

// ============================================================================
// EVENT BUS
// ============================================================================

export class EventBus {
    private handlers = new Map<string, Array<EventHandler<never>>>();
    private hookCallbacks: Array<(event: string, payload: unknown) => void | Promise<void>> = [];
    private totalTriggered = 0;

    /**
     * Enregistre un handler pour un événement
     */
    on<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
        const list = this.handlers.get(event) || [];
        list.push(handler as EventHandler<never>);
        this.handlers.set(event, list);

        // Retourne une fonction de désinscription
        return () => {
            const idx = list.indexOf(handler as EventHandler<never>);
            if (idx >= 0) list.splice(idx, 1);
        };
    }

    /**
     * Enregistre un handler qui ne s'exécute qu'une fois
     */
    once<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
        const off = this.on(event, ((payload: EventPayload<E>) => {
            off();
            return handler(payload);
        }) as EventHandler<E>);
        return off;
    }

    /**
     * Émet un événement
     */
    async emit<E extends EventName>(event: E, payload: EventPayload<E>): Promise<void> {
        this.totalTriggered++;

        const list = this.handlers.get(event) || [];
        for (const handler of list) {
            try {
                await (handler as EventHandler<E>)(payload);
            } catch (err) {
                console.error(`EventBus handler error for ${event}:`, err);
            }
        }

        // Notifier les hook callbacks
        for (const cb of this.hookCallbacks) {
            try {
                await cb(event, payload);
            } catch (err) {
                console.error(`EventBus hook callback error for ${event}:`, err);
            }
        }
    }

    /**
     * Enregistre un callback global pour les hooks
     */
    onAny(callback: (event: string, payload: unknown) => void | Promise<void>): () => void {
        this.hookCallbacks.push(callback);
        return () => {
            const idx = this.hookCallbacks.indexOf(callback);
            if (idx >= 0) this.hookCallbacks.splice(idx, 1);
        };
    }

    /**
     * Nombre total d'événements émis
     */
    getTotalTriggered(): number {
        return this.totalTriggered;
    }

    /**
     * Supprime tous les handlers
     */
    clear(): void {
        this.handlers.clear();
        this.hookCallbacks = [];
    }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: EventBus | null = null;

export function getEventBus(): EventBus {
    if (!instance) {
        instance = new EventBus();
    }
    return instance;
}
