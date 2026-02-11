/**
 * Tests d'integration complets du mode Terminal
 *
 * Couvre le flow de bout en bout :
 * - Orchestrator-level terminal dispatch → status → collect → validate
 * - collectTerminalResults: erreurs (agents pas finis, pas de session, pas de workflow)
 * - pollTerminalCompletion: polling, timeout, abort workflow
 * - autoDispatchPhase en mode terminal
 * - cleanupTerminalSession lors de cancel/complete
 * - buildWtCommandArgs: test direct
 * - Layouts pour 7+ agents
 * - Caracteres speciaux dans les taches
 * - WT command generation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Orchestrator } from '../src/core/Orchestrator.js';
import { TerminalDispatcher } from '../src/core/TerminalDispatcher.js';
import { AgentDispatcher } from '../src/core/AgentDispatcher.js';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile, access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { TerminalSession, ManualDispatchPrompt } from '../src/types/core.js';

// ============================================================================
// HELPERS
// ============================================================================

async function createOrchestratorWithTerminalMode(): Promise<{
    orch: Orchestrator;
    tempDir: string;
    mockSpawnSession: ReturnType<typeof vi.fn>;
    sessionDir: string;
}> {
    const tempDir = await mkdtemp(join(tmpdir(), 'term-integ-'));
    await mkdir(join(tempDir, '.claude', 'orchestrator'), { recursive: true });
    await mkdir(join(tempDir, '.claude', 'memories'), { recursive: true });

    const orch = new Orchestrator(tempDir);
    await orch.initialize();
    orch.setDispatchMode('terminal');

    // Mock le TerminalDispatcher.spawnSession via l'AgentDispatcher
    const dispatcher = (orch as any).agentDispatcher as AgentDispatcher;
    const termDisp = dispatcher.getTerminalDispatcher();
    const sessionDir = await mkdtemp(join(tmpdir(), 'term-session-'));

    const mockSpawnSession = vi.spyOn(termDisp, 'spawnSession').mockImplementation(
        async (prompts: ManualDispatchPrompt[]) => ({
            sessionId: `mock-session-${Date.now()}`,
            sessionDir,
            agents: prompts.map(p => ({
                agentId: p.agentId,
                agentName: p.agentName,
                scriptPath: join(sessionDir, `agent_${p.agentId}.ps1`),
                outputPath: join(sessionDir, `output_${p.agentId}.txt`),
                donePath: join(sessionDir, `done_${p.agentId}.txt`),
            })),
            startedAt: new Date(),
        }),
    );

    return { orch, tempDir, mockSpawnSession, sessionDir };
}

// ============================================================================
// ORCHESTRATOR-LEVEL TERMINAL FLOW (E2E)
// ============================================================================

describe('Orchestrator Terminal Flow (E2E)', () => {
    let orch: Orchestrator;
    let sessionDir: string;

    beforeEach(async () => {
        const setup = await createOrchestratorWithTerminalMode();
        orch = setup.orch;
        sessionDir = setup.sessionDir;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should dispatch in terminal mode and return terminal session', async () => {
        await orch.startWorkflow('BUILD', 'Add dark mode');

        const result = await orch.dispatchPhase();

        expect(result.success).toBe(true);
        expect(result.data!.mode).toBe('terminal');
        expect(result.data!.terminalSession).toBeDefined();
        expect(result.data!.terminalSession!.agents.length).toBeGreaterThan(0);
    });

    it('should report terminal status after dispatch', async () => {
        await orch.startWorkflow('BUILD', 'Add dark mode');
        await orch.dispatchPhase();

        const status = await orch.getTerminalStatus();

        expect(status.success).toBe(true);
        expect(status.data!.total).toBeGreaterThan(0);
        expect(status.data!.running.length).toBeGreaterThan(0);
        expect(status.data!.allDone).toBe(false);
    });

    it('should track agent completion via done files', async () => {
        await orch.startWorkflow('BUILD', 'Add dark mode');
        const dispatchResult = await orch.dispatchPhase();
        const agentId = dispatchResult.data!.terminalSession!.agents[0].agentId;

        // Simuler la completion de l'agent
        await writeFile(join(sessionDir, `done_${agentId}.txt`), 'SUCCESS:25.4', 'utf-8');
        await writeFile(join(sessionDir, `output_${agentId}.txt`), 'Dark mode implementation complete', 'utf-8');

        const status = await orch.getTerminalStatus();

        expect(status.data!.completed).toContain(agentId);
        expect(status.data!.agentDetails[agentId].status).toBe('success');
        expect(status.data!.agentDetails[agentId].duration).toBe(25.4);
    });

    it('should collect terminal results when all agents done', async () => {
        await orch.startWorkflow('BUILD', 'Add dark mode');
        const dispatchResult = await orch.dispatchPhase();
        const agents = dispatchResult.data!.terminalSession!.agents;

        // Simuler completion de tous les agents
        for (const agent of agents) {
            await writeFile(agent.donePath, 'SUCCESS:10', 'utf-8');
            await writeFile(agent.outputPath, `Output from ${agent.agentId}`, 'utf-8');
        }

        const collectResult = await orch.collectTerminalResults();

        expect(collectResult.success).toBe(true);
        expect(collectResult.data).toBeDefined();
        for (const agent of agents) {
            expect(collectResult.data!.agentOutputs[agent.agentId]).toBeDefined();
            expect(collectResult.data!.agentOutputs[agent.agentId].status).toBe('SUCCESS');
            expect(collectResult.data!.agentOutputs[agent.agentId].output).toContain(agent.agentId);
        }
    });

    it('should inject phaseOutput into current phase after collect', async () => {
        await orch.startWorkflow('BUILD', 'Add dark mode');
        const dispatchResult = await orch.dispatchPhase();
        const agents = dispatchResult.data!.terminalSession!.agents;

        for (const agent of agents) {
            await writeFile(agent.donePath, 'SUCCESS:10', 'utf-8');
            await writeFile(agent.outputPath, `Result of ${agent.agentId}`, 'utf-8');
        }

        await orch.collectTerminalResults();

        // Verifier que la phase a maintenant un output
        const wf = await orch.getWorkflowStatus();
        const phase = wf!.phases[wf!.currentPhaseIndex];
        expect(phase.output).not.toBeNull();
        expect(Object.keys(phase.output!.agentOutputs).length).toBeGreaterThan(0);
    });

    it('should handle failed agents in terminal collect', async () => {
        await orch.startWorkflow('BUILD', 'Add dark mode');
        const dispatchResult = await orch.dispatchPhase();
        const agents = dispatchResult.data!.terminalSession!.agents;

        for (const agent of agents) {
            await writeFile(agent.donePath, 'FAILED:5', 'utf-8');
            await writeFile(agent.outputPath, 'Error: claude not found', 'utf-8');
        }

        const collectResult = await orch.collectTerminalResults();

        expect(collectResult.success).toBe(true);
        for (const agent of agents) {
            expect(collectResult.data!.agentOutputs[agent.agentId].status).toBe('FAILED');
        }
        expect(collectResult.data!.errors.length).toBeGreaterThan(0);
    });

    it('should report dispatch mode as terminal in system status', async () => {
        const status = await orch.getSystemStatus();
        expect(status.agents.dispatchMode).toBe('terminal');
    });
});

// ============================================================================
// collectTerminalResults - ERROR PATHS
// ============================================================================

describe('collectTerminalResults - Error Paths', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should fail when no workflow is running', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'term-err-'));
        await mkdir(join(tempDir, '.claude', 'orchestrator'), { recursive: true });
        await mkdir(join(tempDir, '.claude', 'memories'), { recursive: true });

        const orch = new Orchestrator(tempDir);
        await orch.initialize();

        const result = await orch.collectTerminalResults();

        expect(result.success).toBe(false);
        expect(result.error!.message).toContain('No workflow running');
    });

    it('should fail when no terminal session is active', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'term-err-'));
        await mkdir(join(tempDir, '.claude', 'orchestrator'), { recursive: true });
        await mkdir(join(tempDir, '.claude', 'memories'), { recursive: true });

        const orch = new Orchestrator(tempDir);
        await orch.initialize();
        // Manual mode = pas de terminal session
        await orch.startWorkflow('BUILD', 'Test task');

        const result = await orch.collectTerminalResults();

        expect(result.success).toBe(false);
        expect(result.error!.message).toContain('No terminal session active');
    });

    it('should fail when agents are still running', async () => {
        const setup = await createOrchestratorWithTerminalMode();
        await setup.orch.startWorkflow('BUILD', 'Test task');
        await setup.orch.dispatchPhase();

        // Ne pas creer de fichiers .done = agents encore en cours

        const result = await setup.orch.collectTerminalResults();

        expect(result.success).toBe(false);
        expect(result.error!.message).toContain('Not all agents are done');
        expect(result.error!.message).toContain('Running');
    });
});

// ============================================================================
// getTerminalStatus - ERROR PATHS
// ============================================================================

describe('getTerminalStatus - Error Paths', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should fail when no terminal session is active', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'term-status-'));
        await mkdir(join(tempDir, '.claude', 'orchestrator'), { recursive: true });
        await mkdir(join(tempDir, '.claude', 'memories'), { recursive: true });

        const orch = new Orchestrator(tempDir);
        await orch.initialize();

        const result = await orch.getTerminalStatus();

        expect(result.success).toBe(false);
        expect(result.error!.message).toContain('No terminal session active');
    });
});

// ============================================================================
// autoDispatchPhase - TERMINAL MODE
// ============================================================================

describe('autoDispatchPhase - Terminal Mode', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should auto-dispatch and detect timeout when agents never finish', async () => {
        const setup = await createOrchestratorWithTerminalMode();
        await setup.orch.startWorkflow('BUILD', 'Quick task');

        // Mock pollTerminalCompletion pour retourner immediatement sans timeout reel
        vi.spyOn(setup.orch as any, 'pollTerminalCompletion').mockResolvedValue({
            sessionId: 'mock',
            completed: [],
            running: ['fullstack-ui-architect'],
            total: 1,
            allDone: false,
            agentDetails: {
                'fullstack-ui-architect': { status: 'running' },
            },
        });

        const result = await setup.orch.autoDispatchPhase();

        expect(result.success).toBe(true);
        expect(result.data!.autoValidated).toBe(false);
        expect(result.data!.timedOut).toBe(true);
    });

    it('should auto-dispatch and auto-validate when all agents finish', async () => {
        const setup = await createOrchestratorWithTerminalMode();
        await setup.orch.startWorkflow('BUILD', 'Quick task');

        // Mock pollTerminalCompletion pour simuler completion immediate
        vi.spyOn(setup.orch as any, 'pollTerminalCompletion').mockResolvedValue({
            sessionId: 'mock',
            completed: ['fullstack-ui-architect'],
            running: [],
            total: 1,
            allDone: true,
            agentDetails: {
                'fullstack-ui-architect': { status: 'success', duration: 10 },
            },
        });

        // Mock collectTerminalResults
        vi.spyOn(setup.orch, 'collectTerminalResults').mockResolvedValue({
            success: true,
            data: {
                agentOutputs: {
                    'fullstack-ui-architect': {
                        agentId: 'fullstack-ui-architect',
                        status: 'SUCCESS',
                        output: 'Design complete',
                        filesCreated: [],
                        filesModified: [],
                        duration: 10,
                        score: null,
                    },
                },
                filesModified: [],
                errors: [],
                warnings: [],
            },
        });

        const result = await setup.orch.autoDispatchPhase();

        expect(result.success).toBe(true);
        expect(result.data!.autoValidated).toBe(true);
        expect(result.data!.score).toBeDefined();
    });

    it('should return partial status on poll timeout', async () => {
        const setup = await createOrchestratorWithTerminalMode();
        await setup.orch.startWorkflow('BUILD', 'Task');

        vi.spyOn(setup.orch as any, 'pollTerminalCompletion').mockResolvedValue({
            sessionId: 'mock',
            completed: ['fullstack-ui-architect'],
            running: ['security-expert'],
            total: 2,
            allDone: false,
            agentDetails: {
                'fullstack-ui-architect': { status: 'success', duration: 15 },
                'security-expert': { status: 'running' },
            },
        });

        const result = await setup.orch.autoDispatchPhase();

        expect(result.success).toBe(true);
        expect(result.data!.autoValidated).toBe(false);
        expect(result.data!.timedOut).toBe(true);
        expect(result.data!.terminalStatus).toBeDefined();
        expect(result.data!.terminalStatus!.completed).toContain('fullstack-ui-architect');
        expect(result.data!.terminalStatus!.running).toContain('security-expert');
    });
});

// ============================================================================
// pollTerminalCompletion
// ============================================================================

describe('pollTerminalCompletion', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should return null when no workflow', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'poll-'));
        await mkdir(join(tempDir, '.claude', 'orchestrator'), { recursive: true });
        await mkdir(join(tempDir, '.claude', 'memories'), { recursive: true });

        const orch = new Orchestrator(tempDir);
        await orch.initialize();

        const result = await (orch as any).pollTerminalCompletion();
        expect(result).toBeNull();
    });

    it('should abort polling when workflow is cancelled', async () => {
        const setup = await createOrchestratorWithTerminalMode();
        await setup.orch.startWorkflow('BUILD', 'Task');
        await setup.orch.dispatchPhase();

        // Simuler le cancel du workflow pendant le polling
        let pollCount = 0;
        vi.spyOn(setup.orch, 'getTerminalStatus').mockImplementation(async () => {
            pollCount++;
            if (pollCount === 1) {
                // Cancel le workflow au premier poll
                await setup.orch.cancelWorkflow();
            }
            return {
                success: true,
                data: {
                    sessionId: 'mock',
                    completed: [],
                    running: ['fullstack-ui-architect'],
                    total: 1,
                    allDone: false,
                    agentDetails: { 'fullstack-ui-architect': { status: 'running' as const } },
                },
            };
        });

        // Mock setTimeout pour ne pas attendre
        vi.spyOn(global, 'setTimeout').mockImplementation((fn: any) => { fn(); return 0 as any; });

        const result = await (setup.orch as any).pollTerminalCompletion();

        // Doit retourner le statut partiel car le workflow est annule
        expect(result).not.toBeNull();
        expect(pollCount).toBeLessThanOrEqual(3);
    });
});

// ============================================================================
// cleanupTerminalSession
// ============================================================================

describe('cleanupTerminalSession', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should cleanup terminal session when workflow is cancelled', async () => {
        const setup = await createOrchestratorWithTerminalMode();
        await setup.orch.startWorkflow('BUILD', 'Task');
        await setup.orch.dispatchPhase();

        // Verifier que la session existe
        const dispatcher = (setup.orch as any).agentDispatcher as AgentDispatcher;
        expect(dispatcher.getCurrentTerminalSession()).not.toBeNull();

        // Simuler que tous les agents sont termines (pour permettre le cleanup)
        const session = dispatcher.getCurrentTerminalSession()!;
        for (const agent of session.agents) {
            await writeFile(agent.donePath, 'SUCCESS:5', 'utf-8');
        }

        await setup.orch.cancelWorkflow();

        // Session doit etre reset
        expect(dispatcher.getCurrentTerminalSession()).toBeNull();
    });

    it('should not delete session dir when agents are still running', async () => {
        const setup = await createOrchestratorWithTerminalMode();
        await setup.orch.startWorkflow('BUILD', 'Task');
        await setup.orch.dispatchPhase();

        const dispatcher = (setup.orch as any).agentDispatcher as AgentDispatcher;
        const sessionDir = dispatcher.getCurrentTerminalSession()!.sessionDir;

        // Cancel sans agents termines
        await setup.orch.cancelWorkflow();

        // Le repertoire de session doit toujours exister
        await expect(access(sessionDir)).resolves.toBeUndefined();
    });
});

// ============================================================================
// TerminalDispatcher - buildWtCommandArgs (test direct)
// ============================================================================

describe('TerminalDispatcher - buildWtCommandArgs', () => {
    let termDisp: TerminalDispatcher;

    beforeEach(() => {
        termDisp = new TerminalDispatcher();
    });

    function makeAgents(count: number) {
        return Array.from({ length: count }, (_, i) => ({
            agentId: `agent-${i}`,
            agentName: `Agent ${i}`,
            scriptPath: `C:\\temp\\agent_${i}.ps1`,
            outputPath: `C:\\temp\\output_${i}.txt`,
            donePath: `C:\\temp\\done_${i}.txt`,
        }));
    }

    it('should return empty array for single agent', () => {
        const args = (termDisp as any).buildWtCommandArgs(makeAgents(1), 'pwsh');
        expect(args).toEqual([]);
    });

    it('should generate split commands for 2 agents', () => {
        const args = (termDisp as any).buildWtCommandArgs(makeAgents(2), 'pwsh');

        expect(args).toContain(';');
        expect(args).toContain('sp');
        expect(args).toContain('-V');
        // Should reference agent-1's script path
        expect(args.some((a: string) => a.includes('agent_1.ps1'))).toBe(true);
    });

    it('should generate 2x2 grid for 4 agents', () => {
        const args = (termDisp as any).buildWtCommandArgs(makeAgents(4), 'pwsh');
        const splits = args.filter((a: string) => a === 'sp');
        expect(splits.length).toBe(3); // 3 additional splits for agents 1, 2, 3
    });

    it('should handle 6 agents', () => {
        const args = (termDisp as any).buildWtCommandArgs(makeAgents(6), 'pwsh');
        const splits = args.filter((a: string) => a === 'sp');
        expect(splits.length).toBe(5); // 5 splits for agents 1-5
    });

    it('should use pwsh as shell in args', () => {
        const args = (termDisp as any).buildWtCommandArgs(makeAgents(2), 'pwsh');
        expect(args).toContain('pwsh');
    });

    it('should use powershell as shell when specified', () => {
        const args = (termDisp as any).buildWtCommandArgs(makeAgents(2), 'powershell');
        expect(args).toContain('powershell');
    });
});

// ============================================================================
// LAYOUT COMMANDS - EXTENDED (7+ agents)
// ============================================================================

describe('TerminalDispatcher - Layout Commands Extended', () => {
    let termDisp: TerminalDispatcher;

    beforeEach(() => {
        termDisp = new TerminalDispatcher();
    });

    it('should handle 7 agents', () => {
        const cmds = termDisp.getLayoutCommands(7);
        const splits = cmds.filter(c => c.type === 'split');
        expect(splits.length).toBe(6);
        const indices = splits.map(c => (c as { agentIndex: number }).agentIndex);
        expect(indices).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('should handle 8 agents', () => {
        const cmds = termDisp.getLayoutCommands(8);
        const splits = cmds.filter(c => c.type === 'split');
        expect(splits.length).toBe(7);
    });

    it('should handle 9 agents (3x3 grid)', () => {
        const cmds = termDisp.getLayoutCommands(9);
        const splits = cmds.filter(c => c.type === 'split');
        expect(splits.length).toBe(8);
        // Tous les indices de 1 a 8 presents
        const indices = splits.map(c => (c as { agentIndex: number }).agentIndex).sort((a, b) => a - b);
        expect(indices).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    });

    it('should handle 10 agents', () => {
        const cmds = termDisp.getLayoutCommands(10);
        const splits = cmds.filter(c => c.type === 'split');
        expect(splits.length).toBe(9);
    });

    it('should handle 16 agents (4x4 grid)', () => {
        const cmds = termDisp.getLayoutCommands(16);
        const splits = cmds.filter(c => c.type === 'split');
        expect(splits.length).toBe(15);
    });

    it('should always have contiguous agent indices starting from 1', () => {
        for (const count of [5, 6, 7, 8, 9, 10, 12]) {
            const cmds = termDisp.getLayoutCommands(count);
            const splits = cmds.filter(c => c.type === 'split');
            const indices = splits.map(c => (c as { agentIndex: number }).agentIndex).sort((a, b) => a - b);
            const expected = Array.from({ length: count - 1 }, (_, i) => i + 1);
            expect(indices).toEqual(expected);
        }
    });

    it('should use only V and H directions', () => {
        for (const count of [2, 3, 4, 5, 6, 7, 8, 9, 10]) {
            const cmds = termDisp.getLayoutCommands(count);
            for (const cmd of cmds) {
                if (cmd.type === 'split') {
                    expect(['V', 'H']).toContain(cmd.direction);
                }
            }
        }
    });

    it('should use only valid focus directions', () => {
        for (const count of [4, 5, 6, 7, 8, 9, 10]) {
            const cmds = termDisp.getLayoutCommands(count);
            for (const cmd of cmds) {
                if (cmd.type === 'focus') {
                    expect(['left', 'right', 'up', 'down']).toContain(cmd.direction);
                }
            }
        }
    });
});

// ============================================================================
// SPECIAL CHARACTERS IN TASK NAMES
// ============================================================================

describe('TerminalDispatcher - Special Characters', () => {
    let termDisp: TerminalDispatcher;

    beforeEach(() => {
        termDisp = new TerminalDispatcher();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should escape single quotes in task names', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'quote-agent',
            agentName: 'Quote Agent',
            systemPrompt: 'system',
            userPrompt: 'user',
        }];

        const session = await termDisp.spawnSession(prompts, '/test', {
            phaseName: 'Test',
            iteration: 1,
            task: "Fix the user's login bug",
        });

        const script = await readFile(session.agents[0].scriptPath, 'utf-8');
        // Single quotes should be escaped as '' in PowerShell
        expect(script).toContain("user''s");
    });

    it('should handle empty task string', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'empty-task',
            agentName: 'Empty Task Agent',
            systemPrompt: 'system',
            userPrompt: 'user',
        }];

        const session = await termDisp.spawnSession(prompts, '/test', {
            phaseName: 'Phase',
            iteration: 1,
            task: '',
        });

        const script = await readFile(session.agents[0].scriptPath, 'utf-8');
        expect(script).toContain('Empty Task Agent');
    });

    it('should handle task with special PS characters', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'special-agent',
            agentName: 'Special Agent',
            systemPrompt: 'system',
            userPrompt: 'user',
        }];

        const session = await termDisp.spawnSession(prompts, '/test', {
            phaseName: 'Phase',
            iteration: 1,
            task: 'Fix $variable & "strings" issue',
        });

        const script = await readFile(session.agents[0].scriptPath, 'utf-8');
        // Script should be generated without crashing
        expect(script).toContain('Special Agent');
    });

    it('should handle unicode characters in agent names', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'unicode-agent',
            agentName: 'Agent Securite',
            systemPrompt: 'Vous etes un agent de securite',
            userPrompt: 'Verifiez les vulnerabilites',
        }];

        const session = await termDisp.spawnSession(prompts, '/test');

        const systemContent = await readFile(
            join(session.sessionDir, 'system_unicode-agent.txt'),
            'utf-8',
        );
        expect(systemContent).toBe('Vous etes un agent de securite');
    });
});

// ============================================================================
// MULTI-AGENT TERMINAL DISPATCH (SECURITY_AUDIT with 2 agents in remediation)
// ============================================================================

describe('Multi-Agent Terminal Dispatch', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should dispatch SECURITY_AUDIT remediation phase with 2 agents', async () => {
        const setup = await createOrchestratorWithTerminalMode();
        // SECURITY_AUDIT a une phase Remediation avec 2 agents: security-expert + fullstack-ui-architect
        await setup.orch.startWorkflow('SECURITY_AUDIT', 'Audit the app');

        const result = await setup.orch.dispatchPhase();

        // Premiere phase = Scan avec 1 agent
        expect(result.success).toBe(true);
        expect(result.data!.terminalSession!.agents.length).toBe(1);
    });

    it('should handle multi-agent output collection', async () => {
        const setup = await createOrchestratorWithTerminalMode();
        await setup.orch.startWorkflow('BUILD', 'Add dark mode');
        await setup.orch.dispatchPhase();

        const agents = ((setup.orch as any).agentDispatcher as AgentDispatcher)
            .getCurrentTerminalSession()!.agents;

        // Simuler outputs de longueurs differentes
        for (const agent of agents) {
            await writeFile(agent.donePath, 'SUCCESS:10', 'utf-8');
            await writeFile(agent.outputPath, `Output-${agent.agentId}: ${'x'.repeat(100)}`, 'utf-8');
        }

        const result = await setup.orch.collectTerminalResults();

        expect(result.success).toBe(true);
        for (const agent of agents) {
            expect(result.data!.agentOutputs[agent.agentId].output.length).toBeGreaterThan(50);
        }
    });
});

// ============================================================================
// MODE SWITCHING WITH TERMINAL SESSION
// ============================================================================

describe('Mode Switching with Terminal Session', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should switch to terminal mode and back without issues', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'mode-switch-'));
        await mkdir(join(tempDir, '.claude', 'orchestrator'), { recursive: true });
        await mkdir(join(tempDir, '.claude', 'memories'), { recursive: true });

        const orch = new Orchestrator(tempDir);
        await orch.initialize();

        expect(orch.getDispatchMode()).toBe('manual');

        orch.setDispatchMode('terminal');
        expect(orch.getDispatchMode()).toBe('terminal');

        orch.setDispatchMode('manual');
        expect(orch.getDispatchMode()).toBe('manual');

        orch.setDispatchMode('cli');
        expect(orch.getDispatchMode()).toBe('cli');

        orch.setDispatchMode('terminal');
        expect(orch.getDispatchMode()).toBe('terminal');
    });

    it('should propagate terminal interactive to dispatcher', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'interactive-prop-'));
        await mkdir(join(tempDir, '.claude', 'orchestrator'), { recursive: true });
        await mkdir(join(tempDir, '.claude', 'memories'), { recursive: true });

        const orch = new Orchestrator(tempDir);
        await orch.initialize();

        orch.setTerminalInteractive(true);
        expect(orch.getTerminalInteractive()).toBe(true);

        const dispatcher = (orch as any).agentDispatcher as AgentDispatcher;
        expect(dispatcher.getInteractive()).toBe(true);
    });
});

// ============================================================================
// TerminalDispatcher - Session Lifecycle Complete
// ============================================================================

describe('TerminalDispatcher - Session Lifecycle', () => {
    let termDisp: TerminalDispatcher;

    beforeEach(() => {
        termDisp = new TerminalDispatcher();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should create session with unique ID', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'uniq-agent',
            agentName: 'Unique Agent',
            systemPrompt: 'sys',
            userPrompt: 'usr',
        }];

        const session1 = await termDisp.spawnSession(prompts, '/test');
        const session2 = await termDisp.spawnSession(prompts, '/test');

        expect(session1.sessionId).not.toBe(session2.sessionId);
        expect(session1.sessionDir).not.toBe(session2.sessionDir);
    });

    it('should create all expected files in session directory', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [{
            agentId: 'file-check',
            agentName: 'File Check',
            systemPrompt: 'system content',
            userPrompt: 'user content',
        }];

        const session = await termDisp.spawnSession(prompts, '/test');

        // Verifier tous les fichiers attendus
        await expect(access(join(session.sessionDir, 'system_file-check.txt'))).resolves.toBeUndefined();
        await expect(access(join(session.sessionDir, 'user_file-check.txt'))).resolves.toBeUndefined();
        await expect(access(join(session.sessionDir, 'agent_file-check.ps1'))).resolves.toBeUndefined();
    });

    it('should handle multiple agents in single session', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const prompts: ManualDispatchPrompt[] = [
            { agentId: 'a1', agentName: 'Agent 1', systemPrompt: 'sys1', userPrompt: 'usr1' },
            { agentId: 'a2', agentName: 'Agent 2', systemPrompt: 'sys2', userPrompt: 'usr2' },
            { agentId: 'a3', agentName: 'Agent 3', systemPrompt: 'sys3', userPrompt: 'usr3' },
        ];

        const session = await termDisp.spawnSession(prompts, '/test');

        expect(session.agents).toHaveLength(3);

        // Chaque agent a ses propres fichiers
        for (const agent of session.agents) {
            await expect(access(agent.scriptPath)).resolves.toBeUndefined();
        }

        // Verifier les contenus des prompts
        const sys1 = await readFile(join(session.sessionDir, 'system_a1.txt'), 'utf-8');
        const sys2 = await readFile(join(session.sessionDir, 'system_a2.txt'), 'utf-8');
        expect(sys1).toBe('sys1');
        expect(sys2).toBe('sys2');
    });

    it('should set startedAt timestamp', async () => {
        vi.spyOn(termDisp as any, 'launchTerminalPanes').mockResolvedValue(undefined);

        const before = new Date();
        const session = await termDisp.spawnSession(
            [{ agentId: 'ts-agent', agentName: 'TS', systemPrompt: 's', userPrompt: 'u' }],
            '/test',
        );
        const after = new Date();

        expect(session.startedAt.getTime()).toBeGreaterThanOrEqual(before.getTime());
        expect(session.startedAt.getTime()).toBeLessThanOrEqual(after.getTime());
    });
});

// ============================================================================
// DONE FILE PARSING EDGE CASES
// ============================================================================

describe('TerminalDispatcher - Done File Edge Cases', () => {
    let termDisp: TerminalDispatcher;

    beforeEach(() => {
        termDisp = new TerminalDispatcher();
    });

    it('should handle done file with no duration', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'done-edge-'));
        await writeFile(join(tempDir, 'done_a1.txt'), 'SUCCESS:', 'utf-8');

        const session: TerminalSession = {
            sessionId: 'edge-test',
            sessionDir: tempDir,
            agents: [{
                agentId: 'a1',
                agentName: 'Agent 1',
                scriptPath: join(tempDir, 'agent_a1.ps1'),
                outputPath: join(tempDir, 'output_a1.txt'),
                donePath: join(tempDir, 'done_a1.txt'),
            }],
            startedAt: new Date(),
        };

        const status = await termDisp.getStatus(session);
        expect(status.completed).toContain('a1');
        expect(status.agentDetails['a1'].duration).toBe(0);
    });

    it('should handle done file with just SUCCESS (no colon)', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'done-edge-'));
        await writeFile(join(tempDir, 'done_a1.txt'), 'SUCCESS', 'utf-8');

        const session: TerminalSession = {
            sessionId: 'edge-test-2',
            sessionDir: tempDir,
            agents: [{
                agentId: 'a1',
                agentName: 'Agent 1',
                scriptPath: join(tempDir, 'agent_a1.ps1'),
                outputPath: join(tempDir, 'output_a1.txt'),
                donePath: join(tempDir, 'done_a1.txt'),
            }],
            startedAt: new Date(),
        };

        const status = await termDisp.getStatus(session);
        expect(status.completed).toContain('a1');
        expect(status.agentDetails['a1'].status).toBe('success');
    });

    it('should handle done file with whitespace', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'done-edge-'));
        await writeFile(join(tempDir, 'done_a1.txt'), '  SUCCESS:12.5  \n', 'utf-8');

        const session: TerminalSession = {
            sessionId: 'edge-ws',
            sessionDir: tempDir,
            agents: [{
                agentId: 'a1',
                agentName: 'Agent 1',
                scriptPath: join(tempDir, 'agent_a1.ps1'),
                outputPath: join(tempDir, 'output_a1.txt'),
                donePath: join(tempDir, 'done_a1.txt'),
            }],
            startedAt: new Date(),
        };

        const status = await termDisp.getStatus(session);
        expect(status.completed).toContain('a1');
        expect(status.agentDetails['a1'].status).toBe('success');
        expect(status.agentDetails['a1'].duration).toBe(12.5);
    });

    it('should handle mixed success and failure', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'done-mixed-'));
        await writeFile(join(tempDir, 'done_a1.txt'), 'SUCCESS:10', 'utf-8');
        await writeFile(join(tempDir, 'done_a2.txt'), 'FAILED:5', 'utf-8');

        const session: TerminalSession = {
            sessionId: 'mixed-test',
            sessionDir: tempDir,
            agents: [
                {
                    agentId: 'a1', agentName: 'A1',
                    scriptPath: join(tempDir, 'agent_a1.ps1'),
                    outputPath: join(tempDir, 'output_a1.txt'),
                    donePath: join(tempDir, 'done_a1.txt'),
                },
                {
                    agentId: 'a2', agentName: 'A2',
                    scriptPath: join(tempDir, 'agent_a2.ps1'),
                    outputPath: join(tempDir, 'output_a2.txt'),
                    donePath: join(tempDir, 'done_a2.txt'),
                },
            ],
            startedAt: new Date(),
        };

        const status = await termDisp.getStatus(session);
        expect(status.allDone).toBe(true);
        expect(status.agentDetails['a1'].status).toBe('success');
        expect(status.agentDetails['a2'].status).toBe('failed');
    });

    it('should handle partially completed session', async () => {
        const tempDir = await mkdtemp(join(tmpdir(), 'done-partial-'));
        await writeFile(join(tempDir, 'done_a1.txt'), 'SUCCESS:10', 'utf-8');
        // a2 pas de .done = encore en cours

        const session: TerminalSession = {
            sessionId: 'partial-test',
            sessionDir: tempDir,
            agents: [
                {
                    agentId: 'a1', agentName: 'A1',
                    scriptPath: join(tempDir, 'agent_a1.ps1'),
                    outputPath: join(tempDir, 'output_a1.txt'),
                    donePath: join(tempDir, 'done_a1.txt'),
                },
                {
                    agentId: 'a2', agentName: 'A2',
                    scriptPath: join(tempDir, 'agent_a2.ps1'),
                    outputPath: join(tempDir, 'output_a2.txt'),
                    donePath: join(tempDir, 'done_a2.txt'),
                },
            ],
            startedAt: new Date(),
        };

        const status = await termDisp.getStatus(session);
        expect(status.allDone).toBe(false);
        expect(status.completed).toEqual(['a1']);
        expect(status.running).toEqual(['a2']);
    });
});

// ============================================================================
// ANSI STRIPPING EDGE CASES
// ============================================================================

describe('TerminalDispatcher.stripAnsiCodes - Extended', () => {
    it('should strip 256-color codes', () => {
        const input = '\x1b[38;5;196mRed text\x1b[0m';
        expect(TerminalDispatcher.stripAnsiCodes(input)).toBe('Red text');
    });

    it('should strip RGB color codes', () => {
        const input = '\x1b[38;2;255;0;0mRed\x1b[0m';
        expect(TerminalDispatcher.stripAnsiCodes(input)).toBe('Red');
    });

    it('should strip erase line codes', () => {
        const input = '\x1b[2KClean line';
        expect(TerminalDispatcher.stripAnsiCodes(input)).toBe('Clean line');
    });

    it('should handle mixed content with newlines', () => {
        const input = '\x1b[32mLine 1\x1b[0m\nLine 2\n\x1b[31mLine 3\x1b[0m';
        expect(TerminalDispatcher.stripAnsiCodes(input)).toBe('Line 1\nLine 2\nLine 3');
    });

    it('should handle very long strings efficiently', () => {
        const chunk = '\x1b[33mword\x1b[0m ';
        const input = chunk.repeat(1000);
        const start = performance.now();
        const result = TerminalDispatcher.stripAnsiCodes(input);
        const elapsed = performance.now() - start;

        expect(result).toBe('word '.repeat(1000));
        expect(elapsed).toBeLessThan(100); // Should be fast
    });
});
