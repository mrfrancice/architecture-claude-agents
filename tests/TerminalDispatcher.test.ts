import { describe, it, expect, beforeEach } from 'vitest';
import { TerminalDispatcher } from '../src/core/TerminalDispatcher.js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import type { ManualDispatchPrompt, TerminalSession } from '../src/types/core.js';

function createTestPrompts(count: number): ManualDispatchPrompt[] {
    const prompts: ManualDispatchPrompt[] = [];
    for (let i = 0; i < count; i++) {
        prompts.push({
            agentId: `agent-${i}`,
            agentName: `Test Agent ${i}`,
            systemPrompt: `You are test agent ${i}`,
            userPrompt: `Do task ${i}`,
            model: undefined,
        });
    }
    return prompts;
}

describe('TerminalDispatcher', () => {
    let dispatcher: TerminalDispatcher;

    beforeEach(() => {
        dispatcher = new TerminalDispatcher();
    });

    describe('getLayoutCommands', () => {
        it('should return empty for 1 agent', () => {
            const cmds = dispatcher.getLayoutCommands(1);
            expect(cmds).toEqual([]);
        });

        it('should return single vertical split for 2 agents', () => {
            const cmds = dispatcher.getLayoutCommands(2);
            expect(cmds).toHaveLength(1);
            expect(cmds[0]).toEqual({ type: 'split', direction: 'V', agentIndex: 1 });
        });

        it('should return V then H split for 3 agents', () => {
            const cmds = dispatcher.getLayoutCommands(3);
            expect(cmds).toHaveLength(2);
            expect(cmds[0]).toEqual({ type: 'split', direction: 'V', agentIndex: 1 });
            expect(cmds[1]).toEqual({ type: 'split', direction: 'H', agentIndex: 2 });
        });

        it('should return 2x2 grid layout for 4 agents', () => {
            const cmds = dispatcher.getLayoutCommands(4);
            expect(cmds).toHaveLength(5);
            // V split, focus left, H split, focus right, H split
            expect(cmds[0]).toEqual({ type: 'split', direction: 'V', agentIndex: 1 });
            expect(cmds[1]).toEqual({ type: 'focus', direction: 'left' });
            expect(cmds[2]).toEqual({ type: 'split', direction: 'H', agentIndex: 2 });
            expect(cmds[3]).toEqual({ type: 'focus', direction: 'right' });
            expect(cmds[4]).toEqual({ type: 'split', direction: 'H', agentIndex: 3 });
        });

        it('should handle 5+ agents with adaptive grid', () => {
            const cmds = dispatcher.getLayoutCommands(6);
            // Should produce valid commands covering agents 1-5
            const splitCmds = cmds.filter(c => c.type === 'split');
            expect(splitCmds).toHaveLength(5); // 5 additional agents need 5 splits
            // All agent indices from 1 to 5 should be present
            const indices = splitCmds.map(c => (c as { agentIndex: number }).agentIndex);
            expect(indices).toEqual([1, 2, 3, 4, 5]);
        });
    });

    describe('getStatus', () => {
        it('should report all running when no .done files', async () => {
            const tempDir = await mkdtemp(join(tmpdir(), 'term-test-'));
            const session: TerminalSession = {
                sessionId: 'test-session',
                sessionDir: tempDir,
                agents: [
                    {
                        agentId: 'a1',
                        agentName: 'Agent 1',
                        scriptPath: join(tempDir, 'agent_a1.ps1'),
                        outputPath: join(tempDir, 'output_a1.txt'),
                        donePath: join(tempDir, 'done_a1.txt'),
                    },
                    {
                        agentId: 'a2',
                        agentName: 'Agent 2',
                        scriptPath: join(tempDir, 'agent_a2.ps1'),
                        outputPath: join(tempDir, 'output_a2.txt'),
                        donePath: join(tempDir, 'done_a2.txt'),
                    },
                ],
                startedAt: new Date(),
            };

            const status = await dispatcher.getStatus(session);
            expect(status.running).toEqual(['a1', 'a2']);
            expect(status.completed).toEqual([]);
            expect(status.allDone).toBe(false);
            expect(status.total).toBe(2);
        });

        it('should detect completed agents via .done files', async () => {
            const tempDir = await mkdtemp(join(tmpdir(), 'term-test-'));
            const donePath = join(tempDir, 'done_a1.txt');
            await writeFile(donePath, 'SUCCESS:42.5', 'utf-8');

            const session: TerminalSession = {
                sessionId: 'test-session',
                sessionDir: tempDir,
                agents: [
                    {
                        agentId: 'a1',
                        agentName: 'Agent 1',
                        scriptPath: join(tempDir, 'agent_a1.ps1'),
                        outputPath: join(tempDir, 'output_a1.txt'),
                        donePath,
                    },
                ],
                startedAt: new Date(),
            };

            const status = await dispatcher.getStatus(session);
            expect(status.completed).toEqual(['a1']);
            expect(status.running).toEqual([]);
            expect(status.allDone).toBe(true);
            expect(status.agentDetails['a1']).toEqual({
                status: 'success',
                duration: 42.5,
            });
        });

        it('should detect failed agents', async () => {
            const tempDir = await mkdtemp(join(tmpdir(), 'term-test-'));
            const donePath = join(tempDir, 'done_a1.txt');
            await writeFile(donePath, 'FAILED:10.2', 'utf-8');

            const session: TerminalSession = {
                sessionId: 'test-session',
                sessionDir: tempDir,
                agents: [
                    {
                        agentId: 'a1',
                        agentName: 'Agent 1',
                        scriptPath: join(tempDir, 'agent_a1.ps1'),
                        outputPath: join(tempDir, 'output_a1.txt'),
                        donePath,
                    },
                ],
                startedAt: new Date(),
            };

            const status = await dispatcher.getStatus(session);
            expect(status.agentDetails['a1'].status).toBe('failed');
        });
    });

    describe('collectOutputs', () => {
        it('should collect output files', async () => {
            const tempDir = await mkdtemp(join(tmpdir(), 'term-test-'));
            const outputPath = join(tempDir, 'output_a1.txt');
            await writeFile(outputPath, 'Agent output content here', 'utf-8');

            const session: TerminalSession = {
                sessionId: 'test-session',
                sessionDir: tempDir,
                agents: [
                    {
                        agentId: 'a1',
                        agentName: 'Agent 1',
                        scriptPath: join(tempDir, 'agent_a1.ps1'),
                        outputPath,
                        donePath: join(tempDir, 'done_a1.txt'),
                    },
                ],
                startedAt: new Date(),
            };

            const outputs = await dispatcher.collectOutputs(session);
            expect(outputs['a1']).toBe('Agent output content here');
        });

        it('should return empty string for missing output files', async () => {
            const tempDir = await mkdtemp(join(tmpdir(), 'term-test-'));

            const session: TerminalSession = {
                sessionId: 'test-session',
                sessionDir: tempDir,
                agents: [
                    {
                        agentId: 'a1',
                        agentName: 'Agent 1',
                        scriptPath: join(tempDir, 'agent_a1.ps1'),
                        outputPath: join(tempDir, 'output_a1.txt'),
                        donePath: join(tempDir, 'done_a1.txt'),
                    },
                ],
                startedAt: new Date(),
            };

            const outputs = await dispatcher.collectOutputs(session);
            expect(outputs['a1']).toBe('');
        });
    });
});
