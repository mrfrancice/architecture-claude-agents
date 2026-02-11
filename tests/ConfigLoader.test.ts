import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ConfigLoader } from '../src/core/ConfigLoader.js';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('ConfigLoader', () => {
    let tempDir: string;
    let loader: ConfigLoader;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'configloader-test-'));
        loader = new ConfigLoader(tempDir);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it('should return null from getConfig() before load()', () => {
        expect(loader.getConfig()).toBeNull();
    });

    it('should detect TypeScript when tsconfig.json exists', async () => {
        await writeFile(join(tempDir, 'tsconfig.json'), '{}');
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }));
        const config = await loader.load();
        expect(config.tools.typescript).toBe(true);
        expect(config.projectInfo.language).toBe('typescript');
    });

    it('should detect npm when package-lock.json exists', async () => {
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }));
        await writeFile(join(tempDir, 'package-lock.json'), '{}');
        const config = await loader.load();
        expect(config.tools.packageManager).toBe('npm');
    });

    it('should detect yarn when yarn.lock exists', async () => {
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }));
        await writeFile(join(tempDir, 'yarn.lock'), '');
        const config = await loader.load();
        expect(config.tools.packageManager).toBe('yarn');
    });

    it('should detect pnpm when pnpm-lock.yaml exists', async () => {
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }));
        await writeFile(join(tempDir, 'pnpm-lock.yaml'), '');
        const config = await loader.load();
        expect(config.tools.packageManager).toBe('pnpm');
    });

    it('should detect vitest as test runner from package.json devDependencies', async () => {
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({
            name: 'test-project',
            devDependencies: { vitest: '^1.0.0' },
        }));
        const config = await loader.load();
        expect(config.tools.testRunner).toBe('vitest');
    });

    it('should detect jest as test runner', async () => {
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({
            name: 'test-project',
            devDependencies: { jest: '^29.0.0' },
        }));
        const config = await loader.load();
        expect(config.tools.testRunner).toBe('jest');
    });

    it('should detect eslint as linter', async () => {
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({
            name: 'test-project',
            devDependencies: { eslint: '^8.0.0' },
        }));
        const config = await loader.load();
        expect(config.tools.linter).toBe('eslint');
    });

    it('should detect react framework', async () => {
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({
            name: 'test-project',
            dependencies: { react: '^18.0.0' },
        }));
        const config = await loader.load();
        expect(config.projectInfo.framework).toBe('react');
    });

    it('should detect express framework', async () => {
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({
            name: 'test-project',
            dependencies: { express: '^4.0.0' },
        }));
        const config = await loader.load();
        expect(config.projectInfo.framework).toBe('express');
    });

    it('should detect python language when requirements.txt exists', async () => {
        await writeFile(join(tempDir, 'requirements.txt'), 'flask==2.0.0');
        const config = await loader.load();
        expect(config.projectInfo.language).toBe('python');
    });

    it('should detect unknown language when no markers exist', async () => {
        const config = await loader.load();
        expect(config.projectInfo.language).toBe('unknown');
    });

    it('should detect project name from package.json', async () => {
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({
            name: 'my-awesome-project',
        }));
        const config = await loader.load();
        expect(config.projectInfo.name).toBe('my-awesome-project');
    });

    it('should cache config after first load', async () => {
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'test-project' }));
        const config1 = await loader.load();
        const config2 = await loader.load();
        expect(config1).toBe(config2);
    });

    it('should clear cache and reload with reload()', async () => {
        await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'first-name' }));
        const config1 = await loader.load();
        expect(config1.projectInfo.name).toBe('first-name');

        await writeFile(join(tempDir, 'package.json'), JSON.stringify({ name: 'second-name' }));
        const config2 = await loader.reload();
        expect(config2.projectInfo.name).toBe('second-name');
        expect(config2).not.toBe(config1);
    });
});
