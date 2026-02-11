import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MemoryManager } from '../src/core/MemoryManager.js';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';

describe('MemoryManager', () => {
    let tempDir: string;
    let manager: MemoryManager;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'memorymanager-test-'));
        manager = new MemoryManager(tempDir);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it('should create directory on initialize', async () => {
        const memoriesDir = join(tempDir, '.claude', 'memories');
        expect(existsSync(memoriesDir)).toBe(false);
        await manager.initialize();
        expect(existsSync(memoriesDir)).toBe(true);
    });

    it('should return empty list for fresh directory', async () => {
        await manager.initialize();
        const list = await manager.list();
        expect(list).toEqual([]);
    });

    it('should write then read content round-trip', async () => {
        await manager.initialize();
        await manager.write('test-memory', 'Hello, World!');
        const content = await manager.read('test-memory');
        expect(content).toBe('Hello, World!');
    });

    it('should create .md file by default', async () => {
        await manager.initialize();
        await manager.write('my-note', 'Some content');
        const filePath = join(tempDir, '.claude', 'memories', 'my-note.md');
        expect(existsSync(filePath)).toBe(true);
    });

    it('should return metadata with name, size, and updatedAt from list', async () => {
        await manager.initialize();
        await manager.write('note-a', 'content-a');
        const list = await manager.list();
        expect(list).toHaveLength(1);
        expect(list[0].name).toBe('note-a');
        expect(list[0].size).toBeGreaterThan(0);
        expect(list[0].updatedAt).toBeDefined();
        expect(typeof list[0].updatedAt).toBe('string');
    });

    it('should delete an existing file', async () => {
        await manager.initialize();
        await manager.write('to-delete', 'temporary');
        const deleted = await manager.delete('to-delete');
        expect(deleted).toBe(true);
        const content = await manager.read('to-delete');
        expect(content).toBeNull();
    });

    it('should return false when deleting non-existent memory', async () => {
        await manager.initialize();
        const deleted = await manager.delete('does-not-exist');
        expect(deleted).toBe(false);
    });

    it('should return null when reading non-existent memory', async () => {
        await manager.initialize();
        const content = await manager.read('no-such-memory');
        expect(content).toBeNull();
    });

    it('should return correct count', async () => {
        await manager.initialize();
        expect(await manager.count()).toBe(0);
        await manager.write('mem1', 'content1');
        await manager.write('mem2', 'content2');
        await manager.write('mem3', 'content3');
        expect(await manager.count()).toBe(3);
    });

    it('should sanitize special characters in name', async () => {
        await manager.initialize();
        await manager.write('file<>:"/\\|?*name', 'sanitized content');
        const content = await manager.read('file_________name');
        expect(content).toBe('sanitized content');
    });
});
