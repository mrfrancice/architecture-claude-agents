/**
 * AgentRegistry - Charge et gère les agents depuis .claude/agents/*.md
 *
 * Parse les fichiers markdown avec YAML frontmatter pour extraire :
 * - name, model, domain, level, collaborates_with, escalates_to, description
 * - Le corps markdown (après le 2e ---) devient le systemPrompt
 *
 * Fichiers méta (protocols) sont chargés séparément, pas comme agents.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import type { AgentId, AgentDefinition } from '../types/core.js';
import { logInfo, logDebug, logWarn, logError } from '../utils/safe-logger.js';

// ============================================================================
// CONSTANTS
// ============================================================================

/** Fichiers méta qui ne sont pas des agents mais des protocoles */
const META_FILES = new Set([
    'collaboration-protocols',
    'routing-matrix',
    'validation-system',
    'memory-system',
    'task-dependencies',
]);

// ============================================================================
// YAML FRONTMATTER PARSER
// ============================================================================

interface ParsedFrontmatter {
    metadata: Record<string, unknown>;
    body: string;
}

/**
 * Parse un fichier markdown avec frontmatter YAML (entre --- et ---).
 * Implémentation simplifiée sans dépendance externe.
 */
function parseFrontmatter(content: string): ParsedFrontmatter {
    const trimmed = content.trimStart();

    // Check for YAML frontmatter
    if (!trimmed.startsWith('---')) {
        // Try alternative format: # Title then --- block
        const altMatch = trimmed.match(/^#[^\n]*\n+---\n([\s\S]*?)\n---\n([\s\S]*)$/);
        if (altMatch) {
            return {
                metadata: parseSimpleYaml(altMatch[1]),
                body: altMatch[2].trim(),
            };
        }
        return { metadata: {}, body: content };
    }

    // Standard frontmatter: ---\nyaml\n---\nbody
    const endIndex = trimmed.indexOf('\n---', 3);
    if (endIndex === -1) {
        return { metadata: {}, body: content };
    }

    const yamlBlock = trimmed.slice(3, endIndex).trim();
    const body = trimmed.slice(endIndex + 4).trim();

    return {
        metadata: parseSimpleYaml(yamlBlock),
        body,
    };
}

/**
 * Parse simplifié de YAML (couvre les cas du projet : scalaires, listes, strings multilignes).
 */
function parseSimpleYaml(yaml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = yaml.split('\n');
    let currentKey = '';
    let currentList: string[] | null = null;
    let multilineValue = '';
    let inMultiline = false;
    let multilineStyle = ''; // '|' or '>'

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Continue multiline value
        if (inMultiline) {
            if (line.match(/^\S/) && !line.startsWith(' ') && !line.startsWith('\t')) {
                // End of multiline
                result[currentKey] = multilineValue.trim();
                inMultiline = false;
                // Fall through to process this line
            } else {
                const stripped = line.replace(/^ {2}/, '');
                multilineValue += (multilineStyle === '|' ? '\n' : ' ') + stripped;
                continue;
            }
        }

        // List item
        if (line.match(/^\s+-\s+/)) {
            if (currentList) {
                const value = line.replace(/^\s+-\s+/, '').trim();
                // Remove quotes
                currentList.push(value.replace(/^["'](.*)["']$/, '$1'));
            }
            continue;
        }

        // End previous list
        if (currentList && currentKey) {
            result[currentKey] = currentList;
            currentList = null;
        }

        // Key-value pair
        const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
        if (kvMatch) {
            currentKey = kvMatch[1];
            let value = kvMatch[2].trim();

            if (value === '' || value === '|' || value === '>') {
                // Check if next line is a list
                if (i + 1 < lines.length && lines[i + 1].match(/^\s+-\s/)) {
                    currentList = [];
                    continue;
                }
                // Multiline string
                if (value === '|' || value === '>') {
                    inMultiline = true;
                    multilineStyle = value;
                    multilineValue = '';
                    continue;
                }
                result[currentKey] = '';
                continue;
            }

            // Remove quotes
            value = value.replace(/^["'](.*)["']$/, '$1');

            // Parse arrays in brackets: ["a", "b"]
            if (value.startsWith('[') && value.endsWith(']')) {
                const inner = value.slice(1, -1);
                result[currentKey] = inner
                    .split(',')
                    .map(s => s.trim().replace(/^["'](.*)["']$/, '$1'))
                    .filter(s => s.length > 0);
                continue;
            }

            result[currentKey] = value;
        }
    }

    // Flush remaining
    if (currentList && currentKey) {
        result[currentKey] = currentList;
    }
    if (inMultiline && currentKey) {
        result[currentKey] = multilineValue.trim();
    }

    return result;
}

// ============================================================================
// AGENT REGISTRY
// ============================================================================

export class AgentRegistry {
    private agents = new Map<AgentId, AgentDefinition>();
    private protocols = new Map<string, string>();
    private agentsDir: string;
    private initialized = false;

    constructor(projectRoot: string) {
        this.agentsDir = join(projectRoot, '.claude', 'agents');
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            const files = await readdir(this.agentsDir);
            const mdFiles = files.filter(f => extname(f) === '.md');

            for (const file of mdFiles) {
                const name = basename(file, '.md');
                const filePath = join(this.agentsDir, file);

                try {
                    const content = await readFile(filePath, 'utf-8');
                    const { metadata, body } = parseFrontmatter(content);

                    if (META_FILES.has(name)) {
                        // Stocker comme protocole
                        this.protocols.set(name, content);
                        logDebug(`Loaded protocol: ${name}`);
                        continue;
                    }

                    // Construire la définition d'agent
                    const agentName = typeof metadata.name === 'string' ? metadata.name : name;
                    const collabs = (metadata.collaborates_with ?? metadata.integrates_with) as string[] | undefined;

                    const agent: AgentDefinition = {
                        id: agentName,
                        name: agentName,
                        description: this.extractDescription(metadata),
                        systemPrompt: body,
                        capabilities: this.extractCapabilities(metadata, body),
                        model: typeof metadata.model === 'string' ? metadata.model : undefined,
                        domain: typeof metadata.domain === 'string' ? metadata.domain : undefined,
                        level: typeof metadata.level === 'string' ? metadata.level : undefined,
                        collaboratesWith: Array.isArray(collabs) ? collabs : undefined,
                        escalatesTo: typeof metadata.escalates_to === 'string' ? metadata.escalates_to : undefined,
                        builtIn: true,
                    };

                    this.agents.set(agent.id, agent);
                    logDebug(`Loaded agent: ${agent.id} (${agent.domain}/${agent.level})`);
                } catch (err) {
                    logWarn(`Failed to parse agent file: ${file}`, err);
                }
            }
        } catch (err) {
            logWarn('Could not read agents directory', err);
        }

        this.initialized = true;
        logInfo(`AgentRegistry initialized: ${this.agents.size} agents, ${this.protocols.size} protocols`);
    }

    /**
     * Liste tous les agents.
     */
    list(): AgentDefinition[] {
        return [...this.agents.values()];
    }

    /**
     * Récupère un agent par ID.
     */
    get(id: AgentId): AgentDefinition | undefined {
        return this.agents.get(id);
    }

    /**
     * Récupère un agent par ID, lance une erreur si non trouvé.
     */
    getRequired(id: AgentId): AgentDefinition {
        const agent = this.agents.get(id);
        if (!agent) {
            throw new Error(`Agent not found: ${id}`);
        }
        return agent;
    }

    /**
     * Vérifie si un agent existe.
     */
    has(id: AgentId): boolean {
        return this.agents.has(id);
    }

    /**
     * Enregistre un agent dynamiquement.
     */
    register(agent: AgentDefinition): void {
        this.agents.set(agent.id, agent);
        logInfo(`Agent registered: ${agent.id}`);
    }

    /**
     * Récupère un protocole par nom.
     */
    getProtocol(name: string): string | undefined {
        return this.protocols.get(name);
    }

    /**
     * Liste les protocoles disponibles.
     */
    listProtocols(): string[] {
        return [...this.protocols.keys()];
    }

    /**
     * Nombre d'agents chargés.
     */
    get count(): number {
        return this.agents.size;
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    private extractDescription(metadata: Record<string, unknown>): string {
        const desc = metadata.description;
        if (typeof desc === 'string') {
            // Prendre seulement la première ligne/phrase
            const firstLine = desc.split('\n')[0].trim();
            return firstLine || desc.slice(0, 200);
        }
        return '';
    }

    private extractCapabilities(metadata: Record<string, unknown>, body: string): string[] {
        const capabilities: string[] = [];

        if (typeof metadata.domain === 'string') capabilities.push(metadata.domain);
        if (typeof metadata.level === 'string') capabilities.push(metadata.level);

        // Extract capabilities from markdown headings
        const headings = body.match(/^##\s+(.+)$/gm);
        if (headings) {
            for (const h of headings.slice(0, 10)) {
                capabilities.push(h.replace(/^##\s+/, '').trim());
            }
        }

        return capabilities;
    }
}

// ============================================================================
// SINGLETON
// ============================================================================

let instance: AgentRegistry | null = null;

export function getAgentRegistry(projectRoot?: string): AgentRegistry {
    if (!instance) {
        instance = new AgentRegistry(projectRoot || process.cwd());
    }
    return instance;
}
