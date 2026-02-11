/**
 * SkillLoader - Charge les skills depuis .claude/skills/*.md
 *
 * Parsing YAML frontmatter identique aux agents :
 * 1. Frontmatter → name, description, arguments
 * 2. Corps markdown → instructions
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import type { SkillDefinition } from '../types/core.js';
import { logInfo, logDebug, logWarn } from '../utils/safe-logger.js';

// ============================================================================
// SKILL LOADER
// ============================================================================

export class SkillLoader {
    private skills = new Map<string, SkillDefinition>();
    private skillsDir: string;
    private initialized = false;

    constructor(projectRoot: string) {
        this.skillsDir = join(projectRoot, '.claude', 'skills');
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            const files = await readdir(this.skillsDir);
            const mdFiles = files.filter(f => extname(f) === '.md');

            for (const file of mdFiles) {
                const filePath = join(this.skillsDir, file);

                try {
                    const content = await readFile(filePath, 'utf-8');
                    const parsed = this.parseFrontmatter(content);

                    if (!parsed.name) {
                        logWarn(`Skipping skill file without name: ${file}`);
                        continue;
                    }

                    const skill: SkillDefinition = {
                        name: parsed.name,
                        description: parsed.description,
                        arguments: parsed.arguments,
                        instructions: parsed.body,
                    };

                    this.skills.set(skill.name, skill);
                    logDebug(`Loaded skill: ${skill.name}`);
                } catch (err) {
                    logWarn(`Failed to parse skill file: ${file}`, err);
                }
            }
        } catch {
            logWarn('Could not read skills directory');
        }

        this.initialized = true;
        logInfo(`SkillLoader initialized: ${this.skills.size} skills loaded`);
    }

    list(): SkillDefinition[] {
        return [...this.skills.values()];
    }

    get(name: string): SkillDefinition | undefined {
        return this.skills.get(name);
    }

    get count(): number {
        return this.skills.size;
    }

    // ========================================================================
    // PARSING
    // ========================================================================

    private parseFrontmatter(content: string): {
        name: string; description: string;
        arguments: SkillDefinition['arguments']; body: string;
    } {
        const trimmed = content.trimStart();
        if (!trimmed.startsWith('---')) {
            return { name: '', description: '', arguments: [], body: content };
        }

        const endIndex = trimmed.indexOf('\n---', 3);
        if (endIndex === -1) {
            return { name: '', description: '', arguments: [], body: content };
        }

        const yamlBlock = trimmed.slice(3, endIndex).trim();
        const body = trimmed.slice(endIndex + 4).trim();

        // Parse top-level fields
        let name = '';
        let description = '';
        const args: SkillDefinition['arguments'] = [];

        const lines = yamlBlock.split('\n');
        let inArguments = false;
        let currentArg: Partial<SkillDefinition['arguments'][0]> | null = null;

        for (const line of lines) {
            // Detect arguments block
            if (line.match(/^arguments\s*:/)) {
                inArguments = true;
                continue;
            }

            if (inArguments) {
                // New argument item (  - name: xxx)
                const argNameMatch = line.match(/^\s+-\s+name\s*:\s*(.+)/);
                if (argNameMatch) {
                    // Flush previous arg
                    if (currentArg?.name) {
                        args.push({
                            name: currentArg.name,
                            description: currentArg.description || '',
                            required: currentArg.required ?? false,
                            default: currentArg.default,
                        });
                    }
                    currentArg = { name: argNameMatch[1].trim().replace(/^["'](.*)["']$/, '$1') };
                    continue;
                }

                // Argument sub-fields
                if (currentArg) {
                    const subMatch = line.match(/^\s+(\w+)\s*:\s*(.+)/);
                    if (subMatch) {
                        const key = subMatch[1];
                        let val = subMatch[2].trim().replace(/^["'](.*)["']$/, '$1');
                        if (key === 'description') currentArg.description = val;
                        else if (key === 'required') currentArg.required = val === 'true';
                        else if (key === 'default') currentArg.default = val;
                        continue;
                    }
                }

                // If we hit a non-indented line, arguments block ended
                if (!line.match(/^\s/) && line.trim() !== '') {
                    // Flush current arg
                    if (currentArg?.name) {
                        args.push({
                            name: currentArg.name,
                            description: currentArg.description || '',
                            required: currentArg.required ?? false,
                            default: currentArg.default,
                        });
                        currentArg = null;
                    }
                    inArguments = false;
                    // Fall through to process this line as top-level
                } else {
                    continue;
                }
            }

            // Top-level key-value
            const kvMatch = line.match(/^(\w+)\s*:\s*(.+)/);
            if (kvMatch) {
                const key = kvMatch[1];
                const val = kvMatch[2].trim().replace(/^["'](.*)["']$/, '$1');
                if (key === 'name') name = val;
                else if (key === 'description') description = val;
            }
        }

        // Flush last arg
        if (currentArg?.name) {
            args.push({
                name: currentArg.name,
                description: currentArg.description || '',
                required: currentArg.required ?? false,
                default: currentArg.default,
            });
        }

        return { name, description, arguments: args, body };
    }
}
