/**
 * Test COMPLET : Terminal interactif → Collecte → Consolidation → Suite workflow
 *
 * Ce script reste en mémoire pour conserver la session terminal.
 * Il attend que les agents finissent, puis collecte et consolide.
 */
import { Orchestrator } from './dist/core/Orchestrator.js';
import { readFile } from 'node:fs/promises';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
    console.log('=== TEST COMPLET : Interactive + Consolidation ===\n');

    // 1. Initialiser
    const orch = new Orchestrator(process.cwd());
    await orch.initialize();
    console.log('[OK] Orchestrator initialisé');

    // 2. Annuler tout workflow en cours
    const existing = await orch.getWorkflowStatus();
    if (existing && (existing.status === 'RUNNING' || existing.status === 'PAUSED')) {
        await orch.cancelWorkflow();
        console.log('[OK] Ancien workflow annulé');
    }

    // 3. Configurer terminal interactif
    orch.setDispatchMode('terminal');
    orch.setTerminalInteractive(true);
    console.log(`[OK] Mode: ${orch.getDispatchMode()}, Interactive: ${orch.getTerminalInteractive()}`);

    // 4. Démarrer workflow custom
    const startResult = await orch.startWorkflow('CUSTOM', 'Analyser la qualité et la sécurité du fichier src/core/Orchestrator.ts', 'test-2agents');
    if (!startResult.success) {
        console.error('[FAIL] Start:', startResult.error?.message);
        process.exit(1);
    }
    console.log(`[OK] Workflow démarré: ${startResult.data?.phases?.length ?? '?'} phases`);

    // 5. Dispatcher les agents
    console.log('\n[DISPATCH] Lancement des 2 panes interactifs...');
    const dispatchResult = await orch.dispatchPhase();
    if (!dispatchResult.success) {
        console.error('[FAIL] Dispatch:', dispatchResult.error?.message);
        console.error('[DEBUG]', JSON.stringify(dispatchResult, null, 2));
        process.exit(1);
    }
    console.log(`[OK] Dispatch en mode: ${dispatchResult.data?.mode}`);
    if (dispatchResult.data.terminalSession) {
        console.log(`  Session: ${dispatchResult.data.terminalSession.sessionId}`);
        for (const a of dispatchResult.data.terminalSession.agents) {
            console.log(`  - ${a.agentId}: ${a.outputPath}`);
        }
    } else {
        console.log('  (pas de terminalSession dans le résultat)');
    }

    // 6. Polling : attendre que les 2 agents finissent
    console.log('\n[WAIT] En attente de /exit dans les 2 panes...');
    console.log('       (Interagissez avec les agents, puis tapez /exit)\n');

    let allDone = false;
    while (!allDone) {
        await sleep(5000);
        const statusResult = await orch.getTerminalStatus();
        if (!statusResult.success || !statusResult.data) {
            console.log('  [?] Pas de session terminal');
            continue;
        }
        const status = statusResult.data;
        const done = status.completed.length;
        const total = status.total;
        if (done > 0) {
            console.log(`  [${done}/${total}] agents terminés: ${status.completed.join(', ')}`);
        }
        if (status.allDone) {
            allDone = true;
            console.log(`\n[OK] Tous les agents ont terminé !`);
            for (const [id, det] of Object.entries(status.agentDetails)) {
                console.log(`  - ${id}: ${det.status} (${Math.round(det.duration || 0)}s)`);
            }
        }
    }

    // 7. Collecter les outputs (déclenche consolidation automatiquement)
    console.log('\n--- Collecte + Consolidation ---');
    const collectResult = await orch.collectTerminalResults();
    if (!collectResult.success) {
        console.error('[FAIL] Collecte:', collectResult.error?.message);
        process.exit(1);
    }

    const phaseOutput = collectResult.data;
    console.log(`[OK] ${Object.keys(phaseOutput.agentOutputs).length} outputs collectés`);

    for (const [agentId, ao] of Object.entries(phaseOutput.agentOutputs)) {
        const preview = ao.output.substring(0, 100).replace(/\n/g, ' ').trim();
        console.log(`  - ${agentId} (${ao.status}): ${preview}...`);
    }

    if (phaseOutput.consolidatedOutput) {
        console.log(`\n[OK] CONSOLIDATION RÉUSSIE (${phaseOutput.consolidatedOutput.length} chars)`);
        console.log('\n========== RAPPORT CONSOLIDÉ ==========');
        console.log(phaseOutput.consolidatedOutput);
        console.log('========================================');
    } else {
        console.log('\n[INFO] Pas de consolidatedOutput dans le résultat');
        // Essayer manuellement
        console.log('[INFO] Tentative de consolidation manuelle...');
        try {
            const consolidated = await orch.consolidatePhaseOutput(phaseOutput);
            if (consolidated) {
                console.log(`[OK] Consolidation manuelle réussie (${consolidated.length} chars)`);
                console.log('\n========== RAPPORT CONSOLIDÉ ==========');
                console.log(consolidated);
                console.log('========================================');
            } else {
                console.log('[WARN] Consolidation a retourné vide');
            }
        } catch (err) {
            console.error('[FAIL] Consolidation:', err.message);
        }
    }

    // 8. État du workflow
    console.log('\n--- État final du workflow ---');
    const wf = await orch.getWorkflowStatus();
    for (const phase of wf.phases) {
        console.log(`  Phase "${phase.name}": ${phase.status} (score: ${phase.score ?? 'N/A'})`);
    }

    console.log('\n=== TEST COMPLET TERMINÉ ===');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
