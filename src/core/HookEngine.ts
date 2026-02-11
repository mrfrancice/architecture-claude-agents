/**
 * HookEngine - Charge et exécute les hooks depuis .claude/hooks/*.md
 *
 * Parsing identique aux agents :
 * 1. YAML frontmatter → name, event, match_tools
 * 2. Corps markdown → instructions
 * 3. S'abonne aux événements via EventBus
 * 4. Quand un événement matche, signale via EventBus
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import type { HookDefinition } from '../types/core.js';
import type { EventBus, EventName } from './EventBus.js';
import { logInfo, logDebug, logWarn, logError } from '../utils/safe-logger.js';

// ============================================================================
// FRONTMATTER PARSER (hooks use a slightly different format)
// ============================================================================

interface HookFrontmatter {
    name: string;
    description: string;
    event: string;
    match_tools?: string[];
    match_commands?: string[];
}

function parseHookFrontmatter(content: string): { metadata: HookFrontmatter; body: string } | null {
    // Normalize Windows line endings (\r\n → \n)
    const normalized = content.replace(/\r\n/g, '\n');
    const trimmed = normalized.trimStart();

    // Hooks can have frontmatter either at top or after a # title line
    let yamlBlock: string;
    let body: string;

    if (trimmed.startsWith('---')) {
        // Standard frontmatter at top
        const endIndex = trimmed.indexOf('\n---', 3);
        if (endIndex === -1) return null;
        yamlBlock = trimmed.slice(3, endIndex).trim();
        body = trimmed.slice(endIndex + 4).trim();
    } else {
        // Alternative: # Title\n\n---\nyaml\n---\nbody
        const match = trimmed.match(/^#[^\n]*\n+---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (!match) return null;
        yamlBlock = match[1].trim();
        body = match[2].trim();
    }

    // Parse YAML into a generic record first, then map to typed struct
    const raw: Record<string, string | string[]> = {};
    const lines = yamlBlock.split('\n');
    let currentKey = '';
    let currentList: string[] | null = null;

    for (const line of lines) {
        // List item
        if (line.match(/^\s+-\s+/) && currentList) {
            currentList.push(line.replace(/^\s+-\s+/, '').trim().replace(/^["'](.*)["']$/, '$1'));
            continue;
        }

        // End previous list
        if (currentList && currentKey) {
            raw[currentKey] = currentList;
            currentList = null;
        }

        const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
        if (kvMatch) {
            currentKey = kvMatch[1];
            let value = kvMatch[2].trim();

            if (value === '') {
                // Maybe list follows
                currentList = [];
                continue;
            }

            // Parse inline array ["a", "b"]
            if (value.startsWith('[') && value.endsWith(']')) {
                raw[currentKey] = value
                    .slice(1, -1)
                    .split(',')
                    .map((s: string) => s.trim().replace(/^["'](.*)["']$/, '$1'))
                    .filter((s: string) => s.length > 0);
                continue;
            }

            // Remove quotes
            value = value.replace(/^["'](.*)["']$/, '$1');
            raw[currentKey] = value;
        }
    }

    // Flush remaining list
    if (currentList && currentKey) {
        raw[currentKey] = currentList;
    }

    // Handle nested "hooks:" structure where event/match_tools are inside
    // hooks:
    //   - event: PreToolUse
    //     match_tools: ["Bash"]
    if (!raw.event) {
        const eventMatch = yamlBlock.match(/hooks:\s*\n\s+-\s+event:\s*(\S+)/);
        if (eventMatch) {
            raw.event = eventMatch[1];
        }

        if (!raw.match_tools) {
            const mtMatch = yamlBlock.match(/hooks:[\s\S]*?match_tools:\s*(\[.*?\])/);
            if (mtMatch) {
                raw.match_tools = mtMatch[1]
                    .slice(1, -1)
                    .split(',')
                    .map((s: string) => s.trim().replace(/^["'](.*)["']$/, '$1'))
                    .filter((s: string) => s.length > 0);
            }
        }
    }

    // Map raw record to typed HookFrontmatter
    const asStr = (v: string | string[] | undefined): string =>
        typeof v === 'string' ? v : '';
    const asArr = (v: string | string[] | undefined): string[] | undefined =>
        Array.isArray(v) ? v : undefined;

    const metadata: HookFrontmatter = {
        name: asStr(raw.name),
        description: asStr(raw.description),
        event: asStr(raw.event),
        match_tools: asArr(raw.match_tools),
        match_commands: asArr(raw.match_commands),
    };

    return { metadata, body };
}

// ============================================================================
// HOOK ENGINE
// ============================================================================

export class HookEngine {
    private hooks = new Map<string, HookDefinition>();
    private hooksDir: string;
    private eventBus: EventBus;
    private unsubscribers: Array<() => void> = [];
    private initialized = false;

    constructor(projectRoot: string, eventBus: EventBus) {
        this.hooksDir = join(projectRoot, '.claude', 'hooks');
        this.eventBus = eventBus;
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            const files = await readdir(this.hooksDir);
            const mdFiles = files.filter(f => extname(f) === '.md');

            for (const file of mdFiles) {
                const filePath = join(this.hooksDir, file);

                try {
                    const content = await readFile(filePath, 'utf-8');
                    const parsed = parseHookFrontmatter(content);

                    if (!parsed || !parsed.metadata.name) {
                        logWarn(`Skipping hook file without valid frontmatter: ${file}`);
                        continue;
                    }

                    const { metadata, body } = parsed;

                    const hook: HookDefinition = {
                        name: metadata.name,
                        description: metadata.description || '',
                        event: metadata.event || '',
                        matchTools: metadata.match_tools,
                        instructions: body,
                        enabled: true,
                    };

                    this.hooks.set(hook.name, hook);
                    logDebug(`Loaded hook: ${hook.name} (event: ${hook.event})`);
                } catch (err) {
                    logWarn(`Failed to parse hook file: ${file}`, err);
                }
            }
        } catch {
            logWarn('Could not read hooks directory');
        }

        // Subscribe to events
        this.subscribeToEvents();

        this.initialized = true;
        logInfo(`HookEngine initialized: ${this.hooks.size} hooks loaded`);
    }

    /**
     * Liste tous les hooks.
     */
    list(): HookDefinition[] {
        return [...this.hooks.values()];
    }

    /**
     * Récupère un hook par nom.
     */
    get(name: string): HookDefinition | undefined {
        return this.hooks.get(name);
    }

    /**
     * Active/désactive un hook.
     */
    setEnabled(name: string, enabled: boolean): void {
        const hook = this.hooks.get(name);
        if (hook) {
            hook.enabled = enabled;
            logInfo(`Hook ${name} ${enabled ? 'enabled' : 'disabled'}`);
        }
    }

    /**
     * Nombre de hooks chargés.
     */
    get count(): number {
        return this.hooks.size;
    }

    /**
     * Nettoyage des abonnements.
     */
    destroy(): void {
        for (const unsub of this.unsubscribers) {
            unsub();
        }
        this.unsubscribers = [];
    }

    // ========================================================================
    // EVENT SUBSCRIPTIONS
    // ========================================================================

    private subscribeToEvents(): void {
        // Subscribe to all events and match hooks
        const unsub = this.eventBus.onAny((event, payload) => {
            for (const hook of this.hooks.values()) {
                if (!hook.enabled) continue;
                if (this.matchesHook(hook, event, payload)) {
                    try {
                        this.eventBus.emit('hook:triggered', {
                            hookName: hook.name,
                            event,
                            instructions: hook.instructions,
                        });
                        logDebug(`Hook triggered: ${hook.name} on ${event}`);
                    } catch (err) {
                        this.eventBus.emit('hook:error', {
                            hookName: hook.name,
                            event,
                            error: err instanceof Error ? err.message : String(err),
                        });
                        logError(`Hook error: ${hook.name}`, err);
                    }
                }
            }
        });

        this.unsubscribers.push(unsub);
    }

    private matchesHook(hook: HookDefinition, event: EventName, _payload: unknown): boolean {
        // Skip hook:* events to avoid infinite loops
        if (event.startsWith('hook:')) return false;

        // Match by event name mapping
        const eventMapping: Record<string, EventName[]> = {
            'PreToolUse': ['agent:dispatched', 'phase:started'],
            'PostToolUse': ['phase:completed', 'agent:phaseDispatchCompleted'],
            'workflow': ['workflow:started', 'workflow:completed', 'workflow:failed'],
            'phase': ['phase:started', 'phase:completed', 'phase:failed'],
            'agent': ['agent:dispatched', 'agent:phaseDispatchStarted', 'agent:phaseDispatchCompleted'],
        };

        if (hook.event) {
            const mappedEvents = eventMapping[hook.event];
            if (mappedEvents) {
                return mappedEvents.includes(event);
            }
            // Direct event name match
            return event === hook.event;
        }

        return false;
    }
}
