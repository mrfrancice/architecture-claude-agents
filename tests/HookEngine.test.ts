import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { HookEngine } from '../src/core/HookEngine.js';
import { EventBus } from '../src/core/EventBus.js';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('HookEngine', () => {
    let tempDir: string;
    let eventBus: EventBus;
    let engine: HookEngine;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'hookengine-test-'));
        eventBus = new EventBus();
        engine = new HookEngine(tempDir, eventBus);
    });

    afterEach(async () => {
        engine.destroy();
        await rm(tempDir, { recursive: true, force: true });
    });

    async function createHooksFile(hooks: unknown[]): Promise<void> {
        const hooksDir = join(tempDir, '.claude', 'orchestrator');
        await mkdir(hooksDir, { recursive: true });
        await writeFile(
            join(hooksDir, 'hooks.json'),
            JSON.stringify({ hooks }),
        );
    }

    it('should return 0 from getLoadedCount when no hooks.json exists', async () => {
        await engine.initialize();
        expect(engine.getLoadedCount()).toBe(0);
    });

    it('should load hooks from hooks.json correctly', async () => {
        await createHooksFile([
            { name: 'test-hook', event: 'workflow:completed', command: 'echo done' },
            { name: 'another-hook', event: 'workflow:failed', command: 'echo fail' },
        ]);
        await engine.initialize();
        expect(engine.getLoadedCount()).toBe(2);
    });

    it('should exclude disabled hooks from getLoadedCount', async () => {
        await createHooksFile([
            { name: 'enabled-hook', event: 'workflow:completed', command: 'echo done' },
            { name: 'disabled-hook', event: 'workflow:failed', command: 'echo fail', enabled: false },
        ]);
        await engine.initialize();
        expect(engine.getLoadedCount()).toBe(1);
    });

    it('should unsubscribe from events on destroy', async () => {
        await createHooksFile([
            { name: 'test-hook', event: 'workflow:completed', command: 'echo done' },
        ]);
        await engine.initialize();
        engine.destroy();

        // After destroy, emitting should not trigger hooks.
        // We verify by checking that no new results appear after emitting.
        const resultsBefore = engine.getResults().length;
        await eventBus.emit('workflow:completed', { workflowId: 'wf1', totalScore: 100 });
        // Give a tick for any async processing
        await new Promise(r => setTimeout(r, 50));
        expect(engine.getResults().length).toBe(resultsBefore);
    });

    it('should return empty results initially', async () => {
        await engine.initialize();
        expect(engine.getResults()).toEqual([]);
    });

    it('should reload hooks from file', async () => {
        await createHooksFile([
            { name: 'hook-v1', event: 'workflow:completed', command: 'echo v1' },
        ]);
        await engine.initialize();
        expect(engine.getLoadedCount()).toBe(1);

        // Update hooks file with additional hook
        await createHooksFile([
            { name: 'hook-v1', event: 'workflow:completed', command: 'echo v1' },
            { name: 'hook-v2', event: 'workflow:failed', command: 'echo v2' },
        ]);
        await engine.reload();
        expect(engine.getLoadedCount()).toBe(2);
    });
});
