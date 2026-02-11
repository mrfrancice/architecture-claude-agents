/**
 * Tests for safe-logger utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logInfo, logWarn, logError, logDebug, sanitizeValue } from '../src/utils/safe-logger.js';

describe('safe-logger', () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    describe('logInfo', () => {
        it('logs with [orchestrator] prefix', () => {
            logInfo('test message');
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[orchestrator] test message'));
        });

        it('includes sanitized values', () => {
            logInfo('value is', 'hello');
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('hello'));
        });
    });

    describe('logWarn', () => {
        it('logs with WARNING prefix', () => {
            logWarn('something bad');
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('WARNING: something bad'));
        });
    });

    describe('logError', () => {
        it('logs with ERROR prefix', () => {
            logError('failed');
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('ERROR: failed'));
        });

        it('safely handles Error objects', () => {
            logError('operation failed', new Error('disk full'));
            const msg = errorSpy.mock.calls[0][0] as string;
            expect(msg).toContain('disk full');
        });

        it('safely handles non-Error objects', () => {
            logError('operation failed', { code: 42 });
            const msg = errorSpy.mock.calls[0][0] as string;
            expect(msg).toContain('42');
        });
    });

    describe('sanitization', () => {
        it('strips control characters from values', () => {
            logInfo('value:', 'hello\x00world\x1Bfoo');
            const msg = errorSpy.mock.calls[0][0] as string;
            expect(msg).not.toContain('\x00');
            expect(msg).not.toContain('\x1B');
        });

        it('replaces newlines to prevent log injection', () => {
            logInfo('value:', 'line1\nline2\r\nline3');
            const msg = errorSpy.mock.calls[0][0] as string;
            expect(msg).not.toContain('\n');
            expect(msg).toContain('line1 | line2 | line3');
        });

        it('truncates overly long values', () => {
            logInfo('value:', 'x'.repeat(1000));
            const msg = errorSpy.mock.calls[0][0] as string;
            expect(msg).toContain('...[truncated]');
            // Total log length should be bounded
            expect(msg.length).toBeLessThan(2500);
        });

        it('truncates overly long messages', () => {
            logInfo('x'.repeat(3000));
            const msg = errorSpy.mock.calls[0][0] as string;
            expect(msg).toContain('...[truncated]');
            expect(msg.length).toBeLessThanOrEqual(2020); // MAX_LOG_LENGTH + truncation marker
        });

        it('handles null and undefined values', () => {
            logInfo('values:', null, undefined);
            const msg = errorSpy.mock.calls[0][0] as string;
            expect(msg).toContain('null');
            expect(msg).toContain('undefined');
        });
    });

    describe('logDebug', () => {
        afterEach(() => {
            delete process.env.ORCHESTRATOR_DEBUG;
        });

        it('does NOT log when ORCHESTRATOR_DEBUG is not set', () => {
            delete process.env.ORCHESTRATOR_DEBUG;
            logDebug('should be silent');
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('does NOT log when ORCHESTRATOR_DEBUG is "0"', () => {
            process.env.ORCHESTRATOR_DEBUG = '0';
            logDebug('should be silent');
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('logs when ORCHESTRATOR_DEBUG is "1"', () => {
            process.env.ORCHESTRATOR_DEBUG = '1';
            logDebug('debug message');
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('DEBUG: debug message'));
        });

        it('logs when ORCHESTRATOR_DEBUG is "true"', () => {
            process.env.ORCHESTRATOR_DEBUG = 'true';
            logDebug('debug message');
            expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('DEBUG: debug message'));
        });

        it('includes sanitized values', () => {
            process.env.ORCHESTRATOR_DEBUG = '1';
            logDebug('key', 'value');
            const msg = errorSpy.mock.calls[0][0] as string;
            expect(msg).toContain('value');
        });

        it('truncates long debug messages', () => {
            process.env.ORCHESTRATOR_DEBUG = '1';
            logDebug('x'.repeat(3000));
            const msg = errorSpy.mock.calls[0][0] as string;
            expect(msg).toContain('...[truncated]');
        });
    });

    describe('sanitizeValue (exported)', () => {
        it('returns "null" for null', () => {
            expect(sanitizeValue(null)).toBe('null');
        });

        it('returns "undefined" for undefined', () => {
            expect(sanitizeValue(undefined)).toBe('undefined');
        });

        it('returns string as-is when short and clean', () => {
            expect(sanitizeValue('hello')).toBe('hello');
        });

        it('serializes objects to JSON', () => {
            expect(sanitizeValue({ a: 1 })).toBe('{"a":1}');
        });

        it('extracts message from Error objects', () => {
            expect(sanitizeValue(new Error('oops'))).toBe('oops');
        });

        it('handles circular objects gracefully', () => {
            const obj: Record<string, unknown> = {};
            obj.self = obj;
            expect(sanitizeValue(obj)).toBe('[Unserializable object]');
        });

        it('strips control characters', () => {
            const result = sanitizeValue('hello\x00\x1Bworld');
            expect(result).not.toContain('\x00');
            expect(result).not.toContain('\x1B');
        });

        it('replaces newlines with pipe separator', () => {
            expect(sanitizeValue('line1\nline2')).toBe('line1 | line2');
        });

        it('truncates long strings', () => {
            const result = sanitizeValue('x'.repeat(1000));
            expect(result.length).toBeLessThan(600);
            expect(result).toContain('...[truncated]');
        });
    });
});
