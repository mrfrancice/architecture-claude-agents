/**
 * MemoryManager - Gestion des mémoires persistantes
 *
 * Stocke les mémoires dans .claude/memories/ sous forme de fichiers markdown.
 * Permet le partage de contexte entre agents et entre sessions.
 */

import { readFile, writeFile, readdir, unlink, mkdir, stat } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { existsSync } from 'node:fs';

// ============================================================================
// TYPES
// ============================================================================

export interface MemoryEntry {
    name: string;
    content: string;
    createdAt: string;
    updatedAt: string;
    size: number;
}

export interface MemoryMetadata {
    name: string;
    size: number;
    updatedAt: string;
}

// ============================================================================
// MEMORY MANAGER
// ============================================================================

export class MemoryManager {
    private memoriesDir: string;

    constructor(projectRoot: string) {
        this.memoriesDir = join(projectRoot, '.claude', 'memories');
    }

    /**
     * Initialise le dossier mémoires
     */
    async initialize(): Promise<void> {
        if (!existsSync(this.memoriesDir)) {
            await mkdir(this.memoriesDir, { recursive: true });
        }
    }

    /**
     * Liste toutes les mémoires disponibles
     */
    async list(): Promise<MemoryMetadata[]> {
        if (!existsSync(this.memoriesDir)) return [];

        try {
            const files = await readdir(this.memoriesDir);
            const memories: MemoryMetadata[] = [];

            for (const file of files) {
                if (!file.endsWith('.md') && !file.endsWith('.txt') && !file.endsWith('.json')) {
                    continue;
                }
                const filePath = join(this.memoriesDir, file);
                try {
                    const fileStat = await stat(filePath);
                    memories.push({
                        name: basename(file, extname(file)),
                        size: fileStat.size,
                        updatedAt: fileStat.mtime.toISOString(),
                    });
                } catch {
                    // Ignorer les fichiers illisibles
                }
            }

            return memories;
        } catch {
            return [];
        }
    }

    /**
     * Liste les noms des mémoires
     */
    async listNames(): Promise<string[]> {
        const metas = await this.list();
        return metas.map(m => m.name);
    }

    /**
     * Lit le contenu d'une mémoire
     */
    async read(name: string): Promise<string | null> {
        const filePath = this.resolveMemoryPath(name);
        if (!filePath || !existsSync(filePath)) return null;

        try {
            return await readFile(filePath, 'utf-8');
        } catch {
            return null;
        }
    }

    /**
     * Écrit ou met à jour une mémoire
     */
    async write(name: string, content: string): Promise<void> {
        await this.initialize();
        const safeName = this.sanitizeName(name);
        const ext = extname(safeName) || '.md';
        const fileName = ext === extname(safeName) ? safeName : `${safeName}${ext}`;
        const filePath = join(this.memoriesDir, fileName);
        await writeFile(filePath, content, 'utf-8');
    }

    /**
     * Supprime une mémoire
     */
    async delete(name: string): Promise<boolean> {
        const filePath = this.resolveMemoryPath(name);
        if (!filePath || !existsSync(filePath)) return false;

        try {
            await unlink(filePath);
            return true;
        } catch {
            return false;
        }
    }

    /**
     * Nombre de mémoires chargées
     */
    async count(): Promise<number> {
        const names = await this.listNames();
        return names.length;
    }

    // ========================================================================
    // PRIVATE
    // ========================================================================

    /**
     * Résout le chemin d'une mémoire par son nom
     * Cherche avec différentes extensions
     */
    private resolveMemoryPath(name: string): string | null {
        const safeName = this.sanitizeName(name);
        const extensions = ['.md', '.txt', '.json', ''];

        for (const ext of extensions) {
            const candidate = join(this.memoriesDir, `${safeName}${ext}`);
            if (existsSync(candidate)) return candidate;
        }

        // Essayer avec le nom tel quel
        const direct = join(this.memoriesDir, safeName);
        if (existsSync(direct)) return direct;

        return null;
    }

    /**
     * Nettoie un nom de fichier
     */
    private sanitizeName(name: string): string {
        return name.replace(/[<>:"/\\|?*]/g, '_').trim();
    }
}
