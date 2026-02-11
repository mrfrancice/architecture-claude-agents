import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SnapshotManager } from '../src/core/SnapshotManager.js';
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync } from 'node:fs';
import type { Snapshot } from '../src/core/SnapshotManager.js';

const execFileAsync = promisify(execFile);

describe('SnapshotManager', () => {
    let tempDir: string;
    let manager: SnapshotManager;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'snapshotmanager-test-'));
        manager = new SnapshotManager(tempDir);
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    it('should create snapshots directory on initialize', async () => {
        const snapshotsDir = join(tempDir, '.claude', 'orchestrator', 'snapshots');
        expect(existsSync(snapshotsDir)).toBe(false);
        await manager.initialize();
        expect(existsSync(snapshotsDir)).toBe(true);
    });

    it('should return empty list from listSnapshots initially', async () => {
        await manager.initialize();
        expect(manager.listSnapshots()).toEqual([]);
    });

    it('should return null from getLatestSnapshot initially', async () => {
        await manager.initialize();
        expect(manager.getLatestSnapshot()).toBeNull();
    });

    it('should return null from getSnapshot for unknown ID', async () => {
        await manager.initialize();
        expect(manager.getSnapshot('snap_nonexistent')).toBeNull();
    });

    it('should remove snapshots for a given workflow on cleanupWorkflow', async () => {
        // Pre-populate snapshots.json with test data
        const snapshotsDir = join(tempDir, '.claude', 'orchestrator', 'snapshots');
        await mkdir(snapshotsDir, { recursive: true });

        const testSnapshots: Snapshot[] = [
            {
                id: 'snap_001',
                workflowId: 'wf-keep',
                phaseId: 'phase-1',
                commitHash: 'abc123',
                hasStagedChanges: false,
                hasUnstagedChanges: false,
                stashRef: null,
                createdAt: new Date().toISOString(),
                description: 'Snapshot to keep',
            },
            {
                id: 'snap_002',
                workflowId: 'wf-remove',
                phaseId: 'phase-2',
                commitHash: 'def456',
                hasStagedChanges: false,
                hasUnstagedChanges: false,
                stashRef: null,
                createdAt: new Date().toISOString(),
                description: 'Snapshot to remove',
            },
            {
                id: 'snap_003',
                workflowId: 'wf-remove',
                phaseId: 'phase-3',
                commitHash: 'ghi789',
                hasStagedChanges: true,
                hasUnstagedChanges: false,
                stashRef: 'stash-ref-1',
                createdAt: new Date().toISOString(),
                description: 'Another snapshot to remove',
            },
        ];

        await writeFile(
            join(snapshotsDir, 'snapshots.json'),
            JSON.stringify(testSnapshots, null, 2),
        );

        await manager.initialize();
        expect(manager.listSnapshots()).toHaveLength(3);

        await manager.cleanupWorkflow('wf-remove');

        const remaining = manager.listSnapshots();
        expect(remaining).toHaveLength(1);
        expect(remaining[0].id).toBe('snap_001');
        expect(remaining[0].workflowId).toBe('wf-keep');
    });

    it('should return a copy from listSnapshots (not mutable reference)', async () => {
        const snapshotsDir = join(tempDir, '.claude', 'orchestrator', 'snapshots');
        await mkdir(snapshotsDir, { recursive: true });

        const testSnapshots: Snapshot[] = [
            {
                id: 'snap_100',
                workflowId: 'wf-test',
                phaseId: 'phase-1',
                commitHash: 'aaa111',
                hasStagedChanges: false,
                hasUnstagedChanges: false,
                stashRef: null,
                createdAt: new Date().toISOString(),
                description: 'Test snapshot',
            },
        ];

        await writeFile(
            join(snapshotsDir, 'snapshots.json'),
            JSON.stringify(testSnapshots, null, 2),
        );

        await manager.initialize();

        const list1 = manager.listSnapshots();
        const list2 = manager.listSnapshots();
        expect(list1).not.toBe(list2);
        expect(list1).toEqual(list2);

        // Mutating the returned array should not affect internal state
        list1.push({
            id: 'snap_extra',
            workflowId: 'wf-extra',
            phaseId: 'phase-extra',
            commitHash: 'xxx',
            hasStagedChanges: false,
            hasUnstagedChanges: false,
            stashRef: null,
            createdAt: new Date().toISOString(),
            description: 'Extra',
        });

        expect(manager.listSnapshots()).toHaveLength(1);
    });
});

// ============================================================================
// getChangedFiles & getHeadCommitHash (requires a real git repo)
// ============================================================================

describe('SnapshotManager - getChangedFiles', () => {
    let gitDir: string;
    let manager: SnapshotManager;

    async function git(...args: string[]) {
        const { stdout } = await execFileAsync('git', args, { cwd: gitDir });
        return stdout.trim();
    }

    beforeEach(async () => {
        gitDir = await mkdtemp(join(tmpdir(), 'snapshot-git-test-'));
        manager = new SnapshotManager(gitDir);
        await manager.initialize();

        // Init a real git repo with an initial commit
        await git('init');
        await git('config', 'user.email', 'test@test.com');
        await git('config', 'user.name', 'Test');
        await writeFile(join(gitDir, 'initial.txt'), 'initial content');
        await git('add', '.');
        await git('commit', '-m', 'initial');
    });

    afterEach(async () => {
        await rm(gitDir, { recursive: true, force: true });
    });

    it('should return empty when no changes', async () => {
        const result = await manager.getChangedFiles();
        expect(result.created).toEqual([]);
        expect(result.modified).toEqual([]);
        expect(result.deleted).toEqual([]);
    });

    it('should detect untracked (created) files', async () => {
        await writeFile(join(gitDir, 'new-file.txt'), 'new content');

        const result = await manager.getChangedFiles();
        expect(result.created).toContain('new-file.txt');
    });

    it('should detect modified tracked files (unstaged)', async () => {
        await writeFile(join(gitDir, 'initial.txt'), 'modified content');

        // Use sinceCommit to detect modifications vs HEAD
        const commitHash = await git('rev-parse', 'HEAD');
        const result = await manager.getChangedFiles(commitHash);
        expect(result.modified).toContain('initial.txt');
    });

    it('should detect staged new files', async () => {
        await writeFile(join(gitDir, 'staged-new.txt'), 'staged content');
        await git('add', 'staged-new.txt');

        const result = await manager.getChangedFiles();
        expect(result.created).toContain('staged-new.txt');
    });

    it('should return null from getHeadCommitHash in non-git dir', async () => {
        const nonGitDir = await mkdtemp(join(tmpdir(), 'non-git-'));
        const nonGitManager = new SnapshotManager(nonGitDir);
        await nonGitManager.initialize();

        const hash = await nonGitManager.getHeadCommitHash();
        expect(hash).toBeNull();

        await rm(nonGitDir, { recursive: true, force: true });
    });

    it('should return commit hash from getHeadCommitHash in git dir', async () => {
        const hash = await manager.getHeadCommitHash();
        expect(hash).toBeTruthy();
        expect(hash!.length).toBeGreaterThanOrEqual(7);
    });

    it('should return empty result in non-git dir', async () => {
        const nonGitDir = await mkdtemp(join(tmpdir(), 'non-git-'));
        const nonGitManager = new SnapshotManager(nonGitDir);
        await nonGitManager.initialize();

        const result = await nonGitManager.getChangedFiles();
        expect(result.created).toEqual([]);
        expect(result.modified).toEqual([]);
        expect(result.deleted).toEqual([]);

        await rm(nonGitDir, { recursive: true, force: true });
    });
});
