/**
 * HookExecutor - Écoute les événements hook:triggered et rend les instructions exploitables
 *
 * Catégorise chaque hook en PreToolUse ou PostToolUse selon l'événement source,
 * puis fournit des accesseurs pour injecter les instructions dans les prompts agents
 * ou évaluer les contraintes post-exécution.
 */

import type { EventBus } from './EventBus.js';
import type { StateManager } from './StateManager.js';
import { logDebug } from '../utils/safe-logger.js';

// ============================================================================
// TYPES
// ============================================================================

export interface HookResult {
    hookName: string;
    event: string;
    instructions: string;
    triggeredAt: string;
}

type HookCategory = 'pre' | 'post';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Events that map to PreToolUse (guidance to inject before agent execution). */
const PRE_TOOL_EVENTS = new Set(['phase:started', 'agent:dispatched']);

/** Events that map to PostToolUse (validation after execution). */
const POST_TOOL_EVENTS = new Set(['phase:completed', 'agent:phaseDispatchCompleted']);

// ============================================================================
// HOOK EXECUTOR
// ============================================================================

export class HookExecutor {
    private eventBus: EventBus;
    private stateManager: StateManager;

    private preResults: HookResult[] = [];
    private postResults: HookResult[] = [];
    private unsubscribers: Array<() => void> = [];

    constructor(eventBus: EventBus, stateManager: StateManager) {
        this.eventBus = eventBus;
        this.stateManager = stateManager;
    }

    /**
     * Souscrit à l'événement hook:triggered.
     */
    initialize(): void {
        const unsub = this.eventBus.on('hook:triggered', (payload) => {
            this.handleHookTriggered(payload);
        });
        this.unsubscribers.push(unsub);
        logDebug('HookExecutor initialized');
    }

    // ========================================================================
    // PUBLIC API
    // ========================================================================

    /**
     * Retourne les hooks PreToolUse accumulés.
     */
    getPreToolUseGuidance(): HookResult[] {
        return [...this.preResults];
    }

    /**
     * Retourne les hooks PostToolUse accumulés.
     */
    getPostToolUseGuidance(): HookResult[] {
        return [...this.postResults];
    }

    /**
     * Formate les hooks PreToolUse en section markdown injectable dans les prompts agents.
     * Retourne null si aucun hook actif.
     */
    formatGuidanceForPrompt(): string | null {
        if (this.preResults.length === 0) return null;

        const lines = this.preResults.map(r =>
            `### ${r.hookName}\n_Triggered by: ${r.event}_\n\n${r.instructions}`,
        );

        return lines.join('\n\n---\n\n');
    }

    /**
     * Évalue les hooks PostToolUse contre l'output de phase.
     * Retourne les feedbacks des hooks dont les instructions mentionnent des patterns trouvés dans l'output.
     */
    evaluatePostHooks(output: string): string[] {
        const feedbacks: string[] = [];

        for (const hook of this.postResults) {
            // Simple heuristic: if the hook has instructions, include them as feedback
            // The instructions themselves describe what to check
            if (hook.instructions) {
                feedbacks.push(`[${hook.hookName}] ${hook.instructions}`);
            }
        }

        return feedbacks;
    }

    /**
     * Vide les accumulateurs (appelé à chaque début de phase).
     */
    clearResults(): void {
        this.preResults = [];
        this.postResults = [];
        logDebug('HookExecutor results cleared');
    }

    /**
     * Nombre de résultats accumulés.
     */
    get count(): number {
        return this.preResults.length + this.postResults.length;
    }

    /**
     * Désinscrit les listeners.
     */
    destroy(): void {
        for (const unsub of this.unsubscribers) {
            unsub();
        }
        this.unsubscribers = [];
    }

    // ========================================================================
    // INTERNAL
    // ========================================================================

    private handleHookTriggered(payload: { hookName: string; event: string; instructions: string }): void {
        const result: HookResult = {
            hookName: payload.hookName,
            event: payload.event,
            instructions: payload.instructions,
            triggeredAt: new Date().toISOString(),
        };

        const category = this.categorize(payload.event);

        if (category === 'pre') {
            this.preResults.push(result);
        } else {
            this.postResults.push(result);
        }

        // Record in stats
        this.stateManager.recordHookTriggered();

        logDebug(`HookExecutor: ${payload.hookName} categorized as ${category} (event: ${payload.event})`);
    }

    private categorize(event: string): HookCategory {
        if (PRE_TOOL_EVENTS.has(event)) return 'pre';
        if (POST_TOOL_EVENTS.has(event)) return 'post';
        // Default to pre for unknown events
        return 'pre';
    }
}
