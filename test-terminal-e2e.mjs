/**
 * Test E2E : Vérifie que les panes se lancent avec le bon contexte
 * et que l'output est correctement retourné pour consolidation.
 *
 * Stratégie :
 * 1. Crée un workflow test-2agents en mode terminal non-interactif
 * 2. Intercepte spawnSession pour capturer les prompts sans lancer de vrais panes
 * 3. Vérifie le contenu des fichiers system/user prompts écrits sur disque
 * 4. Simule les .done et output files
 * 5. Collecte et vérifie la structure prête pour consolidation
 */

import { Orchestrator } from './dist/core/Orchestrator.js';
import { readFile, writeFile, access, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const PASS = '\x1b[32m[PASS]\x1b[0m';
const FAIL = '\x1b[31m[FAIL]\x1b[0m';
const INFO = '\x1b[36m[INFO]\x1b[0m';
let failures = 0;

function assert(condition, message) {
    if (condition) {
        console.log(`${PASS} ${message}`);
    } else {
        console.log(`${FAIL} ${message}`);
        failures++;
    }
}

async function fileExists(path) {
    try { await access(path); return true; } catch { return false; }
}

async function main() {
    console.log('\n=== TEST E2E : Terminal Panes - Contexte & Output pour Consolidation ===\n');

    // ─────────────────────────────────────────────────────────
    // 1. INITIALISATION
    // ─────────────────────────────────────────────────────────
    console.log('--- 1. Initialisation ---');
    const orch = new Orchestrator(process.cwd());
    await orch.initialize();

    // Annuler tout workflow en cours
    const existing = await orch.getWorkflowStatus();
    if (existing && (existing.status === 'RUNNING' || existing.status === 'PAUSED')) {
        await orch.cancelWorkflow();
    }

    orch.setDispatchMode('terminal');
    orch.setTerminalInteractive(false); // non-interactif = --print mode

    assert(orch.getDispatchMode() === 'terminal', 'Mode terminal configuré');
    assert(!orch.getTerminalInteractive(), 'Mode non-interactif configuré');

    // ─────────────────────────────────────────────────────────
    // 2. INTERCEPTER LE LANCEMENT DES PANES
    // ─────────────────────────────────────────────────────────
    console.log('\n--- 2. Lancement du workflow avec interception ---');

    // On va laisser spawnSession générer les fichiers mais bloquer launchTerminalPanes
    const dispatcher = orch['agentDispatcher'];
    const termDisp = dispatcher.getTerminalDispatcher();

    // Intercepter le lancement réel des fenêtres
    const originalLaunch = termDisp['launchTerminalPanes'].bind(termDisp);
    let launchCalled = false;
    let launchArgs = null;
    termDisp['launchTerminalPanes'] = async (agents, sessionDir) => {
        launchCalled = true;
        launchArgs = { agents: agents.map(a => ({ agentId: a.agentId, agentName: a.agentName })), sessionDir };
        console.log(`${INFO} launchTerminalPanes intercepté (${agents.length} agents)`);
        // Ne PAS lancer les vrais panes
    };

    // Démarrer le workflow
    const startResult = await orch.startWorkflow('CUSTOM', 'Analyser la sécurité et la qualité du module EventBus', 'test-2agents');
    assert(startResult.success, `Workflow démarré: ${startResult.data?.phases?.length} phases`);

    // Dispatcher
    const dispatchResult = await orch.dispatchPhase();
    assert(dispatchResult.success, 'Dispatch réussi');
    assert(dispatchResult.data.mode === 'terminal', 'Mode = terminal');
    assert(launchCalled, 'launchTerminalPanes a été appelé');
    assert(dispatchResult.data.terminalSession !== undefined, 'Session terminal retournée');

    const session = dispatchResult.data.terminalSession;
    assert(session.agents.length === 2, `2 agents dans la session (trouvé: ${session.agents.length})`);

    // ─────────────────────────────────────────────────────────
    // 3. VÉRIFICATION DU CONTEXTE SUR DISQUE
    // ─────────────────────────────────────────────────────────
    console.log('\n--- 3. Vérification du contexte écrit sur disque ---');

    for (const agent of session.agents) {
        const systemFile = join(session.sessionDir, `system_${agent.agentId}.txt`);
        const userFile = join(session.sessionDir, `user_${agent.agentId}.txt`);
        const scriptFile = agent.scriptPath;

        // Fichiers existent ?
        assert(await fileExists(systemFile), `system_${agent.agentId}.txt existe`);
        assert(await fileExists(userFile), `user_${agent.agentId}.txt existe`);
        assert(await fileExists(scriptFile), `agent_${agent.agentId}.ps1 existe`);

        // System prompt non vide ?
        const sysContent = await readFile(systemFile, 'utf-8');
        assert(sysContent.length > 50, `System prompt ${agent.agentId}: ${sysContent.length} chars (> 50)`);

        // User prompt contient le contexte attendu ?
        const userContent = await readFile(userFile, 'utf-8');
        assert(userContent.includes('Analyser la sécurité'), `User prompt ${agent.agentId} contient la tâche`);
        assert(userContent.includes('Dual Analysis'), `User prompt ${agent.agentId} contient le nom de phase`);
        assert(userContent.includes('Project Info'), `User prompt ${agent.agentId} contient les infos projet`);

        // Script PS1 valide ?
        const scriptContent = await readFile(scriptFile, 'utf-8');
        assert(scriptContent.includes('trap {'), `Script ${agent.agentId} contient le trap handler`);
        assert(scriptContent.includes('Get-Command claude'), `Script ${agent.agentId} vérifie claude CLI`);
        assert(scriptContent.includes('$PSScriptRoot'), `Script ${agent.agentId} utilise $PSScriptRoot`);
        assert(scriptContent.includes("'--print'"), `Script ${agent.agentId} utilise --print (non-interactif)`);
        assert(!scriptContent.includes('--append-system-prompt'), `Script ${agent.agentId} n'utilise PAS --append-system-prompt`);
        assert(scriptContent.includes('Tee-Object'), `Script ${agent.agentId} capture l'output avec Tee-Object`);
        assert(scriptContent.includes(agent.agentName), `Script ${agent.agentId} affiche le nom de l'agent`);
        assert(scriptContent.includes('Dual Analysis'), `Script ${agent.agentId} affiche le nom de phase`);
    }

    // Vérifier que les prompts retournés sont cohérents
    assert(dispatchResult.data.prompts.length === 2, '2 prompts retournés');
    for (const prompt of dispatchResult.data.prompts) {
        assert(prompt.systemPrompt.length > 50, `Prompt ${prompt.agentId}: systemPrompt ${prompt.systemPrompt.length} chars`);
        assert(prompt.userPrompt.includes('Analyser la sécurité'), `Prompt ${prompt.agentId}: userPrompt contient la tâche`);
    }

    // ─────────────────────────────────────────────────────────
    // 4. SIMULATION DES OUTPUTS D'AGENTS
    // ─────────────────────────────────────────────────────────
    console.log('\n--- 4. Simulation des outputs d\'agents ---');

    const agentOutputs = {
        'security-expert': `## Security Analysis of EventBus

### Findings
1. **No input validation** on event names - could allow injection of malicious event names
2. **No rate limiting** on event emission - potential DoS vector
3. **Error handler** catches and logs but doesn't propagate - errors could be silently swallowed

### Recommendations
- Add event name validation regex
- Implement rate limiting per event type
- Add optional error propagation mode

### Risk Level: Medium`,

        'fullstack-ui-architect': `## Architecture Review of EventBus

### Design Assessment
- Clean pub/sub pattern implementation
- Good use of typed events
- Singleton pattern appropriate for this use case

### Quality Issues
1. **Missing unsubscribe mechanism** - potential memory leak in long-running processes
2. **No wildcard event support** - limits flexibility for cross-cutting concerns
3. **Synchronous emission** - could block if handlers are slow

### Improvement Suggestions
- Add removeListener/off method
- Consider wildcard/namespace support (e.g., "workflow:*")
- Add async emission option with Promise.allSettled`,
    };

    for (const agent of session.agents) {
        const output = agentOutputs[agent.agentId] || 'Default output';
        await writeFile(agent.outputPath, output, 'utf-8');
        await writeFile(agent.donePath, `SUCCESS:${Math.random() * 30 + 5}`, 'utf-8');
        console.log(`${INFO} Écrit output_${agent.agentId}.txt (${output.length} chars) + done`);
    }

    // ─────────────────────────────────────────────────────────
    // 5. VÉRIFICATION DU STATUT TERMINAL
    // ─────────────────────────────────────────────────────────
    console.log('\n--- 5. Vérification du statut terminal ---');

    const statusResult = await orch.getTerminalStatus();
    assert(statusResult.success, 'getTerminalStatus réussi');
    assert(statusResult.data.allDone === true, 'Tous les agents terminés');
    assert(statusResult.data.completed.length === 2, '2 agents completed');
    assert(statusResult.data.running.length === 0, '0 agents running');

    for (const agentId of statusResult.data.completed) {
        const detail = statusResult.data.agentDetails[agentId];
        assert(detail.status === 'success', `Agent ${agentId}: status = success`);
        assert(detail.duration > 0, `Agent ${agentId}: duration = ${detail.duration?.toFixed(1)}s`);
    }

    // ─────────────────────────────────────────────────────────
    // 6. COLLECTE DES OUTPUTS
    // ─────────────────────────────────────────────────────────
    console.log('\n--- 6. Collecte des outputs (collectTerminalResults) ---');

    // Mock consolidation pour ne pas appeler le vrai claude
    const originalConsolidate = orch.consolidatePhaseOutput.bind(orch);
    let consolidationCalled = false;
    let consolidationInput = null;
    orch.consolidatePhaseOutput = async (phaseOutput) => {
        consolidationCalled = true;
        consolidationInput = phaseOutput;
        const agentNames = Object.keys(phaseOutput.agentOutputs);
        return `## Consolidated Report\nCombined analysis from ${agentNames.length} agents: ${agentNames.join(', ')}.\n\n### Key Findings\n- Security issues identified\n- Architecture improvements suggested`;
    };

    const collectResult = await orch.collectTerminalResults();
    assert(collectResult.success, 'Collecte réussie');

    const phaseOutput = collectResult.data;
    assert(Object.keys(phaseOutput.agentOutputs).length === 2, '2 agent outputs collectés');
    assert(phaseOutput.errors.length === 0, 'Pas d\'erreurs');

    // Vérifier contenu des outputs
    for (const [agentId, ao] of Object.entries(phaseOutput.agentOutputs)) {
        assert(ao.status === 'SUCCESS', `Output ${agentId}: status = SUCCESS`);
        assert(ao.output.length > 100, `Output ${agentId}: ${ao.output.length} chars de contenu`);
        assert(ao.output === agentOutputs[agentId], `Output ${agentId}: contenu identique à l'original`);
        assert(ao.duration > 0, `Output ${agentId}: duration > 0`);
    }

    // ─────────────────────────────────────────────────────────
    // 7. VÉRIFICATION DE LA CONSOLIDATION
    // ─────────────────────────────────────────────────────────
    console.log('\n--- 7. Vérification de la consolidation ---');

    assert(consolidationCalled, 'consolidatePhaseOutput a été appelée (2 agents)');

    if (consolidationInput) {
        const inputAgents = Object.keys(consolidationInput.agentOutputs);
        assert(inputAgents.length === 2, `Consolidation reçoit 2 agents: ${inputAgents.join(', ')}`);
        for (const agentId of inputAgents) {
            assert(
                consolidationInput.agentOutputs[agentId].output.length > 100,
                `Consolidation reçoit output complet de ${agentId} (${consolidationInput.agentOutputs[agentId].output.length} chars)`,
            );
        }
    }

    assert(phaseOutput.consolidatedOutput !== undefined, 'consolidatedOutput présent dans PhaseOutput');
    assert(phaseOutput.consolidatedOutput.includes('Consolidated Report'), 'consolidatedOutput contient le rapport');
    assert(phaseOutput.consolidatedOutput.includes('security-expert'), 'consolidatedOutput mentionne security-expert');
    assert(phaseOutput.consolidatedOutput.includes('fullstack-ui-architect'), 'consolidatedOutput mentionne fullstack-ui-architect');

    // ─────────────────────────────────────────────────────────
    // 8. VÉRIFICATION DE L'INJECTION DANS LA PHASE
    // ─────────────────────────────────────────────────────────
    console.log('\n--- 8. Vérification de l\'injection dans la phase du workflow ---');

    const wf = await orch.getWorkflowStatus();
    const currentPhase = wf.phases[wf.currentPhaseIndex];
    assert(currentPhase.output !== null, 'Phase a un output après collecte');
    assert(Object.keys(currentPhase.output.agentOutputs).length === 2, 'Phase output a 2 agent outputs');
    assert(currentPhase.output.consolidatedOutput !== undefined, 'Phase output a consolidatedOutput');

    // ─────────────────────────────────────────────────────────
    // 9. VÉRIFICATION DU MODE INTERACTIF
    // ─────────────────────────────────────────────────────────
    console.log('\n--- 9. Test du mode interactif (vérification du script) ---');

    // Restaurer le dispatcher et tester le mode interactif
    orch.consolidatePhaseOutput = originalConsolidate;
    termDisp['launchTerminalPanes'] = async () => {}; // toujours intercepter

    // Cancel et redémarrer en mode interactif
    await orch.cancelWorkflow();
    orch.setTerminalInteractive(true);

    const startResult2 = await orch.startWorkflow('CUSTOM', "Tester l'escapage des quotes", 'test-2agents');
    assert(startResult2.success, 'Workflow interactif démarré');

    const dispatchResult2 = await orch.dispatchPhase();
    assert(dispatchResult2.success, 'Dispatch interactif réussi');

    const session2 = dispatchResult2.data.terminalSession;
    assert(session2.interactive === true, 'Session marquée interactive');

    for (const agent of session2.agents) {
        const scriptContent = await readFile(agent.scriptPath, 'utf-8');
        assert(scriptContent.includes('INTERACTIVE'), `Script interactif ${agent.agentId}: contient INTERACTIVE`);
        assert(scriptContent.includes('--append-system-prompt'), `Script interactif ${agent.agentId}: utilise --append-system-prompt`);
        // Le main claudeArgs ne doit PAS contenir --print, mais l'export step oui (--continue --print)
        assert(!scriptContent.includes("$claudeArgs = @('--print'"), `Script interactif ${agent.agentId}: claudeArgs principal sans --print`);
        assert(scriptContent.includes('--continue'), `Script interactif ${agent.agentId}: a le step d'export --continue`);
        assert(agent.transcriptPath !== undefined, `Agent interactif ${agent.agentId}: transcriptPath défini`);

        // Vérifier escapage des quotes dans le task
        assert(scriptContent.includes("l''escapage"), `Script interactif ${agent.agentId}: quotes escapées dans la tâche`);
    }

    // Cleanup
    await orch.cancelWorkflow();

    // ─────────────────────────────────────────────────────────
    // BILAN
    // ─────────────────────────────────────────────────────────
    console.log('\n' + '='.repeat(60));
    if (failures === 0) {
        console.log(`${PASS} TOUS LES TESTS PASSENT`);
    } else {
        console.log(`${FAIL} ${failures} test(s) en échec`);
    }
    console.log('='.repeat(60));

    process.exit(failures > 0 ? 1 : 0);
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
