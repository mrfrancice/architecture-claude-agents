/**
 * MemoryManager - CRUD sur les mémoires persistantes du projet
 *
 * Les mémoires sont stockées dans .claude/memories/*.md
 * Elles permettent de conserver le contexte entre sessions
 * et de partager des informations entre agents.
 */

import { readFile, writeFile, readdir, unlink, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { logInfo, logDebug, logError } from '../utils/safe-logger.js';

// ============================================================================
// CONSTANTS
// ============================================================================

const PATH_TRAVERSAL_PATTERN = /\.\.[/\\]/;
const NULL_BYTE_PATTERN = /\0/;
const VALID_NAME_PATTERN = /^[\w][\w. -]{0,198}$/;

// ============================================================================
// MEMORY MANAGER
// ============================================================================

export class MemoryManager {
    private memoriesDir: string;
    private cache = new Map<string, string>();
    private initialized = false;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(projectRoot: string) {
        this.memoriesDir = join(projectRoot, '.claude', 'memories');
    }

    async initialize(): Promise<void> {
        if (this.initialized) return;

        try {
            await mkdir(this.memoriesDir, { recursive: true });
        } catch {
            // Directory may already exist
        }

        await this.refresh();
        this.initialized = true;
        logInfo(`MemoryManager initialized, ${this.cache.size} memories loaded`);
    }

    /**
     * Recharge le cache depuis le disque.
     */
    async refresh(): Promise<void> {
        this.cache.clear();
        try {
            const files = await readdir(this.memoriesDir);
            for (const file of files) {
                if (extname(file) === '.md') {
                    const name = basename(file, '.md');
                    try {
                        const content = await readFile(join(this.memoriesDir, file), 'utf-8');
                        this.cache.set(name, content);
                    } catch (err) {
                        logError(`Failed to read memory ${name}`, err);
                    }
                }
            }
        } catch {
            // Directory may not exist yet
        }
    }

    /**
     * Liste toutes les mémoires disponibles.
     */
    async list(): Promise<string[]> {
        return [...this.cache.keys()].sort();
    }

    /**
     * Lit le contenu d'une mémoire.
     */
    async read(name: string): Promise<string | null> {
        this.validateName(name);
        return this.cache.get(name) ?? null;
    }

    /**
     * Écrit ou met à jour une mémoire.
     * Les écritures sont sérialisées via une write queue pour éviter les race conditions.
     */
    async write(name: string, content: string): Promise<void> {
        this.validateName(name);
        return this.enqueueWrite(async () => {
            const filePath = join(this.memoriesDir, `${name}.md`);
            await writeFile(filePath, content, 'utf-8');
            this.cache.set(name, content);
            logDebug(`Memory written: ${name}`);
        });
    }

    /**
     * Supprime une mémoire.
     * Les écritures sont sérialisées via une write queue pour éviter les race conditions.
     */
    async delete(name: string): Promise<void> {
        this.validateName(name);
        return this.enqueueWrite(async () => {
            const filePath = join(this.memoriesDir, `${name}.md`);
            try {
                await unlink(filePath);
            } catch {
                // File may not exist
            }
            this.cache.delete(name);
            logDebug(`Memory deleted: ${name}`);
        });
    }

    /**
     * Retourne toutes les mémoires sous forme de Record.
     */
    getAll(): Record<string, string> {
        const result: Record<string, string> = {};
        for (const [name, content] of this.cache) {
            result[name] = content;
        }
        return result;
    }

    /**
     * Nombre de mémoires chargées.
     */
    get count(): number {
        return this.cache.size;
    }

    // ========================================================================
    // WRITE QUEUE
    // ========================================================================

    private async enqueueWrite(writeFn: () => Promise<void>): Promise<void> {
        const previous = this.writeQueue;
        this.writeQueue = previous.then(async () => {
            try {
                await writeFn();
            } catch (err) {
                logError(`Memory write failed`, err);
            }
        });
        await this.writeQueue;
    }

    // ========================================================================
    // VALIDATION
    // ========================================================================

    private validateName(name: string): void {
        if (!name || typeof name !== 'string') {
            throw new Error('Memory name must be a non-empty string');
        }
        if (PATH_TRAVERSAL_PATTERN.test(name)) {
            throw new Error('Memory name contains path traversal sequences');
        }
        if (NULL_BYTE_PATTERN.test(name)) {
            throw new Error('Memory name contains null bytes');
        }
        if (!VALID_NAME_PATTERN.test(name)) {
            throw new Error('Memory name contains invalid characters. Use alphanumeric, hyphens, underscores, dots, and spaces.');
        }
    }
}
