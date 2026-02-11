/**
 * Test script: Terminal interactif avec 2 panes + consolidation
 *
 * Lance un workflow custom avec 2 agents en parallèle dans Windows Terminal,
 * en mode interactif (claude TUI au lieu de claude --print).
 */
import { Orchestrator } from './dist/core/Orchestrator.js';

async function main() {
    console.log('=== Test Terminal Interactif + Consolidation ===\n');

    // 1. Initialiser l'orchestrateur sur le projet courant
    const orch = new Orchestrator(process.cwd());
    await orch.initialize();
    console.log('[OK] Orchestrator initialisé');

    // 2. Annuler tout workflow en cours
    const existing = await orch.getWorkflowStatus();
    if (existing && (existing.status === 'RUNNING' || existing.status === 'PAUSED')) {
        await orch.cancelWorkflow();
        console.log('[OK] Ancien workflow annulé');
    }

    // 3. Configurer : mode terminal + interactif
    orch.setDispatchMode('terminal');
    orch.setTerminalInteractive(true);
    console.log(`[OK] Mode: ${orch.getDispatchMode()}, Interactive: ${orch.getTerminalInteractive()}`);

    // 3. Démarrer le workflow custom "test-2agents"
    const startResult = await orch.startWorkflow('CUSTOM', 'Analyser la qualité du code du fichier src/core/Orchestrator.ts', 'test-2agents');
    if (!startResult.success) {
        console.error('[FAIL] Start workflow:', startResult.error?.message);
        process.exit(1);
    }
    console.log(`[OK] Workflow démarré: ${startResult.data.type} - ${startResult.data.phases.length} phases`);
    console.log(`     Phase courante: ${startResult.data.phases[0].name} (${startResult.data.phases[0].status})`);

    // 4. Afficher les agents de la phase courante
    const phaseInfo = orch.getCurrentPhaseInfo();
    console.log(`\n[INFO] Phase "${phaseInfo.phase.name}" - Agents assignés:`);
    for (const agent of phaseInfo.agents) {
        console.log(`  - ${agent.id} (${agent.name})`);
    }

    // 5. Dispatcher → ouvre les panes Windows Terminal
    console.log('\n[DISPATCH] Lancement des panes terminal interactifs...');
    const dispatchResult = await orch.dispatchPhase();
    if (!dispatchResult.success) {
        console.error('[FAIL] Dispatch:', dispatchResult.error?.message);
        process.exit(1);
    }

    console.log(`[OK] Dispatch réussi en mode: ${dispatchResult.data.mode}`);
    if (dispatchResult.data.terminalSession) {
        console.log(`     Session: ${dispatchResult.data.terminalSession.sessionId}`);
        console.log(`     Agents: ${dispatchResult.data.terminalSession.agents.length} panes ouverts`);
        for (const a of dispatchResult.data.terminalSession.agents) {
            console.log(`       - ${a.agentId}: output=${a.outputPath}`);
            if (a.transcriptPath) {
                console.log(`         transcript=${a.transcriptPath}`);
            }
        }
    }

    console.log('\n========================================');
    console.log('Les panes sont ouverts ! Interagissez avec chaque agent.');
    console.log('Quand vous avez fini, tapez /exit dans chaque pane.');
    console.log('');
    console.log('Ensuite, utilisez les commandes MCP :');
    console.log('  orchestrator_agents { action: "terminal_status" }');
    console.log('  orchestrator_agents { action: "terminal_collect" }');
    console.log('========================================');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
