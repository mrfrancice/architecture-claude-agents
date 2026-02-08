import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../src/core/EventBus.js';

describe('EventBus', () => {
    let bus: EventBus;

    beforeEach(() => {
        bus = new EventBus();
    });

    it('should emit and receive events', async () => {
        let received = false;
        bus.on('workflow:started', (payload) => {
            expect(payload.workflowId).toBe('wf1');
            expect(payload.type).toBe('BUILD');
            received = true;
        });

        await bus.emit('workflow:started', { workflowId: 'wf1', type: 'BUILD', task: 'test' });
        expect(received).toBe(true);
    });

    it('should support multiple handlers', async () => {
        let count = 0;
        bus.on('workflow:paused', () => { count++; });
        bus.on('workflow:paused', () => { count++; });

        await bus.emit('workflow:paused', { workflowId: 'wf1' });
        expect(count).toBe(2);
    });

    it('should unsubscribe with returned function', async () => {
        let count = 0;
        const off = bus.on('workflow:paused', () => { count++; });

        await bus.emit('workflow:paused', { workflowId: 'wf1' });
        expect(count).toBe(1);

        off();
        await bus.emit('workflow:paused', { workflowId: 'wf1' });
        expect(count).toBe(1);
    });

    it('should support once()', async () => {
        let count = 0;
        bus.once('workflow:resumed', () => { count++; });

        await bus.emit('workflow:resumed', { workflowId: 'wf1' });
        await bus.emit('workflow:resumed', { workflowId: 'wf1' });
        expect(count).toBe(1);
    });

    it('should track total triggered', async () => {
        expect(bus.getTotalTriggered()).toBe(0);
        await bus.emit('workflow:paused', { workflowId: 'wf1' });
        await bus.emit('workflow:paused', { workflowId: 'wf1' });
        expect(bus.getTotalTriggered()).toBe(2);
    });

    it('should call onAny hook callbacks', async () => {
        const events: string[] = [];
        bus.onAny((event) => { events.push(event); });

        await bus.emit('workflow:started', { workflowId: 'wf1', type: 'BUILD', task: 'test' });
        await bus.emit('workflow:paused', { workflowId: 'wf1' });

        expect(events).toEqual(['workflow:started', 'workflow:paused']);
    });

    it('should clear all handlers', async () => {
        let called = false;
        bus.on('workflow:paused', () => { called = true; });
        bus.clear();

        await bus.emit('workflow:paused', { workflowId: 'wf1' });
        expect(called).toBe(false);
    });

    it('should handle handler errors gracefully', async () => {
        bus.on('workflow:paused', () => { throw new Error('handler crash'); });

        // Should not throw
        await bus.emit('workflow:paused', { workflowId: 'wf1' });
    });
});
