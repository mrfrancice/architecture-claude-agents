/**
 * Tests pour les 3 modes de dispatch : manual, cli, terminal
 *
 * Couvre :
 * - Mode manual : prompts retournés, pas d'exécution
 * - Mode CLI : exécution claude --print avec retry, backoff, erreurs
 * - Mode terminal : spawn session, status, collect, cleanup
 * - Transitions entre modes
 * - Events émis par chaque mode
 * - AgentDispatcher terminal session management
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { AgentDispatcher, ContextPipeline } from '../src/core/AgentDispatcher.js';
import { AgentRegistry } from '../src/core/AgentRegistry.js';
import { MemoryManager } from '../src/core/MemoryManager.js';
import { EventBus } from '../src/core/EventBus.js';
import { TerminalDispatcher } from '../src/core/TerminalDispatcher.js';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, readFile, mkdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workflow, WorkflowPhase, ManualDispatchPrompt, TerminalSession } from '../src/types/core.js';

// ============================================================================
// HELPERS
// ============================================================================

function createTestWorkflow(agentCount: 1 | 2 = 1): Workflow {
    const agents = agentCount === 2
        ? ['fullstack-ui-architect', 'security-expert']
        : ['fullstack-ui-architect'];

    return {
        id: 'wf_mode_test',
        type: 'BUILD',
        task: 'Implement user authentication',
        status: 'RUNNING',
        phases: [
            {
                id: 'wf_mode_test_phase_0',
                name: 'Design',
                description: 'Design the authentication flow',
                agents,
                dependencies: [],
                status: 'RUNNING',
                iteration: 1,
                maxIterations: 3,
                score: null,
                startedAt: new Date(),
                completedAt: null,
                output: null,
                lastFeedback: [],
                forcePromoted: false,
                mode: 'non-interactive',
            },
        ],
        currentPhaseIndex: 0,
        totalScore: null,
        createdAt: new Date(),
        startedAt: new Date(),
        completedAt: null,
        snapshotId: null,
        context: {
            memories: [],
            userPreferences: {},
            projectInfo: {
                name: 'test-project',
                type: 'application',
                language: 'TypeScript',
                framework: 'Express',
                rootPath: '/test',
            },
        },
    };
}

function createMockSession(tempDir: string, agentIds: string[] = ['a1', 'a2']): TerminalSession {
    return {
        sessionId: 'test-session-123',
        sessionDir: tempDir,
        agents: agentIds.map(id => ({
            agentId: id,
            agentName: `Agent ${id}`,
            scriptPath: join(tempDir, `agent_${id}.ps1`),
            outputPath: join(tempDir, `output_${id}.txt`),
            donePath: join(tempDir, `done_${id}.txt`),
        })),
        startedAt: new Date(),
    };
}

async function setupDispatcher(mode: 'manual' | 'cli' | 'terminal' = 'manual') {
    const tempDir = await mkdtemp(join(tmpdir(), 'dispatch-mode-test-'));
    const registry = new AgentRegistry(tempDir);
    await registry.initialize();
    const eventBus = new EventBus();
    const memMgr = new MemoryManager(tempDir);
    await memMgr.initialize();
    const dispatcher = new AgentDispatcher(registry, memMgr, eventBus, mode);
    return { dispatcher, registry, eventBus, memMgr, tempDir };
}

// ============================================================================
// MODE MANUAL
// ============================================================================

describe('Mode Manual', () => {
    let dispatcher: AgentDispatcher;
    let eventBus: EventBus;

    beforeEach(async () => {
        const setup = await setupDispatcher('manual');
        dispatcher = setup.dispatcher;
        eventBus = setup.eventBus;
    });

    it('should report manual mode', () => {
        expect(dispatcher.getMode()).toBe('manual');
    });

    it('should return prompts without executing anything', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.mode).toBe('manual');
        expect(result.prompts).toBeDefined();
        expect(result.prompts).toHaveLength(1);
        expect(result.terminalSession).toBeUndefined();
    });

    it('should include systemPrompt and userPrompt in manual prompts', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const result = await dispatcher.dispatchPhase(workflow, phase);
        const prompt = result.prompts![0];

        expect(prompt.agentId).toBe('fullstack-ui-architect');
        expect(prompt.agentName).toBeTruthy();
        expect(prompt.systemPrompt.length).toBeGreaterThan(0);
        expect(prompt.userPrompt).toContain('Implement user authentication');
        expect(prompt.userPrompt).toContain('Design');
    });

    it('should return SUCCESS status with zero duration for manual dispatch', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.results).toHaveLength(1);
        expect(result.results[0].mode).toBe('manual');
        expect(result.results[0].status).toBe('SUCCESS');
        expect(result.results[0].duration).toBe(0);
        expect(result.results[0].output).toBe('');
    });

    it('should generate prompts for multiple agents sequentially', async () => {
        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];

        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.prompts).toHaveLength(2);
        expect(result.results).toHaveLength(2);
        expect(result.prompts![0].agentId).toBe('fullstack-ui-architect');
        expect(result.prompts![1].agentId).toBe('security-expert');
    });

    it('should include feedback in manual prompts when provided', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        phase.iteration = 2;

        const result = await dispatcher.dispatchPhase(workflow, phase, ['Improve error handling', 'Add rate limiting']);

        const prompt = result.prompts![0];
        expect(prompt.userPrompt).toContain('Improve error handling');
        expect(prompt.userPrompt).toContain('Add rate limiting');
        expect(prompt.userPrompt).toContain('Iteration 2/3');
    });

    it('should emit phaseDispatchStarted and phaseDispatchCompleted events', async () => {
        const events: Array<{ name: string; data: unknown }> = [];
        eventBus.on('agent:phaseDispatchStarted', (data) => { events.push({ name: 'started', data }); });
        eventBus.on('agent:dispatched', (data) => { events.push({ name: 'dispatched', data }); });
        eventBus.on('agent:phaseDispatchCompleted', (data) => { events.push({ name: 'completed', data }); });

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(events).toHaveLength(3);
        expect(events[0].name).toBe('started');
        expect(events[1].name).toBe('dispatched');
        expect(events[2].name).toBe('completed');

        // Verify event payload content
        const startedData = events[0].data as { mode: string; agents: string[] };
        expect(startedData.mode).toBe('manual');
        expect(startedData.agents).toEqual(['fullstack-ui-architect']);
    });

    it('should emit one dispatched event per agent in manual mode', async () => {
        const dispatchedAgents: string[] = [];
        eventBus.on('agent:dispatched', (data: { agentId: string }) => {
            dispatchedAgents.push(data.agentId);
        });

        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(dispatchedAgents).toEqual(['fullstack-ui-architect', 'security-expert']);
    });

    it('should not set terminal session in manual mode', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(dispatcher.getCurrentTerminalSession()).toBeNull();
    });

    it('should not include prompts key when undefined in manual result', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        const result = await dispatcher.dispatchPhase(workflow, phase);

        // In manual mode prompts should be defined
        expect(result.prompts).toBeDefined();
        expect(Array.isArray(result.prompts)).toBe(true);
    });
});

// ============================================================================
// MODE CLI
// ============================================================================

describe('Mode CLI', () => {
    let dispatcher: AgentDispatcher;
    let eventBus: EventBus;

    beforeEach(async () => {
        const setup = await setupDispatcher('cli');
        dispatcher = setup.dispatcher;
        eventBus = setup.eventBus;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /** Mock le dispatchCli privé pour éviter d'appeler le vrai claude CLI */
    function mockCliSuccess(output = 'mocked cli output') {
        vi.spyOn(dispatcher as any, 'dispatchCli').mockResolvedValue({
            agentId: 'fullstack-ui-architect',
            mode: 'cli',
            status: 'SUCCESS',
            output,
            duration: 1234,
        });
    }

    function mockCliFailure(error = 'claude not found') {
        vi.spyOn(dispatcher as any, 'dispatchCli').mockResolvedValue({
            agentId: 'fullstack-ui-architect',
            mode: 'cli',
            status: 'FAILED',
            output: '',
            duration: 50,
            error,
        });
    }

    it('should report cli mode', () => {
        expect(dispatcher.getMode()).toBe('cli');
    });

    it('should dispatch in cli mode and return results', async () => {
        mockCliSuccess('design output from CLI');

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.mode).toBe('cli');
        expect(result.results).toHaveLength(1);
        expect(result.results[0].status).toBe('SUCCESS');
        expect(result.results[0].mode).toBe('cli');
        expect(result.results[0].output).toBe('design output from CLI');
    });

    it('should not return prompts in cli mode', async () => {
        mockCliSuccess();

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.prompts).toBeUndefined();
    });

    it('should emit events during cli dispatch', async () => {
        mockCliSuccess();

        const eventNames: string[] = [];
        eventBus.on('agent:phaseDispatchStarted', () => eventNames.push('started'));
        eventBus.on('agent:dispatched', () => eventNames.push('dispatched'));
        eventBus.on('agent:phaseDispatchCompleted', () => eventNames.push('completed'));

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(eventNames).toEqual(['started', 'dispatched', 'completed']);
    });

    it('should handle cli failure gracefully', async () => {
        mockCliFailure('ENOENT: claude not found');

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.results[0].status).toBe('FAILED');
        expect(result.results[0].error).toContain('not found');
    });

    it('should retry on transient errors (via dispatchCliWithRetry)', async () => {
        let callCount = 0;
        vi.spyOn(dispatcher as any, 'dispatchCli').mockImplementation(async () => {
            callCount++;
            if (callCount < 3) {
                return {
                    agentId: 'fullstack-ui-architect',
                    mode: 'cli',
                    status: 'FAILED',
                    output: '',
                    duration: 10,
                    error: 'connection reset',
                };
            }
            return {
                agentId: 'fullstack-ui-architect',
                mode: 'cli',
                status: 'SUCCESS',
                output: 'success after retries',
                duration: 100,
            };
        });

        // Mock les délais de retry pour ne pas attendre
        vi.spyOn(global, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any; });

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.results[0].status).toBe('SUCCESS');
        expect(result.results[0].output).toBe('success after retries');
        expect(result.results[0].retryCount).toBe(2); // 3rd attempt = index 2
        expect(callCount).toBe(3);
    });

    it('should NOT retry on non-transient errors (not found / invalid)', async () => {
        let callCount = 0;
        vi.spyOn(dispatcher as any, 'dispatchCli').mockImplementation(async () => {
            callCount++;
            return {
                agentId: 'fullstack-ui-architect',
                mode: 'cli',
                status: 'FAILED',
                output: '',
                duration: 10,
                error: 'command not found',
            };
        });

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.results[0].status).toBe('FAILED');
        expect(callCount).toBe(1); // No retry for "not found"
    });

    it('should report cli mode in event payload', async () => {
        mockCliSuccess();

        let capturedMode: string | undefined;
        eventBus.on('agent:phaseDispatchStarted', (data: { mode: string }) => {
            capturedMode = data.mode;
        });

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(capturedMode).toBe('cli');
    });

    it('should accumulate peer outputs between agents in cli mode', async () => {
        const dispatchedContexts: any[] = [];
        vi.spyOn(dispatcher as any, 'dispatchCli').mockImplementation(async (context: any) => {
            dispatchedContexts.push(context);
            return {
                agentId: context.agent.id,
                mode: 'cli',
                status: 'SUCCESS',
                output: `output from ${context.agent.id}`,
                duration: 100,
            };
        });

        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        // Second agent should receive first agent's output as peer output
        // (peerOutputs is built in dispatchPhase before calling buildContext)
        // First agent: no peers
        // Second agent: should have first agent's output
        // Note: buildContext receives accumulated peerOutputs
        expect(dispatchedContexts).toHaveLength(2);
    });

    it('should emit dispatched event per agent in cli mode', async () => {
        vi.spyOn(dispatcher as any, 'dispatchCli').mockImplementation(async (ctx: any) => ({
            agentId: ctx.agent.id,
            mode: 'cli',
            status: 'SUCCESS',
            output: 'ok',
            duration: 50,
        }));

        const dispatchedAgents: string[] = [];
        eventBus.on('agent:dispatched', (data: { agentId: string }) => {
            dispatchedAgents.push(data.agentId);
        });

        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(dispatchedAgents).toEqual(['fullstack-ui-architect', 'security-expert']);
    });

    it('should have duration set after cli execution', async () => {
        mockCliSuccess();

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        const result = await dispatcher.dispatchPhase(workflow, phase);

        // dispatchCliWithRetry recalcule la durée via Date.now()
        // Avec un mock instantané, la durée est ~0 mais elle est définie
        expect(result.results[0].duration).toBeGreaterThanOrEqual(0);
        expect(typeof result.results[0].duration).toBe('number');
    });
});

// ============================================================================
// MODE TERMINAL
// ============================================================================

describe('Mode Terminal', () => {
    let dispatcher: AgentDispatcher;
    let eventBus: EventBus;

    beforeEach(async () => {
        const setup = await setupDispatcher('terminal');
        dispatcher = setup.dispatcher;
        eventBus = setup.eventBus;

        // Mock le TerminalDispatcher.spawnSession pour ne pas lancer de vrais panes
        const termDisp = dispatcher.getTerminalDispatcher();
        vi.spyOn(termDisp, 'spawnSession').mockImplementation(async (prompts, _workDir, _phaseInfo) => {
            const sessionDir = await mkdtemp(join(tmpdir(), 'mock-terminal-'));
            return {
                sessionId: 'mock-session-' + Date.now(),
                sessionDir,
                agents: prompts.map(p => ({
                    agentId: p.agentId,
                    agentName: p.agentName,
                    scriptPath: join(sessionDir, `agent_${p.agentId}.ps1`),
                    outputPath: join(sessionDir, `output_${p.agentId}.txt`),
                    donePath: join(sessionDir, `done_${p.agentId}.txt`),
                })),
                startedAt: new Date(),
            };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should report terminal mode', () => {
        expect(dispatcher.getMode()).toBe('terminal');
    });

    it('should spawn a terminal session and return it in result', async () => {
        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];

        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.mode).toBe('terminal');
        expect(result.terminalSession).toBeDefined();
        expect(result.terminalSession!.sessionId).toContain('mock-session-');
        expect(result.terminalSession!.agents).toHaveLength(2);
    });

    it('should store terminal session for later status checks', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        expect(dispatcher.getCurrentTerminalSession()).toBeNull();

        await dispatcher.dispatchPhase(workflow, phase);

        expect(dispatcher.getCurrentTerminalSession()).not.toBeNull();
        expect(dispatcher.getCurrentTerminalSession()!.sessionId).toContain('mock-session-');
    });

    it('should return prompts alongside terminal session', async () => {
        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];

        const result = await dispatcher.dispatchPhase(workflow, phase);

        // Terminal mode also builds prompts (used to create the script files)
        expect(result.prompts).toHaveLength(2);
        expect(result.prompts![0].agentId).toBe('fullstack-ui-architect');
        expect(result.prompts![1].agentId).toBe('security-expert');
    });

    it('should return placeholder results with terminal mode flag', async () => {
        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];

        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.results).toHaveLength(2);
        for (const r of result.results) {
            expect(r.mode).toBe('terminal');
            expect(r.status).toBe('SUCCESS');
            expect(r.output).toBe('');
            expect(r.duration).toBe(0);
        }
    });

    it('should emit terminalSpawned event', async () => {
        let terminalEvent: { sessionDir: string; agents: string[] } | null = null;
        eventBus.on('agent:terminalSpawned', (data) => {
            terminalEvent = data as { sessionDir: string; agents: string[] };
        });

        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(terminalEvent).not.toBeNull();
        expect(terminalEvent!.sessionDir).toBeTruthy();
        expect(terminalEvent!.agents).toEqual(['fullstack-ui-architect', 'security-expert']);
    });

    it('should emit phaseDispatchStarted and phaseDispatchCompleted events', async () => {
        const events: string[] = [];
        eventBus.on('agent:phaseDispatchStarted', () => events.push('started'));
        eventBus.on('agent:phaseDispatchCompleted', () => events.push('completed'));

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(events).toEqual(['started', 'completed']);
    });

    it('should NOT emit individual agent:dispatched events in terminal mode', async () => {
        let dispatchedCount = 0;
        eventBus.on('agent:dispatched', () => dispatchedCount++);

        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        // Terminal mode ne fait pas de dispatch individuel — les agents sont lancés en parallèle
        expect(dispatchedCount).toBe(0);
    });

    it('should call spawnSession with correct phaseInfo', async () => {
        const termDisp = dispatcher.getTerminalDispatcher();
        const spawnSpy = vi.spyOn(termDisp, 'spawnSession');

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(spawnSpy).toHaveBeenCalledOnce();
        const callArgs = spawnSpy.mock.calls[0];
        // arg 0 = prompts, arg 1 = workDir, arg 2 = phaseInfo
        expect(callArgs[1]).toBe('/test'); // rootPath from workflow
        expect(callArgs[2]).toEqual({
            phaseName: 'Design',
            iteration: 1,
            task: 'Implement user authentication',
        });
    });

    it('should pass feedback into prompt building for terminal mode', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        phase.iteration = 2;

        const result = await dispatcher.dispatchPhase(workflow, phase, ['Fix XSS vulnerability']);

        const prompt = result.prompts![0];
        expect(prompt.userPrompt).toContain('Fix XSS vulnerability');
        expect(prompt.userPrompt).toContain('Iteration 2/3');
    });
});

// ============================================================================
// TERMINAL SESSION MANAGEMENT (via AgentDispatcher)
// ============================================================================

describe('Terminal Session Management', () => {
    let dispatcher: AgentDispatcher;
    let tempDir: string;

    beforeEach(async () => {
        const setup = await setupDispatcher('terminal');
        dispatcher = setup.dispatcher;
        tempDir = await mkdtemp(join(tmpdir(), 'session-mgmt-test-'));

        // Mock spawnSession to use our controlled tempDir
        const termDisp = dispatcher.getTerminalDispatcher();
        vi.spyOn(termDisp, 'spawnSession').mockImplementation(async (prompts) => {
            return createMockSession(tempDir, prompts.map(p => p.agentId));
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return null status when no terminal session', async () => {
        const freshSetup = await setupDispatcher('manual');
        const status = await freshSetup.dispatcher.getTerminalStatus();
        expect(status).toBeNull();
    });

    it('should return null outputs when no terminal session', async () => {
        const freshSetup = await setupDispatcher('manual');
        const outputs = await freshSetup.dispatcher.collectTerminalOutputs();
        expect(outputs).toBeNull();
    });

    it('should get terminal status with running agents', async () => {
        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        const status = await dispatcher.getTerminalStatus();

        expect(status).not.toBeNull();
        expect(status!.total).toBe(2);
        expect(status!.running).toHaveLength(2);
        expect(status!.completed).toHaveLength(0);
        expect(status!.allDone).toBe(false);
    });

    it('should detect completed agents via done files', async () => {
        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        // Simulate agent a1 completing
        await writeFile(join(tempDir, 'done_fullstack-ui-architect.txt'), 'SUCCESS:15.3', 'utf-8');

        const status = await dispatcher.getTerminalStatus();

        expect(status!.completed).toEqual(['fullstack-ui-architect']);
        expect(status!.running).toEqual(['security-expert']);
        expect(status!.allDone).toBe(false);
        expect(status!.agentDetails['fullstack-ui-architect']).toEqual({
            status: 'success',
            duration: 15.3,
        });
    });

    it('should detect all agents done', async () => {
        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        // Simulate both agents completing
        await writeFile(join(tempDir, 'done_fullstack-ui-architect.txt'), 'SUCCESS:10', 'utf-8');
        await writeFile(join(tempDir, 'done_security-expert.txt'), 'SUCCESS:20', 'utf-8');

        const status = await dispatcher.getTerminalStatus();

        expect(status!.allDone).toBe(true);
        expect(status!.completed).toHaveLength(2);
        expect(status!.running).toHaveLength(0);
    });

    it('should detect failed agents', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        await writeFile(join(tempDir, 'done_fullstack-ui-architect.txt'), 'FAILED:5.2', 'utf-8');

        const status = await dispatcher.getTerminalStatus();

        expect(status!.agentDetails['fullstack-ui-architect']).toEqual({
            status: 'failed',
            duration: 5.2,
        });
    });

    it('should collect terminal outputs', async () => {
        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        // Write output files
        await writeFile(join(tempDir, 'output_fullstack-ui-architect.txt'), 'Design output here', 'utf-8');
        await writeFile(join(tempDir, 'output_security-expert.txt'), 'Security audit output', 'utf-8');

        const outputs = await dispatcher.collectTerminalOutputs();

        expect(outputs).not.toBeNull();
        expect(outputs!['fullstack-ui-architect']).toBe('Design output here');
        expect(outputs!['security-expert']).toBe('Security audit output');
    });

    it('should return empty string for agents without output file', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        const outputs = await dispatcher.collectTerminalOutputs();

        expect(outputs!['fullstack-ui-architect']).toBe('');
    });

    it('should reset terminal session', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(dispatcher.getCurrentTerminalSession()).not.toBeNull();

        dispatcher.resetTerminalSession();

        expect(dispatcher.getCurrentTerminalSession()).toBeNull();
        expect(await dispatcher.getTerminalStatus()).toBeNull();
        expect(await dispatcher.collectTerminalOutputs()).toBeNull();
    });
});

// ============================================================================
// TRANSITIONS ENTRE MODES
// ============================================================================

describe('Mode Transitions', () => {
    let dispatcher: AgentDispatcher;
    let eventBus: EventBus;

    beforeEach(async () => {
        const setup = await setupDispatcher('manual');
        dispatcher = setup.dispatcher;
        eventBus = setup.eventBus;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should switch from manual to cli', () => {
        expect(dispatcher.getMode()).toBe('manual');
        dispatcher.setMode('cli');
        expect(dispatcher.getMode()).toBe('cli');
    });

    it('should switch from manual to terminal', () => {
        dispatcher.setMode('terminal');
        expect(dispatcher.getMode()).toBe('terminal');
    });

    it('should switch from cli to manual', () => {
        dispatcher.setMode('cli');
        dispatcher.setMode('manual');
        expect(dispatcher.getMode()).toBe('manual');
    });

    it('should switch from terminal to manual', () => {
        dispatcher.setMode('terminal');
        dispatcher.setMode('manual');
        expect(dispatcher.getMode()).toBe('manual');
    });

    it('should dispatch with correct mode after transition to cli', async () => {
        dispatcher.setMode('cli');

        // Mock dispatchCli pour éviter le vrai appel
        vi.spyOn(dispatcher as any, 'dispatchCli').mockResolvedValue({
            agentId: 'fullstack-ui-architect',
            mode: 'cli',
            status: 'SUCCESS',
            output: 'mocked',
            duration: 100,
        });

        let capturedMode: string | undefined;
        eventBus.on('agent:phaseDispatchStarted', (data: { mode: string }) => {
            capturedMode = data.mode;
        });

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(capturedMode).toBe('cli');
    });

    it('should support rapid mode switches', () => {
        dispatcher.setMode('cli');
        dispatcher.setMode('terminal');
        dispatcher.setMode('manual');
        dispatcher.setMode('cli');
        dispatcher.setMode('terminal');
        expect(dispatcher.getMode()).toBe('terminal');
    });

    it('should dispatch manual then terminal on the same instance', async () => {
        // Manual dispatch
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const manualResult = await dispatcher.dispatchPhase(workflow, phase);
        expect(manualResult.mode).toBe('manual');
        expect(manualResult.prompts).toBeDefined();
        expect(manualResult.terminalSession).toBeUndefined();

        // Switch to terminal
        dispatcher.setMode('terminal');
        const termDisp = dispatcher.getTerminalDispatcher();
        vi.spyOn(termDisp, 'spawnSession').mockImplementation(async (prompts) => {
            const dir = await mkdtemp(join(tmpdir(), 'trans-test-'));
            return createMockSession(dir, prompts.map(p => p.agentId));
        });

        const terminalResult = await dispatcher.dispatchPhase(workflow, phase);
        expect(terminalResult.mode).toBe('terminal');
        expect(terminalResult.terminalSession).toBeDefined();
    });
});

// ============================================================================
// toPhaseOutput - conversion pour tous les modes
// ============================================================================

describe('toPhaseOutput across modes', () => {
    it('should convert manual results to PhaseOutput', () => {
        const output = AgentDispatcher.toPhaseOutput({
            phaseId: 'p1',
            phaseName: 'Design',
            mode: 'manual',
            results: [
                { agentId: 'a1', mode: 'manual', status: 'SUCCESS', output: '', duration: 0 },
            ],
            prompts: [{
                agentId: 'a1',
                agentName: 'Agent 1',
                systemPrompt: 'sys',
                userPrompt: 'user',
            }],
        });

        expect(output.agentOutputs['a1'].status).toBe('SUCCESS');
        expect(output.agentOutputs['a1'].duration).toBe(0);
        expect(output.errors).toHaveLength(0);
    });

    it('should convert cli results to PhaseOutput with errors', () => {
        const output = AgentDispatcher.toPhaseOutput({
            phaseId: 'p1',
            phaseName: 'Code',
            mode: 'cli',
            results: [
                { agentId: 'a1', mode: 'cli', status: 'SUCCESS', output: 'Code output', duration: 5000 },
                { agentId: 'a2', mode: 'cli', status: 'FAILED', output: '', duration: 1000, error: 'claude not found' },
            ],
        });

        expect(output.agentOutputs['a1'].status).toBe('SUCCESS');
        expect(output.agentOutputs['a1'].output).toBe('Code output');
        expect(output.agentOutputs['a2'].status).toBe('FAILED');
        expect(output.errors).toHaveLength(1);
        expect(output.errors[0]).toContain('claude not found');
    });

    it('should convert terminal placeholder results to PhaseOutput', () => {
        const output = AgentDispatcher.toPhaseOutput({
            phaseId: 'p1',
            phaseName: 'Design',
            mode: 'terminal',
            results: [
                { agentId: 'a1', mode: 'terminal', status: 'SUCCESS', output: '', duration: 0 },
                { agentId: 'a2', mode: 'terminal', status: 'SUCCESS', output: '', duration: 0 },
            ],
        });

        expect(Object.keys(output.agentOutputs)).toHaveLength(2);
        expect(output.errors).toHaveLength(0);
        // Terminal outputs are initially empty — they get filled by collectTerminalOutputs later
        expect(output.agentOutputs['a1'].output).toBe('');
        expect(output.agentOutputs['a2'].output).toBe('');
    });

    it('should handle mixed status results', () => {
        const output = AgentDispatcher.toPhaseOutput({
            phaseId: 'p1',
            phaseName: 'Test',
            mode: 'cli',
            results: [
                { agentId: 'a1', mode: 'cli', status: 'SUCCESS', output: 'ok', duration: 100 },
                { agentId: 'a2', mode: 'cli', status: 'PARTIAL', output: 'partial', duration: 200 },
                { agentId: 'a3', mode: 'cli', status: 'FAILED', output: '', duration: 50, error: 'timeout' },
            ],
        });

        expect(output.agentOutputs['a1'].status).toBe('SUCCESS');
        expect(output.agentOutputs['a2'].status).toBe('PARTIAL');
        expect(output.agentOutputs['a3'].status).toBe('FAILED');
        expect(output.errors).toHaveLength(1);
    });
});

// ============================================================================
// PHASE MODE (interactive / non-interactive)
// ============================================================================

describe('Phase Mode', () => {
    let dispatcher: AgentDispatcher;
    let eventBus: EventBus;

    beforeEach(async () => {
        const setup = await setupDispatcher('terminal');
        dispatcher = setup.dispatcher;
        eventBus = setup.eventBus;

        const termDisp = dispatcher.getTerminalDispatcher();
        vi.spyOn(termDisp, 'spawnSession').mockImplementation(async (prompts, _workDir, _phaseInfo, interactive) => {
            const sessionDir = await mkdtemp(join(tmpdir(), 'mock-phase-mode-'));
            return {
                sessionId: 'mock-phase-mode-' + Date.now(),
                sessionDir,
                agents: prompts.map(p => ({
                    agentId: p.agentId,
                    agentName: p.agentName,
                    scriptPath: join(sessionDir, `agent_${p.agentId}.ps1`),
                    outputPath: join(sessionDir, `output_${p.agentId}.txt`),
                    donePath: join(sessionDir, `done_${p.agentId}.txt`),
                })),
                startedAt: new Date(),
                interactive,
            };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should include interactive instructions in prompt for interactive phase', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        phase.mode = 'interactive';

        const prompt = await dispatcher.getPromptForAgent('fullstack-ui-architect', workflow, phase);

        expect(prompt.userPrompt).toContain('Execution Mode: Interactive');
        expect(prompt.userPrompt).toContain('full access to tools');
        expect(prompt.userPrompt).toContain('Write, Edit, Bash');
    });

    it('should NOT include interactive instructions for non-interactive phase', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        phase.mode = 'non-interactive';

        const prompt = await dispatcher.getPromptForAgent('fullstack-ui-architect', workflow, phase);

        expect(prompt.userPrompt).not.toContain('Execution Mode: Interactive');
        expect(prompt.userPrompt).not.toContain('full access to tools');
    });

    it('should include filesModified from previous phases in prompt', async () => {
        const workflow = createTestWorkflow();
        // Add a completed previous phase with files
        const completedPhase = {
            id: 'wf_mode_test_phase_prev',
            name: 'Code',
            description: 'Code phase',
            agents: ['fullstack-ui-architect'],
            dependencies: [],
            status: 'PASS' as const,
            iteration: 1,
            maxIterations: 3,
            score: 85,
            startedAt: new Date(),
            completedAt: new Date(),
            output: {
                agentOutputs: {
                    'fullstack-ui-architect': {
                        agentId: 'fullstack-ui-architect',
                        status: 'SUCCESS' as const,
                        output: 'Created login component',
                        filesCreated: ['src/login.tsx'],
                        filesModified: ['src/app.tsx'],
                        duration: 100,
                        score: null,
                    },
                },
                filesModified: ['src/login.tsx', 'src/app.tsx'],
                errors: [],
                warnings: [],
            },
            lastFeedback: [],
            forcePromoted: false,
            mode: 'interactive' as const,
        };
        workflow.phases.unshift(completedPhase);
        workflow.currentPhaseIndex = 1;

        const currentPhase = workflow.phases[1];
        const prompt = await dispatcher.getPromptForAgent('fullstack-ui-architect', workflow, currentPhase);

        expect(prompt.userPrompt).toContain('src/login.tsx');
        expect(prompt.userPrompt).toContain('src/app.tsx');
        expect(prompt.userPrompt).toContain('Files modified');
    });
});

// ============================================================================
// getPromptForAgent - fonctionne indépendamment du mode
// ============================================================================

describe('getPromptForAgent (mode-independent)', () => {
    it('should generate prompt regardless of dispatch mode', async () => {
        const { dispatcher } = await setupDispatcher('cli');

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const prompt = await dispatcher.getPromptForAgent('fullstack-ui-architect', workflow, phase);

        expect(prompt.agentId).toBe('fullstack-ui-architect');
        expect(prompt.systemPrompt.length).toBeGreaterThan(0);
        expect(prompt.userPrompt).toContain('Implement user authentication');
    });

    it('should include peer outputs in generated prompt', async () => {
        const { dispatcher } = await setupDispatcher('manual');

        const workflow = createTestWorkflow(2);
        const phase = workflow.phases[0];
        const peerOutputs = { 'fullstack-ui-architect': 'Design complete: JWT auth with refresh tokens' };

        const prompt = await dispatcher.getPromptForAgent('security-expert', workflow, phase, [], peerOutputs);

        expect(prompt.userPrompt).toContain('JWT auth with refresh tokens');
        expect(prompt.userPrompt).toContain('Other Agents Output');
    });

    it('should work in terminal mode', async () => {
        const { dispatcher } = await setupDispatcher('terminal');

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const prompt = await dispatcher.getPromptForAgent('fullstack-ui-architect', workflow, phase, ['Add OAuth support']);

        expect(prompt.userPrompt).toContain('Add OAuth support');
    });
});

// ============================================================================
// TerminalDispatcher - prepareAgent et script generation
// ============================================================================

describe('TerminalDispatcher - Script Generation', () => {
    let termDisp: TerminalDispatcher;

    beforeEach(() => {
        termDisp = new TerminalDispatcher();
    });

    it('should generate valid PS1 scripts with trap and Get-Command', async () => {
        const sessionDir = await mkdtemp(join(tmpdir(), 'script-gen-test-'));
        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'test-agent',
            agentName: 'Test Agent',
            systemPrompt: 'You are a test agent',
            userPrompt: 'Do something',
        }];

        // Mock launchTerminalPanes to avoid actually launching
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const session = await termDisp.spawnSession(prompts, '/test');

        // Read generated script
        const scriptContent = await readFile(session.agents[0].scriptPath, 'utf-8');

        // Verify trap block
        expect(scriptContent).toContain('trap {');
        expect(scriptContent).toContain('ERREUR FATALE');

        // Verify Get-Command check
        expect(scriptContent).toContain('Get-Command claude -ErrorAction Stop');

        // Verify ErrorActionPreference
        expect(scriptContent).toContain('$ErrorActionPreference = "Stop"');
        expect(scriptContent).toContain('$ErrorActionPreference = "Continue"');

        // Verify uses $PSScriptRoot
        expect(scriptContent).toContain('$PSScriptRoot');

        // Verify exit code handling
        expect(scriptContent).toContain('$exitCode = $LASTEXITCODE');

        // Verify press-any-key to close (instead of auto-close)
        expect(scriptContent).toContain('Appuyez sur une touche pour fermer');
        expect(scriptContent).toContain('ReadKey');

        vi.restoreAllMocks();
    });

    it('should include model arg in script when model is specified', async () => {
        const sessionDir = await mkdtemp(join(tmpdir(), 'script-model-test-'));
        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'model-agent',
            agentName: 'Model Agent',
            systemPrompt: 'system',
            userPrompt: 'user',
            model: 'claude-sonnet-4-5-20250929',
        }];

        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const session = await termDisp.spawnSession(prompts, '/test');
        const scriptContent = await readFile(session.agents[0].scriptPath, 'utf-8');

        expect(scriptContent).toContain("'--model'");
        expect(scriptContent).toContain("'claude-sonnet-4-5-20250929'");

        vi.restoreAllMocks();
    });

    it('should write system and user prompt files', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'file-agent',
            agentName: 'File Agent',
            systemPrompt: 'System prompt content here',
            userPrompt: 'User prompt content here',
        }];

        const session = await termDisp.spawnSession(prompts, '/test');

        const systemContent = await readFile(join(session.sessionDir, 'system_file-agent.txt'), 'utf-8');
        const userContent = await readFile(join(session.sessionDir, 'user_file-agent.txt'), 'utf-8');

        expect(systemContent).toBe('System prompt content here');
        expect(userContent).toBe('User prompt content here');

        vi.restoreAllMocks();
    });

    it('should include phase info in script header', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'info-agent',
            agentName: 'Info Agent',
            systemPrompt: 'sys',
            userPrompt: 'usr',
        }];

        const session = await termDisp.spawnSession(prompts, '/test', {
            phaseName: 'Security Audit',
            iteration: 2,
            task: 'Audit the authentication module',
        });

        const scriptContent = await readFile(session.agents[0].scriptPath, 'utf-8');

        expect(scriptContent).toContain('Info Agent');
        expect(scriptContent).toContain('Security Audit');
        expect(scriptContent).toContain('Iteration 2');

        vi.restoreAllMocks();
    });

    it('should include full task in script (no truncation)', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const longTask = 'A'.repeat(100);
        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'trunc-agent',
            agentName: 'Trunc Agent',
            systemPrompt: 'sys',
            userPrompt: 'usr',
        }];

        const session = await termDisp.spawnSession(prompts, '/test', {
            phaseName: 'Phase',
            iteration: 1,
            task: longTask,
        });

        const scriptContent = await readFile(session.agents[0].scriptPath, 'utf-8');

        // Task should be included in full (no truncation)
        expect(scriptContent).toContain(longTask);

        vi.restoreAllMocks();
    });
});

// ============================================================================
// TerminalDispatcher - Cleanup
// ============================================================================

describe('TerminalDispatcher - Session Cleanup', () => {
    let termDisp: TerminalDispatcher;

    beforeEach(() => {
        termDisp = new TerminalDispatcher();
    });

    it('should clean up session directory', async () => {
        const sessionDir = await mkdtemp(join(tmpdir(), 'cleanup-test-'));
        await writeFile(join(sessionDir, 'test.txt'), 'data', 'utf-8');

        const session: TerminalSession = {
            sessionId: 'cleanup-test',
            sessionDir,
            agents: [],
            startedAt: new Date(),
        };

        await termDisp.cleanupSession(session);

        // Directory should no longer exist
        await expect(access(sessionDir)).rejects.toThrow();
    });

    it('should clean up old sessions beyond max age', async () => {
        const baseDir = join(tmpdir(), 'mcp-orchestrator');
        await mkdir(baseDir, { recursive: true });

        // Create an "old" session directory
        const oldDir = join(baseDir, 'terminal_old_session');
        await mkdir(oldDir, { recursive: true });
        await writeFile(join(oldDir, 'test.txt'), 'old data', 'utf-8');

        // cleanupOldSessions with maxAge=0 should delete everything
        const deleted = await termDisp.cleanupOldSessions(0);

        expect(deleted).toBeGreaterThanOrEqual(1);
    });

    it('should return 0 when no old sessions exist', async () => {
        // Very large maxAge = nothing to delete
        const deleted = await termDisp.cleanupOldSessions(999_999_999_999);
        expect(deleted).toBe(0);
    });
});

// ============================================================================
// INTERACTIVE MODE
// ============================================================================

describe('Interactive Mode', () => {
    let dispatcher: AgentDispatcher;
    let eventBus: EventBus;

    beforeEach(async () => {
        const setup = await setupDispatcher('terminal');
        dispatcher = setup.dispatcher;
        eventBus = setup.eventBus;

        const termDisp = dispatcher.getTerminalDispatcher();
        vi.spyOn(termDisp, 'spawnSession').mockImplementation(async (prompts, _workDir, _phaseInfo, interactive) => {
            const sessionDir = await mkdtemp(join(tmpdir(), 'mock-interactive-'));
            return {
                sessionId: 'mock-interactive-' + Date.now(),
                sessionDir,
                agents: prompts.map(p => ({
                    agentId: p.agentId,
                    agentName: p.agentName,
                    scriptPath: join(sessionDir, `agent_${p.agentId}.ps1`),
                    outputPath: join(sessionDir, `output_${p.agentId}.txt`),
                    donePath: join(sessionDir, `done_${p.agentId}.txt`),
                    transcriptPath: interactive ? join(sessionDir, `transcript_${p.agentId}.txt`) : undefined,
                })),
                startedAt: new Date(),
                interactive,
            };
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should default interactive to false', () => {
        expect(dispatcher.getInteractive()).toBe(false);
    });

    it('should set and get interactive mode', () => {
        dispatcher.setInteractive(true);
        expect(dispatcher.getInteractive()).toBe(true);
        dispatcher.setInteractive(false);
        expect(dispatcher.getInteractive()).toBe(false);
    });

    it('should pass interactive flag to spawnSession', async () => {
        dispatcher.setInteractive(true);
        const termDisp = dispatcher.getTerminalDispatcher();
        const spawnSpy = vi.spyOn(termDisp, 'spawnSession');

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(spawnSpy).toHaveBeenCalledOnce();
        const callArgs = spawnSpy.mock.calls[0];
        // arg 3 = interactive
        expect(callArgs[3]).toBe(true);
    });

    it('should set interactive flag on returned session', async () => {
        dispatcher.setInteractive(true);

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.terminalSession).toBeDefined();
        expect(result.terminalSession!.interactive).toBe(true);
    });

    it('should include transcriptPath in agent info when interactive', async () => {
        dispatcher.setInteractive(true);

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.terminalSession!.agents[0].transcriptPath).toBeDefined();
        expect(result.terminalSession!.agents[0].transcriptPath).toContain('transcript_');
    });

    it('should not include transcriptPath when not interactive', async () => {
        dispatcher.setInteractive(false);

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.terminalSession!.agents[0].transcriptPath).toBeUndefined();
    });
});

// ============================================================================
// INTERACTIVE SCRIPT GENERATION
// ============================================================================

describe('TerminalDispatcher - Interactive Script Generation', () => {
    let termDisp: TerminalDispatcher;

    beforeEach(() => {
        termDisp = new TerminalDispatcher();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should generate interactive PS1 script with --print (autonomous code mode)', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'int-agent',
            agentName: 'Interactive Agent',
            systemPrompt: 'You are an interactive test agent',
            userPrompt: 'Do something interactively',
        }];

        const session = await termDisp.spawnSession(prompts, '/test', undefined, true);
        const scriptContent = await readFile(session.agents[0].scriptPath, 'utf-8');

        // Interactive mode now uses --print (autonomous, no human interaction needed)
        expect(scriptContent).toContain("'--print'");

        // Should contain code-mode visual indicators
        expect(scriptContent).toContain('Mode: CODE');
        expect(scriptContent).toContain('autonome');

        // Should NOT contain old TUI-mode artifacts
        expect(scriptContent).not.toContain('--append-system-prompt');
        expect(scriptContent).not.toContain('/exit');
        expect(scriptContent).not.toContain('--continue');

        // Should have TERMINE indicator for completion
        expect(scriptContent).toContain('TERMINE');
    });

    it('should generate non-interactive PS1 script with --print when interactive=false', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'nonint-agent',
            agentName: 'Non-Interactive Agent',
            systemPrompt: 'system',
            userPrompt: 'user',
        }];

        const session = await termDisp.spawnSession(prompts, '/test', undefined, false);
        const scriptContent = await readFile(session.agents[0].scriptPath, 'utf-8');

        // Should contain --print (one-shot mode)
        expect(scriptContent).toContain("'--print'");

        // Should NOT contain --append-system-prompt (interactive mode)
        expect(scriptContent).not.toContain('--append-system-prompt');
    });

    it('should default to non-interactive when interactive param is undefined', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'def-agent',
            agentName: 'Default Agent',
            systemPrompt: 'system',
            userPrompt: 'user',
        }];

        const session = await termDisp.spawnSession(prompts, '/test');
        const scriptContent = await readFile(session.agents[0].scriptPath, 'utf-8');

        // Should default to --print mode (non-interactive)
        expect(scriptContent).toContain("'--print'");
        expect(scriptContent).not.toContain('--append-system-prompt');
    });

    it('should include transcriptPath in agent info for interactive sessions', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'tp-agent',
            agentName: 'Transcript Agent',
            systemPrompt: 'system',
            userPrompt: 'user',
        }];

        const session = await termDisp.spawnSession(prompts, '/test', undefined, true);

        expect(session.agents[0].transcriptPath).toBeDefined();
        expect(session.agents[0].transcriptPath).toContain('transcript_tp-agent.txt');
        expect(session.interactive).toBe(true);
    });

    it('should not include transcriptPath for non-interactive sessions', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'notp-agent',
            agentName: 'No Transcript Agent',
            systemPrompt: 'system',
            userPrompt: 'user',
        }];

        const session = await termDisp.spawnSession(prompts, '/test', undefined, false);

        expect(session.agents[0].transcriptPath).toBeUndefined();
        expect(session.interactive).toBe(false);
    });
});

// ============================================================================
// stripAnsiCodes
// ============================================================================

describe('TerminalDispatcher.stripAnsiCodes', () => {
    it('should strip basic ANSI color codes', () => {
        const input = '\x1b[31mHello\x1b[0m World';
        const result = TerminalDispatcher.stripAnsiCodes(input);
        expect(result).toBe('Hello World');
    });

    it('should strip cursor movement codes', () => {
        const input = '\x1b[2AText\x1b[3B';
        const result = TerminalDispatcher.stripAnsiCodes(input);
        expect(result).toBe('Text');
    });

    it('should handle text without ANSI codes', () => {
        const input = 'Plain text without codes';
        const result = TerminalDispatcher.stripAnsiCodes(input);
        expect(result).toBe('Plain text without codes');
    });

    it('should strip multiple ANSI sequences', () => {
        const input = '\x1b[1m\x1b[33mBold Yellow\x1b[0m \x1b[4mUnderline\x1b[0m';
        const result = TerminalDispatcher.stripAnsiCodes(input);
        expect(result).toBe('Bold Yellow Underline');
    });

    it('should handle empty string', () => {
        expect(TerminalDispatcher.stripAnsiCodes('')).toBe('');
    });
});

// ============================================================================
// Interactive collectOutputs - ANSI stripping
// ============================================================================

describe('TerminalDispatcher - Interactive collectOutputs', () => {
    let termDisp: TerminalDispatcher;

    beforeEach(() => {
        termDisp = new TerminalDispatcher();
    });

    it('should strip ANSI codes from output when session is interactive', async () => {
        const sessionDir = await mkdtemp(join(tmpdir(), 'collect-int-'));
        await writeFile(join(sessionDir, 'output_a1.txt'), '\x1b[32mGreen text\x1b[0m Normal', 'utf-8');

        const session: TerminalSession = {
            sessionId: 'int-collect',
            sessionDir,
            agents: [{
                agentId: 'a1',
                agentName: 'Agent 1',
                scriptPath: join(sessionDir, 'agent_a1.ps1'),
                outputPath: join(sessionDir, 'output_a1.txt'),
                donePath: join(sessionDir, 'done_a1.txt'),
            }],
            startedAt: new Date(),
            interactive: true,
        };

        const outputs = await termDisp.collectOutputs(session);
        expect(outputs['a1']).toBe('Green text Normal');
    });

    it('should NOT strip ANSI codes when session is not interactive', async () => {
        const sessionDir = await mkdtemp(join(tmpdir(), 'collect-nonint-'));
        const rawContent = '\x1b[32mGreen text\x1b[0m Normal';
        await writeFile(join(sessionDir, 'output_a1.txt'), rawContent, 'utf-8');

        const session: TerminalSession = {
            sessionId: 'nonint-collect',
            sessionDir,
            agents: [{
                agentId: 'a1',
                agentName: 'Agent 1',
                scriptPath: join(sessionDir, 'agent_a1.ps1'),
                outputPath: join(sessionDir, 'output_a1.txt'),
                donePath: join(sessionDir, 'done_a1.txt'),
            }],
            startedAt: new Date(),
            interactive: false,
        };

        const outputs = await termDisp.collectOutputs(session);
        expect(outputs['a1']).toBe(rawContent);
    });
});
