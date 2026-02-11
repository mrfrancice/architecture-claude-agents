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

        // Extraire le texte combiné des outputs d'agents pour analyse
        const outputText = this.extractOutputText(output);

        // Si aucun fichier fourni, tenter d'en extraire depuis l'output
        if (files.length === 0 && outputText) {
            const extracted = this.extractFilePaths(outputText);
            files = extracted;
        }

        // Calculer les scores par axe
        const [correctness, completeness, security, bestPractices, tests, documentation] =
            await Promise.all([
                this.scoreCorrectness(files, outputText),
                this.scoreCompleteness(output, files, outputText),
                this.scoreSecurity(files, outputText),
                this.scoreBestPractices(files, outputText),
                this.scoreTests(outputText),
                this.scoreDocumentation(files, outputText),
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

        // Scan agent output text for strong blocker signals
        if (output) {
            const agentText = this.extractOutputText(output);
            if (agentText) {
                if (/(?:^|\n).*syntax\s*error/im.test(agentText) && !blockers.some(b => b.type === 'SYNTAX_ERROR')) {
                    blockers.push({
                        type: 'SYNTAX_ERROR',
                        message: 'Syntax error detected in agent output',
                    });
                }
                if (/(?:^|\n).*build[:\s]*(failed|failure)/im.test(agentText) && !blockers.some(b => b.type === 'BUILD_FAILED')) {
                    blockers.push({
                        type: 'BUILD_FAILED',
                        message: 'Build failure detected in agent output',
                    });
                }
                if (/(?:^|\n).*(segfault|tests?\s+crashed|fatal\s+error)/im.test(agentText) && !blockers.some(b => b.type === 'TESTS_CRASHED')) {
                    blockers.push({
                        type: 'TESTS_CRASHED',
                        message: 'Tests crashed or fatal error detected in agent output',
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
    private async scoreCorrectness(files: string[], outputText?: string): Promise<number> {
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
        } else if (files.length > 0) {
            // Vérifier que les fichiers existent
            let existingFiles = 0;
            for (const file of files) {
                const fullPath = join(this.projectRoot, file);
                if (existsSync(fullPath)) existingFiles++;
            }
            score = Math.round((existingFiles / files.length) * 100);
        } else if (outputText) {
            // Analyser le texte de l'output pour des signaux de correctness
            score = this.analyzeCorrectnessFromText(outputText);
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Completeness (20%) - Requirements couverts
     */
    private async scoreCompleteness(output: PhaseOutput | null, files: string[], outputText?: string): Promise<number> {
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
            } else if (hasOutputs && outputText) {
                // Output exists but no files - analyze text for completeness
                score = this.analyzeCompletenessFromText(outputText);
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
            score = Math.round((nonEmptyCount / files.length) * 100);
        } else if (outputText) {
            score = this.analyzeCompletenessFromText(outputText);
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Security (20%) - Patterns de vulnérabilité OWASP
     */
    private async scoreSecurity(files: string[], outputText?: string): Promise<number> {
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

        // Analyse additionnelle du texte d'output pour des signaux de sécurité
        if (files.length === 0 && outputText) {
            const textSecurityPatterns: Array<{ pattern: RegExp; severity: number }> = [
                { pattern: /eval\s*\(/g, severity: 10 },
                { pattern: /innerHTML\s*=/g, severity: 8 },
                { pattern: /password\s*[:=]\s*['"][^'"]+['"]/gi, severity: 15 },
                { pattern: /api[_-]?key\s*[:=]\s*['"][^'"]+['"]/gi, severity: 15 },
                { pattern: /exec\s*\(\s*[`'"]/g, severity: 10 },
            ];
            for (const { pattern, severity } of textSecurityPatterns) {
                if (pattern.test(outputText)) {
                    score -= severity;
                    pattern.lastIndex = 0;
                }
            }
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Best Practices (15%) - Lint et conventions
     */
    private async scoreBestPractices(files: string[], outputText?: string): Promise<number> {
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

        // Analyse du texte output si pas de fichiers
        if (files.length === 0 && outputText) {
            score = this.analyzeBestPracticesFromText(outputText);
        } else {
            score = Math.max(30, score - issues * 2);
        }

        return Math.min(100, score);
    }

    /**
     * Tests (15%) - Coverage et pass rate
     */
    private async scoreTests(outputText?: string): Promise<number> {
        if (!this.tools.testRunner) {
            // Pas de test runner détecté, vérifier s'il y a des fichiers de test
            const hasTestFiles = await this.hasTestFiles();
            if (hasTestFiles) return 50;

            // Analyser l'output pour des mentions de tests
            if (outputText) {
                return this.analyzeTestsFromText(outputText);
            }
            return 30;
        }

        const testResult = await this.runTests();
        if (testResult === null) return 50; // Impossible de lancer les tests

        return testResult;
    }

    /**
     * Documentation (5%) - Présence de docs
     */
    private async scoreDocumentation(files: string[], outputText?: string): Promise<number> {
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
        } else if (outputText) {
            // Analyser l'output pour des mentions de documentation
            const hasJsDoc = /\/\*\*[\s\S]*?\*\//.test(outputText);
            const hasComments = /\/\/\s+\w/.test(outputText);
            const hasReadmeMention = /readme|documentation|jsdoc|tsdoc/i.test(outputText);
            if (hasJsDoc) score += 15;
            if (hasComments) score += 10;
            if (hasReadmeMention) score += 5;
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

    // ========================================================================
    // OUTPUT TEXT ANALYSIS
    // ========================================================================

    /**
     * Extrait le texte combiné de tous les outputs d'agents
     */
    private extractOutputText(output: PhaseOutput | null): string {
        if (!output) return '';
        const parts: string[] = [];
        for (const agentOutput of Object.values(output.agentOutputs)) {
            if (agentOutput.output) {
                parts.push(agentOutput.output);
            }
        }
        return parts.join('\n');
    }

    /**
     * Extrait les chemins de fichiers mentionnés dans l'output
     */
    private extractFilePaths(text: string): string[] {
        const paths = new Set<string>();
        // Match file paths like src/foo/bar.ts, ./file.js, etc.
        const filePatterns = [
            /(?:^|\s|`)((?:src|lib|app|test|tests|__tests__)\/[\w./-]+\.\w{1,5})(?:\s|`|$|:|\))/gm,
            /(?:^|\s|`)(\.\/[\w./-]+\.\w{1,5})(?:\s|`|$|:|\))/gm,
            /(?:created?|modified?|updated?|edited?|wrote)\s+(?:`)?([^\s`]+\.\w{1,5})(?:`)?/gi,
        ];
        for (const pattern of filePatterns) {
            let match;
            while ((match = pattern.exec(text)) !== null) {
                const filePath = match[1].replace(/^\.\//, '');
                if (!filePath.includes('..') && !filePath.startsWith('/')) {
                    paths.add(filePath);
                }
            }
        }
        return [...paths];
    }

    /**
     * Analyse le texte pour des signaux de correctness
     */
    private analyzeCorrectnessFromText(text: string): number {
        let score = 60; // Base plus basse que le default quand on analyse du texte
        const hasCodeBlocks = /```[\s\S]*?```/.test(text);
        // Match errors but exclude negated forms like "no errors", "0 errors"
        const hasErrorMentions = /(?<!no\s)(?<!0\s)(?<!zero\s)\b(error|exception|failed|crash)\b/i.test(text);
        const hasSuccessSignals = /compil|build\s+success|no\s+errors|0\s+errors|passes|all\s+pass/i.test(text);
        const hasImplementation = /function|class|interface|export|import|const|let|var/i.test(text);

        if (hasCodeBlocks) score += 15;
        if (hasImplementation) score += 10;
        if (hasSuccessSignals) score += 15;
        if (hasErrorMentions) score -= 10;

        // Strong failure signals — penalize heavily
        if (/build[:\s]*(failed|failure|error)/i.test(text)) score -= 30;
        if (/compilation[:\s]*(failed|error)/i.test(text)) score -= 30;
        if (/syntax\s*error/i.test(text)) score -= 25;

        // Type errors: extract count, -10 per error (cap -40)
        const typeErrorMatch = text.match(/(\d+)\s+type\s+error/i);
        if (typeErrorMatch) {
            const count = parseInt(typeErrorMatch[1], 10);
            score -= Math.min(40, count * 10);
        }

        // Generic error count: -5 per error (cap -30)
        const errorCountMatch = text.match(/(\d+)\s+(error|errors)\b/i);
        if (errorCountMatch) {
            const count = parseInt(errorCountMatch[1], 10);
            if (count > 0) {
                score -= Math.min(30, count * 5);
            }
        }

        return Math.max(0, Math.min(100, score));
    }

    /**
     * Analyse le texte pour des signaux de completeness
     */
    private analyzeCompletenessFromText(text: string): number {
        let score = 50;
        const textLength = text.length;

        // Longueur de l'output comme indicateur de completeness
        if (textLength > 5000) score += 20;
        else if (textLength > 2000) score += 15;
        else if (textLength > 500) score += 10;

        // Signaux structurels
        if (/```[\s\S]*?```/.test(text)) score += 10;
        if (/## |### |\*\*/.test(text)) score += 5;
        if (/step\s+\d|phase\s+\d|\d\.\s/i.test(text)) score += 5;

        return Math.max(20, Math.min(100, score));
    }

    /**
     * Analyse le texte pour des signaux de best practices
     */
    private analyzeBestPracticesFromText(text: string): number {
        let score = 70;
        const codeBlocks = text.match(/```[\s\S]*?```/g) || [];

        for (const block of codeBlocks) {
            if (/console\.(log|warn|error)/.test(block)) score -= 3;
            if (/TODO|FIXME|HACK|XXX/i.test(block)) score -= 3;
            if (/\bany\b/.test(block)) score -= 2;
            // Positive signals
            if (/type\s+\w+|interface\s+\w+/.test(block)) score += 3;
            if (/try\s*\{[\s\S]*?catch/.test(block)) score += 2;
        }

        return Math.max(30, Math.min(100, score));
    }

    /**
     * Analyse le texte pour des signaux de tests
     */
    private analyzeTestsFromText(text: string): number {
        // 1. Try to extract explicit coverage percentage
        const coverageMatch = text.match(/coverage[:\s]+(\d+)%/i);
        const coverageScore = coverageMatch ? parseInt(coverageMatch[1], 10) : null;

        // 2. Try to extract pass/fail ratio
        const failMatch = text.match(/(\d+)\s+fail/i);
        const passMatch = text.match(/(\d+)\s+pass/i);
        let ratioScore: number | null = null;
        if (passMatch || failMatch) {
            const passed = passMatch ? parseInt(passMatch[1], 10) : 0;
            const failed = failMatch ? parseInt(failMatch[1], 10) : 0;
            const total = passed + failed;
            if (total > 0) {
                ratioScore = Math.round((passed / total) * 100);
            }
        }

        // 3. "no tests" or coverage 0% → very low score
        if (/no\s+tests|0\s*%\s*coverage|coverage[:\s]+0%/i.test(text)) {
            return 10;
        }

        // 4. If we found numeric metrics, use them
        if (coverageScore !== null && ratioScore !== null) {
            return Math.max(10, Math.min(100, Math.min(coverageScore, ratioScore)));
        }
        if (coverageScore !== null) {
            return Math.max(10, Math.min(100, coverageScore));
        }
        if (ratioScore !== null) {
            return Math.max(10, Math.min(100, ratioScore));
        }

        // 5. Fallback: keyword-based analysis
        let score = 30;
        const hasTestCode = /describe\s*\(|it\s*\(|test\s*\(|expect\s*\(|assert/i.test(text);
        const hasTestMention = /test|spec|coverage|unit\s+test|integration\s+test/i.test(text);
        const hasTestFile = /\.test\.|\.spec\.|__tests__/i.test(text);

        if (hasTestCode) score += 30;
        if (hasTestMention) score += 10;
        if (hasTestFile) score += 10;

        return Math.max(20, Math.min(100, score));
    }

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
