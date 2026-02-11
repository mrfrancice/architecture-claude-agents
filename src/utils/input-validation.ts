/**
 * Input validation utilities for MCP tool parameters.
 *
 * Provides defense-in-depth validation: string length limits, pattern checks,
 * array bounds, and path traversal prevention. All functions throw on invalid
 * input with descriptive error messages.
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum lengths for various string parameters (in characters). */
export const MAX_LENGTHS = {
    /** Workflow task description */
    task: 10_000,
    /** Phase output text */
    output: 500_000,
    /** Memory content */
    memoryContent: 100_000,
    /** Memory / snapshot / workflow name */
    name: 200,
    /** Agent system prompt */
    systemPrompt: 50_000,
    /** Agent description */
    description: 5_000,
    /** Generic short ID (agent_id, phaseId, snapshotId, etc.) */
    id: 200,
    /** Individual capability string */
    capability: 500,
    /** File path */
    filePath: 500,
} as const;

/** Maximum array sizes for list parameters. */
export const MAX_ARRAY_LENGTHS = {
    files: 500,
    capabilities: 50,
} as const;

/** Pattern for valid IDs: alphanumeric, hyphens, underscores, dots. */
const ID_PATTERN = /^[\w.:-]{1,200}$/;

/** Characters forbidden in memory/file names to prevent path traversal. */
const PATH_TRAVERSAL_PATTERN = /\.\.[/\\]/;

// ============================================================================
// VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates that a string parameter does not exceed the given max length.
 * Returns the string unchanged if valid; throws otherwise.
 */
export function validateStringLength(
    value: unknown,
    paramName: string,
    maxLength: number,
): string {
    if (typeof value !== 'string') {
        throw new Error(`Parameter "${paramName}" must be a string`);
    }
    if (value.length > maxLength) {
        throw new Error(
            `Parameter "${paramName}" exceeds maximum length of ${maxLength} characters (got ${value.length})`,
        );
    }
    return value;
}

/**
 * Validates an optional string parameter: if present, enforces max length.
 * Returns the string or undefined.
 */
export function validateOptionalString(
    value: unknown,
    paramName: string,
    maxLength: number,
): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return validateStringLength(value, paramName, maxLength);
}

/**
 * Validates a short identifier (agent_id, phaseId, snapshotId, etc.).
 * Must match alphanumeric + hyphens/underscores/dots/colons pattern.
 */
export function validateId(value: unknown, paramName: string): string {
    const str = validateStringLength(value, paramName, MAX_LENGTHS.id);
    if (!ID_PATTERN.test(str)) {
        throw new Error(
            `Parameter "${paramName}" contains invalid characters. ` +
            `Only alphanumeric, hyphens, underscores, dots, and colons are allowed.`,
        );
    }
    return str;
}

/**
 * Validates an optional ID parameter.
 */
export function validateOptionalId(value: unknown, paramName: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return validateId(value, paramName);
}

/**
 * Validates a name parameter: enforces length and prevents path traversal.
 */
export function validateName(value: unknown, paramName: string): string {
    const str = validateStringLength(value, paramName, MAX_LENGTHS.name);
    if (PATH_TRAVERSAL_PATTERN.test(str)) {
        throw new Error(
            `Parameter "${paramName}" contains path traversal sequences ("../" or "..\\")`
        );
    }
    // Prevent null bytes
    if (str.includes('\0')) {
        throw new Error(`Parameter "${paramName}" contains null bytes`);
    }
    return str;
}

/**
 * Validates an optional name parameter.
 */
export function validateOptionalName(value: unknown, paramName: string): string | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return validateName(value, paramName);
}

/**
 * Validates a file path: enforces length, prevents path traversal and null bytes.
 */
export function validateFilePath(value: unknown, paramName: string): string {
    const str = validateStringLength(value, paramName, MAX_LENGTHS.filePath);
    if (PATH_TRAVERSAL_PATTERN.test(str)) {
        throw new Error(
            `Parameter "${paramName}" contains path traversal sequences`,
        );
    }
    if (str.includes('\0')) {
        throw new Error(`Parameter "${paramName}" contains null bytes`);
    }
    return str;
}

/**
 * Validates an array parameter: checks type, enforces max length,
 * and validates each element as a string within maxElementLength.
 */
export function validateStringArray(
    value: unknown,
    paramName: string,
    maxArrayLength: number,
    maxElementLength: number,
): string[] {
    if (!Array.isArray(value)) {
        throw new Error(`Parameter "${paramName}" must be an array`);
    }
    if (value.length > maxArrayLength) {
        throw new Error(
            `Parameter "${paramName}" exceeds maximum length of ${maxArrayLength} items (got ${value.length})`,
        );
    }
    return value.map((item, index) => {
        if (typeof item !== 'string') {
            throw new Error(`Parameter "${paramName}[${index}]" must be a string`);
        }
        if (item.length > maxElementLength) {
            throw new Error(
                `Parameter "${paramName}[${index}]" exceeds maximum length of ${maxElementLength} characters`,
            );
        }
        return item;
    });
}

/**
 * Validates an optional string array parameter.
 */
export function validateOptionalStringArray(
    value: unknown,
    paramName: string,
    maxArrayLength: number,
    maxElementLength: number,
): string[] | undefined {
    if (value === undefined || value === null) return undefined;
    return validateStringArray(value, paramName, maxArrayLength, maxElementLength);
}

/**
 * Validates a boolean parameter: must be a real boolean.
 * Rejects truthy/falsy coercion (e.g. strings, numbers).
 */
export function validateBoolean(
    value: unknown,
    paramName: string,
): boolean {
    if (typeof value !== 'boolean') {
        throw new Error(`Parameter "${paramName}" must be a boolean (got ${typeof value})`);
    }
    return value;
}

/**
 * Validates an optional boolean parameter.
 * Returns the boolean value, or the provided default when absent.
 */
export function validateOptionalBoolean(
    value: unknown,
    paramName: string,
    defaultValue: boolean = false,
): boolean {
    if (value === undefined || value === null) return defaultValue;
    return validateBoolean(value, paramName);
}

/**
 * Validates that a string value belongs to a fixed set of allowed values.
 * Produces a clear error message listing all valid options.
 */
export function validateEnum<T extends string>(
    value: unknown,
    paramName: string,
    allowedValues: ReadonlySet<T> | readonly T[],
): T {
    const str = validateStringLength(value, paramName, 200);
    const allowed = allowedValues instanceof Set ? allowedValues : new Set(allowedValues);
    if (!allowed.has(str as T)) {
        const options = [...allowed].join(', ');
        throw new Error(`Parameter "${paramName}" must be one of: ${options} (got "${str}")`);
    }
    return str as T;
}

/**
 * Validates an optional enum parameter.
 * Returns the value or undefined when absent.
 */
export function validateOptionalEnum<T extends string>(
    value: unknown,
    paramName: string,
    allowedValues: ReadonlySet<T> | readonly T[],
): T | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    return validateEnum(value, paramName, allowedValues);
}
