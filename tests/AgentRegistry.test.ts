import { describe, it, expect, beforeEach } from 'vitest';
import { AgentRegistry } from '../src/core/AgentRegistry.js';
import { tmpdir } from 'node:os';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

describe('AgentRegistry', () => {
    let registry: AgentRegistry;
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'orch-test-'));
        registry = new AgentRegistry(tempDir);
        await registry.initialize();
    });

    it('should load 8 built-in agents', () => {
        const agents = registry.list();
        expect(agents.length).toBe(8);
    });

    it('should get agent by id', () => {
        const agent = registry.get('security-expert');
        expect(agent).toBeDefined();
        expect(agent!.name).toBe('Security Expert');
        expect(agent!.builtIn).toBe(true);
    });

    it('should return undefined for unknown agent', () => {
        expect(registry.get('nonexistent')).toBeUndefined();
    });

    it('should throw on getRequired for unknown agent', () => {
        expect(() => registry.getRequired('nonexistent')).toThrow('Agent "nonexistent" not found');
    });

    it('should check has()', () => {
        expect(registry.has('fullstack-ui-architect')).toBe(true);
        expect(registry.has('nonexistent')).toBe(false);
    });

    it('should register custom agent', () => {
        registry.register({
            id: 'custom-agent',
            name: 'Custom Agent',
            description: 'Test',
            systemPrompt: 'You are a custom agent',
            capabilities: ['test'],
            builtIn: false,
        });

        expect(registry.has('custom-agent')).toBe(true);
        expect(registry.list().length).toBe(9);
    });

    it('should load custom agents from disk', async () => {
        const agentsDir = join(tempDir, '.claude', 'orchestrator', 'agents');
        await mkdir(agentsDir, { recursive: true });
        await writeFile(join(agentsDir, 'test-agent.json'), JSON.stringify({
            id: 'disk-agent',
            name: 'Disk Agent',
            systemPrompt: 'You are a disk agent',
            capabilities: ['disk'],
        }));

        await registry.reload();
        expect(registry.has('disk-agent')).toBe(true);
        expect(registry.get('disk-agent')!.builtIn).toBe(false);
    });

    it('should not initialize twice', async () => {
        await registry.initialize();
        expect(registry.list().length).toBe(8);
    });

    it('should have all expected built-in agent ids', () => {
        const ids = registry.list().map(a => a.id);
        expect(ids).toContain('fullstack-ui-architect');
        expect(ids).toContain('test-automation-strategist');
        expect(ids).toContain('security-expert');
        expect(ids).toContain('senior-code-reviewer');
        expect(ids).toContain('database-optimization-expert');
        expect(ids).toContain('distributed-systems-architect');
        expect(ids).toContain('technical-writer');
        expect(ids).toContain('ux-design-strategist');
    });

    it('should have system prompts for all agents', () => {
        for (const agent of registry.list()) {
            expect(agent.systemPrompt.length).toBeGreaterThan(50);
            expect(agent.capabilities.length).toBeGreaterThan(0);
        }
    });
});
