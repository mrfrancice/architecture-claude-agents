/**
 * EventBus - Bus d'événements typé pour la communication inter-modules
 *
 * Fournit un système pub/sub découplé entre les composants de l'orchestrateur.
 * Chaque handler est protégé par un try/catch pour éviter la propagation d'erreurs.
 */

import { logError, logDebug } from '../utils/safe-logger.js';

// ============================================================================
// EVENT TYPES
// ============================================================================

export interface OrchestratorEvents {
    'workflow:started': { workflowId: string; type: string; task: string };
    'workflow:paused': { workflowId: string };
    'workflow:resumed': { workflowId: string };
    'workflow:cancelled': { workflowId: string };
    'workflow:completed': { workflowId: string; totalScore: number | null };
    'workflow:failed': { workflowId: string; error: string };

    'phase:started': { workflowId: string; phaseId: string; phaseName: string; iteration: number };
    'phase:completed': { workflowId: string; phaseId: string; phaseName: string; score: number | null; decision: string };
    'phase:iterating': { workflowId: string; phaseId: string; phaseName: string; iteration: number; feedback: string[] };
    'phase:failed': { workflowId: string; phaseId: string; phaseName: string; error: string };

    'agent:dispatched': { workflowId: string; phaseId: string; agentId: string; mode: string; duration: number; status: string };
    'agent:phaseDispatchStarted': { workflowId: string; phaseId: string; agentIds: string[]; mode: string };
    'agent:phaseDispatchCompleted': { workflowId: string; phaseId: string; results: number; mode: string };

    'score:calculated': { workflowId: string; phaseId: string; total: number; decision: string };

    'snapshot:created': { snapshotId: string; description: string };
    'snapshot:restored': { snapshotId: string };

    'memory:written': { name: string };
    'memory:deleted': { name: string };

    'hook:triggered': { hookName: string; event: string; instructions: string };
    'hook:error': { hookName: string; event: string; error: string };
}

export type EventName = keyof OrchestratorEvents;
type EventHandler<E extends EventName> = (payload: OrchestratorEvents[E]) => void;
type AnyEventHandler = (event: EventName, payload: unknown) => void;

// ============================================================================
// EVENT BUS
// ============================================================================

export class EventBus {
    private handlers = new Map<EventName, Set<EventHandler<any>>>();
    private onceHandlers = new Map<EventName, Set<EventHandler<any>>>();
    private anyHandlers = new Set<AnyEventHandler>();

    /**
     * S'abonner à un événement. Retourne une fonction de désinscription.
     */
    on<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
        if (!this.handlers.has(event)) {
            this.handlers.set(event, new Set());
        }
        this.handlers.get(event)!.add(handler);

        return () => {
            this.handlers.get(event)?.delete(handler);
        };
    }

    /**
     * S'abonner à un événement pour une seule émission.
     */
    once<E extends EventName>(event: E, handler: EventHandler<E>): () => void {
        if (!this.onceHandlers.has(event)) {
            this.onceHandlers.set(event, new Set());
        }
        this.onceHandlers.get(event)!.add(handler);

        return () => {
            this.onceHandlers.get(event)?.delete(handler);
        };
    }

    /**
     * Émettre un événement. Chaque handler est protégé individuellement.
     */
    emit<E extends EventName>(event: E, payload: OrchestratorEvents[E]): void {
        logDebug(`Event emitted: ${event}`);

        // Handlers persistants
        const handlers = this.handlers.get(event);
        if (handlers) {
            for (const handler of handlers) {
                try {
                    handler(payload);
                } catch (err) {
                    logError(`EventBus handler error for ${event}`, err);
                }
            }
        }

        // Handlers one-shot
        const onceHandlers = this.onceHandlers.get(event);
        if (onceHandlers) {
            const snapshot = [...onceHandlers];
            onceHandlers.clear();
            for (const handler of snapshot) {
                try {
                    handler(payload);
                } catch (err) {
                    logError(`EventBus once-handler error for ${event}`, err);
                }
            }
        }

        // Any handlers
        for (const handler of this.anyHandlers) {
            try {
                handler(event, payload);
            } catch (err) {
                logError(`EventBus any-handler error for ${event}`, err);
            }
        }
    }

    /**
     * S'abonner à TOUS les événements. Utile pour les hooks et le logging.
     */
    onAny(handler: AnyEventHandler): () => void {
        this.anyHandlers.add(handler);
        return () => {
            this.anyHandlers.delete(handler);
        };
    }

    /**
     * Supprime tous les abonnements.
     */
    clear(): void {
        this.handlers.clear();
        this.onceHandlers.clear();
        this.anyHandlers.clear();
    }

    /**
     * Retourne le nombre total d'abonnements.
     */
    get listenerCount(): number {
        let count = 0;
        for (const set of this.handlers.values()) count += set.size;
        for (const set of this.onceHandlers.values()) count += set.size;
        count += this.anyHandlers.size;
        return count;
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
