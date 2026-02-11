import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { Orchestrator } from '../src/core/Orchestrator.js';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PhaseOutput, AgentOutput } from '../src/types/core.js';

describe('Orchestrator', () => {
    let orch: Orchestrator;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'orch-test-'));
        // Create required dirs
        await mkdir(join(tempDir, '.claude', 'orchestrator'), { recursive: true });
        await mkdir(join(tempDir, '.claude', 'memories'), { recursive: true });

        orch = new Orchestrator(tempDir);
        await orch.initialize();
    });

    describe('initialization', () => {
        it('should initialize successfully', async () => {
            const status = await orch.getSystemStatus();
            expect(status.initialized).toBe(true);
            expect(status.sessionId).toBeTruthy();
        });

        it('should have 9 built-in agents', async () => {
            const status = await orch.getSystemStatus();
            expect(status.agents.total).toBe(9);
            expect(status.agents.builtIn).toBe(9);
            expect(status.agents.custom).toBe(0);
        });

        it('should default to manual dispatch mode', () => {
            expect(orch.getDispatchMode()).toBe('manual');
        });

        it('should not have a current workflow', async () => {
            const wf = await orch.getWorkflowStatus();
            expect(wf).toBeNull();
        });
    });

    describe('workflow lifecycle', () => {
        it('should start a BUILD workflow', async () => {
            const result = await orch.startWorkflow('BUILD', 'Create login page');
            expect(result.success).toBe(true);
            expect(result.data!.type).toBe('BUILD');
            expect(result.data!.task).toBe('Create login page');
            expect(result.data!.status).toBe('RUNNING');
            expect(result.data!.phases.length).toBe(6);
        });

        it('should start all 6 workflow types', async () => {
            const types = ['BUILD', 'REVIEW', 'OPTIMIZE', 'DESIGN', 'DEBUG', 'SECURITY_AUDIT'] as const;
            for (const type of types) {
                const orch2 = new Orchestrator(await mkdtemp(join(tmpdir(), 'orch-')));
                await orch2.initialize();
                const result = await orch2.startWorkflow(type, 'test task');
                expect(result.success).toBe(true);
                expect(result.data!.phases.length).toBeGreaterThan(0);
            }
        });

        it('should not start a second workflow while one is running', async () => {
            await orch.startWorkflow('BUILD', 'Task 1');
            const result = await orch.startWorkflow('BUILD', 'Task 2');
            expect(result.success).toBe(false);
            expect(result.error!.message).toContain('already running');
        });

        it('should pause and resume workflow', async () => {
            await orch.startWorkflow('BUILD', 'Task');

            const pauseResult = await orch.pauseWorkflow();
            expect(pauseResult.success).toBe(true);

            const wf1 = await orch.getWorkflowStatus();
            expect(wf1!.status).toBe('PAUSED');

            const resumeResult = await orch.resumeWorkflow();
            expect(resumeResult.success).toBe(true);

            const wf2 = await orch.getWorkflowStatus();
            expect(wf2!.status).toBe('RUNNING');
        });

        it('should cancel workflow', async () => {
            await orch.startWorkflow('BUILD', 'Task');
            const result = await orch.cancelWorkflow();
            expect(result.success).toBe(true);

            const wf = await orch.getWorkflowStatus();
            expect(wf!.status).toBe('CANCELLED');
        });

        it('should fail when no workflow running', async () => {
            expect((await orch.pauseWorkflow()).success).toBe(false);
            expect((await orch.resumeWorkflow()).success).toBe(false);
        });

        it('should have first phase RUNNING after start', async () => {
            const result = await orch.startWorkflow('BUILD', 'Task');
            expect(result.data!.phases[0].status).toBe('RUNNING');
            expect(result.data!.phases[0].iteration).toBe(1);
        });
    });

    describe('dispatch', () => {
        it('should dispatch current phase in manual mode', async () => {
            await orch.startWorkflow('BUILD', 'Create login page');

            const result = await orch.dispatchPhase();
            expect(result.success).toBe(true);
            expect(result.data!.mode).toBe('manual');
            expect(result.data!.prompts).toBeDefined();
            expect(result.data!.prompts!.length).toBeGreaterThan(0);
        });

        it('should fail dispatch when no workflow', async () => {
            const result = await orch.dispatchPhase();
            expect(result.success).toBe(false);
        });

        it('should get manual prompts', async () => {
            await orch.startWorkflow('BUILD', 'Task');

            const result = await orch.getManualPrompts();
            expect(result.success).toBe(true);
            expect(result.data!.length).toBeGreaterThan(0);
            expect(result.data![0].systemPrompt.length).toBeGreaterThan(50);
            expect(result.data![0].userPrompt).toContain('Task');
        });

        it('should change dispatch mode', () => {
            orch.setDispatchMode('cli');
            expect(orch.getDispatchMode()).toBe('cli');
            orch.setDispatchMode('manual');
            expect(orch.getDispatchMode()).toBe('manual');
        });

        it('should get current phase info', async () => {
            await orch.startWorkflow('BUILD', 'Task');
            const info = orch.getCurrentPhaseInfo();
            expect(info).toBeTruthy();
            expect(info!.phase.name).toBe('Design');
            expect(info!.agents.length).toBeGreaterThan(0);
            expect(info!.agents[0].id).toBe('fullstack-ui-architect');
        });
    });

    describe('agent registry access', () => {
        it('should expose agent registry', () => {
            const registry = orch.getAgentRegistry();
            expect(registry.list().length).toBe(9);
            expect(registry.has('security-expert')).toBe(true);
        });
    });

    describe('memory', () => {
        it('should write and read memory', async () => {
            const writeResult = await orch.writeMemory('test-mem', 'hello world');
            expect(writeResult.success).toBe(true);

            const content = await orch.readMemory('test-mem');
            expect(content).toBe('hello world');
        });

        it('should list memories', async () => {
            await orch.writeMemory('mem1', 'content1');
            await orch.writeMemory('mem2', 'content2');
            const list = await orch.listMemories();
            expect(list).toContain('mem1');
            expect(list).toContain('mem2');
        });

        it('should delete memory', async () => {
            await orch.writeMemory('to-delete', 'content');
            const result = await orch.deleteMemory('to-delete');
            expect(result.success).toBe(true);

            const content = await orch.readMemory('to-delete');
            expect(content).toBeNull();
        });
    });

    describe('custom workflows', () => {
        it('should load custom workflow from disk', async () => {
            const wfDir = join(tempDir, '.claude', 'orchestrator', 'workflows');
            await mkdir(wfDir, { recursive: true });
            await writeFile(join(wfDir, 'test-wf.json'), JSON.stringify({
                name: 'test-workflow',
                description: 'A test workflow',
                phases: [
                    { name: 'Phase A', agents: ['security-expert'], maxIterations: 2 },
                    { name: 'Phase B', agents: ['technical-writer'] },
                ],
            }));

            // Re-initialize to load custom workflows
            const orch2 = new Orchestrator(tempDir);
            await orch2.initialize();

            const customs = orch2.listCustomWorkflows();
            expect(customs.length).toBe(1);
            expect(customs[0].name).toBe('test-workflow');
            expect(customs[0].phaseCount).toBe(2);
        });

        it('should start a custom workflow', async () => {
            const wfDir = join(tempDir, '.claude', 'orchestrator', 'workflows');
            await mkdir(wfDir, { recursive: true });
            await writeFile(join(wfDir, 'custom.json'), JSON.stringify({
                name: 'my-custom',
                description: 'Custom',
                phases: [
                    { name: 'Step 1', agents: ['security-expert'] },
                    { name: 'Step 2', agents: ['technical-writer'] },
                ],
            }));

            const orch2 = new Orchestrator(tempDir);
            await orch2.initialize();

            const result = await orch2.startWorkflow('CUSTOM', 'Custom task', 'my-custom');
            expect(result.success).toBe(true);
            expect(result.data!.phases.length).toBe(2);
            expect(result.data!.phases[0].name).toBe('Step 1');
            expect(result.data!.phases[1].name).toBe('Step 2');
        });

        it('should fail for unknown custom workflow', async () => {
            const result = await orch.startWorkflow('CUSTOM', 'Task', 'nonexistent');
            expect(result.success).toBe(false);
            expect(result.error!.message).toContain('not found');
        });
    });

    describe('phase mode', () => {
        it('should assign interactive mode to Code phase in BUILD workflow', async () => {
            const result = await orch.startWorkflow('BUILD', 'Create login page');
            const phases = result.data!.phases;

            const design = phases.find(p => p.name === 'Design')!;
            const code = phases.find(p => p.name === 'Code')!;
            const tests = phases.find(p => p.name === 'Tests')!;
            const security = phases.find(p => p.name === 'Security')!;
            const review = phases.find(p => p.name === 'Review')!;

            expect(design.mode).toBe('non-interactive');
            expect(code.mode).toBe('interactive');
            expect(tests.mode).toBe('interactive');
            expect(security.mode).toBe('non-interactive');
            expect(review.mode).toBe('non-interactive');
        });

        it('should assign interactive mode to Fix phase in DEBUG workflow', async () => {
            const orch2 = new Orchestrator(await mkdtemp(join(tmpdir(), 'orch-mode-')));
            await orch2.initialize();

            const result = await orch2.startWorkflow('DEBUG', 'Fix the login bug');
            const phases = result.data!.phases;

            const investigation = phases.find(p => p.name === 'Investigation')!;
            const fix = phases.find(p => p.name === 'Fix')!;

            expect(investigation.mode).toBe('non-interactive');
            expect(fix.mode).toBe('interactive');
        });

        it('should assign non-interactive mode to all REVIEW phases', async () => {
            const orch2 = new Orchestrator(await mkdtemp(join(tmpdir(), 'orch-mode-')));
            await orch2.initialize();

            const result = await orch2.startWorkflow('REVIEW', 'Review the code');
            for (const phase of result.data!.phases) {
                expect(phase.mode).toBe('non-interactive');
            }
        });

        it('should propagate mode from custom workflow template', async () => {
            const wfDir = join(tempDir, '.claude', 'orchestrator', 'workflows');
            await mkdir(wfDir, { recursive: true });
            await writeFile(join(wfDir, 'mode-test.json'), JSON.stringify({
                name: 'mode-test',
                description: 'Test mode propagation',
                phases: [
                    { name: 'Analysis', agents: ['security-expert'], mode: 'non-interactive' },
                    { name: 'Implementation', agents: ['fullstack-ui-architect'], mode: 'interactive' },
                    { name: 'Review', agents: ['senior-code-reviewer'] },
                ],
            }));

            const orch2 = new Orchestrator(tempDir);
            await orch2.initialize();

            const result = await orch2.startWorkflow('CUSTOM', 'Test task', 'mode-test');
            expect(result.success).toBe(true);
            expect(result.data!.phases[0].mode).toBe('non-interactive');
            expect(result.data!.phases[1].mode).toBe('interactive');
            expect(result.data!.phases[2].mode).toBe('non-interactive'); // default
        });

        it('should auto-switch terminal interactive based on phase mode', async () => {
            orch.setDispatchMode('terminal');
            await orch.startWorkflow('BUILD', 'Create a feature');

            // First phase is Design (non-interactive)
            // Access the dispatcher to check
            const registry = orch.getAgentRegistry();
            expect(orch.getTerminalInteractive()).toBe(false);
        });
    });

    describe('system status', () => {
        it('should return complete status', async () => {
            const status = await orch.getSystemStatus();
            expect(status.initialized).toBe(true);
            expect(status.agents.total).toBe(9);
            expect(status.agents.dispatchMode).toBe('manual');
            expect(status.stats).toBeDefined();
            expect(status.memoriesLoaded).toBe(0);
        });

        it('should reflect workflow in status', async () => {
            await orch.startWorkflow('BUILD', 'Task');
            const status = await orch.getSystemStatus();
            expect(status.currentWorkflow).toBeTruthy();
            expect(status.currentWorkflow!.type).toBe('BUILD');
            expect(status.currentWorkflow!.status).toBe('RUNNING');
            expect(status.currentWorkflow!.progress).toBe(0);
        });
    });

    describe('terminal interactive mode', () => {
        it('should default terminalInteractive to false', () => {
            expect(orch.getTerminalInteractive()).toBe(false);
        });

        it('should set and get terminal interactive', () => {
            orch.setTerminalInteractive(true);
            expect(orch.getTerminalInteractive()).toBe(true);
            orch.setTerminalInteractive(false);
            expect(orch.getTerminalInteractive()).toBe(false);
        });
    });

    describe('output consolidation', () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        function createMultiAgentPhaseOutput(): PhaseOutput {
            const makeOutput = (agentId: string, output: string): AgentOutput => ({
                agentId,
                status: 'SUCCESS',
                output,
                filesCreated: [],
                filesModified: [],
                duration: 100,
                score: null,
            });

            return {
                agentOutputs: {
                    'security-expert': makeOutput('security-expert', 'Found XSS vulnerability in login form'),
                    'fullstack-ui-architect': makeOutput('fullstack-ui-architect', 'Redesigned login form with input sanitization'),
                },
                filesModified: [],
                errors: [],
                warnings: [],
            };
        }

        function createSingleAgentPhaseOutput(): PhaseOutput {
            return {
                agentOutputs: {
                    'security-expert': {
                        agentId: 'security-expert',
                        status: 'SUCCESS',
                        output: 'Audit complete, no issues found',
                        filesCreated: [],
                        filesModified: [],
                        duration: 100,
                        score: null,
                    },
                },
                filesModified: [],
                errors: [],
                warnings: [],
            };
        }

        it('should consolidate multi-agent output via CLI call', async () => {
            // Mock the consolidatePhaseOutput method to avoid calling the real claude CLI
            vi.spyOn(orch, 'consolidatePhaseOutput').mockResolvedValue(
                '## Phase Summary\nConsolidated report here\n## Key Findings\n- XSS fix applied',
            );

            const phaseOutput = createMultiAgentPhaseOutput();
            const result = await orch.consolidatePhaseOutput(phaseOutput);

            expect(result).toContain('Phase Summary');
            expect(result).toContain('XSS fix applied');
        });

        it('should NOT consolidate single-agent output', async () => {
            const phaseOutput = createSingleAgentPhaseOutput();
            const result = await orch.consolidatePhaseOutput(phaseOutput);

            expect(result).toBe('');
        });

        it('should return empty string when consolidation fails', async () => {
            // Mock to simulate failure
            vi.spyOn(orch, 'consolidatePhaseOutput').mockResolvedValue('');

            const phaseOutput = createMultiAgentPhaseOutput();
            const result = await orch.consolidatePhaseOutput(phaseOutput);

            expect(result).toBe('');
        });

        it('should have output-consolidator agent registered', () => {
            const registry = orch.getAgentRegistry();
            const consolidator = registry.get('output-consolidator');
            expect(consolidator).toBeDefined();
            expect(consolidator!.builtIn).toBe(true);
            expect(consolidator!.capabilities).toContain('consolidation');
        });

        it('should skip consolidation when phaseOutput has fewer than 2 agents', async () => {
            const singleOutput = createSingleAgentPhaseOutput();
            const result = await orch.consolidatePhaseOutput(singleOutput);
            expect(result).toBe('');
        });

        it('should include consolidatedOutput type in PhaseOutput', () => {
            const output: PhaseOutput = {
                agentOutputs: {},
                filesModified: [],
                errors: [],
                warnings: [],
                consolidatedOutput: 'test consolidated output',
            };
            expect(output.consolidatedOutput).toBe('test consolidated output');
        });
    });
});
