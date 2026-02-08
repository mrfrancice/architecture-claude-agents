import { describe, it, expect, beforeEach } from 'vitest';
import { AgentDispatcher, ContextPipeline } from '../src/core/AgentDispatcher.js';
import { AgentRegistry } from '../src/core/AgentRegistry.js';
import { MemoryManager } from '../src/core/MemoryManager.js';
import { EventBus } from '../src/core/EventBus.js';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import type { Workflow, WorkflowPhase } from '../src/types/core.js';

function createTestWorkflow(): Workflow {
    return {
        id: 'wf_test',
        type: 'BUILD',
        task: 'Build a login page',
        status: 'RUNNING',
        phases: [
            {
                id: 'wf_test_phase_0',
                name: 'Design',
                description: 'Phase 1: Design',
                agents: ['fullstack-ui-architect'],
                dependencies: [],
                status: 'RUNNING',
                iteration: 1,
                maxIterations: 3,
                score: null,
                startedAt: new Date(),
                completedAt: null,
                output: null,
            },
            {
                id: 'wf_test_phase_1',
                name: 'Code',
                description: 'Phase 2: Code',
                agents: ['fullstack-ui-architect', 'security-expert'],
                dependencies: ['wf_test_phase_0'],
                status: 'PENDING',
                iteration: 0,
                maxIterations: 3,
                score: null,
                startedAt: null,
                completedAt: null,
                output: null,
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
                framework: 'React',
                rootPath: '/test',
            },
        },
    };
}

describe('ContextPipeline', () => {
    let pipeline: ContextPipeline;
    let registry: AgentRegistry;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'orch-test-'));
        registry = new AgentRegistry(tempDir);
        await registry.initialize();
        const memMgr = new MemoryManager(tempDir);
        await memMgr.initialize();
        pipeline = new ContextPipeline(registry, memMgr);
    });

    it('should build context for an agent', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const ctx = await pipeline.buildContext('fullstack-ui-architect', workflow, phase, []);
        expect(ctx.agent.id).toBe('fullstack-ui-architect');
        expect(ctx.task).toBe('Build a login page');
        expect(ctx.phase.name).toBe('Design');
        expect(ctx.projectInfo.language).toBe('TypeScript');
        expect(ctx.previousPhases).toHaveLength(0);
        expect(ctx.peerOutputs).toEqual({});
    });

    it('should include peer outputs in context', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        const peerOutputs = { 'other-agent': 'some output from peer' };

        const ctx = await pipeline.buildContext('fullstack-ui-architect', workflow, phase, [], peerOutputs);
        expect(ctx.peerOutputs['other-agent']).toBe('some output from peer');
    });

    it('should build user prompt with all sections', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const ctx = await pipeline.buildContext('fullstack-ui-architect', workflow, phase, ['fix error handling']);
        const prompt = pipeline.buildUserPrompt(ctx);

        expect(prompt).toContain('## Task');
        expect(prompt).toContain('Build a login page');
        expect(prompt).toContain('## Current Phase: Design');
        expect(prompt).toContain('## Feedback from Previous Iteration');
        expect(prompt).toContain('fix error handling');
        expect(prompt).toContain('## Project Info');
        expect(prompt).toContain('TypeScript');
    });

    it('should include previous phase outputs', async () => {
        const workflow = createTestWorkflow();
        // Simulate phase 0 completed with output
        workflow.phases[0].status = 'PASS';
        workflow.phases[0].output = {
            agentOutputs: {
                'fullstack-ui-architect': {
                    agentId: 'fullstack-ui-architect',
                    status: 'SUCCESS',
                    output: 'Design document content here',
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

        const phase1 = workflow.phases[1];
        const ctx = await pipeline.buildContext('security-expert', workflow, phase1, []);
        const prompt = pipeline.buildUserPrompt(ctx);

        expect(ctx.previousPhases).toHaveLength(1);
        expect(ctx.previousPhases[0].phaseName).toBe('Design');
        expect(prompt).toContain('## Previous Phases Output');
        expect(prompt).toContain('Design document content here');
    });

    it('should include peer outputs in prompt', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[1];
        const peerOutputs = { 'fullstack-ui-architect': 'Implementation code here' };

        const ctx = await pipeline.buildContext('security-expert', workflow, phase, [], peerOutputs);
        const prompt = pipeline.buildUserPrompt(ctx);

        expect(prompt).toContain('## Other Agents Output (same phase)');
        expect(prompt).toContain('Implementation code here');
    });
});

describe('AgentDispatcher', () => {
    let dispatcher: AgentDispatcher;
    let registry: AgentRegistry;
    let eventBus: EventBus;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'orch-test-'));
        registry = new AgentRegistry(tempDir);
        await registry.initialize();
        eventBus = new EventBus();
        const memMgr = new MemoryManager(tempDir);
        await memMgr.initialize();
        dispatcher = new AgentDispatcher(registry, memMgr, eventBus, 'manual');
    });

    it('should default to manual mode', () => {
        expect(dispatcher.getMode()).toBe('manual');
    });

    it('should change mode', () => {
        dispatcher.setMode('cli');
        expect(dispatcher.getMode()).toBe('cli');
    });

    it('should dispatch in manual mode and return prompts', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.mode).toBe('manual');
        expect(result.phaseId).toBe('wf_test_phase_0');
        expect(result.phaseName).toBe('Design');
        expect(result.results).toHaveLength(1);
        expect(result.prompts).toHaveLength(1);
        expect(result.prompts![0].agentId).toBe('fullstack-ui-architect');
        expect(result.prompts![0].systemPrompt).toContain('Senior Fullstack UI Architect');
        expect(result.prompts![0].userPrompt).toContain('Build a login page');
    });

    it('should dispatch multiple agents and generate prompts for each', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[1]; // Has 2 agents

        const result = await dispatcher.dispatchPhase(workflow, phase);

        expect(result.prompts).toHaveLength(2);
        expect(result.prompts![0].agentId).toBe('fullstack-ui-architect');
        expect(result.prompts![1].agentId).toBe('security-expert');
    });

    it('should emit events during dispatch', async () => {
        const events: string[] = [];
        eventBus.on('agent:phaseDispatchStarted', () => { events.push('started'); });
        eventBus.on('agent:dispatched', () => { events.push('dispatched'); });
        eventBus.on('agent:phaseDispatchCompleted', () => { events.push('completed'); });

        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];
        await dispatcher.dispatchPhase(workflow, phase);

        expect(events).toEqual(['started', 'dispatched', 'completed']);
    });

    it('should generate prompt for specific agent', async () => {
        const workflow = createTestWorkflow();
        const phase = workflow.phases[0];

        const prompt = await dispatcher.getPromptForAgent('fullstack-ui-architect', workflow, phase);
        expect(prompt.agentId).toBe('fullstack-ui-architect');
        expect(prompt.systemPrompt.length).toBeGreaterThan(50);
        expect(prompt.userPrompt).toContain('Build a login page');
    });

    it('should convert dispatch result to PhaseOutput', () => {
        const output = AgentDispatcher.toPhaseOutput({
            phaseId: 'p1',
            phaseName: 'Test',
            mode: 'cli',
            results: [
                { agentId: 'a1', mode: 'cli', status: 'SUCCESS', output: 'result1', duration: 100 },
                { agentId: 'a2', mode: 'cli', status: 'FAILED', output: '', duration: 50, error: 'timeout' },
            ],
        });

        expect(output.agentOutputs['a1'].status).toBe('SUCCESS');
        expect(output.agentOutputs['a1'].output).toBe('result1');
        expect(output.agentOutputs['a2'].status).toBe('FAILED');
        expect(output.errors).toHaveLength(1);
        expect(output.errors[0]).toContain('timeout');
    });
});
