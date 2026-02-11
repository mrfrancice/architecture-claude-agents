/**
 * Safe logging utility for the MCP Orchestrator.
 *
 * Provides structured, sanitized logging that:
 * - Prevents log injection (strips control characters and newlines from interpolated values)
 * - Truncates overly long messages to prevent log flooding
 * - Adds consistent prefixes for log categorization
 *
 * All output goes to stderr (MCP protocol uses stdout for JSON-RPC).
 */

// ============================================================================
// CONSTANTS
// ============================================================================

/** Maximum length for a single log message (characters). */
const MAX_LOG_LENGTH = 2000;

/** Maximum length for a single interpolated value in a log message. */
const MAX_VALUE_LENGTH = 500;

// ============================================================================
// SANITIZATION
// ============================================================================

/**
 * Sanitizes a value for safe inclusion in log output.
 * Strips control characters (except space), truncates long values,
 * and prevents log injection via embedded newlines.
 *
 * Exported so other modules can sanitize values before including them
 * in user-facing messages (e.g. error responses).
 */
export function sanitizeValue(value: unknown): string {
    let str: string;

    if (value === null || value === undefined) {
        return String(value);
    } else if (typeof value === 'string') {
        str = value;
    } else if (value instanceof Error) {
        str = value.message;
    } else if (typeof value === 'object') {
        try {
            str = JSON.stringify(value);
        } catch {
            str = '[Unserializable object]';
        }
    } else {
        str = String(value);
    }

    // Strip control characters except space (0x20) and tab (0x09)
    // This prevents ANSI escape injection, carriage return overwrite, etc.
    // eslint-disable-next-line no-control-regex
    str = str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    // Replace newlines with a visible marker to prevent log line injection
    str = str.replace(/\r?\n/g, ' | ');

    // Truncate
    if (str.length > MAX_VALUE_LENGTH) {
        str = str.slice(0, MAX_VALUE_LENGTH) + '...[truncated]';
    }

    return str;
}

// ============================================================================
// LOGGER
// ============================================================================

/**
 * Logs an informational message to stderr with the [orchestrator] prefix.
 */
export function logInfo(message: string, ...values: unknown[]): void {
    const sanitizedValues = values.map(sanitizeValue);
    let msg = `[orchestrator] ${message}`;
    if (sanitizedValues.length > 0) {
        msg += ' ' + sanitizedValues.join(' ');
    }
    if (msg.length > MAX_LOG_LENGTH) {
        msg = msg.slice(0, MAX_LOG_LENGTH) + '...[truncated]';
    }
    console.error(msg);
}

/**
 * Logs a warning message to stderr with the [orchestrator] WARNING prefix.
 */
export function logWarn(message: string, ...values: unknown[]): void {
    const sanitizedValues = values.map(sanitizeValue);
    let msg = `[orchestrator] WARNING: ${message}`;
    if (sanitizedValues.length > 0) {
        msg += ' ' + sanitizedValues.join(' ');
    }
    if (msg.length > MAX_LOG_LENGTH) {
        msg = msg.slice(0, MAX_LOG_LENGTH) + '...[truncated]';
    }
    console.error(msg);
}

/**
 * Logs an error message to stderr with the [orchestrator] ERROR prefix.
 * Safely handles Error objects without exposing stack traces in production logs.
 */
export function logError(message: string, error?: unknown): void {
    const sanitizedError = error !== undefined ? sanitizeValue(error) : '';
    let msg = `[orchestrator] ERROR: ${message}`;
    if (sanitizedError) {
        msg += ` - ${sanitizedError}`;
    }
    if (msg.length > MAX_LOG_LENGTH) {
        msg = msg.slice(0, MAX_LOG_LENGTH) + '...[truncated]';
    }
    console.error(msg);
}

/**
 * Logs a debug message to stderr with the [orchestrator] DEBUG prefix.
 * Only emits when ORCHESTRATOR_DEBUG environment variable is set to "1" or "true".
 * Useful for verbose tracing without polluting production logs.
 */
export function logDebug(message: string, ...values: unknown[]): void {
    const envDebug = process.env.ORCHESTRATOR_DEBUG;
    if (envDebug !== '1' && envDebug !== 'true') return;

    const sanitizedValues = values.map(sanitizeValue);
    let msg = `[orchestrator] DEBUG: ${message}`;
    if (sanitizedValues.length > 0) {
        msg += ' ' + sanitizedValues.join(' ');
    }
    if (msg.length > MAX_LOG_LENGTH) {
        msg = msg.slice(0, MAX_LOG_LENGTH) + '...[truncated]';
    }
    console.error(msg);
}
