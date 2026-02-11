/**
 * ConfigLoader - Détection automatique de la configuration projet
 *
 * Analyse le répertoire projet pour détecter :
 * - Package manager (npm, yarn, pnpm, bun)
 * - Linter (eslint, biome, oxlint)
 * - Test runner (vitest, jest, pytest, phpunit)
 * - Formatter (prettier, biome)
 * - Bundler (vite, webpack, esbuild, rollup)
 * - TypeScript (tsconfig.json)
 */

import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectInfo } from '../types/core.js';
import { logInfo, logDebug, logWarn } from '../utils/safe-logger.js';

// ============================================================================
// TYPES
// ============================================================================

export interface DetectedTools {
    packageManager: string | null;
    linter: string | null;
    linterCommand: string | null;
    testRunner: string | null;
    testCommand: string | null;
    formatter: string | null;
    bundler: string | null;
    typescript: boolean;
    typescriptCommand: string | null;
}

export interface ProjectConfig {
    projectInfo: ProjectInfo;
    tools: DetectedTools;
    preferences: Record<string, unknown>;
}

// ============================================================================
// CONFIG LOADER
// ============================================================================

export class ConfigLoader {
    private projectRoot: string;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    async load(): Promise<ProjectConfig> {
        logInfo('Loading project configuration from', this.projectRoot);

        const [projectInfo, tools] = await Promise.all([
            this.detectProjectInfo(),
            this.detectTools(),
        ]);

        logDebug(`Detected tools: ${JSON.stringify(tools)}`);

        return {
            projectInfo,
            tools,
            preferences: {},
        };
    }

    private async detectProjectInfo(): Promise<ProjectInfo> {
        const info: ProjectInfo = {
            name: 'project',
            type: 'unknown',
            language: 'unknown',
            framework: null,
            rootPath: this.projectRoot,
        };

        const pkg = await this.readJson('package.json');
        if (pkg) {
            info.name = pkg.name || 'project';
            info.type = pkg.type || 'commonjs';
            info.language = 'typescript';

            // Detect framework from dependencies
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (allDeps['next']) info.framework = 'next';
            else if (allDeps['nuxt']) info.framework = 'nuxt';
            else if (allDeps['@angular/core']) info.framework = 'angular';
            else if (allDeps['vue']) info.framework = 'vue';
            else if (allDeps['react']) info.framework = 'react';
            else if (allDeps['svelte']) info.framework = 'svelte';
            else if (allDeps['express']) info.framework = 'express';
            else if (allDeps['fastify']) info.framework = 'fastify';
            else if (allDeps['nestjs'] || allDeps['@nestjs/core']) info.framework = 'nestjs';

            // Check if actually TypeScript
            if (!allDeps['typescript'] && !await this.fileExists('tsconfig.json')) {
                info.language = 'javascript';
            }
        }

        // Python project
        if (await this.fileExists('pyproject.toml') || await this.fileExists('setup.py')) {
            info.language = 'python';
            info.type = 'python';
        }

        // PHP project
        if (await this.fileExists('composer.json')) {
            info.language = 'php';
            const composer = await this.readJson('composer.json');
            if (composer?.require?.['laravel/framework']) info.framework = 'laravel';
        }

        // Go project
        if (await this.fileExists('go.mod')) {
            info.language = 'go';
            info.type = 'go-module';
        }

        // Rust project
        if (await this.fileExists('Cargo.toml')) {
            info.language = 'rust';
            info.type = 'cargo';
        }

        return info;
    }

    private async detectTools(): Promise<DetectedTools> {
        const tools: DetectedTools = {
            packageManager: null,
            linter: null,
            linterCommand: null,
            testRunner: null,
            testCommand: null,
            formatter: null,
            bundler: null,
            typescript: false,
            typescriptCommand: null,
        };

        // Package manager detection (by lockfile)
        const pmChecks: Array<[string, string]> = [
            ['bun.lockb', 'bun'],
            ['pnpm-lock.yaml', 'pnpm'],
            ['yarn.lock', 'yarn'],
            ['package-lock.json', 'npm'],
        ];
        for (const [lockfile, pm] of pmChecks) {
            if (await this.fileExists(lockfile)) {
                tools.packageManager = pm;
                break;
            }
        }

        // TypeScript
        if (await this.fileExists('tsconfig.json')) {
            tools.typescript = true;
            tools.typescriptCommand = 'npx tsc --noEmit';
        }

        // Linter detection
        const linterChecks: Array<[string, string, string]> = [
            ['biome.json', 'biome', 'npx biome check .'],
            ['biome.jsonc', 'biome', 'npx biome check .'],
            ['.eslintrc.json', 'eslint', 'npx eslint .'],
            ['.eslintrc.js', 'eslint', 'npx eslint .'],
            ['.eslintrc.cjs', 'eslint', 'npx eslint .'],
            ['.eslintrc.yml', 'eslint', 'npx eslint .'],
            ['eslint.config.js', 'eslint', 'npx eslint .'],
            ['eslint.config.mjs', 'eslint', 'npx eslint .'],
            ['eslint.config.ts', 'eslint', 'npx eslint .'],
            ['oxlintrc.json', 'oxlint', 'npx oxlint .'],
        ];
        for (const [file, linter, command] of linterChecks) {
            if (await this.fileExists(file)) {
                tools.linter = linter;
                tools.linterCommand = command;
                break;
            }
        }

        // Test runner detection
        const pkg = await this.readJson('package.json');
        if (pkg) {
            const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };
            if (allDeps['vitest']) {
                tools.testRunner = 'vitest';
                tools.testCommand = 'npx vitest run';
            } else if (allDeps['jest']) {
                tools.testRunner = 'jest';
                tools.testCommand = 'npx jest';
            } else if (allDeps['mocha']) {
                tools.testRunner = 'mocha';
                tools.testCommand = 'npx mocha';
            }
        }

        // Python test runner
        if (await this.fileExists('pytest.ini') || await this.fileExists('pyproject.toml')) {
            if (!tools.testRunner) {
                tools.testRunner = 'pytest';
                tools.testCommand = 'pytest';
            }
        }

        // Formatter detection
        const formatterChecks: Array<[string, string]> = [
            ['.prettierrc', 'prettier'],
            ['.prettierrc.json', 'prettier'],
            ['.prettierrc.js', 'prettier'],
            ['prettier.config.js', 'prettier'],
            ['prettier.config.mjs', 'prettier'],
        ];
        for (const [file, formatter] of formatterChecks) {
            if (await this.fileExists(file)) {
                tools.formatter = formatter;
                break;
            }
        }
        // Biome also formats
        if (!tools.formatter && tools.linter === 'biome') {
            tools.formatter = 'biome';
        }

        // Bundler detection
        const bundlerChecks: Array<[string, string]> = [
            ['vite.config.ts', 'vite'],
            ['vite.config.js', 'vite'],
            ['vite.config.mts', 'vite'],
            ['webpack.config.js', 'webpack'],
            ['webpack.config.ts', 'webpack'],
            ['rollup.config.js', 'rollup'],
            ['rollup.config.mjs', 'rollup'],
            ['esbuild.config.js', 'esbuild'],
        ];
        for (const [file, bundler] of bundlerChecks) {
            if (await this.fileExists(file)) {
                tools.bundler = bundler;
                break;
            }
        }

        return tools;
    }

    // ========================================================================
    // HELPERS
    // ========================================================================

    private async fileExists(relativePath: string): Promise<boolean> {
        try {
            await access(join(this.projectRoot, relativePath));
            return true;
        } catch {
            return false;
        }
    }

    private async readJson(relativePath: string): Promise<Record<string, any> | null> {
        try {
            const content = await readFile(join(this.projectRoot, relativePath), 'utf-8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }
}
