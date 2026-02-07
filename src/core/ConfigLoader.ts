/**
 * ConfigLoader - Détection automatique de la configuration projet
 *
 * Analyse le projet pour détecter :
 * - Langage principal
 * - Framework utilisé
 * - Outils disponibles (linter, test runner, etc.)
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { ProjectInfo } from '../types/core.js';

// ============================================================================
// TYPES
// ============================================================================

export interface ProjectConfig {
    projectInfo: ProjectInfo;
    tools: DetectedTools;
    preferences: Record<string, unknown>;
}

export interface DetectedTools {
    packageManager: 'npm' | 'yarn' | 'pnpm' | 'bun' | null;
    linter: string | null;
    testRunner: string | null;
    formatter: string | null;
    bundler: string | null;
    typescript: boolean;
}

// ============================================================================
// CONFIG LOADER
// ============================================================================

export class ConfigLoader {
    private projectRoot: string;
    private config: ProjectConfig | null = null;

    constructor(projectRoot: string) {
        this.projectRoot = projectRoot;
    }

    /**
     * Charge et détecte la configuration projet
     */
    async load(): Promise<ProjectConfig> {
        if (this.config) return this.config;

        const packageJson = await this.readPackageJson();
        const tools = await this.detectTools(packageJson);
        const projectInfo = await this.detectProjectInfo(packageJson, tools);
        const preferences = await this.loadPreferences();

        this.config = { projectInfo, tools, preferences };
        return this.config;
    }

    /**
     * Retourne la config (après load)
     */
    getConfig(): ProjectConfig | null {
        return this.config;
    }

    /**
     * Recharge la configuration
     */
    async reload(): Promise<ProjectConfig> {
        this.config = null;
        return this.load();
    }

    // ========================================================================
    // DETECTION
    // ========================================================================

    private async readPackageJson(): Promise<Record<string, unknown> | null> {
        const path = join(this.projectRoot, 'package.json');
        if (!existsSync(path)) return null;
        try {
            const content = await readFile(path, 'utf-8');
            return JSON.parse(content);
        } catch {
            return null;
        }
    }

    private async detectTools(packageJson: Record<string, unknown> | null): Promise<DetectedTools> {
        const tools: DetectedTools = {
            packageManager: null,
            linter: null,
            testRunner: null,
            formatter: null,
            bundler: null,
            typescript: false,
        };

        // Package manager
        if (existsSync(join(this.projectRoot, 'bun.lockb'))) {
            tools.packageManager = 'bun';
        } else if (existsSync(join(this.projectRoot, 'pnpm-lock.yaml'))) {
            tools.packageManager = 'pnpm';
        } else if (existsSync(join(this.projectRoot, 'yarn.lock'))) {
            tools.packageManager = 'yarn';
        } else if (existsSync(join(this.projectRoot, 'package-lock.json'))) {
            tools.packageManager = 'npm';
        }

        // TypeScript
        tools.typescript = existsSync(join(this.projectRoot, 'tsconfig.json'));

        if (!packageJson) return tools;

        const allDeps = {
            ...(packageJson.dependencies as Record<string, string> || {}),
            ...(packageJson.devDependencies as Record<string, string> || {}),
        };

        // Linter
        if (allDeps['eslint'] || allDeps['@eslint/js']) {
            tools.linter = 'eslint';
        } else if (allDeps['biome'] || allDeps['@biomejs/biome']) {
            tools.linter = 'biome';
        }

        // Test runner
        if (allDeps['vitest']) {
            tools.testRunner = 'vitest';
        } else if (allDeps['jest'] || allDeps['@jest/core']) {
            tools.testRunner = 'jest';
        } else if (allDeps['mocha']) {
            tools.testRunner = 'mocha';
        }

        // Formatter
        if (allDeps['prettier']) {
            tools.formatter = 'prettier';
        } else if (allDeps['@biomejs/biome']) {
            tools.formatter = 'biome';
        }

        // Bundler
        if (allDeps['vite']) {
            tools.bundler = 'vite';
        } else if (allDeps['webpack']) {
            tools.bundler = 'webpack';
        } else if (allDeps['esbuild']) {
            tools.bundler = 'esbuild';
        } else if (allDeps['rollup']) {
            tools.bundler = 'rollup';
        }

        return tools;
    }

    private async detectProjectInfo(
        packageJson: Record<string, unknown> | null,
        tools: DetectedTools,
    ): Promise<ProjectInfo> {
        const name = (packageJson?.name as string) || this.projectRoot.split(/[\\/]/).pop() || 'project';

        // Détection du langage
        let language = 'unknown';
        if (tools.typescript) {
            language = 'typescript';
        } else if (packageJson) {
            language = 'javascript';
        } else if (existsSync(join(this.projectRoot, 'requirements.txt')) || existsSync(join(this.projectRoot, 'pyproject.toml'))) {
            language = 'python';
        } else if (existsSync(join(this.projectRoot, 'go.mod'))) {
            language = 'go';
        } else if (existsSync(join(this.projectRoot, 'Cargo.toml'))) {
            language = 'rust';
        } else if (existsSync(join(this.projectRoot, 'pom.xml')) || existsSync(join(this.projectRoot, 'build.gradle'))) {
            language = 'java';
        }

        // Détection du framework
        let framework: string | null = null;
        if (packageJson) {
            const allDeps = {
                ...(packageJson.dependencies as Record<string, string> || {}),
                ...(packageJson.devDependencies as Record<string, string> || {}),
            };

            if (allDeps['next']) framework = 'next';
            else if (allDeps['nuxt']) framework = 'nuxt';
            else if (allDeps['@angular/core']) framework = 'angular';
            else if (allDeps['vue']) framework = 'vue';
            else if (allDeps['react']) framework = 'react';
            else if (allDeps['svelte']) framework = 'svelte';
            else if (allDeps['express']) framework = 'express';
            else if (allDeps['fastify']) framework = 'fastify';
            else if (allDeps['hono']) framework = 'hono';
            else if (allDeps['nestjs'] || allDeps['@nestjs/core']) framework = 'nestjs';
        }

        // Détection du type
        let type = 'library';
        const scripts = packageJson?.scripts as Record<string, string> | undefined;
        if (scripts?.start || scripts?.serve) {
            type = framework ? 'application' : 'server';
        }
        if (packageJson?.bin) type = 'cli';

        return {
            name,
            type,
            language,
            framework,
            rootPath: this.projectRoot,
        };
    }

    private async loadPreferences(): Promise<Record<string, unknown>> {
        const prefsPath = join(this.projectRoot, '.claude', 'orchestrator', 'preferences.json');
        if (!existsSync(prefsPath)) return {};
        try {
            const content = await readFile(prefsPath, 'utf-8');
            return JSON.parse(content);
        } catch {
            return {};
        }
    }
}
