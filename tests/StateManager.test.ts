import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { StateManager } from '../src/core/StateManager.js';
import type { SessionState, OrchestratorStats } from '../src/core/StateManager.js';
import type { Workflow, WorkflowPhase } from '../src/types/core.js';

// ============================================================================
// HELPERS
// ============================================================================

function createMinimalWorkflow(overrides: Partial<Workflow> = {}): Workflow {
    return {
        id: 'wf-1',
        type: 'BUILD',
        task: 'Test task',
        status: 'RUNNING',
        phases: [],
        currentPhaseIndex: 0,
        totalScore: null,
        createdAt: new Date('2024-01-01'),
        startedAt: new Date('2024-01-01'),
        completedAt: null,
        snapshotId: null,
        context: {
            memories: [],
            userPreferences: {},
            projectInfo: {
                name: 'test',
                type: 'library',
                language: 'typescript',
                framework: null,
                rootPath: '/tmp/test',
            },
        },
        ...overrides,
    };
}

function createSession(overrides: Partial<SessionState> = {}): SessionState {
    return {
        sessionId: 'session-1',
        startedAt: '2024-01-01T00:00:00.000Z',
        currentWorkflowId: 'wf-1',
        ...overrides,
    };
}

function createPhase(overrides: Partial<WorkflowPhase> = {}): WorkflowPhase {
    return {
        id: 'phase-1',
        name: 'Test Phase',
        description: 'A test phase',
        agents: ['architect'],
        dependencies: [],
        status: 'PENDING',
        iteration: 0,
        maxIterations: 3,
        score: null,
        startedAt: null,
        completedAt: null,
        output: null,
        ...overrides,
    };
}

// ============================================================================
// TESTS
// ============================================================================

describe('StateManager', () => {
    let tmpDir: string;
    let manager: StateManager;

    beforeEach(async () => {
        tmpDir = await mkdtemp(join(tmpdir(), 'state-manager-test-'));
        manager = new StateManager(tmpDir);
    });

    afterEach(async () => {
        await rm(tmpDir, { recursive: true, force: true });
    });

    // ========================================================================
    // initialize
    // ========================================================================

    describe('initialize()', () => {
        it('should create dirs and default files', async () => {
            await manager.initialize();

            const stateDir = join(tmpDir, '.claude', 'orchestrator');
            expect(existsSync(stateDir)).toBe(true);

            const statsPath = join(stateDir, 'stats.json');
            expect(existsSync(statsPath)).toBe(true);
            const statsContent = JSON.parse(await readFile(statsPath, 'utf-8'));
            expect(statsContent).toEqual({
                workflowsCompleted: 0,
                workflowsFailed: 0,
                workflowsCancelled: 0,
                totalWorkflows: 0,
                averageScore: 0,
                scoreSum: 0,
                scoreCount: 0,
                totalHooksTriggered: 0,
            });

            const historyPath = join(stateDir, 'history.json');
            expect(existsSync(historyPath)).toBe(true);
            const historyContent = JSON.parse(await readFile(historyPath, 'utf-8'));
            expect(historyContent).toEqual([]);
        });

        it('should be idempotent (no-op on second call)', async () => {
            await manager.initialize();
            // Modify stats to verify second call does not overwrite
            const stats = await manager.getStats();
            stats.totalWorkflows = 42;
            const statsPath = join(tmpDir, '.claude', 'orchestrator', 'stats.json');
            const { writeFile: wf } = await import('node:fs/promises');
            await wf(statsPath, JSON.stringify(stats, null, 2), 'utf-8');

            await manager.initialize();

            const afterStats = await manager.getStats();
            expect(afterStats.totalWorkflows).toBe(42);
        });
    });

    // ========================================================================
    // saveState / loadState
    // ========================================================================

    describe('saveState() / loadState()', () => {
        it('should round-trip state with Date serialization/deserialization', async () => {
            await manager.initialize();

            const session = createSession();
            const workflow = createMinimalWorkflow({
                phases: [
                    createPhase({
                        startedAt: new Date('2024-06-15T10:00:00Z'),
                        completedAt: new Date('2024-06-15T10:30:00Z'),
                    }),
                ],
                startedAt: new Date('2024-06-15T09:00:00Z'),
                completedAt: new Date('2024-06-15T11:00:00Z'),
            });

            await manager.saveState(session, workflow);
            const loaded = await manager.loadState();

            expect(loaded).not.toBeNull();
            expect(loaded!.session).toEqual(session);

            const loadedWf = loaded!.currentWorkflow!;
            // Dates must be restored as Date objects
            expect(loadedWf.createdAt).toBeInstanceOf(Date);
            expect(loadedWf.startedAt).toBeInstanceOf(Date);
            expect(loadedWf.completedAt).toBeInstanceOf(Date);
            expect(loadedWf.createdAt.toISOString()).toBe('2024-01-01T00:00:00.000Z');
            expect(loadedWf.startedAt!.toISOString()).toBe('2024-06-15T09:00:00.000Z');
            expect(loadedWf.completedAt!.toISOString()).toBe('2024-06-15T11:00:00.000Z');

            // Phase dates
            expect(loadedWf.phases[0].startedAt).toBeInstanceOf(Date);
            expect(loadedWf.phases[0].completedAt).toBeInstanceOf(Date);
            expect(loadedWf.phases[0].startedAt!.toISOString()).toBe('2024-06-15T10:00:00.000Z');
            expect(loadedWf.phases[0].completedAt!.toISOString()).toBe('2024-06-15T10:30:00.000Z');
        });

        it('should save state with null workflow', async () => {
            await manager.initialize();

            const session = createSession({ currentWorkflowId: null });
            await manager.saveState(session, null);

            const loaded = await manager.loadState();
            expect(loaded).not.toBeNull();
            expect(loaded!.currentWorkflow).toBeNull();
            expect(loaded!.session.currentWorkflowId).toBeNull();
        });
    });

    describe('loadState()', () => {
        it('should return null when no state file exists', async () => {
            await manager.initialize();
            const result = await manager.loadState();
            expect(result).toBeNull();
        });

        it('should return null on corrupt JSON', async () => {
            await manager.initialize();
            const statePath = join(tmpDir, '.claude', 'orchestrator', 'state.json');
            const { writeFile: wf } = await import('node:fs/promises');
            await wf(statePath, '{ invalid json {{{{', 'utf-8');

            const result = await manager.loadState();
            expect(result).toBeNull();
        });
    });

    // ========================================================================
    // addToHistory / getHistory
    // ========================================================================

    describe('addToHistory()', () => {
        it('should add entries correctly', async () => {
            await manager.initialize();

            const wf = createMinimalWorkflow({
                status: 'COMPLETE',
                totalScore: 85,
                completedAt: new Date('2024-06-15T12:00:00Z'),
                phases: [
                    createPhase({ status: 'PASS' }),
                    createPhase({ id: 'phase-2', status: 'PASS' }),
                ],
            });

            await manager.addToHistory(wf);

            const history = await manager.getHistory();
            expect(history).toHaveLength(1);
            expect(history[0].id).toBe('wf-1');
            expect(history[0].type).toBe('BUILD');
            expect(history[0].task).toBe('Test task');
            expect(history[0].status).toBe('COMPLETE');
            expect(history[0].totalScore).toBe(85);
            expect(history[0].startedAt).toBe('2024-01-01T00:00:00.000Z');
            expect(history[0].completedAt).toBe('2024-06-15T12:00:00.000Z');
            expect(history[0].phasesCount).toBe(2);
            expect(history[0].phasesCompleted).toBe(2);
        });

        it('should add multiple entries', async () => {
            await manager.initialize();

            await manager.addToHistory(createMinimalWorkflow({ id: 'wf-1' }));
            await manager.addToHistory(createMinimalWorkflow({ id: 'wf-2' }));
            await manager.addToHistory(createMinimalWorkflow({ id: 'wf-3' }));

            const history = await manager.getHistory();
            expect(history).toHaveLength(3);
            expect(history[0].id).toBe('wf-1');
            expect(history[1].id).toBe('wf-2');
            expect(history[2].id).toBe('wf-3');
        });

        it('should cap history at 100 entries', async () => {
            await manager.initialize();

            for (let i = 0; i < 105; i++) {
                await manager.addToHistory(createMinimalWorkflow({ id: `wf-${i}` }));
            }

            const history = await manager.getHistory();
            expect(history).toHaveLength(100);
            // Should keep the last 100 entries (indices 5..104)
            expect(history[0].id).toBe('wf-5');
            expect(history[99].id).toBe('wf-104');
        });
    });

    describe('getHistory()', () => {
        it('should return empty array when no history file exists', async () => {
            // Do NOT initialize (so no files are created)
            const freshManager = new StateManager(tmpDir);
            const history = await freshManager.getHistory();
            expect(history).toEqual([]);
        });
    });

    // ========================================================================
    // getStats / updateStats
    // ========================================================================

    describe('getStats()', () => {
        it('should return defaults when no stats file exists', async () => {
            const freshManager = new StateManager(tmpDir);
            const stats = await freshManager.getStats();
            expect(stats).toEqual({
                workflowsCompleted: 0,
                workflowsFailed: 0,
                workflowsCancelled: 0,
                totalWorkflows: 0,
                averageScore: 0,
                scoreSum: 0,
                scoreCount: 0,
                totalHooksTriggered: 0,
            });
        });
    });

    describe('updateStats()', () => {
        it('should increment workflowsCompleted and update averageScore on COMPLETE', async () => {
            await manager.initialize();

            const wf = createMinimalWorkflow({
                status: 'COMPLETE',
                totalScore: 80,
            });

            await manager.updateStats(wf);

            let stats = await manager.getStats();
            expect(stats.workflowsCompleted).toBe(1);
            expect(stats.totalWorkflows).toBe(1);
            expect(stats.scoreSum).toBe(80);
            expect(stats.scoreCount).toBe(1);
            expect(stats.averageScore).toBe(80);

            // Add another with different score
            const wf2 = createMinimalWorkflow({
                id: 'wf-2',
                status: 'COMPLETE',
                totalScore: 60,
            });

            await manager.updateStats(wf2);

            stats = await manager.getStats();
            expect(stats.workflowsCompleted).toBe(2);
            expect(stats.totalWorkflows).toBe(2);
            expect(stats.scoreSum).toBe(140);
            expect(stats.scoreCount).toBe(2);
            expect(stats.averageScore).toBe(70);
        });

        it('should not update score when COMPLETE but totalScore is null', async () => {
            await manager.initialize();

            const wf = createMinimalWorkflow({
                status: 'COMPLETE',
                totalScore: null,
            });

            await manager.updateStats(wf);

            const stats = await manager.getStats();
            expect(stats.workflowsCompleted).toBe(1);
            expect(stats.totalWorkflows).toBe(1);
            expect(stats.scoreSum).toBe(0);
            expect(stats.scoreCount).toBe(0);
            expect(stats.averageScore).toBe(0);
        });

        it('should increment workflowsFailed on FAILED', async () => {
            await manager.initialize();

            const wf = createMinimalWorkflow({ status: 'FAILED' });

            await manager.updateStats(wf);

            const stats = await manager.getStats();
            expect(stats.workflowsFailed).toBe(1);
            expect(stats.totalWorkflows).toBe(1);
            expect(stats.workflowsCompleted).toBe(0);
            expect(stats.workflowsCancelled).toBe(0);
        });

        it('should increment workflowsCancelled on CANCELLED', async () => {
            await manager.initialize();

            const wf = createMinimalWorkflow({ status: 'CANCELLED' });

            await manager.updateStats(wf);

            const stats = await manager.getStats();
            expect(stats.workflowsCancelled).toBe(1);
            expect(stats.totalWorkflows).toBe(1);
            expect(stats.workflowsCompleted).toBe(0);
            expect(stats.workflowsFailed).toBe(0);
        });
    });

    // ========================================================================
    // incrementHooksTriggered
    // ========================================================================

    describe('incrementHooksTriggered()', () => {
        it('should increment the hooks counter', async () => {
            await manager.initialize();

            await manager.incrementHooksTriggered(3);
            let stats = await manager.getStats();
            expect(stats.totalHooksTriggered).toBe(3);

            await manager.incrementHooksTriggered();
            stats = await manager.getStats();
            expect(stats.totalHooksTriggered).toBe(4);

            await manager.incrementHooksTriggered(5);
            stats = await manager.getStats();
            expect(stats.totalHooksTriggered).toBe(9);
        });
    });

    // ========================================================================
    // clearState
    // ========================================================================

    describe('clearState()', () => {
        it('should clear the state file', async () => {
            await manager.initialize();

            const session = createSession();
            const workflow = createMinimalWorkflow();
            await manager.saveState(session, workflow);

            // Verify state was saved
            let loaded = await manager.loadState();
            expect(loaded).not.toBeNull();

            // Clear
            await manager.clearState();

            // State file now contains {}, which is valid JSON but has no
            // currentWorkflow or session structure. loadState reads and
            // attempts to deserialize; it returns the parsed object.
            const statePath = join(tmpDir, '.claude', 'orchestrator', 'state.json');
            const rawContent = await readFile(statePath, 'utf-8');
            expect(JSON.parse(rawContent)).toEqual({});
        });

        it('should be a no-op if state file does not exist', async () => {
            await manager.initialize();
            // clearState when no state.json was ever written should not throw
            await expect(manager.clearState()).resolves.toBeUndefined();
        });
    });
});
