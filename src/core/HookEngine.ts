/**
 * HookEngine - Exécution de scripts en réaction aux événements
 *
 * Charge les hooks depuis .claude/orchestrator/hooks.json et les exécute
 * lorsque les événements correspondants sont émis par l'EventBus.
 *
 * Format hooks.json :
 * {
 *   "hooks": [
 *     {
 *       "name": "run-tests-after-code",
 *       "event": "phase:completed",
 *       "command": "npm test",
 *       "condition": { "phaseName": "Code" }
 *     }
 *   ]
 * }
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { EventBus, type EventName } from './EventBus.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// TYPES
// ============================================================================

export interface HookDefinition {
    name: string;
    event: string;
    command: string;
    condition?: Record<string, unknown>;
    timeout?: number;
    enabled?: boolean;
}

export interface HooksConfig {
    hooks: HookDefinition[];
}

export interface HookResult {
    hookName: string;
    event: string;
    success: boolean;
    output?: string;
    error?: string;
    duration: number;
}

// ============================================================================
// HOOK ENGINE
// ============================================================================

export class HookEngine {
    private projectRoot: string;
    private eventBus: EventBus;
    private hooks: HookDefinition[] = [];
    private results: HookResult[] = [];
    private unsubscribe: (() => void) | null = null;

    constructor(projectRoot: string, eventBus: EventBus) {
        this.projectRoot = projectRoot;
        this.eventBus = eventBus;
    }

    /**
     * Charge les hooks et s'abonne aux événements
     */
    async initialize(): Promise<void> {
        await this.loadHooks();
        this.subscribe();
    }

    /**
     * Nombre de hooks chargés
     */
    getLoadedCount(): number {
        return this.hooks.filter(h => h.enabled !== false).length;
    }

    /**
     * Historique des exécutions
     */
    getResults(): HookResult[] {
        return [...this.results];
    }

    /**
     * Recharge les hooks depuis le fichier
     */
    async reload(): Promise<void> {
        this.destroy();
        await this.loadHooks();
        this.subscribe();
    }

    /**
     * Détruit le HookEngine (désinscription)
     */
    destroy(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    // ========================================================================
    // PRIVATE
    // ========================================================================

    private async loadHooks(): Promise<void> {
        const hooksPath = join(this.projectRoot, '.claude', 'orchestrator', 'hooks.json');
        if (!existsSync(hooksPath)) {
            this.hooks = [];
            return;
        }

        try {
            const content = await readFile(hooksPath, 'utf-8');
            const config: HooksConfig = JSON.parse(content);
            this.hooks = config.hooks || [];
        } catch (err) {
            console.error('HookEngine: Failed to load hooks.json:', err);
            this.hooks = [];
        }
    }

    private subscribe(): void {
        this.unsubscribe = this.eventBus.onAny(async (event: string, payload: unknown) => {
            const matchingHooks = this.hooks.filter(
                h => h.enabled !== false && h.event === event,
            );

            for (const hook of matchingHooks) {
                if (this.matchesCondition(hook.condition, payload)) {
                    await this.executeHook(hook, event, payload);
                }
            }
        });
    }

    private matchesCondition(condition: Record<string, unknown> | undefined, payload: unknown): boolean {
        if (!condition) return true;
        if (!payload || typeof payload !== 'object') return false;

        const data = payload as Record<string, unknown>;
        return Object.entries(condition).every(([key, value]) => data[key] === value);
    }

    private async executeHook(hook: HookDefinition, event: string, payload: unknown): Promise<void> {
        const startTime = Date.now();

        try {
            // Injecter le payload comme variable d'environnement
            const env = {
                ...process.env,
                ORCHESTRATOR_EVENT: event,
                ORCHESTRATOR_PAYLOAD: JSON.stringify(payload),
                ORCHESTRATOR_HOOK_NAME: hook.name,
            };

            const { stdout, stderr } = await execFileAsync(
                process.platform === 'win32' ? 'cmd' : 'sh',
                process.platform === 'win32' ? ['/c', hook.command] : ['-c', hook.command],
                {
                    cwd: this.projectRoot,
                    timeout: hook.timeout || 30000,
                    env,
                },
            );

            const duration = Date.now() - startTime;
            const output = (stdout + stderr).trim();

            this.results.push({
                hookName: hook.name,
                event,
                success: true,
                output: output || undefined,
                duration,
            });

            // Garder les 50 derniers résultats
            if (this.results.length > 50) this.results.splice(0, this.results.length - 50);

            await this.eventBus.emit('hook:triggered', { hookName: hook.name, event });
        } catch (err) {
            const duration = Date.now() - startTime;
            const errorMsg = err instanceof Error ? err.message : String(err);

            this.results.push({
                hookName: hook.name,
                event,
                success: false,
                error: errorMsg,
                duration,
            });

            if (this.results.length > 50) this.results.splice(0, this.results.length - 50);

            await this.eventBus.emit('hook:error', { hookName: hook.name, error: errorMsg });
        }
    }
}
