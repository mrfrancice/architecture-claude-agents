/**
 * ScoringEngine - Scoring objectif sur 6 axes
 *
 * | Axe             | Poids | Outil réel                    |
 * |-----------------|-------|-------------------------------|
 * | Correctness     | 25%   | npx tsc --noEmit              |
 * | Completeness    | 20%   | Heuristique fichiers/TODOs    |
 * | Security        | 20%   | Pattern matching OWASP        |
 * | Best Practices  | 15%   | Linter si détecté             |
 * | Tests           | 15%   | Test runner si détecté        |
 * | Documentation   | 5%    | README, JSDoc                 |
 *
 * Décision : PASS ≥90, ITERATE 60-89, FAIL <60
 * Détection de blockers : NO_OUTPUT, SYNTAX_ERROR, CRITICAL_SECURITY, BUILD_FAILED
 */

import { exec } from 'node:child_process';
import { readFile, readdir, access } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { promisify } from 'node:util';
import type {
    ScoreResult, ScoreBreakdown, ScoreModifier, Blocker, BlockerType, PhaseOutput,
} from '../types/core.js';
import type { DetectedTools } from './ConfigLoader.js';
import { logInfo, logDebug, logError } from '../utils/safe-logger.js';

const execAsync = promisify(exec);

// ============================================================================
// CONSTANTS
// ============================================================================

const WEIGHTS: Record<keyof ScoreBreakdown, number> = {
    correctness: 25,
    completeness: 20,
    security: 20,
    bestPractices: 15,
    tests: 15,
    documentation: 5,
};

const SECURITY_PATTERNS: Array<{ pattern: RegExp; severity: 'critical' | 'high' | 'medium'; name: string }> = [
    { pattern: /eval\s*\(/, severity: 'critical', name: 'eval() usage' },
    { pattern: /innerHTML\s*=/, severity: 'high', name: 'innerHTML assignment (XSS risk)' },
    { pattern: /document\.write\s*\(/, severity: 'high', name: 'document.write (XSS risk)' },
    { pattern: /\$\{.*\}.*(?:exec|query|sql)/i, severity: 'critical', name: 'Template literal in SQL/exec (injection risk)' },
    { pattern: /password\s*[:=]\s*['"][^'"]+['"]/i, severity: 'critical', name: 'Hardcoded password' },
    { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/i, severity: 'critical', name: 'Hardcoded API key' },
    { pattern: /secret\s*[:=]\s*['"][^'"]+['"]/i, severity: 'high', name: 'Hardcoded secret' },
    { pattern: /(?:BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY)/, severity: 'critical', name: 'Embedded private key' },
    { pattern: /disable.*(?:csrf|xss|cors)/i, severity: 'high', name: 'Security feature disabled' },
    { pattern: /(?:crypto\.createHash\(['"]md5['"]\))/, severity: 'medium', name: 'Weak hash (MD5)' },
    { pattern: /(?:crypto\.createHash\(['"]sha1['"]\))/, severity: 'medium', name: 'Weak hash (SHA1)' },
    { pattern: /new\s+Function\s*\(/, severity: 'high', name: 'new Function() (code injection risk)' },
    { pattern: /child_process.*exec\s*\(/, severity: 'high', name: 'Shell execution (command injection risk)' },
    { pattern: /\.env\b.*=/, severity: 'medium', name: 'Potential env variable leak' },
];

const EXEC_TIMEOUT = 30_000;
const EXEC_MAX_BUFFER = 5 * 1024 * 1024; // 5MB

// ============================================================================
// SCORING ENGINE
// ============================================================================

export class ScoringEngine {
    private tools: DetectedTools;
    private projectRoot: string;

    constructor(projectRoot: string, tools: DetectedTools) {
        this.projectRoot = projectRoot;
        this.tools = tools;
    }

    /**
     * Score complet d'une phase.
     */
    async score(phaseOutput?: PhaseOutput | null, files?: string[]): Promise<ScoreResult> {
        logInfo('Scoring phase...');

        const blockers = await this.detectBlockers(phaseOutput);
        if (blockers.length > 0) {
            const hasBlocker = blockers.some(b =>
                b.type === 'NO_OUTPUT' || b.type === 'BUILD_FAILED' || b.type === 'CRITICAL_SECURITY'
            );
            if (hasBlocker) {
                return this.buildResult(
                    { correctness: 0, completeness: 0, security: 0, bestPractices: 0, tests: 0, documentation: 0 },
                    blockers, [], [],
                    ['Phase has critical blockers that must be resolved'],
                );
            }
        }

        const targetFiles = files || await this.getSourceFiles();

        const [correctness, completeness, security, bestPractices, tests, documentation] = await Promise.all([
            this.scoreCorrectness(),
            this.scoreCompleteness(targetFiles, phaseOutput),
            this.scoreSecurity(targetFiles),
            this.scoreBestPractices(),
            this.scoreTests(),
            this.scoreDocumentation(),
        ]);

        const breakdown: ScoreBreakdown = {
            correctness: correctness.score,
            completeness: completeness.score,
            security: security.score,
            bestPractices: bestPractices.score,
            tests: tests.score,
            documentation: documentation.score,
        };

        const allBonuses = [
            ...correctness.bonuses, ...completeness.bonuses, ...security.bonuses,
            ...bestPractices.bonuses, ...tests.bonuses, ...documentation.bonuses,
        ];
        const allPenalties = [
            ...correctness.penalties, ...completeness.penalties, ...security.penalties,
            ...bestPractices.penalties, ...tests.penalties, ...documentation.penalties,
        ];
        const allFeedback = [
            ...correctness.feedback, ...completeness.feedback, ...security.feedback,
            ...bestPractices.feedback, ...tests.feedback, ...documentation.feedback,
        ];

        const allBlockers = [
            ...blockers, ...security.blockers,
        ];

        return this.buildResult(breakdown, allBlockers, allBonuses, allPenalties, allFeedback);
    }

    // ========================================================================
    // AXIS SCORING
    // ========================================================================

    private async scoreCorrectness(): Promise<AxisResult> {
        const result: AxisResult = { score: 70, bonuses: [], penalties: [], feedback: [], blockers: [] };

        if (!this.tools.typescript) {
            result.score = 75; // Can't verify, assume decent
            result.feedback.push('No TypeScript config found, skipping type check');
            return result;
        }

        try {
            await execAsync(this.tools.typescriptCommand || 'npx tsc --noEmit', {
                cwd: this.projectRoot,
                timeout: EXEC_TIMEOUT,
                maxBuffer: EXEC_MAX_BUFFER,
            });
            result.score = 100;
            result.bonuses.push({ name: 'Clean build', value: 0, reason: 'TypeScript compiles without errors' });
        } catch (err: unknown) {
            const execErr = err as { stderr?: string; stdout?: string; message?: string };
            const stderr = execErr.stderr || execErr.stdout || '';
            const errorCount = (stderr.match(/error TS/g) || []).length;

            logDebug(`TypeScript check failed: ${errorCount} errors. ${execErr.message || ''}`);

            if (errorCount === 0) {
                result.score = 95; // Warnings only
                result.feedback.push('TypeScript build has warnings');
            } else if (errorCount <= 3) {
                result.score = 60;
                result.penalties.push({ name: 'Build errors', value: -15, reason: `${errorCount} TypeScript errors` });
                result.feedback.push(`TypeScript build has ${errorCount} error(s)`);
            } else if (errorCount <= 10) {
                result.score = 30;
                result.penalties.push({ name: 'Many build errors', value: -30, reason: `${errorCount} TypeScript errors` });
                result.feedback.push(`TypeScript build has ${errorCount} errors - needs fixing`);
            } else {
                result.score = 10;
                result.blockers.push({ type: 'BUILD_FAILED' as BlockerType, message: `TypeScript build failed with ${errorCount} errors` });
                result.feedback.push(`TypeScript build critically broken: ${errorCount} errors`);
            }
        }

        return result;
    }

    private async scoreCompleteness(files: string[], phaseOutput?: PhaseOutput | null): Promise<AxisResult> {
        const result: AxisResult = { score: 70, bonuses: [], penalties: [], feedback: [], blockers: [] };

        // Check for TODO/FIXME in source files
        let todoCount = 0;
        let fileCount = 0;
        for (const file of files.slice(0, 100)) {
            try {
                const content = await readFile(file, 'utf-8');
                const todos = content.match(/\b(TODO|FIXME|HACK|XXX)\b/g);
                if (todos) todoCount += todos.length;
                fileCount++;
            } catch {
                // Skip unreadable files
            }
        }

        if (todoCount === 0 && fileCount > 0) {
            result.score = 90;
            result.bonuses.push({ name: 'No TODOs', value: 2, reason: 'No TODO/FIXME markers found' });
        } else if (todoCount <= 5) {
            result.score = 75;
            result.feedback.push(`Found ${todoCount} TODO/FIXME markers`);
        } else {
            result.score = 55;
            result.penalties.push({ name: 'Many TODOs', value: -10, reason: `${todoCount} TODO/FIXME markers suggest incomplete work` });
            result.feedback.push(`Found ${todoCount} TODO/FIXME markers - work may be incomplete`);
        }

        // Check for outputs from agents
        if (phaseOutput) {
            const agentCount = Object.keys(phaseOutput.agentOutputs).length;
            if (agentCount === 0) {
                result.score = Math.min(result.score, 40);
                result.feedback.push('No agent outputs recorded');
            }
        }

        return result;
    }

    private async scoreSecurity(files: string[]): Promise<AxisResult> {
        const result: AxisResult = { score: 90, bonuses: [], penalties: [], feedback: [], blockers: [] };

        let criticalCount = 0;
        let highCount = 0;
        let mediumCount = 0;

        for (const file of files.slice(0, 100)) {
            try {
                const content = await readFile(file, 'utf-8');
                for (const { pattern, severity, name } of SECURITY_PATTERNS) {
                    const matches = content.match(new RegExp(pattern.source, 'g'));
                    if (matches) {
                        switch (severity) {
                            case 'critical': criticalCount += matches.length; break;
                            case 'high': highCount += matches.length; break;
                            case 'medium': mediumCount += matches.length; break;
                        }
                        result.feedback.push(`${severity.toUpperCase()}: ${name} found in ${file} (${matches.length}x)`);
                    }
                }
            } catch {
                // Skip unreadable files
            }
        }

        if (criticalCount > 0) {
            result.score = 20;
            result.penalties.push({ name: 'Critical security issues', value: -25, reason: `${criticalCount} critical vulnerabilities found` });
            result.blockers.push({ type: 'CRITICAL_SECURITY' as BlockerType, message: `${criticalCount} critical security issues detected` });
        } else if (highCount > 0) {
            result.score = 50;
            result.penalties.push({ name: 'High security issues', value: -15, reason: `${highCount} high severity issues found` });
        } else if (mediumCount > 0) {
            result.score = 75;
            result.penalties.push({ name: 'Medium security issues', value: -5, reason: `${mediumCount} medium severity issues found` });
        } else {
            result.score = 100;
            result.bonuses.push({ name: 'Zero security issues', value: 2, reason: 'No security patterns detected' });
        }

        return result;
    }

    private async scoreBestPractices(): Promise<AxisResult> {
        const result: AxisResult = { score: 70, bonuses: [], penalties: [], feedback: [], blockers: [] };

        if (!this.tools.linter || !this.tools.linterCommand) {
            result.score = 70;
            result.feedback.push('No linter detected, skipping lint check');
            return result;
        }

        try {
            await execAsync(this.tools.linterCommand, {
                cwd: this.projectRoot,
                timeout: EXEC_TIMEOUT,
                maxBuffer: EXEC_MAX_BUFFER,
            });
            result.score = 100;
            result.bonuses.push({ name: 'No lint errors', value: 3, reason: 'Linter passes cleanly' });
        } catch (err: unknown) {
            const execErr = err as { stderr?: string; stdout?: string; message?: string };
            const output = execErr.stdout || execErr.stderr || '';
            const errorCount = (output.match(/error/gi) || []).length;
            const warningCount = (output.match(/warning/gi) || []).length;

            logDebug(`Linter check failed: ${errorCount} errors, ${warningCount} warnings. ${execErr.message || ''}`);

            if (errorCount === 0 && warningCount > 0) {
                result.score = 80;
                result.feedback.push(`Linter has ${warningCount} warnings`);
            } else if (errorCount <= 5) {
                result.score = 55;
                result.penalties.push({ name: 'Lint errors', value: -5, reason: `${errorCount} lint errors` });
                result.feedback.push(`Linter found ${errorCount} errors`);
            } else {
                result.score = 30;
                result.penalties.push({ name: 'Many lint errors', value: -10, reason: `${errorCount} lint errors` });
                result.feedback.push(`Linter found ${errorCount} errors - code quality needs attention`);
            }
        }

        return result;
    }

    private async scoreTests(): Promise<AxisResult> {
        const result: AxisResult = { score: 50, bonuses: [], penalties: [], feedback: [], blockers: [] };

        if (!this.tools.testRunner || !this.tools.testCommand) {
            // Check if test files exist
            const hasTests = await this.hasTestFiles();
            if (!hasTests) {
                result.score = 30;
                result.penalties.push({ name: 'No tests', value: -10, reason: 'No test runner detected and no test files found' });
                result.feedback.push('No tests found - consider adding tests');
                return result;
            }
            result.score = 50;
            result.feedback.push('Test files exist but no test runner detected');
            return result;
        }

        try {
            const { stdout } = await execAsync(this.tools.testCommand, {
                cwd: this.projectRoot,
                timeout: 60_000, // Tests can take longer
                maxBuffer: EXEC_MAX_BUFFER,
            });

            result.score = 90;

            // Try to extract coverage info
            const coverageMatch = stdout.match(/(?:Coverage|Stmts|Lines)\s*:\s*(\d+(?:\.\d+)?)\s*%/i);
            if (coverageMatch) {
                const coverage = parseFloat(coverageMatch[1]);
                if (coverage >= 90) {
                    result.score = 100;
                    result.bonuses.push({ name: 'High test coverage', value: 5, reason: `${coverage}% coverage` });
                } else if (coverage >= 70) {
                    result.score = 85;
                } else if (coverage < 50) {
                    result.score = 65;
                    result.penalties.push({ name: 'Low test coverage', value: -5, reason: `${coverage}% coverage` });
                    result.feedback.push(`Test coverage is low: ${coverage}%`);
                }
            }
        } catch (err: unknown) {
            const execErr = err as { stderr?: string; stdout?: string; message?: string };
            const output = execErr.stdout || execErr.stderr || '';
            const failedMatch = output.match(/(\d+)\s+(?:failed|failing)/i);
            const failedCount = failedMatch ? parseInt(failedMatch[1]) : 0;

            logDebug(`Test runner failed: ${failedCount} failures. ${execErr.message || ''}`);

            if (failedCount > 0) {
                result.score = 30;
                result.penalties.push({ name: 'Test failures', value: -15, reason: `${failedCount} test(s) failed` });
                result.feedback.push(`${failedCount} test(s) failed`);
            } else {
                result.score = 20;
                result.feedback.push('Test runner failed to execute');
            }
        }

        return result;
    }

    private async scoreDocumentation(): Promise<AxisResult> {
        const result: AxisResult = { score: 50, bonuses: [], penalties: [], feedback: [], blockers: [] };

        let hasReadme = false;
        let hasChangelog = false;

        try {
            await access(join(this.projectRoot, 'README.md'));
            hasReadme = true;
        } catch { /* */ }

        try {
            await access(join(this.projectRoot, 'CHANGELOG.md'));
            hasChangelog = true;
        } catch { /* */ }

        if (hasReadme && hasChangelog) {
            result.score = 90;
            result.bonuses.push({ name: 'Documentation complete', value: 2, reason: 'README and CHANGELOG present' });
        } else if (hasReadme) {
            result.score = 70;
        } else {
            result.score = 30;
            result.feedback.push('No README.md found');
        }

        return result;
    }

    // ========================================================================
    // BLOCKER DETECTION
    // ========================================================================

    private async detectBlockers(phaseOutput?: PhaseOutput | null): Promise<Blocker[]> {
        const blockers: Blocker[] = [];

        if (!phaseOutput) {
            blockers.push({ type: 'NO_OUTPUT', message: 'No phase output available' });
            return blockers;
        }

        const agentOutputs = Object.values(phaseOutput.agentOutputs);
        if (agentOutputs.length === 0) {
            blockers.push({ type: 'NO_OUTPUT', message: 'No agent produced output' });
        }
        for (const ao of agentOutputs) {
            if (ao.status === 'FAILED' && !ao.output) {
                blockers.push({ type: 'NO_OUTPUT', message: `Agent ${ao.agentId} produced no output` });
            }
        }

        return blockers;
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    private buildResult(
        breakdown: ScoreBreakdown,
        blockers: Blocker[],
        bonuses: ScoreModifier[],
        penalties: ScoreModifier[],
        feedback: string[] = [],
    ): ScoreResult {
        // Weighted total
        let total = 0;
        for (const [key, weight] of Object.entries(WEIGHTS)) {
            total += (breakdown[key as keyof ScoreBreakdown] * weight) / 100;
        }

        // Apply bonuses and penalties
        const bonusTotal = bonuses.reduce((sum, b) => sum + b.value, 0);
        const penaltyTotal = penalties.reduce((sum, p) => sum + p.value, 0);
        total = Math.max(0, Math.min(100, Math.round(total + bonusTotal + penaltyTotal)));

        // Determine decision
        let decision: 'PASS' | 'ITERATE' | 'FAIL';
        if (blockers.some(b => b.type === 'CRITICAL_SECURITY' || b.type === 'BUILD_FAILED' || b.type === 'NO_OUTPUT')) {
            decision = 'FAIL';
        } else if (total >= 90) {
            decision = 'PASS';
        } else if (total >= 60) {
            decision = 'ITERATE';
        } else {
            decision = 'FAIL';
        }

        logInfo(`Score: ${total}/100, decision: ${decision}`);

        return {
            total,
            breakdown,
            decision,
            blockers,
            feedback,
            bonuses,
            penalties,
        };
    }

    private async getSourceFiles(): Promise<string[]> {
        const files: string[] = [];
        const srcExtensions = new Set(['.ts', '.js', '.tsx', '.jsx', '.py', '.php', '.go', '.rs']);

        const scanDir = async (dir: string, depth: number): Promise<void> => {
            if (depth > 5 || files.length > 200) return;
            try {
                const entries = await readdir(dir, { withFileTypes: true });
                for (const entry of entries) {
                    const fullPath = join(dir, entry.name);
                    if (entry.isDirectory()) {
                        if (!entry.name.startsWith('.') && entry.name !== 'node_modules' && entry.name !== 'dist' && entry.name !== 'build') {
                            await scanDir(fullPath, depth + 1);
                        }
                    } else if (entry.isFile() && srcExtensions.has(extname(entry.name))) {
                        files.push(fullPath);
                    }
                }
            } catch { /* */ }
        };

        await scanDir(this.projectRoot, 0);
        return files;
    }

    private async hasTestFiles(): Promise<boolean> {
        const testPatterns = ['test', 'tests', 'spec', '__tests__'];
        for (const pattern of testPatterns) {
            try {
                await access(join(this.projectRoot, pattern));
                return true;
            } catch { /* */ }
        }
        return false;
    }
}

// ============================================================================
// HELPER TYPE
// ============================================================================

interface AxisResult {
    score: number;
    bonuses: ScoreModifier[];
    penalties: ScoreModifier[];
    feedback: string[];
    blockers: Blocker[];
}
