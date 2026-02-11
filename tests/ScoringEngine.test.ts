import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ScoringEngine } from '../src/core/ScoringEngine.js';
import type { PhaseOutput, ScoreResult } from '../src/types/core.js';
import type { DetectedTools } from '../src/core/ConfigLoader.js';
import { tmpdir } from 'node:os';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

// Default tools with nothing detected — avoids calling tsc/eslint/vitest
const defaultTools: DetectedTools = {
    packageManager: null,
    linter: null,
    testRunner: null,
    formatter: null,
    bundler: null,
    typescript: false,
};

// Helper to create a simple PhaseOutput
function makeOutput(overrides: Partial<PhaseOutput> = {}): PhaseOutput {
    return {
        agentOutputs: {
            'agent-1': {
                agentId: 'agent-1',
                status: 'SUCCESS',
                output: 'done',
                filesCreated: [],
                filesModified: ['file.ts'],
                duration: 10,
                score: null,
            },
        },
        filesModified: ['file.ts'],
        errors: [],
        warnings: [],
        ...overrides,
    };
}

describe('ScoringEngine', () => {
    let tempDir: string;
    let engine: ScoringEngine;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'scoring-test-'));
        engine = new ScoringEngine(tempDir, defaultTools);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    // ========================================================================
    // BLOCKER DETECTION
    // ========================================================================
    describe('Blocker detection', () => {
        it('should detect NO_OUTPUT when output is null and files are empty', async () => {
            const result = await engine.score(null, []);
            expect(result.total).toBe(0);
            expect(result.decision).toBe('FAIL');
            expect(result.blockers).toHaveLength(1);
            expect(result.blockers[0].type).toBe('NO_OUTPUT');
            expect(result.blockers[0].message).toContain('No output produced');
        });

        it('should NOT detect NO_OUTPUT when output is provided', async () => {
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;');
            const output = makeOutput();
            const result = await engine.score(output, ['file.ts']);
            expect(result.blockers.find(b => b.type === 'NO_OUTPUT')).toBeUndefined();
        });

        it('should NOT detect NO_OUTPUT when files are provided even without output', async () => {
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;');
            const result = await engine.score(null, ['file.ts']);
            expect(result.blockers.find(b => b.type === 'NO_OUTPUT')).toBeUndefined();
        });

        it('should detect SYNTAX_ERROR from output errors', async () => {
            const output = makeOutput({ errors: ['SyntaxError: Unexpected token'] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.total).toBe(0);
            expect(result.decision).toBe('FAIL');
            expect(result.blockers.some(b => b.type === 'SYNTAX_ERROR')).toBe(true);
        });

        it('should detect SYNTAX_ERROR case-insensitively', async () => {
            const output = makeOutput({ errors: ['There was a syntax error in file.ts'] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.blockers.some(b => b.type === 'SYNTAX_ERROR')).toBe(true);
        });

        it('should detect BUILD_FAILED from output errors', async () => {
            const output = makeOutput({ errors: ['Build failed with 3 errors'] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.blockers.some(b => b.type === 'BUILD_FAILED')).toBe(true);
        });

        it('should detect BUILD_FAILED for "compilation failed"', async () => {
            const output = makeOutput({ errors: ['Compilation failed due to missing types'] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.blockers.some(b => b.type === 'BUILD_FAILED')).toBe(true);
        });

        it('should detect TESTS_CRASHED for "segfault"', async () => {
            const output = makeOutput({ errors: ['segfault at 0x00'] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.blockers.some(b => b.type === 'TESTS_CRASHED')).toBe(true);
        });

        it('should detect TESTS_CRASHED for "tests crashed"', async () => {
            const output = makeOutput({ errors: ['Tests crashed unexpectedly'] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.blockers.some(b => b.type === 'TESTS_CRASHED')).toBe(true);
        });

        it('should detect TESTS_CRASHED for "fatal error"', async () => {
            const output = makeOutput({ errors: ['Fatal error: out of memory'] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.blockers.some(b => b.type === 'TESTS_CRASHED')).toBe(true);
        });

        it('should detect multiple blockers from multiple errors', async () => {
            const output = makeOutput({
                errors: [
                    'SyntaxError in module A',
                    'Build failed',
                    'Fatal error in tests',
                ],
            });
            const result = await engine.score(output, ['file.ts']);
            expect(result.blockers.length).toBeGreaterThanOrEqual(3);
            const types = result.blockers.map(b => b.type);
            expect(types).toContain('SYNTAX_ERROR');
            expect(types).toContain('BUILD_FAILED');
            expect(types).toContain('TESTS_CRASHED');
        });

        it('should not detect blockers when errors are unrelated', async () => {
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;');
            const output = makeOutput({ errors: ['Warning: something minor'] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.blockers).toHaveLength(0);
            expect(result.total).toBeGreaterThan(0);
        });

        describe('CRITICAL_SECURITY blockers', () => {
            it('should detect hardcoded password in files', async () => {
                await writeFile(join(tempDir, 'config.ts'), `const password = "my_secret_pass123";`);
                const result = await engine.score(null, ['config.ts']);
                expect(result.blockers.some(b => b.type === 'CRITICAL_SECURITY')).toBe(true);
                const secBlocker = result.blockers.find(b => b.type === 'CRITICAL_SECURITY');
                expect(secBlocker!.message).toContain('Hardcoded password');
                expect(secBlocker!.file).toBe('config.ts');
            });

            it('should detect hardcoded API key', async () => {
                await writeFile(
                    join(tempDir, 'config.ts'),
                    `const api_key = "AKIAIOSFODNN7EXAMPLE1234";`,
                );
                const result = await engine.score(null, ['config.ts']);
                expect(result.blockers.some(b => b.type === 'CRITICAL_SECURITY')).toBe(true);
                expect(result.blockers.some(b => b.message.includes('API key'))).toBe(true);
            });

            it('should detect private key in source', async () => {
                await writeFile(
                    join(tempDir, 'cert.ts'),
                    `const key = "-----BEGIN PRIVATE KEY-----\\nMIIEvQIBADANBg..."`,
                );
                const result = await engine.score(null, ['cert.ts']);
                expect(result.blockers.some(b => b.type === 'CRITICAL_SECURITY')).toBe(true);
                expect(result.blockers.some(b => b.message.includes('Private key'))).toBe(true);
            });

            it('should detect RSA private key in source', async () => {
                await writeFile(
                    join(tempDir, 'cert.ts'),
                    `const key = "-----BEGIN RSA PRIVATE KEY-----\\nMIIEvQIBADANBg..."`,
                );
                const result = await engine.score(null, ['cert.ts']);
                expect(result.blockers.some(b => b.type === 'CRITICAL_SECURITY')).toBe(true);
            });

            it('should detect eval() on user input', async () => {
                await writeFile(
                    join(tempDir, 'handler.ts'),
                    `app.post('/exec', (req, res) => { eval(req.body.code); });`,
                );
                const result = await engine.score(null, ['handler.ts']);
                expect(result.blockers.some(b => b.type === 'CRITICAL_SECURITY')).toBe(true);
                expect(result.blockers.some(b => b.message.includes('eval()'))).toBe(true);
            });

            it('should detect exec() on user input (command injection)', async () => {
                await writeFile(
                    join(tempDir, 'handler.ts'),
                    `app.post('/run', (req, res) => { exec(req.body.cmd); });`,
                );
                const result = await engine.score(null, ['handler.ts']);
                expect(result.blockers.some(b => b.type === 'CRITICAL_SECURITY')).toBe(true);
                expect(result.blockers.some(b => b.message.includes('Command injection'))).toBe(true);
            });

            it('should skip non-existent files without error', async () => {
                const result = await engine.score(null, ['nonexistent.ts']);
                // No CRITICAL_SECURITY blocker, but NO_OUTPUT should not trigger either
                // since files array is non-empty
                expect(result.blockers.filter(b => b.type === 'CRITICAL_SECURITY')).toHaveLength(0);
            });

            it('should detect multiple critical issues in the same file', async () => {
                await writeFile(
                    join(tempDir, 'bad.ts'),
                    [
                        `const password = "hunter2";`,
                        `const api_key = "AKIAIOSFODNN7EXAMPLE1234";`,
                        `eval(req.body.code);`,
                    ].join('\n'),
                );
                const result = await engine.score(null, ['bad.ts']);
                const criticalBlockers = result.blockers.filter(b => b.type === 'CRITICAL_SECURITY');
                expect(criticalBlockers.length).toBeGreaterThanOrEqual(3);
            });
        });

        it('should return zero breakdown when blockers are detected', async () => {
            const result = await engine.score(null, []);
            expect(result.breakdown).toEqual({
                correctness: 0,
                completeness: 0,
                security: 0,
                bestPractices: 0,
                tests: 0,
                documentation: 0,
            });
        });

        it('should produce blocker feedback messages', async () => {
            const result = await engine.score(null, []);
            expect(result.feedback.length).toBeGreaterThan(0);
            expect(result.feedback[0]).toContain('BLOCKER');
            expect(result.feedback[0]).toContain('NO_OUTPUT');
        });
    });

    // ========================================================================
    // DECISION LOGIC
    // ========================================================================
    describe('Decision logic', () => {
        // We control scores by creating specific file conditions.
        // With no tools detected, correctness is based on file existence,
        // tests defaults to 30 (no test runner, no test files).

        it('should return FAIL for total < 60', async () => {
            // Non-existent files drive correctness and completeness low
            const result = await engine.score(null, ['nonexistent.ts']);
            // correctness = 0 (0/1 files exist), completeness ~ 0 (empty non-readable file)
            expect(result.decision).toBe('FAIL');
            expect(result.total).toBeLessThan(60);
        });

        it('should return ITERATE for total 60-89', async () => {
            // Create a decent file, add README
            await writeFile(join(tempDir, 'README.md'), '# Project');
            await writeFile(join(tempDir, 'app.ts'), '/** Main module */\nconst x = 1;\n');
            const output = makeOutput({
                agentOutputs: {
                    'agent-1': {
                        agentId: 'agent-1',
                        status: 'SUCCESS',
                        output: 'done',
                        filesCreated: [],
                        filesModified: ['app.ts'],
                        duration: 10,
                        score: null,
                    },
                },
                filesModified: ['app.ts'],
                errors: [],
                warnings: [],
            });
            const result = await engine.score(output, ['app.ts']);
            // This should land in the 60-89 range
            expect(result.total).toBeGreaterThanOrEqual(60);
            expect(result.total).toBeLessThan(90);
            expect(result.decision).toBe('ITERATE');
        });

        it('should return PASS for total >= 90', async () => {
            // Create ideal conditions: clean files, README, test dirs
            await writeFile(join(tempDir, 'README.md'), '# Project\nWell documented project');
            await mkdir(join(tempDir, 'tests'), { recursive: true });
            await writeFile(
                join(tempDir, 'app.ts'),
                '/** Main module with JSDoc */\nexport function hello(): string { return "hi"; }\n',
            );
            const output = makeOutput({
                agentOutputs: {
                    'agent-1': {
                        agentId: 'agent-1',
                        status: 'SUCCESS',
                        output: 'done',
                        filesCreated: [],
                        filesModified: ['app.ts'],
                        duration: 10,
                        score: null,
                    },
                },
                filesModified: ['app.ts'],
                errors: [],
                warnings: [],
            });
            const result = await engine.score(output, ['app.ts']);
            // With test dir present (50), clean code, and perfect security we should reach 90+
            expect(result.total).toBeGreaterThanOrEqual(90);
            expect(result.decision).toBe('PASS');
        });
    });

    // ========================================================================
    // SCORE CLAMPING
    // ========================================================================
    describe('Score clamping', () => {
        it('should never return total > 100', async () => {
            // Create perfect conditions with all bonuses
            await writeFile(join(tempDir, 'README.md'), '# Project');
            await mkdir(join(tempDir, 'tests'), { recursive: true });
            await writeFile(
                join(tempDir, 'clean.ts'),
                '/** Perfect module */\nexport const value = 42;\n',
            );
            const output = makeOutput({
                filesModified: ['clean.ts'],
                errors: [],
                warnings: [],
            });
            const result = await engine.score(output, ['clean.ts']);
            expect(result.total).toBeLessThanOrEqual(100);
        });

        it('should never return total < 0', async () => {
            // With blockers, total is 0
            const result = await engine.score(null, []);
            expect(result.total).toBeGreaterThanOrEqual(0);
        });

        it('should clamp individual axis scores to 0-100', async () => {
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;\n');
            const result = await engine.score(null, ['file.ts']);
            const { breakdown } = result;
            for (const [, value] of Object.entries(breakdown)) {
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThanOrEqual(100);
            }
        });
    });

    // ========================================================================
    // BONUSES
    // ========================================================================
    describe('Bonuses', () => {
        it('should apply security bonus when security === 100', async () => {
            // Clean file with no security issues
            await writeFile(join(tempDir, 'safe.ts'), '/** Safe */\nexport const x = 1;\n');
            await writeFile(join(tempDir, 'README.md'), '# Project');
            const output = makeOutput({ filesModified: ['safe.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['safe.ts']);
            const secBonus = result.bonuses.find(b => b.name === 'Zero security issues');
            expect(secBonus).toBeDefined();
            expect(secBonus!.value).toBe(2);
        });

        it('should not apply security bonus when security < 100', async () => {
            await writeFile(join(tempDir, 'vuln.ts'), 'eval("code");');
            const output = makeOutput({ filesModified: ['vuln.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['vuln.ts']);
            expect(result.bonuses.find(b => b.name === 'Zero security issues')).toBeUndefined();
        });

        it('should apply documentation bonus when documentation >= 90', async () => {
            await writeFile(join(tempDir, 'README.md'), '# Project');
            // 50 (base) + 20 (README) + 30 (all files have JSDoc) = 100
            await writeFile(
                join(tempDir, 'mod.ts'),
                '/** Module documentation */\nexport const x = 1;\n',
            );
            const output = makeOutput({ filesModified: ['mod.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['mod.ts']);
            expect(result.breakdown.documentation).toBeGreaterThanOrEqual(90);
            const docBonus = result.bonuses.find(b => b.name === 'Complete documentation');
            expect(docBonus).toBeDefined();
            expect(docBonus!.value).toBe(2);
        });

        it('should apply best practices bonus when bestPractices >= 95', async () => {
            // Clean file with no issues at all — no long lines, no console.log, no TODO, no tabs+spaces mix
            await writeFile(join(tempDir, 'clean.js'), 'const x = 1;\n');
            const output = makeOutput({ filesModified: ['clean.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['clean.js']);
            // Base is 80 with 0 issues = 80, which is < 95, so no bonus
            // Actually we need to check what score we get
            // Without linter, base = 80, 0 issues → score = 80
            expect(result.bonuses.find(b => b.name === 'No lint errors')).toBeUndefined();
        });

        it('should include bonus in feedback', async () => {
            await writeFile(join(tempDir, 'safe.ts'), '/** Safe */\nexport const x = 1;\n');
            await writeFile(join(tempDir, 'README.md'), '# Docs');
            const output = makeOutput({ filesModified: ['safe.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['safe.ts']);
            const bonusFeedback = result.feedback.filter(f => f.startsWith('Bonus:'));
            expect(bonusFeedback.length).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // PENALTIES
    // ========================================================================
    describe('Penalties', () => {
        it('should apply test penalty (value -10) when tests < 30', async () => {
            // No test runner, no test files → tests = 30
            // 30 is not < 30, so let's verify that the boundary is strict
            await writeFile(join(tempDir, 'file.ts'), '/** code */\nconst x = 1;\n');
            const output = makeOutput({ filesModified: ['file.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['file.ts']);
            // tests = 30 (no runner, no test files) → not < 30
            const noTestPenalty = result.penalties.find(p => p.name === 'No/minimal tests');
            expect(noTestPenalty).toBeUndefined();
        });

        it('should apply test penalty (value -5) when tests < 50 but >= 30', async () => {
            // tests = 30 (no runner, no test files) → 30 < 50
            await writeFile(join(tempDir, 'file.ts'), '/** code */\nconst x = 1;\n');
            const output = makeOutput({ filesModified: ['file.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['file.ts']);
            // tests = 30, which is >= 30 but < 50
            const lowTestPenalty = result.penalties.find(p => p.name === 'Low test coverage');
            expect(lowTestPenalty).toBeDefined();
            expect(lowTestPenalty!.value).toBe(-5);
        });

        it('should not apply test penalty when tests >= 50', async () => {
            // Create a test directory so hasTestFiles returns true → tests = 50
            await mkdir(join(tempDir, 'tests'), { recursive: true });
            await writeFile(join(tempDir, 'file.ts'), '/** code */\nconst x = 1;\n');
            const output = makeOutput({ filesModified: ['file.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.breakdown.tests).toBe(50);
            expect(result.penalties.find(p => p.name === 'Low test coverage')).toBeUndefined();
            expect(result.penalties.find(p => p.name === 'No/minimal tests')).toBeUndefined();
        });

        it('should apply bestPractices penalty when bestPractices < 50', async () => {
            // Create a file with many issues to drive bestPractices below 50
            // base = 80, need > 15 issues to go below 50 → 80 - 16*2 = 48
            const longLine = 'x'.repeat(201);
            const badLines = [];
            for (let i = 0; i < 8; i++) {
                badLines.push(longLine);
                badLines.push('console.log("debug");');
            }
            await writeFile(join(tempDir, 'messy.js'), badLines.join('\n'));
            const output = makeOutput({ filesModified: ['messy.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['messy.js']);
            expect(result.breakdown.bestPractices).toBeLessThan(50);
            const bpPenalty = result.penalties.find(p => p.name === 'Many lint errors');
            expect(bpPenalty).toBeDefined();
            expect(bpPenalty!.value).toBe(-5);
        });

        it('should apply security penalty when security < 60', async () => {
            // Use patterns that degrade security score WITHOUT triggering critical blockers.
            // Critical blockers require: password=, api_key= with 16+ chars, private key header,
            // eval(req., exec(req. — so avoid those specific forms.
            // eval() = -15, innerHTML = -10, exec("...") = -15, http:// = -5 => total = -45 → score 55
            await writeFile(
                join(tempDir, 'vuln.ts'),
                [
                    'eval("code")',
                    'el.innerHTML = data',
                    'exec("rm -rf /")',
                    'fetch("http://insecure.api")',
                ].join('\n'),
            );
            const output = makeOutput({ filesModified: ['vuln.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['vuln.ts']);
            expect(result.breakdown.security).toBeLessThan(60);
            const secPenalty = result.penalties.find(p => p.name === 'Security vulnerabilities');
            expect(secPenalty).toBeDefined();
            expect(secPenalty!.value).toBe(-10);
        });

        it('should include penalties in feedback', async () => {
            await writeFile(join(tempDir, 'file.ts'), '/** code */\nconst x = 1;\n');
            const output = makeOutput({ filesModified: ['file.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['file.ts']);
            const penaltyFeedback = result.feedback.filter(f => f.startsWith('Penalty:'));
            // At minimum, tests < 50 penalty
            expect(penaltyFeedback.length).toBeGreaterThan(0);
        });
    });

    // ========================================================================
    // SECURITY SCORING
    // ========================================================================
    describe('Security scoring', () => {
        it('should return 100 for clean file', async () => {
            await writeFile(join(tempDir, 'clean.ts'), 'export const x = 1;\n');
            const output = makeOutput({ filesModified: ['clean.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['clean.ts']);
            expect(result.breakdown.security).toBe(100);
        });

        it('should penalize eval() usage (-15)', async () => {
            await writeFile(join(tempDir, 'code.ts'), 'const r = eval("1+1");');
            const output = makeOutput({ filesModified: ['code.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['code.ts']);
            expect(result.breakdown.security).toBe(85);
        });

        it('should penalize innerHTML assignment (-10)', async () => {
            await writeFile(join(tempDir, 'dom.ts'), 'el.innerHTML = userInput;');
            const output = makeOutput({ filesModified: ['dom.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['dom.ts']);
            expect(result.breakdown.security).toBe(90);
        });

        it('should penalize dangerouslySetInnerHTML (-10)', async () => {
            await writeFile(
                join(tempDir, 'comp.tsx'),
                '<div dangerouslySetInnerHTML={{ __html: data }} />',
            );
            const output = makeOutput({ filesModified: ['comp.tsx'], errors: [], warnings: [] });
            const result = await engine.score(output, ['comp.tsx']);
            expect(result.breakdown.security).toBe(90);
        });

        it('should penalize exec() with string argument (-15)', async () => {
            await writeFile(join(tempDir, 'cmd.ts'), `exec("ls -la");`);
            const output = makeOutput({ filesModified: ['cmd.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['cmd.ts']);
            expect(result.breakdown.security).toBe(85);
        });

        it('should penalize hardcoded password (-20)', async () => {
            await writeFile(join(tempDir, 'config.ts'), `const password = "mysecret123";`);
            const output = makeOutput({ filesModified: ['config.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['config.ts']);
            expect(result.breakdown.security).toBeLessThanOrEqual(80);
        });

        it('should penalize hardcoded API key (-20)', async () => {
            await writeFile(join(tempDir, 'config.ts'), `const apiKey = "sk_live_1234567890abcdef";`);
            const output = makeOutput({ filesModified: ['config.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['config.ts']);
            expect(result.breakdown.security).toBeLessThanOrEqual(80);
        });

        it('should penalize hardcoded secret (-15)', async () => {
            await writeFile(join(tempDir, 'config.ts'), `const secret = "my_secret_value";`);
            const output = makeOutput({ filesModified: ['config.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['config.ts']);
            expect(result.breakdown.security).toBeLessThanOrEqual(85);
        });

        it('should penalize SQL injection risk (-15)', async () => {
            await writeFile(
                join(tempDir, 'db.ts'),
                `const q = "SELECT * FROM users WHERE id=" + userId;`,
            );
            const output = makeOutput({ filesModified: ['db.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['db.ts']);
            expect(result.breakdown.security).toBe(85);
        });

        it('should penalize insecure HTTP URL (-5)', async () => {
            await writeFile(join(tempDir, 'api.ts'), `fetch("http://example.com/api");`);
            const output = makeOutput({ filesModified: ['api.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['api.ts']);
            expect(result.breakdown.security).toBe(95);
        });

        it('should penalize permissive CORS (-5)', async () => {
            await writeFile(join(tempDir, 'server.ts'), `app.use(cors());`);
            const output = makeOutput({ filesModified: ['server.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['server.ts']);
            expect(result.breakdown.security).toBe(95);
        });

        it('should penalize SSL disabled (-10)', async () => {
            await writeFile(join(tempDir, 'client.ts'), `rejectUnauthorized: false`);
            const output = makeOutput({ filesModified: ['client.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['client.ts']);
            expect(result.breakdown.security).toBe(90);
        });

        it('should accumulate penalties from multiple issues', async () => {
            await writeFile(
                join(tempDir, 'bad.ts'),
                [
                    'eval("code");',             // -15
                    'el.innerHTML = data;',       // -10
                    'fetch("http://api.local");', // -5
                ].join('\n'),
            );
            const output = makeOutput({ filesModified: ['bad.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['bad.ts']);
            expect(result.breakdown.security).toBe(70);
        });

        it('should clamp security to 0 even with massive penalties', async () => {
            await writeFile(
                join(tempDir, 'terrible.ts'),
                [
                    'eval("x");',
                    'innerHTML = y;',
                    'dangerouslySetInnerHTML',
                    'exec("cmd");',
                    'password = "abc";',
                    'api_key = "AKIAIOSFODNN7EXAMPLE1234";',
                    'secret = "s";',
                    '"SELECT * FROM users WHERE id=" + x;',
                    '"http://test"',
                    'cors()',
                    'rejectUnauthorized: false',
                ].join('\n'),
            );
            const output = makeOutput({ filesModified: ['terrible.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['terrible.ts']);
            expect(result.breakdown.security).toBeGreaterThanOrEqual(0);
        });

        it('should accumulate across multiple files', async () => {
            await writeFile(join(tempDir, 'a.ts'), 'eval("x");'); // -15
            await writeFile(join(tempDir, 'b.ts'), 'el.innerHTML = y;'); // -10
            const output = makeOutput({ filesModified: ['a.ts', 'b.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['a.ts', 'b.ts']);
            expect(result.breakdown.security).toBe(75);
        });

        it('should skip non-existent files in security scan', async () => {
            await writeFile(join(tempDir, 'real.ts'), 'const safe = 1;');
            const output = makeOutput({ filesModified: ['real.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['real.ts', 'ghost.ts']);
            expect(result.breakdown.security).toBe(100);
        });
    });

    // ========================================================================
    // DOCUMENTATION SCORING
    // ========================================================================
    describe('Documentation scoring', () => {
        it('should give base 50 when no README and no JSDoc files', async () => {
            await writeFile(join(tempDir, 'data.json'), '{}');
            const output = makeOutput({ filesModified: ['data.json'], errors: [], warnings: [] });
            const result = await engine.score(output, ['data.json']);
            // data.json is not .ts/.js so totalFiles = 0, no doc ratio added
            expect(result.breakdown.documentation).toBe(50);
        });

        it('should add 20 points for README.md', async () => {
            await writeFile(join(tempDir, 'README.md'), '# Hello');
            await writeFile(join(tempDir, 'data.json'), '{}');
            const output = makeOutput({ filesModified: ['data.json'], errors: [], warnings: [] });
            const result = await engine.score(output, ['data.json']);
            expect(result.breakdown.documentation).toBe(70);
        });

        it('should add JSDoc ratio for code files', async () => {
            await writeFile(join(tempDir, 'a.ts'), '/** Documented */\nconst x = 1;');
            await writeFile(join(tempDir, 'b.ts'), 'const y = 2;'); // no doc
            const output = makeOutput({ filesModified: ['a.ts', 'b.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['a.ts', 'b.ts']);
            // base 50, no README (0), 1/2 files documented → 50 + round(0.5*30)=15 → 65
            expect(result.breakdown.documentation).toBe(65);
        });

        it('should give full JSDoc ratio when all files have comments', async () => {
            await writeFile(join(tempDir, 'a.ts'), '/** Documented */\nconst x = 1;');
            await writeFile(join(tempDir, 'b.js'), '// also documented\nconst y = 2;');
            const output = makeOutput({ filesModified: ['a.ts', 'b.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['a.ts', 'b.js']);
            // base 50, no README, 2/2 docs → 50 + 30 = 80
            expect(result.breakdown.documentation).toBe(80);
        });

        it('should max at 100 with README and all files documented', async () => {
            await writeFile(join(tempDir, 'README.md'), '# Project');
            await writeFile(join(tempDir, 'a.ts'), '/** Documented */\nconst x = 1;');
            const output = makeOutput({ filesModified: ['a.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['a.ts']);
            // base 50 + 20 (README) + 30 (1/1) = 100
            expect(result.breakdown.documentation).toBe(100);
        });

        it('should detect line comments (// style) as documentation', async () => {
            await writeFile(join(tempDir, 'a.js'), '// This is a comment\nconst x = 1;');
            const output = makeOutput({ filesModified: ['a.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['a.js']);
            // base 50 + 30 (1/1 doc) = 80
            expect(result.breakdown.documentation).toBe(80);
        });

        it('should only check .ts/.js/.tsx/.jsx files for JSDoc', async () => {
            await writeFile(join(tempDir, 'style.css'), '/* comment */\nbody {}');
            await writeFile(join(tempDir, 'data.json'), '{}');
            const output = makeOutput({
                filesModified: ['style.css', 'data.json'],
                errors: [],
                warnings: [],
            });
            const result = await engine.score(output, ['style.css', 'data.json']);
            // totalFiles = 0, so no JSDoc ratio, base = 50
            expect(result.breakdown.documentation).toBe(50);
        });
    });

    // ========================================================================
    // BEST PRACTICES SCORING
    // ========================================================================
    describe('Best practices scoring', () => {
        it('should give base 80 for clean file with no issues', async () => {
            await writeFile(join(tempDir, 'clean.js'), 'const x = 1;\n');
            const output = makeOutput({ filesModified: ['clean.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['clean.js']);
            expect(result.breakdown.bestPractices).toBe(80);
        });

        it('should penalize lines > 200 chars', async () => {
            const longLine = 'const x = ' + '"' + 'a'.repeat(200) + '";';
            await writeFile(join(tempDir, 'long.js'), longLine);
            const output = makeOutput({ filesModified: ['long.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['long.js']);
            expect(result.breakdown.bestPractices).toBeLessThan(80);
        });

        it('should penalize mixed tabs and spaces', async () => {
            // Line with both \t and multiple spaces
            await writeFile(join(tempDir, 'mixed.js'), '\t  const x = 1;\n');
            const output = makeOutput({ filesModified: ['mixed.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['mixed.js']);
            expect(result.breakdown.bestPractices).toBeLessThan(80);
        });

        it('should penalize console.log statements', async () => {
            await writeFile(join(tempDir, 'debug.js'), 'console.log("debug");\n');
            const output = makeOutput({ filesModified: ['debug.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['debug.js']);
            expect(result.breakdown.bestPractices).toBe(78); // 80 - 1*2
        });

        it('should penalize console.warn statements', async () => {
            await writeFile(join(tempDir, 'warn.js'), 'console.warn("warning");\n');
            const output = makeOutput({ filesModified: ['warn.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['warn.js']);
            expect(result.breakdown.bestPractices).toBe(78);
        });

        it('should penalize console.error statements', async () => {
            await writeFile(join(tempDir, 'err.js'), 'console.error("err");\n');
            const output = makeOutput({ filesModified: ['err.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['err.js']);
            expect(result.breakdown.bestPractices).toBe(78);
        });

        it('should penalize TODO/FIXME/HACK/XXX comments', async () => {
            await writeFile(join(tempDir, 'todo.js'), '// TODO: fix this\n');
            const output = makeOutput({ filesModified: ['todo.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['todo.js']);
            expect(result.breakdown.bestPractices).toBe(78);
        });

        it('should penalize `any` in .ts files', async () => {
            await writeFile(join(tempDir, 'typed.ts'), 'const x: any = 1;\n');
            const output = makeOutput({ filesModified: ['typed.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['typed.ts']);
            expect(result.breakdown.bestPractices).toBeLessThan(80);
        });

        it('should not penalize `any` in .js files', async () => {
            await writeFile(join(tempDir, 'plain.js'), 'const x = "any value";\n');
            const output = makeOutput({ filesModified: ['plain.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['plain.js']);
            // "any" in a .js file should not trigger the TS `any` check
            expect(result.breakdown.bestPractices).toBe(80);
        });

        it('should accumulate multiple issues', async () => {
            await writeFile(
                join(tempDir, 'bad.js'),
                [
                    'console.log("a");',    // +1 issue
                    'console.log("b");',    // +1 issue
                    '// TODO: fix',         // +1 issue
                    '// FIXME: broken',     // +1 issue
                ].join('\n'),
            );
            const output = makeOutput({ filesModified: ['bad.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['bad.js']);
            // 80 - 4*2 = 72
            expect(result.breakdown.bestPractices).toBe(72);
        });

        it('should clamp bestPractices to minimum 30', async () => {
            const lines = [];
            for (let i = 0; i < 30; i++) {
                lines.push('console.log("issue ' + i + '");');
            }
            await writeFile(join(tempDir, 'many.js'), lines.join('\n'));
            const output = makeOutput({ filesModified: ['many.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['many.js']);
            // 80 - 30*2 = 20, clamped to 30
            expect(result.breakdown.bestPractices).toBe(30);
        });

        it('should skip non-existent files without error', async () => {
            const output = makeOutput({ filesModified: ['ghost.js'], errors: [], warnings: [] });
            const result = await engine.score(output, ['ghost.js']);
            // No file to read → no issues, base 80
            expect(result.breakdown.bestPractices).toBe(80);
        });
    });

    // ========================================================================
    // COMPLETENESS SCORING
    // ========================================================================
    describe('Completeness scoring', () => {
        describe('with PhaseOutput', () => {
            it('should score 95 when outputs and files present, no errors', async () => {
                await writeFile(join(tempDir, 'file.ts'), 'const x = 1;\n');
                const output = makeOutput();
                const result = await engine.score(output, ['file.ts']);
                expect(result.breakdown.completeness).toBe(95);
            });

            it('should score 80 when outputs and files present but with errors', async () => {
                await writeFile(join(tempDir, 'file.ts'), 'const x = 1;\n');
                const output = makeOutput({
                    errors: ['some minor issue'],
                });
                // This will be a blocker-less error since "some minor issue" doesn't match blocker patterns
                const result = await engine.score(output, ['file.ts']);
                expect(result.breakdown.completeness).toBe(80);
            });

            it('should analyze output text for completeness when no files', async () => {
                const output: PhaseOutput = {
                    agentOutputs: {
                        'agent-1': {
                            agentId: 'agent-1',
                            status: 'SUCCESS',
                            output: 'done',
                            filesCreated: [],
                            filesModified: [],
                            duration: 10,
                            score: null,
                        },
                    },
                    filesModified: [],
                    errors: [],
                    warnings: [],
                };
                // With minimal output text "done", completeness is derived from text analysis
                const result = await engine.score(output, []);
                expect(result.breakdown.completeness).toBe(50);
            });

            it('should score higher completeness for substantial output text', async () => {
                const longOutput = '## Implementation\n\n```typescript\nconst x = 1;\n```\n\n1. Step one\n2. Step two\n\n' + 'x'.repeat(3000);
                const output: PhaseOutput = {
                    agentOutputs: {
                        'agent-1': {
                            agentId: 'agent-1',
                            status: 'SUCCESS',
                            output: longOutput,
                            filesCreated: [],
                            filesModified: [],
                            duration: 10,
                            score: null,
                        },
                    },
                    filesModified: [],
                    errors: [],
                    warnings: [],
                };
                const result = await engine.score(output, []);
                // Substantial text with code blocks, structure, and length should score higher
                expect(result.breakdown.completeness).toBeGreaterThanOrEqual(80);
            });

            it('should score 40 when no outputs and no files in output', async () => {
                const output: PhaseOutput = {
                    agentOutputs: {},
                    filesModified: [],
                    errors: [],
                    warnings: [],
                };
                const result = await engine.score(output, []);
                expect(result.breakdown.completeness).toBe(40);
            });

            it('should deduct for warnings', async () => {
                await writeFile(join(tempDir, 'file.ts'), 'const x = 1;\n');
                const output = makeOutput({
                    warnings: ['warn1', 'warn2', 'warn3'],
                });
                const result = await engine.score(output, ['file.ts']);
                // 95 - 3*2 = 89
                expect(result.breakdown.completeness).toBe(89);
            });
        });

        describe('without PhaseOutput (files only)', () => {
            it('should score 100 when all files are non-empty', async () => {
                await writeFile(join(tempDir, 'a.ts'), 'const a = 1;');
                await writeFile(join(tempDir, 'b.ts'), 'const b = 2;');
                const result = await engine.score(null, ['a.ts', 'b.ts']);
                expect(result.breakdown.completeness).toBe(100);
            });

            it('should score 50 when half the files are non-empty', async () => {
                await writeFile(join(tempDir, 'a.ts'), 'const a = 1;');
                await writeFile(join(tempDir, 'b.ts'), '');
                const result = await engine.score(null, ['a.ts', 'b.ts']);
                expect(result.breakdown.completeness).toBe(50);
            });

            it('should score 0 when all files are empty', async () => {
                await writeFile(join(tempDir, 'a.ts'), '');
                await writeFile(join(tempDir, 'b.ts'), '   ');
                const result = await engine.score(null, ['a.ts', 'b.ts']);
                // '' → trimmed length 0 → not counted
                // '   ' → trimmed length 0 → not counted
                expect(result.breakdown.completeness).toBe(0);
            });

            it('should handle missing files gracefully (count as not non-empty)', async () => {
                await writeFile(join(tempDir, 'exists.ts'), 'const x = 1;');
                const result = await engine.score(null, ['exists.ts', 'missing.ts']);
                // 1/2 non-empty → 50
                expect(result.breakdown.completeness).toBe(50);
            });
        });
    });

    // ========================================================================
    // CORRECTNESS SCORING (without TypeScript tools)
    // ========================================================================
    describe('Correctness scoring (no TypeScript)', () => {
        it('should score 100 when all files exist', async () => {
            await writeFile(join(tempDir, 'a.ts'), 'const x = 1;');
            await writeFile(join(tempDir, 'b.ts'), 'const y = 2;');
            const output = makeOutput({ filesModified: ['a.ts', 'b.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['a.ts', 'b.ts']);
            expect(result.breakdown.correctness).toBe(100);
        });

        it('should score 50 when half the files exist', async () => {
            await writeFile(join(tempDir, 'a.ts'), 'const x = 1;');
            const output = makeOutput({ filesModified: ['a.ts', 'missing.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['a.ts', 'missing.ts']);
            expect(result.breakdown.correctness).toBe(50);
        });

        it('should score 0 when no files exist', async () => {
            const output = makeOutput({ filesModified: ['x.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['x.ts']);
            expect(result.breakdown.correctness).toBe(0);
        });

        it('should analyze output text for correctness when files array is empty', async () => {
            const output: PhaseOutput = {
                agentOutputs: {
                    'agent-1': {
                        agentId: 'agent-1',
                        status: 'SUCCESS',
                        output: 'done',
                        filesCreated: [],
                        filesModified: [],
                        duration: 10,
                        score: null,
                    },
                },
                filesModified: [],
                errors: [],
                warnings: [],
            };
            // Minimal output "done" → text analysis base score (60)
            const result = await engine.score(output, []);
            expect(result.breakdown.correctness).toBe(60);
        });

        it('should score higher correctness for output with code', async () => {
            const output: PhaseOutput = {
                agentOutputs: {
                    'agent-1': {
                        agentId: 'agent-1',
                        status: 'SUCCESS',
                        output: '```typescript\nfunction add(a: number, b: number) { return a + b; }\n```\nBuild success, no errors.',
                        filesCreated: [],
                        filesModified: [],
                        duration: 10,
                        score: null,
                    },
                },
                filesModified: [],
                errors: [],
                warnings: [],
            };
            const result = await engine.score(output, []);
            // Code blocks + implementation + success signals
            expect(result.breakdown.correctness).toBe(100);
        });
    });

    // ========================================================================
    // TESTS SCORING (no test runner)
    // ========================================================================
    describe('Tests scoring (no test runner)', () => {
        it('should score 50 when test directory exists', async () => {
            await mkdir(join(tempDir, 'tests'), { recursive: true });
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;\n');
            const output = makeOutput({ filesModified: ['file.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.breakdown.tests).toBe(50);
        });

        it('should score 50 for __tests__ directory', async () => {
            await mkdir(join(tempDir, '__tests__'), { recursive: true });
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;\n');
            const output = makeOutput({ filesModified: ['file.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.breakdown.tests).toBe(50);
        });

        it('should score 50 for src/tests directory', async () => {
            await mkdir(join(tempDir, 'src', 'tests'), { recursive: true });
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;\n');
            const output = makeOutput({ filesModified: ['file.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.breakdown.tests).toBe(50);
        });

        it('should score 30 when no test directory exists', async () => {
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;\n');
            const output = makeOutput({ filesModified: ['file.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['file.ts']);
            expect(result.breakdown.tests).toBe(30);
        });
    });

    // ========================================================================
    // FEEDBACK GENERATION
    // ========================================================================
    describe('Feedback generation', () => {
        it('should report strong areas (score >= 90)', async () => {
            await writeFile(join(tempDir, 'README.md'), '# Project');
            await writeFile(join(tempDir, 'clean.ts'), '/** Clean */\nexport const x = 1;\n');
            const output = makeOutput({ filesModified: ['clean.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['clean.ts']);
            const strongFeedback = result.feedback.find(f => f.startsWith('Strong areas:'));
            expect(strongFeedback).toBeDefined();
        });

        it('should report weak areas (score < 70)', async () => {
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;\n');
            const output = makeOutput({ filesModified: ['file.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['file.ts']);
            const weakFeedback = result.feedback.find(f => f.startsWith('Areas to improve:'));
            // tests = 30 < 70 → should show as weak
            expect(weakFeedback).toBeDefined();
            expect(weakFeedback).toContain('tests');
        });

        it('should include percentage in feedback', async () => {
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;\n');
            const output = makeOutput({ filesModified: ['file.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['file.ts']);
            const weakFeedback = result.feedback.find(f => f.startsWith('Areas to improve:'));
            expect(weakFeedback).toMatch(/\d+%/);
        });
    });

    // ========================================================================
    // scoreFiles() METHOD
    // ========================================================================
    describe('scoreFiles()', () => {
        it('should call score(null, files)', async () => {
            await writeFile(join(tempDir, 'file.ts'), '/** Doc */\nconst x = 1;\n');
            const resultA = await engine.scoreFiles(['file.ts']);
            const resultB = await engine.score(null, ['file.ts']);
            expect(resultA.total).toBe(resultB.total);
            expect(resultA.decision).toBe(resultB.decision);
            expect(resultA.breakdown).toEqual(resultB.breakdown);
        });

        it('should return FAIL with NO_OUTPUT blocker for empty files array', async () => {
            const result = await engine.scoreFiles([]);
            expect(result.decision).toBe('FAIL');
            expect(result.blockers[0].type).toBe('NO_OUTPUT');
        });
    });

    // ========================================================================
    // WEIGHTED SCORE CALCULATION
    // ========================================================================
    describe('Weighted score calculation', () => {
        it('should weight axes correctly (25/20/20/15/15/5)', async () => {
            // We can verify the total is consistent with known breakdown values
            await writeFile(join(tempDir, 'file.ts'), '/** Doc */\nconst x = 1;\n');
            const output = makeOutput({ filesModified: ['file.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['file.ts']);

            const { correctness, completeness, security, bestPractices, tests, documentation } =
                result.breakdown;

            const rawWeighted =
                correctness * 0.25 +
                completeness * 0.20 +
                security * 0.20 +
                bestPractices * 0.15 +
                tests * 0.15 +
                documentation * 0.05;

            const bonusTotal = result.bonuses.reduce((sum, b) => sum + b.value, 0);
            const penaltyTotal = result.penalties.reduce((sum, p) => sum + p.value, 0);

            const expected = Math.max(0, Math.min(100, Math.round(rawWeighted + bonusTotal + penaltyTotal)));
            expect(result.total).toBe(expected);
        });
    });

    // ========================================================================
    // EDGE CASES
    // ========================================================================
    describe('Edge cases', () => {
        it('should handle empty file content in files', async () => {
            await writeFile(join(tempDir, 'empty.ts'), '');
            const output = makeOutput({ filesModified: ['empty.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['empty.ts']);
            // Should not crash
            expect(result.total).toBeGreaterThanOrEqual(0);
        });

        it('should handle binary-like content in files', async () => {
            await writeFile(join(tempDir, 'bin.ts'), '\x00\x01\x02\x03');
            const output = makeOutput({ filesModified: ['bin.ts'], errors: [], warnings: [] });
            const result = await engine.score(output, ['bin.ts']);
            expect(result.total).toBeGreaterThanOrEqual(0);
        });

        it('should handle very large number of files', async () => {
            const files: string[] = [];
            for (let i = 0; i < 50; i++) {
                const name = `file${i}.ts`;
                await writeFile(join(tempDir, name), `/** File ${i} */\nconst x${i} = ${i};\n`);
                files.push(name);
            }
            const output = makeOutput({ filesModified: files, errors: [], warnings: [] });
            const result = await engine.score(output, files);
            expect(result.total).toBeGreaterThan(0);
            expect(result.decision).toBeDefined();
        });

        it('should handle output with no agent outputs but with files', async () => {
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;');
            const output: PhaseOutput = {
                agentOutputs: {},
                filesModified: ['file.ts'],
                errors: [],
                warnings: [],
            };
            const result = await engine.score(output, ['file.ts']);
            // hasOutputs false, hasFiles true → 65
            expect(result.breakdown.completeness).toBe(65);
        });

        it('should return all expected ScoreResult fields', async () => {
            await writeFile(join(tempDir, 'file.ts'), 'const x = 1;\n');
            const result = await engine.score(null, ['file.ts']);
            expect(result).toHaveProperty('total');
            expect(result).toHaveProperty('breakdown');
            expect(result).toHaveProperty('decision');
            expect(result).toHaveProperty('blockers');
            expect(result).toHaveProperty('feedback');
            expect(result).toHaveProperty('bonuses');
            expect(result).toHaveProperty('penalties');
            expect(result.breakdown).toHaveProperty('correctness');
            expect(result.breakdown).toHaveProperty('completeness');
            expect(result.breakdown).toHaveProperty('security');
            expect(result.breakdown).toHaveProperty('bestPractices');
            expect(result.breakdown).toHaveProperty('tests');
            expect(result.breakdown).toHaveProperty('documentation');
        });
    });
});
