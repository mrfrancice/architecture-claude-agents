import { describe, it, expect } from 'vitest';
import { capitalize, slugify, truncate } from '../src/utils/string-helpers.js';

// ─────────────────────────────────────────────────────────────
// capitalize
// ─────────────────────────────────────────────────────────────

describe('capitalize', () => {
    // ── Happy path ──────────────────────────────────────────
    it('should capitalize the first letter of a lowercase word', () => {
        expect(capitalize('hello')).toBe('Hello');
    });

    it('should leave an already-capitalized string unchanged', () => {
        expect(capitalize('Hello')).toBe('Hello');
    });

    it('should capitalize only the first character, leaving the rest intact', () => {
        expect(capitalize('hELLO wORLD')).toBe('HELLO wORLD');
    });

    it('should handle a multi-word sentence', () => {
        expect(capitalize('hello world')).toBe('Hello world');
    });

    // ── Single characters ───────────────────────────────────
    it('should capitalize a single lowercase letter', () => {
        expect(capitalize('a')).toBe('A');
    });

    it('should leave a single uppercase letter unchanged', () => {
        expect(capitalize('Z')).toBe('Z');
    });

    // ── Strings starting with non-alpha characters ──────────
    it('should return unchanged when the first char is a digit', () => {
        expect(capitalize('123abc')).toBe('123abc');
    });

    it('should return unchanged when the first char is a symbol', () => {
        expect(capitalize('!bang')).toBe('!bang');
    });

    it('should return unchanged when the first char is a space', () => {
        expect(capitalize(' leading space')).toBe(' leading space');
    });

    // ── Unicode ─────────────────────────────────────────────
    it('should capitalize accented characters', () => {
        expect(capitalize('étudiant')).toBe('Étudiant');
    });

    it('should handle emoji at the start (no crash)', () => {
        const result = capitalize('🎉 party');
        // charAt(0) on a surrogate pair returns the high surrogate
        // The function should not crash
        expect(typeof result).toBe('string');
        expect(result.length).toBeGreaterThan(0);
    });

    // ── Edge cases / null-ish ───────────────────────────────
    it('should return empty string for empty input', () => {
        expect(capitalize('')).toBe('');
    });

    it('should return empty string for null', () => {
        expect(capitalize(null as any)).toBe('');
    });

    it('should return empty string for undefined', () => {
        expect(capitalize(undefined as any)).toBe('');
    });

    // ── Whitespace-only strings ─────────────────────────────
    it('should return a whitespace string as-is (no crash)', () => {
        expect(capitalize('   ')).toBe('   ');
    });

    it('should handle tab characters', () => {
        expect(capitalize('\thello')).toBe('\thello');
    });
});

// ─────────────────────────────────────────────────────────────
// slugify
// ─────────────────────────────────────────────────────────────

describe('slugify', () => {
    // ── Happy path ──────────────────────────────────────────
    it('should convert "Hello World" to "hello-world"', () => {
        expect(slugify('Hello World')).toBe('hello-world');
    });

    it('should handle a typical page title', () => {
        expect(slugify('My Blog Post Title')).toBe('my-blog-post-title');
    });

    // ── Accented / international characters ─────────────────
    it('should strip diacritics (crème brûlée)', () => {
        expect(slugify('crème brûlée')).toBe('creme-brulee');
    });

    it('should handle German umlauts', () => {
        expect(slugify('Ärger über Öl')).toBe('arger-uber-ol');
    });

    it('should handle Scandinavian characters', () => {
        expect(slugify('Ångström Ørsted')).toBe('angstrom-rsted');
    });

    // ── Special characters ──────────────────────────────────
    it('should strip exclamation marks and other punctuation', () => {
        expect(slugify('Hello World!')).toBe('hello-world');
    });

    it('should handle ampersands', () => {
        expect(slugify('Rock & Roll')).toBe('rock-roll');
    });

    it('should handle parentheses and brackets', () => {
        expect(slugify('Something (with parens) [and brackets]')).toBe(
            'something-with-parens-and-brackets',
        );
    });

    it('should handle dots and underscores', () => {
        expect(slugify('file_name.test.ts')).toBe('file-name-test-ts');
    });

    it('should handle @ and # symbols', () => {
        expect(slugify('@user #tag')).toBe('user-tag');
    });

    // ── Whitespace handling ─────────────────────────────────
    it('should collapse multiple spaces into a single hyphen', () => {
        expect(slugify('  Foo  BAR  baz  ')).toBe('foo-bar-baz');
    });

    it('should trim leading and trailing whitespace (no leading/trailing hyphens)', () => {
        expect(slugify('   hello   ')).toBe('hello');
    });

    it('should handle tabs and newlines', () => {
        expect(slugify('hello\tworld\nfoo')).toBe('hello-world-foo');
    });

    // ── Already-slugified input ─────────────────────────────
    it('should return an already-valid slug unchanged', () => {
        expect(slugify('already-a-slug')).toBe('already-a-slug');
    });

    it('should lowercase an uppercase slug', () => {
        expect(slugify('UPPER-CASE')).toBe('upper-case');
    });

    // ── Numbers ─────────────────────────────────────────────
    it('should preserve numbers', () => {
        expect(slugify('ES2022 Modules')).toBe('es2022-modules');
    });

    it('should handle numeric-only input', () => {
        expect(slugify('12345')).toBe('12345');
    });

    // ── Edge cases / null-ish ───────────────────────────────
    it('should return empty string for empty input', () => {
        expect(slugify('')).toBe('');
    });

    it('should return empty string for null', () => {
        expect(slugify(null as any)).toBe('');
    });

    it('should return empty string for undefined', () => {
        expect(slugify(undefined as any)).toBe('');
    });

    // ── All-special-characters input ────────────────────────
    it('should return empty string when input is only special characters', () => {
        expect(slugify('!@#$%^&*()')).toBe('');
    });

    it('should return empty string for whitespace-only input', () => {
        expect(slugify('     ')).toBe('');
    });

    // ── Consecutive hyphens ─────────────────────────────────
    it('should collapse multiple hyphens into one', () => {
        expect(slugify('a---b')).toBe('a-b');
    });

    it('should handle mixed separators (hyphens, underscores, spaces)', () => {
        expect(slugify('a - b _ c   d')).toBe('a-b-c-d');
    });
});

// ─────────────────────────────────────────────────────────────
// truncate
// ─────────────────────────────────────────────────────────────

describe('truncate', () => {
    // ── Happy path ──────────────────────────────────────────
    it('should truncate and append "..." when string exceeds maxLen', () => {
        expect(truncate('Hello World', 5)).toBe('He...');
    });

    it('should return original string when shorter than maxLen', () => {
        expect(truncate('Hi', 10)).toBe('Hi');
    });

    it('should return original string when exactly equal to maxLen', () => {
        expect(truncate('Hello', 5)).toBe('Hello');
    });

    // ── Ellipsis counted in maxLen ──────────────────────────
    it('should include the "..." within maxLen (not added on top)', () => {
        const result = truncate('Hello World', 8);
        expect(result).toBe('Hello...');
        expect(result.length).toBe(8);
    });

    it('should truncate a long sentence correctly', () => {
        const result = truncate('The quick brown fox jumps over the lazy dog', 20);
        expect(result).toBe('The quick brown f...');
        expect(result.length).toBe(20);
    });

    // ── Boundary: maxLen exactly at string length ± 1 ───────
    it('should not truncate when maxLen is exactly the string length', () => {
        expect(truncate('abcde', 5)).toBe('abcde');
    });

    it('should truncate when maxLen is one less than string length', () => {
        const result = truncate('abcde', 4);
        expect(result).toBe('a...');
        expect(result.length).toBe(4);
    });

    it('should not truncate when maxLen is one more than string length', () => {
        expect(truncate('abcde', 6)).toBe('abcde');
    });

    // ── Small maxLen values (≤ 3) ───────────────────────────
    it('should return "..." when maxLen is 3 and string is longer', () => {
        expect(truncate('Hello World', 3)).toBe('...');
    });

    it('should return ".." when maxLen is 2 and string is longer', () => {
        expect(truncate('Hello World', 2)).toBe('..');
    });

    it('should return "." when maxLen is 1 and string is longer', () => {
        expect(truncate('Hello World', 1)).toBe('.');
    });

    it('should return "" when maxLen is 0', () => {
        expect(truncate('Hello World', 0)).toBe('');
    });

    // ── Negative maxLen ─────────────────────────────────────
    it('should return empty string for negative maxLen', () => {
        expect(truncate('Hello', -1)).toBe('');
    });

    it('should return empty string for large negative maxLen', () => {
        expect(truncate('Hello', -100)).toBe('');
    });

    // ── Edge cases / null-ish ───────────────────────────────
    it('should return empty string for empty input', () => {
        expect(truncate('', 5)).toBe('');
    });

    it('should return empty string for null', () => {
        expect(truncate(null as any, 5)).toBe('');
    });

    it('should return empty string for undefined', () => {
        expect(truncate(undefined as any, 5)).toBe('');
    });

    // ── Very large maxLen ───────────────────────────────────
    it('should return original string when maxLen is very large', () => {
        expect(truncate('short', 10000)).toBe('short');
    });

    // ── maxLen = 4 (boundary: first case where we get 1 char + "...") ──
    it('should show exactly 1 character + ellipsis when maxLen is 4', () => {
        const result = truncate('Hello World', 4);
        expect(result).toBe('H...');
        expect(result.length).toBe(4);
    });

    // ── Whitespace handling ─────────────────────────────────
    it('should truncate strings with spaces (no special trim)', () => {
        expect(truncate('a b c d e f g', 7)).toBe('a b ...');
    });

    // ── Unicode in truncated output ─────────────────────────
    it('should truncate a unicode string by character index', () => {
        const result = truncate('Héllo Wörld', 7);
        // slice(0, 4) = 'Héll' + '...' = 'Héll...' (length 7)
        expect(result).toBe('Héll...');
        expect(result.length).toBe(7);
    });

    // ── Short string with small maxLen (no truncation needed) ──
    it('should not truncate "Hi" with maxLen 3', () => {
        expect(truncate('Hi', 3)).toBe('Hi');
    });

    it('should not truncate "Hi" with maxLen 2', () => {
        expect(truncate('Hi', 2)).toBe('Hi');
    });

    it('should not truncate single char with maxLen 1', () => {
        expect(truncate('H', 1)).toBe('H');
    });
});
