/**
 * ScoringEngine - Calcul objectif du score de qualité
 *
 * Évalue le code sur 6 axes :
 * - Correctness (25%) : compilation, syntaxe
 * - Completeness (20%) : requirements couverts
 * - Security (20%) : patterns de vulnérabilité
 * - Best Practices (15%) : lint, conventions
 * - Tests (15%) : coverage, pass rate
 * - Documentation (5%) : présence de docs
 *
 * Décision : PASS (≥90) | ITERATE (60-89) | FAIL (<60)
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import type {
    ScoreResult,
    ScoreBreakdown,
    ScoreModifier,
    Blocker,
    BlockerType,
    PhaseOutput,
} from '../types/core.js';
import type { DetectedTools } from './ConfigLoader.js';

const execFileAsync = promisify(execFile);

// ============================================================================
// SCORING ENGINE
// ============================================================================

export class ScoringEngine {
    private projectRoot: string;
    private tools: DetectedTools;

    constructor(projectRoot: string, tools: DetectedTools) {
        this.projectRoot = projectRoot;
        this.tools = tools;
    }

    /**
     * Calcule le score complet pour une phase
     */
    async score(output: PhaseOutput | null, files: string[]): Promise<ScoreResult> {
        const blockers = this.detectBlockers(output, files);

        // Si bloqueurs critiques, score FAIL direct
        if (blockers.length > 0) {
            return {
                total: 0,
                breakdown: this.zeroBreakdown(),
                decision: 'FAIL',
                blockers,
                feedback: blockers.map(b => `BLOCKER [${b.type}]: ${b.message}`),
                bonuses: [],
                penalties: [],
            };
        }

        // Calculer les scores par axe
        const [correctness, completeness, security, bestPractices, tests, documentation] =
            await Promise.all([
                this.scoreCorrectness(files),
                this.scoreCompleteness(output, files),
                this.scoreSecurity(files),
                this.scoreBestPractices(files),
                this.scoreTests(),
                this.scoreDocumentation(files),
            ]);

        const breakdown: ScoreBreakdown = {
            correctness,
            completeness,
            security,
            bestPractices,
            tests,
            documentation,
        };

        // Calculer bonuses et penalties
        const bonuses = this.calculateBonuses(breakdown);
        const penalties = this.calculatePenalties(breakdown);

        // Score total pondéré
        const weightedScore =
            correctness * 0.25 +
            completeness * 0.20 +
            security * 0.20 +
            bestPractices * 0.15 +
            tests * 0.15 +
            documentation * 0.05;

        const bonusTotal = bonuses.reduce((sum, b) => sum + b.value, 0);
        const penaltyTotal = penalties.reduce((sum, p) => sum + p.value, 0);

        const total = Math.max(0, Math.min(100, Math.round(weightedScore + bonusTotal + penaltyTotal)));

        // Décision
        let decision: ScoreResult['decision'];
        if (total >= 90) decision = 'PASS';
        else if (total >= 60) decision = 'ITERATE';
        else decision = 'FAIL';

        // Feedback
        const feedback = this.generateFeedback(breakdown, bonuses, penalties);

        return { total, breakdown, decision, blockers, feedback, bonuses, penalties };
    }

    /**
     * Score rapide pour des fichiers individuels
     */
    async scoreFiles(files: string[]): Promise<ScoreResult> {
        return this.score(null, files);
    }

    // ========================================================================
    // BLOCKER DETECTION
    // ========================================================================

    private detectBlockers(output: PhaseOutput | null, files: string[]): Blocker[] {
        const blockers: Blocker[] = [];

        // NO_OUTPUT
        if (!output && files.length === 0) {
            blockers.push({
                type: 'NO_OUTPUT',
                message: 'No output produced and no files specified',
            });
            return blockers;
        }

        // Vérifier les erreurs critiques dans l'output
        if (output) {
            for (const error of output.errors) {
                const lower = error.toLowerCase();
                if (lower.includes('syntax error') || lower.includes('syntaxerror')) {
                    blockers.push({
                        type: 'SYNTAX_ERROR',
                        message: error,
                    });
                }
                if (lower.includes('build failed') || lower.includes('compilation failed')) {
                    blockers.push({
                        type: 'BUILD_FAILED',
                        message: error,
                    });
                }
                if (lower.includes('segfault') || lower.includes('tests crashed') || lower.includes('fatal error')) {
                    blockers.push({
                        type: 'TESTS_CRASHED',
                        message: error,
                    });
                }
            }
        }

        // CRITICAL_SECURITY - scanner les fichiers pour des failles critiques
        const criticalPatterns: Array<{ pattern: RegExp; name: string }> = [
            { pattern: /password\s*[:=]\s*['"][^'"]+['"]/gi, name: 'Hardcoded password' },
            { pattern: /api[_-]?key\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/gi, name: 'Hardcoded API key' },
            { pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g, name: 'Private key in source' },
            { pattern: /eval\s*\(\s*req\./g, name: 'eval() on user input' },
            { pattern: /exec\s*\(\s*req\./g, name: 'Command injection via user input' },
        ];

        for (const file of files) {
            try {
                const fullPath = join(this.projectRoot, file);
                if (!existsSync(fullPath)) continue;
                const content = readFileSync(fullPath, 'utf-8');
                for (const { pattern, name } of criticalPatterns) {
                    if (pattern.test(content)) {
                        blockers.push({
                            type: 'CRITICAL_SECURITY',
                            message: `${name} detected in ${file}`,
                            file,
                        });
                        pattern.lastIndex = 0;
                    }
                }
            } catch {
                // Ignorer les fichiers illisibles
            }
        }

        return blockers;
    }

    // ========================================================================
    // AXIS SCORING
    // ========================================================================

    /**
     * Correctness (25%) - Le code compile et fonctionne
     */
    private async scoreCorrectness(files: string[]): Promise<number> {
        let score = 70; // Base score

        // Vérifier si TypeScript compile
        if (this.tools.typescript) {
            const compiles = await this.runTypeCheck();
            if (compiles.success) {
                score = 100;
            } else {
                // Pénaliser selon le nombre d'erreurs
                const errorCount = compiles.errorCount;
                score = Math.max(20, 80 - errorCount * 5);
            }
        } else {
            // Vérifier que les fichiers existent
            let existingFiles = 0;
            for (const file of files) {
                const fullPath = join(this.projectRoot, file);
                if (existsSync(fullPath)) existingFiles++;
            }
            score = files.length > 0 ? Math.round((existingFiles / files.length) * 100) : 70;
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Completeness (20%) - Requirements couverts
     */
    private async scoreCompleteness(output: PhaseOutput | null, files: string[]): Promise<number> {
        let score = 70;

        if (output) {
            const hasOutputs = Object.keys(output.agentOutputs).length > 0;
            const hasFiles = output.filesModified.length > 0 || files.length > 0;
            const hasErrors = output.errors.length > 0;
            const hasWarnings = output.warnings.length > 0;

            if (hasOutputs && hasFiles && !hasErrors) {
                score = 95;
            } else if (hasOutputs && hasFiles) {
                score = 80;
            } else if (hasOutputs || hasFiles) {
                score = 65;
            } else {
                score = 40;
            }

            if (hasWarnings) score -= output.warnings.length * 2;
        } else if (files.length > 0) {
            // Si on n'a que des fichiers, vérifier qu'ils ne sont pas vides
            let nonEmptyCount = 0;
            for (const file of files) {
                try {
                    const fullPath = join(this.projectRoot, file);
                    const content = await readFile(fullPath, 'utf-8');
                    if (content.trim().length > 0) nonEmptyCount++;
                } catch {
                    // Fichier n'existe pas
                }
            }
            score = files.length > 0 ? Math.round((nonEmptyCount / files.length) * 100) : 50;
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Security (20%) - Patterns de vulnérabilité OWASP
     */
    private async scoreSecurity(files: string[]): Promise<number> {
        let score = 100;
        const issues: string[] = [];

        const securityPatterns: Array<{ pattern: RegExp; severity: number; name: string }> = [
            { pattern: /eval\s*\(/g, severity: 15, name: 'eval() usage' },
            { pattern: /innerHTML\s*=/g, severity: 10, name: 'innerHTML assignment (XSS risk)' },
            { pattern: /dangerouslySetInnerHTML/g, severity: 10, name: 'dangerouslySetInnerHTML (XSS risk)' },
            { pattern: /exec\s*\(\s*[`'"]/g, severity: 15, name: 'Command injection risk' },
            { pattern: /password\s*[:=]\s*['"][^'"]+['"]/gi, severity: 20, name: 'Hardcoded password' },
            { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/gi, severity: 20, name: 'Hardcoded API key' },
            { pattern: /secret\s*[:=]\s*['"][^'"]+['"]/gi, severity: 15, name: 'Hardcoded secret' },
            { pattern: /SELECT\s+.*\s+FROM\s+.*\+/gi, severity: 15, name: 'SQL injection risk (string concat)' },
            { pattern: /\bhttp:\/\//g, severity: 5, name: 'Insecure HTTP URL' },
            { pattern: /cors\(\s*\)/g, severity: 5, name: 'Permissive CORS' },
            { pattern: /disable.*ssl|verify.*false|rejectUnauthorized.*false/gi, severity: 10, name: 'SSL verification disabled' },
        ];

        for (const file of files) {
            try {
                const fullPath = join(this.projectRoot, file);
                if (!existsSync(fullPath)) continue;
                const content = await readFile(fullPath, 'utf-8');

                for (const { pattern, severity, name } of securityPatterns) {
                    const matches = content.match(pattern);
                    if (matches) {
                        score -= severity;
                        issues.push(`${file}: ${name} (${matches.length} occurrence(s))`);
                    }
                }
            } catch {
                // Ignorer les fichiers illisibles
            }
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Best Practices (15%) - Lint et conventions
     */
    private async scoreBestPractices(files: string[]): Promise<number> {
        // Essayer de lancer le linter
        if (this.tools.linter === 'eslint') {
            const lintResult = await this.runEslint(files);
            if (lintResult !== null) return lintResult;
        }

        // Analyse statique de base si pas de linter
        let score = 80;
        let issues = 0;

        for (const file of files) {
            try {
                const fullPath = join(this.projectRoot, file);
                if (!existsSync(fullPath)) continue;
                const content = await readFile(fullPath, 'utf-8');
                const lines = content.split('\n');

                for (const line of lines) {
                    if (line.length > 200) issues++;           // Lignes trop longues
                    if (/\t/.test(line) && /  /.test(line)) issues++; // Mélange tabs/spaces
                    if (/console\.(log|warn|error)/.test(line)) issues++; // Console statements
                    if (/TODO|FIXME|HACK|XXX/i.test(line)) issues++; // TODOs restants
                    if (/any\b/.test(line) && file.endsWith('.ts')) issues++; // Type `any` en TS
                }
            } catch {
                // Ignorer
            }
        }

        score = Math.max(30, score - issues * 2);
        return Math.min(100, score);
    }

    /**
     * Tests (15%) - Coverage et pass rate
     */
    private async scoreTests(): Promise<number> {
        if (!this.tools.testRunner) {
            // Pas de test runner détecté, vérifier s'il y a des fichiers de test
            const hasTestFiles = await this.hasTestFiles();
            return hasTestFiles ? 50 : 30;
        }

        const testResult = await this.runTests();
        if (testResult === null) return 50; // Impossible de lancer les tests

        return testResult;
    }

    /**
     * Documentation (5%) - Présence de docs
     */
    private async scoreDocumentation(files: string[]): Promise<number> {
        let score = 50;

        // README existe ?
        if (existsSync(join(this.projectRoot, 'README.md'))) score += 20;

        // Vérifier la présence de JSDoc/commentaires dans les fichiers
        let filesWithDocs = 0;
        let totalFiles = 0;

        for (const file of files) {
            if (!file.endsWith('.ts') && !file.endsWith('.js') && !file.endsWith('.tsx') && !file.endsWith('.jsx')) {
                continue;
            }

            totalFiles++;
            try {
                const fullPath = join(this.projectRoot, file);
                if (!existsSync(fullPath)) continue;
                const content = await readFile(fullPath, 'utf-8');
                // Vérifie la présence de commentaires JSDoc ou de commentaires multilignes
                if (/\/\*\*[\s\S]*?\*\//.test(content) || /^\s*\/\//.test(content)) {
                    filesWithDocs++;
                }
            } catch {
                // Ignorer
            }
        }

        if (totalFiles > 0) {
            const docRatio = filesWithDocs / totalFiles;
            score += Math.round(docRatio * 30);
        }

        return Math.max(0, Math.min(100, score));
    }

    // ========================================================================
    // BONUSES & PENALTIES
    // ========================================================================

    private calculateBonuses(breakdown: ScoreBreakdown): ScoreModifier[] {
        const bonuses: ScoreModifier[] = [];

        if (breakdown.tests >= 90) {
            bonuses.push({ name: 'High test coverage', value: 5, reason: 'Test score ≥ 90%' });
        }
        if (breakdown.bestPractices >= 95) {
            bonuses.push({ name: 'No lint errors', value: 3, reason: 'Best practices score ≥ 95%' });
        }
        if (breakdown.documentation >= 90) {
            bonuses.push({ name: 'Complete documentation', value: 2, reason: 'Documentation score ≥ 90%' });
        }
        if (breakdown.security === 100) {
            bonuses.push({ name: 'Zero security issues', value: 2, reason: 'Perfect security score' });
        }

        return bonuses;
    }

    private calculatePenalties(breakdown: ScoreBreakdown): ScoreModifier[] {
        const penalties: ScoreModifier[] = [];

        if (breakdown.tests < 30) {
            penalties.push({ name: 'No/minimal tests', value: -10, reason: 'Test score < 30%' });
        } else if (breakdown.tests < 50) {
            penalties.push({ name: 'Low test coverage', value: -5, reason: 'Test score < 50%' });
        }

        if (breakdown.bestPractices < 50) {
            penalties.push({ name: 'Many lint errors', value: -5, reason: 'Best practices score < 50%' });
        }

        if (breakdown.security < 60) {
            penalties.push({ name: 'Security vulnerabilities', value: -10, reason: 'Security score < 60%' });
        }

        return penalties;
    }

    // ========================================================================
    // FEEDBACK
    // ========================================================================

    private generateFeedback(
        breakdown: ScoreBreakdown,
        bonuses: ScoreModifier[],
        penalties: ScoreModifier[],
    ): string[] {
        const feedback: string[] = [];

        // Axes faibles
        const axes = Object.entries(breakdown) as Array<[keyof ScoreBreakdown, number]>;
        const weak = axes.filter(([, score]) => score < 70);
        const strong = axes.filter(([, score]) => score >= 90);

        if (strong.length > 0) {
            feedback.push(`Strong areas: ${strong.map(([name, score]) => `${name} (${score}%)`).join(', ')}`);
        }
        if (weak.length > 0) {
            feedback.push(`Areas to improve: ${weak.map(([name, score]) => `${name} (${score}%)`).join(', ')}`);
        }

        for (const b of bonuses) {
            feedback.push(`Bonus: ${b.name} (+${b.value})`);
        }
        for (const p of penalties) {
            feedback.push(`Penalty: ${p.name} (${p.value})`);
        }

        return feedback;
    }

    // ========================================================================
    // TOOL RUNNERS
    // ========================================================================

    private async runTypeCheck(): Promise<{ success: boolean; errorCount: number }> {
        try {
            await execFileAsync('npx', ['tsc', '--noEmit', '--pretty', 'false'], {
                cwd: this.projectRoot,
                timeout: 60000,
                shell: true,
            });
            return { success: true, errorCount: 0 };
        } catch (err) {
            const error = err as { stdout?: string; stderr?: string };
            const output = (error.stdout || '') + (error.stderr || '');
            const errorLines = output.split('\n').filter(l => /error TS\d+/.test(l));
            return { success: false, errorCount: errorLines.length || 1 };
        }
    }

    private async runEslint(files: string[]): Promise<number | null> {
        if (files.length === 0) return null;

        try {
            const targetFiles = files.filter(f =>
                f.endsWith('.ts') || f.endsWith('.js') || f.endsWith('.tsx') || f.endsWith('.jsx'),
            );
            if (targetFiles.length === 0) return null;

            const fullPaths = targetFiles.map(f => join(this.projectRoot, f));
            await execFileAsync('npx', ['eslint', '--format', 'json', ...fullPaths], {
                cwd: this.projectRoot,
                timeout: 30000,
                shell: true,
            });
            return 100; // Pas d'erreurs
        } catch (err) {
            const error = err as { stdout?: string };
            try {
                const results = JSON.parse(error.stdout || '[]');
                let totalErrors = 0;
                let totalWarnings = 0;
                for (const result of results) {
                    totalErrors += result.errorCount || 0;
                    totalWarnings += result.warningCount || 0;
                }
                return Math.max(20, 100 - totalErrors * 5 - totalWarnings * 2);
            } catch {
                return 60; // Fallback
            }
        }
    }

    private async runTests(): Promise<number | null> {
        const runner = this.tools.testRunner;
        if (!runner) return null;

        try {
            const cmd = runner === 'vitest'
                ? ['npx', ['vitest', 'run', '--reporter=json']]
                : runner === 'jest'
                    ? ['npx', ['jest', '--json', '--silent']]
                    : null;

            if (!cmd) return null;

            const { stdout } = await execFileAsync(cmd[0] as string, cmd[1] as string[], {
                cwd: this.projectRoot,
                timeout: 120000,
                shell: true,
            });

            try {
                const result = JSON.parse(stdout);
                const passed = result.numPassedTests || result.numPassed || 0;
                const failed = result.numFailedTests || result.numFailed || 0;
                const total = passed + failed;
                if (total === 0) return 50;

                const passRate = (passed / total) * 100;
                return Math.round(passRate);
            } catch {
                return 70; // Tests ont passé mais pas de JSON parsable
            }
        } catch {
            return 30; // Tests ont échoué
        }
    }

    private async hasTestFiles(): Promise<boolean> {
        const testPaths = [
            join(this.projectRoot, 'test'),
            join(this.projectRoot, 'tests'),
            join(this.projectRoot, '__tests__'),
            join(this.projectRoot, 'src', 'test'),
            join(this.projectRoot, 'src', 'tests'),
            join(this.projectRoot, 'src', '__tests__'),
        ];

        for (const path of testPaths) {
            if (existsSync(path)) return true;
        }
        return false;
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    private zeroBreakdown(): ScoreBreakdown {
        return {
            correctness: 0,
            completeness: 0,
            security: 0,
            bestPractices: 0,
            tests: 0,
            documentation: 0,
        };
    }
}
