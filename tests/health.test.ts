import { describe, it, expect } from 'vitest';
import { healthTool } from '../src/tools/health.tool.js';

describe('healthTool schema', () => {
    it('should have correct tool name', () => {
        expect(healthTool.name).toBe('orchestrator_health');
    });

    it('should have a description', () => {
        expect(healthTool.description).toBeTruthy();
        expect(healthTool.description!.length).toBeGreaterThan(10);
    });

    it('should have an empty properties schema (no parameters)', () => {
        expect(healthTool.inputSchema.type).toBe('object');
        expect((healthTool.inputSchema as Record<string, unknown>).properties).toEqual({});
    });
});
