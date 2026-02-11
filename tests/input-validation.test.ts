/**
 * Tests for input-validation utility
 */

import { describe, it, expect } from 'vitest';
import {
    validateStringLength,
    validateOptionalString,
    validateId,
    validateOptionalId,
    validateName,
    validateOptionalName,
    validateFilePath,
    validateStringArray,
    validateOptionalStringArray,
    validateBoolean,
    validateOptionalBoolean,
    validateEnum,
    validateOptionalEnum,
    MAX_LENGTHS,
    MAX_ARRAY_LENGTHS,
} from '../src/utils/input-validation.js';

// ============================================================================
// validateStringLength
// ============================================================================

describe('validateStringLength', () => {
    it('accepts a string within limit', () => {
        expect(validateStringLength('hello', 'test', 100)).toBe('hello');
    });

    it('accepts a string at exact limit', () => {
        const str = 'a'.repeat(50);
        expect(validateStringLength(str, 'test', 50)).toBe(str);
    });

    it('rejects a string exceeding limit', () => {
        expect(() => validateStringLength('a'.repeat(101), 'test', 100)).toThrow(
            /exceeds maximum length of 100/,
        );
    });

    it('rejects non-string values', () => {
        expect(() => validateStringLength(123, 'test', 100)).toThrow(/must be a string/);
        expect(() => validateStringLength(null, 'test', 100)).toThrow(/must be a string/);
        expect(() => validateStringLength(undefined, 'test', 100)).toThrow(/must be a string/);
    });

    it('includes param name in error message', () => {
        expect(() => validateStringLength(42, 'myParam', 10)).toThrow(/"myParam"/);
    });
});

// ============================================================================
// validateOptionalString
// ============================================================================

describe('validateOptionalString', () => {
    it('returns undefined for null/undefined/empty', () => {
        expect(validateOptionalString(undefined, 'test', 100)).toBeUndefined();
        expect(validateOptionalString(null, 'test', 100)).toBeUndefined();
        expect(validateOptionalString('', 'test', 100)).toBeUndefined();
    });

    it('validates present strings', () => {
        expect(validateOptionalString('hello', 'test', 100)).toBe('hello');
    });

    it('rejects strings exceeding limit', () => {
        expect(() => validateOptionalString('a'.repeat(11), 'test', 10)).toThrow(
            /exceeds maximum length/,
        );
    });
});

// ============================================================================
// validateId
// ============================================================================

describe('validateId', () => {
    it('accepts valid IDs', () => {
        expect(validateId('my-agent', 'agent_id')).toBe('my-agent');
        expect(validateId('agent_01', 'agent_id')).toBe('agent_01');
        expect(validateId('phase.test:v2', 'id')).toBe('phase.test:v2');
        expect(validateId('wf_123_abc', 'id')).toBe('wf_123_abc');
    });

    it('rejects IDs with spaces', () => {
        expect(() => validateId('my agent', 'agent_id')).toThrow(/invalid characters/);
    });

    it('rejects IDs with special characters', () => {
        expect(() => validateId('agent/../etc', 'agent_id')).toThrow(/invalid characters/);
        expect(() => validateId('agent;rm -rf', 'agent_id')).toThrow(/invalid characters/);
    });

    it('rejects empty IDs', () => {
        expect(() => validateId('', 'agent_id')).toThrow(/invalid characters/);
    });

    it('rejects overly long IDs', () => {
        expect(() => validateId('a'.repeat(201), 'agent_id')).toThrow(/exceeds maximum length/);
    });
});

// ============================================================================
// validateOptionalId
// ============================================================================

describe('validateOptionalId', () => {
    it('returns undefined for missing values', () => {
        expect(validateOptionalId(undefined, 'id')).toBeUndefined();
        expect(validateOptionalId(null, 'id')).toBeUndefined();
        expect(validateOptionalId('', 'id')).toBeUndefined();
    });

    it('validates present IDs', () => {
        expect(validateOptionalId('my-id', 'id')).toBe('my-id');
    });
});

// ============================================================================
// validateName
// ============================================================================

describe('validateName', () => {
    it('accepts valid names', () => {
        expect(validateName('my-memory', 'name')).toBe('my-memory');
        expect(validateName('architecture-decisions', 'name')).toBe('architecture-decisions');
    });

    it('rejects path traversal with ../', () => {
        expect(() => validateName('../../../etc/passwd', 'name')).toThrow(/path traversal/);
    });

    it('rejects path traversal with ..\\', () => {
        expect(() => validateName('..\\..\\windows', 'name')).toThrow(/path traversal/);
    });

    it('rejects null bytes', () => {
        expect(() => validateName('name\0evil', 'name')).toThrow(/null bytes/);
    });

    it('rejects overly long names', () => {
        expect(() => validateName('a'.repeat(201), 'name')).toThrow(/exceeds maximum length/);
    });
});

// ============================================================================
// validateFilePath
// ============================================================================

describe('validateFilePath', () => {
    it('accepts valid relative paths', () => {
        expect(validateFilePath('src/core/file.ts', 'path')).toBe('src/core/file.ts');
    });

    it('rejects path traversal', () => {
        expect(() => validateFilePath('../etc/passwd', 'path')).toThrow(/path traversal/);
    });

    it('rejects null bytes', () => {
        expect(() => validateFilePath('src/\0evil.ts', 'path')).toThrow(/null bytes/);
    });
});

// ============================================================================
// validateStringArray
// ============================================================================

describe('validateStringArray', () => {
    it('accepts valid arrays', () => {
        const result = validateStringArray(['a', 'b', 'c'], 'files', 10, 100);
        expect(result).toEqual(['a', 'b', 'c']);
    });

    it('rejects non-array values', () => {
        expect(() => validateStringArray('not-array', 'files', 10, 100)).toThrow(/must be an array/);
    });

    it('rejects arrays exceeding max length', () => {
        const arr = Array.from({ length: 11 }, (_, i) => `item${i}`);
        expect(() => validateStringArray(arr, 'files', 10, 100)).toThrow(/exceeds maximum length of 10/);
    });

    it('rejects non-string elements', () => {
        expect(() => validateStringArray(['a', 123], 'files', 10, 100)).toThrow(/must be a string/);
    });

    it('rejects elements exceeding max element length', () => {
        expect(() => validateStringArray(['a'.repeat(101)], 'files', 10, 100)).toThrow(
            /exceeds maximum length of 100/,
        );
    });
});

// ============================================================================
// validateOptionalStringArray
// ============================================================================

describe('validateOptionalStringArray', () => {
    it('returns undefined for null/undefined', () => {
        expect(validateOptionalStringArray(undefined, 'files', 10, 100)).toBeUndefined();
        expect(validateOptionalStringArray(null, 'files', 10, 100)).toBeUndefined();
    });

    it('validates present arrays', () => {
        expect(validateOptionalStringArray(['a'], 'files', 10, 100)).toEqual(['a']);
    });
});

// ============================================================================
// validateBoolean
// ============================================================================

describe('validateBoolean', () => {
    it('accepts true', () => {
        expect(validateBoolean(true, 'flag')).toBe(true);
    });

    it('accepts false', () => {
        expect(validateBoolean(false, 'flag')).toBe(false);
    });

    it('rejects string "true"', () => {
        expect(() => validateBoolean('true', 'flag')).toThrow(/must be a boolean/);
    });

    it('rejects number 1', () => {
        expect(() => validateBoolean(1, 'flag')).toThrow(/must be a boolean/);
    });

    it('rejects null', () => {
        expect(() => validateBoolean(null, 'flag')).toThrow(/must be a boolean/);
    });

    it('rejects undefined', () => {
        expect(() => validateBoolean(undefined, 'flag')).toThrow(/must be a boolean/);
    });

    it('includes param name and actual type in error', () => {
        expect(() => validateBoolean('yes', 'interactive')).toThrow(/"interactive"/);
        expect(() => validateBoolean('yes', 'interactive')).toThrow(/got string/);
    });
});

// ============================================================================
// validateOptionalBoolean
// ============================================================================

describe('validateOptionalBoolean', () => {
    it('returns default for undefined', () => {
        expect(validateOptionalBoolean(undefined, 'flag', false)).toBe(false);
        expect(validateOptionalBoolean(undefined, 'flag', true)).toBe(true);
    });

    it('returns default for null', () => {
        expect(validateOptionalBoolean(null, 'flag', true)).toBe(true);
    });

    it('returns false as default when no default provided', () => {
        expect(validateOptionalBoolean(undefined, 'flag')).toBe(false);
    });

    it('validates present booleans', () => {
        expect(validateOptionalBoolean(true, 'flag')).toBe(true);
        expect(validateOptionalBoolean(false, 'flag')).toBe(false);
    });

    it('rejects non-boolean when present', () => {
        expect(() => validateOptionalBoolean('true', 'flag')).toThrow(/must be a boolean/);
    });
});

// ============================================================================
// validateEnum
// ============================================================================

describe('validateEnum', () => {
    const ACTIONS = new Set(['start', 'stop', 'pause'] as const);

    it('accepts a valid enum value', () => {
        expect(validateEnum('start', 'action', ACTIONS)).toBe('start');
        expect(validateEnum('stop', 'action', ACTIONS)).toBe('stop');
        expect(validateEnum('pause', 'action', ACTIONS)).toBe('pause');
    });

    it('rejects an invalid enum value', () => {
        expect(() => validateEnum('restart', 'action', ACTIONS)).toThrow(/must be one of/);
    });

    it('includes valid options in error message', () => {
        expect(() => validateEnum('bad', 'action', ACTIONS)).toThrow(/start, stop, pause/);
    });

    it('includes actual value in error message', () => {
        expect(() => validateEnum('bad', 'action', ACTIONS)).toThrow(/got "bad"/);
    });

    it('rejects non-string values', () => {
        expect(() => validateEnum(123, 'action', ACTIONS)).toThrow(/must be a string/);
    });

    it('works with readonly array as well as Set', () => {
        const MODES = ['manual', 'cli', 'terminal'] as const;
        expect(validateEnum('cli', 'mode', MODES)).toBe('cli');
        expect(() => validateEnum('batch', 'mode', MODES)).toThrow(/must be one of/);
    });

    it('rejects overly long values', () => {
        expect(() => validateEnum('a'.repeat(201), 'action', ACTIONS)).toThrow(/exceeds maximum length/);
    });
});

// ============================================================================
// validateOptionalEnum
// ============================================================================

describe('validateOptionalEnum', () => {
    const MODES = new Set(['a', 'b', 'c'] as const);

    it('returns undefined for null/undefined/empty', () => {
        expect(validateOptionalEnum(undefined, 'mode', MODES)).toBeUndefined();
        expect(validateOptionalEnum(null, 'mode', MODES)).toBeUndefined();
        expect(validateOptionalEnum('', 'mode', MODES)).toBeUndefined();
    });

    it('validates present enum values', () => {
        expect(validateOptionalEnum('a', 'mode', MODES)).toBe('a');
    });

    it('rejects invalid enum values when present', () => {
        expect(() => validateOptionalEnum('d', 'mode', MODES)).toThrow(/must be one of/);
    });
});
