/**
 * TEST E2E : Mode Terminal Interactif — Création de code réel
 *
 * Ce script teste le cycle complet :
 *   1. Démarrage d'un workflow custom à 3 phases (Design → Code → Tests)
 *   2. Phase 1 (Design) : non-interactive — agent analyse en --print
 *   3. Phase 2 (Code)   : interactive — agent écrit du code sur le disque
 *   4. Phase 3 (Tests)  : interactive — agent écrit et lance des tests
 *   5. Git diff tracking : détection automatique des fichiers créés/modifiés
 *   6. Collecte des outputs + consolidation
 *
 * PRÉREQUIS :
 *   - npx tsc (build le projet)
 *   - Le repo git doit être propre (ou au moins avoir un commit)
 *
 * USAGE :
 *   node test-interactive-codegen.mjs
 *
 * Le script reste actif pendant l'exécution des panes.
 * Pour les phases interactives : interagissez avec l'agent dans la pane,
 * puis tapez /exit quand vous avez terminé.
 */

import { Orchestrator } from './dist/core/Orchestrator.js';

const TASK = `Create a simple TypeScript utility module at "src/utils/string-helpers.ts" that exports 3 functions:
1. capitalize(str: string): string — capitalizes the first letter
2. slugify(str: string): string — converts to URL-friendly slug (lowercase, hyphens)
3. truncate(str: string, maxLen: number): string — truncates with "..." if longer than maxLen

The module must:
- Be pure TypeScript with ES module exports
- Have JSDoc comments on each function
- Handle edge cases (empty strings, null-ish values)`;

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function banner(text) {
    const line = '='.repeat(60);
    console.log(`\n${line}`);
    console.log(`  ${text}`);
    console.log(`${line}\n`);
}

function section(text) {
    console.log(`\n--- ${text} ---`);
}

async function waitForAgents(orch, phaseName) {
    console.log(`\n[WAIT] Phase "${phaseName}" — en attente des agents...`);
    console.log('       (Pour les phases interactives: interagissez puis tapez /exit)\n');

    const startWait = Date.now();
    let lastLog = 0;

    while (true) {
        await sleep(3000);

        const statusResult = await orch.getTerminalStatus();
        if (!statusResult.success || !statusResult.data) {
            // Pas de session terminal (mode non-terminal ou collectée)
            return null;
        }

        const status = statusResult.data;
        const elapsed = Math.round((Date.now() - startWait) / 1000);

        // Log progress every 15s
        if (Date.now() - lastLog > 15000) {
            const running = status.running.join(', ') || 'none';
            const done = status.completed.join(', ') || 'none';
            console.log(`  [${elapsed}s] Running: ${running} | Done: ${done}`);
            lastLog = Date.now();
        }

        if (status.allDone) {
            console.log(`\n[OK] Phase "${phaseName}" — tous les agents ont terminé (${elapsed}s)`);
            for (const [id, det] of Object.entries(status.agentDetails)) {
                const icon = det.status === 'success' ? '✓' : '✗';
                console.log(`  ${icon} ${id}: ${det.status} (${Math.round(det.duration || 0)}s)`);
            }
            return status;
        }

        // Timeout 30 min
        if (elapsed > 1800) {
            console.error(`[TIMEOUT] Phase "${phaseName}" a dépassé 30 minutes`);
            return status;
        }
    }
}

async function processPhase(orch, phaseIndex) {
    const wf = await orch.getWorkflowStatus();
    const phase = wf.phases[phaseIndex];
    if (!phase) return false;

    section(`PHASE ${phaseIndex + 1}: ${phase.name} (${phase.mode})`);
    console.log(`  Agents: ${phase.agents.join(', ')}`);
    console.log(`  Status: ${phase.status}`);

    if (phase.status !== 'RUNNING') {
        console.log(`  [SKIP] Phase n'est pas RUNNING`);
        return false;
    }

    // 1. Dispatch
    console.log(`\n[DISPATCH] Lancement de la phase "${phase.name}"...`);
    const dispatchResult = await orch.dispatchPhase();
    if (!dispatchResult.success) {
        console.error(`[FAIL] Dispatch: ${dispatchResult.error?.message}`);
        return false;
    }

    console.log(`  Mode dispatch: ${dispatchResult.data.mode}`);
    if (dispatchResult.data.terminalSession) {
        const sess = dispatchResult.data.terminalSession;
        console.log(`  Session: ${sess.sessionId}`);
        console.log(`  Interactive: ${sess.interactive ?? false}`);
        for (const a of sess.agents) {
            console.log(`    - ${a.agentId}: output → ${a.outputPath}`);
        }
    }

    // 2. Wait for agents (terminal mode)
    if (dispatchResult.data.terminalSession) {
        const status = await waitForAgents(orch, phase.name);
        if (!status?.allDone) {
            console.error(`[FAIL] Agents not all done for phase "${phase.name}"`);
            return false;
        }

        // 3. Collect outputs
        section(`COLLECTE: ${phase.name}`);
        const collectResult = await orch.collectTerminalResults();
        if (!collectResult.success) {
            console.error(`[FAIL] Collecte: ${collectResult.error?.message}`);
            return false;
        }

        const output = collectResult.data;
        console.log(`  Agents collectés: ${Object.keys(output.agentOutputs).length}`);
        console.log(`  Fichiers modifiés: ${output.filesModified.length > 0 ? output.filesModified.join(', ') : '(aucun)'}`);
        console.log(`  Erreurs: ${output.errors.length}`);
        console.log(`  Warnings: ${output.warnings.length}`);

        // Preview each agent output
        for (const [agentId, ao] of Object.entries(output.agentOutputs)) {
            const preview = ao.output.substring(0, 150).replace(/\n/g, ' ').trim();
            console.log(`\n  [${agentId}] (${ao.status})`);
            console.log(`    Files created: ${ao.filesCreated.length > 0 ? ao.filesCreated.join(', ') : '(none)'}`);
            console.log(`    Files modified: ${ao.filesModified.length > 0 ? ao.filesModified.join(', ') : '(none)'}`);
            console.log(`    Output: ${preview}...`);
        }

        if (output.consolidatedOutput) {
            console.log(`\n  [CONSOLIDATION] ${output.consolidatedOutput.length} chars`);
            const preview = output.consolidatedOutput.substring(0, 200).replace(/\n/g, ' ');
            console.log(`    ${preview}...`);
        }
    }

    // 4. Validate
    section(`VALIDATION: ${phase.name}`);
    const validateResult = await orch.validatePhase();
    if (!validateResult.success) {
        console.error(`[FAIL] Validation: ${validateResult.error?.message}`);
        return false;
    }

    const score = validateResult.data;
    console.log(`  Score: ${score.total}/100`);
    console.log(`  Decision: ${score.decision}`);
    console.log(`  Breakdown:`);
    for (const [key, val] of Object.entries(score.breakdown)) {
        console.log(`    ${key}: ${val}`);
    }
    if (score.feedback.length > 0) {
        console.log(`  Feedback:`);
        for (const f of score.feedback) {
            console.log(`    - ${f}`);
        }
    }
    if (score.blockers.length > 0) {
        console.log(`  Blockers:`);
        for (const b of score.blockers) {
            console.log(`    - [${b.type}] ${b.message}`);
        }
    }

    return true;
}

async function main() {
    banner('TEST E2E : Terminal Interactif + Codegen + Git Diff');

    console.log('TÂCHE:');
    console.log(TASK);
    console.log();

    // ========================================================================
    // INIT
    // ========================================================================
    section('INITIALISATION');
    const orch = new Orchestrator(process.cwd());
    await orch.initialize();
    console.log('[OK] Orchestrator initialisé');

    // Cancel any existing workflow
    const existing = await orch.getWorkflowStatus();
    if (existing && (existing.status === 'RUNNING' || existing.status === 'PAUSED')) {
        await orch.cancelWorkflow();
        console.log('[OK] Ancien workflow annulé');
    }

    // ========================================================================
    // CONFIGURATION
    // ========================================================================
    section('CONFIGURATION');
    orch.setDispatchMode('terminal');
    console.log(`  Dispatch mode: ${orch.getDispatchMode()}`);
    console.log(`  Terminal interactive sera auto-switché par phase.mode`);

    const status = await orch.getSystemStatus();
    console.log(`  Agents: ${status.agents.total} (${status.agents.builtIn} built-in, ${status.agents.custom} custom)`);

    // ========================================================================
    // START WORKFLOW
    // ========================================================================
    section('DÉMARRAGE WORKFLOW');
    const startResult = await orch.startWorkflow(
        'CUSTOM',
        TASK,
        'test-interactive-codegen',
    );

    if (!startResult.success) {
        console.error(`[FAIL] Start: ${startResult.error?.message}`);
        process.exit(1);
    }

    const wf = startResult.data;
    console.log(`  Workflow: ${wf.id}`);
    console.log(`  Phases: ${wf.phases.length}`);
    for (const phase of wf.phases) {
        console.log(`    ${phase.name}: ${phase.mode} (agents: ${phase.agents.join(', ')})`);
    }

    // ========================================================================
    // EXECUTE PHASES
    // ========================================================================
    let phaseIndex = 0;
    let continueProcessing = true;

    while (continueProcessing) {
        const currentWf = await orch.getWorkflowStatus();

        if (!currentWf || currentWf.status !== 'RUNNING') {
            console.log(`\n[END] Workflow status: ${currentWf?.status || 'null'}`);
            continueProcessing = false;
            break;
        }

        phaseIndex = currentWf.currentPhaseIndex;
        const currentPhase = currentWf.phases[phaseIndex];

        if (!currentPhase || currentPhase.status !== 'RUNNING') {
            // Workflow may have auto-advanced or completed
            if (currentWf.status === 'COMPLETE' || currentWf.status === 'FAILED') {
                continueProcessing = false;
                break;
            }
            // Wait a bit and recheck
            await sleep(1000);
            continue;
        }

        const ok = await processPhase(orch, phaseIndex);
        if (!ok) {
            console.error(`\n[FAIL] Phase ${phaseIndex} échouée, arrêt du test`);
            continueProcessing = false;
        }

        // Small delay before checking next phase
        await sleep(2000);
    }

    // ========================================================================
    // RÉSUMÉ FINAL
    // ========================================================================
    banner('RÉSUMÉ FINAL');

    const finalWf = await orch.getWorkflowStatus();
    if (!finalWf) {
        console.log('  Pas de workflow');
    } else {
        console.log(`  Status: ${finalWf.status}`);
        console.log(`  Score total: ${finalWf.totalScore ?? 'N/A'}`);
        console.log();

        for (const phase of finalWf.phases) {
            const icon = phase.status === 'PASS' ? '✓'
                : phase.status === 'FAIL' ? '✗'
                : phase.status === 'SKIPPED' ? '⊘'
                : '●';
            const modeTag = phase.mode === 'interactive' ? ' [INTERACTIVE]' : '';
            const promoted = phase.forcePromoted ? ' (force-promoted)' : '';
            console.log(`  ${icon} ${phase.name}: ${phase.status} (score: ${phase.score ?? 'N/A'})${modeTag}${promoted}`);

            if (phase.output?.filesModified?.length) {
                console.log(`    Files: ${phase.output.filesModified.join(', ')}`);
            }
        }
    }

    // ========================================================================
    // VÉRIFICATIONS GIT
    // ========================================================================
    section('VÉRIFICATION GIT');
    const { SnapshotManager } = await import('./dist/core/SnapshotManager.js');
    const snapMgr = new SnapshotManager(process.cwd());
    await snapMgr.initialize();

    const changedFiles = await snapMgr.getChangedFiles();
    console.log(`  Fichiers créés:   ${changedFiles.created.length > 0 ? changedFiles.created.join(', ') : '(aucun)'}`);
    console.log(`  Fichiers modifiés: ${changedFiles.modified.length > 0 ? changedFiles.modified.join(', ') : '(aucun)'}`);
    console.log(`  Fichiers supprimés: ${changedFiles.deleted.length > 0 ? changedFiles.deleted.join(', ') : '(aucun)'}`);

    // Check if the expected file was actually created
    const expectedFile = 'src/utils/string-helpers.ts';
    const allFiles = [...changedFiles.created, ...changedFiles.modified];
    if (allFiles.some(f => f.includes('string-helpers'))) {
        console.log(`\n  ✓ Le fichier attendu (${expectedFile}) a été détecté par git diff !`);
    } else {
        console.log(`\n  ✗ Le fichier attendu (${expectedFile}) n'a PAS été détecté`);
        console.log(`    (Vérifiez que l'agent a bien créé le fichier pendant la phase Code)`);
    }

    banner('TEST TERMINÉ');
}

main().catch(err => {
    console.error('\nFATAL:', err);
    process.exit(1);
});
