/**
 * Test TEMPS RÉEL : Mode Terminal complet
 *
 * Ce script teste la chaîne complète en conditions réelles :
 *   1. Build TypeScript (npx tsc)
 *   2. Init Orchestrator
 *   3. Lancement automatique des panes Windows Terminal (ou PowerShell fallback)
 *   4. Vérification du contexte écrit sur disque
 *   5. Polling de progression en temps réel
 *   6. Collecte des outputs
 *   7. Consolidation multi-agents
 *   8. Affichage du rapport final
 *
 * Usage :
 *   node test-terminal-realtime.mjs                    # Mode non-interactif (défaut)
 *   node test-terminal-realtime.mjs --interactive      # Mode interactif (TUI)
 *   node test-terminal-realtime.mjs --task "Ma tâche"  # Tâche personnalisée
 *
 * Le mode NON-INTERACTIF (--print) est recommandé pour un premier test :
 * les agents s'exécutent automatiquement et la sortie est capturée sans intervention.
 *
 * Le mode INTERACTIF ouvre des TUI claude où vous pouvez taper des messages.
 * Tapez /exit dans chaque pane pour terminer l'agent.
 */

import { Orchestrator } from './dist/core/Orchestrator.js';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

// ─────────────────────────────────────────────────────────────
// CONFIGURATION
// ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const INTERACTIVE = args.includes('--interactive') || args.includes('-i');
const TASK_INDEX = args.indexOf('--task');
const CUSTOM_TASK = TASK_INDEX !== -1 ? args[TASK_INDEX + 1] : null;

const DEFAULT_TASK_NONINTERACTIVE =
    'Analyze the code quality and security of the file src/core/EventBus.ts. ' +
    'Focus on: error handling robustness, potential memory leaks from event listeners, ' +
    'and any injection risks via event names. Be concise (max 300 words).';

const DEFAULT_TASK_INTERACTIVE =
    'Review the architecture of src/core/AgentDispatcher.ts. ' +
    'Identify the top 3 improvements for maintainability and testability.';

const TASK = CUSTOM_TASK || (INTERACTIVE ? DEFAULT_TASK_INTERACTIVE : DEFAULT_TASK_NONINTERACTIVE);
const WORKFLOW = 'test-2agents';
const POLL_INTERVAL = 3000; // 3s
const TIMEOUT = 10 * 60 * 1000; // 10 minutes

// ─────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────

const C = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    yellow: '\x1b[33m',
    gray: '\x1b[90m',
    bold: '\x1b[1m',
    magenta: '\x1b[35m',
};

function log(tag, color, msg) {
    const ts = new Date().toLocaleTimeString('fr-FR', { hour12: false });
    console.log(`${C.gray}${ts}${C.reset} ${color}[${tag}]${C.reset} ${msg}`);
}

const ok   = (msg) => log('OK',   C.green, msg);
const info = (msg) => log('INFO', C.cyan, msg);
const warn = (msg) => log('WARN', C.yellow, msg);
const fail = (msg) => log('FAIL', C.red, msg);
const step = (n, msg) => console.log(`\n${C.bold}${C.magenta}── ${n}. ${msg} ──${C.reset}`);

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fileExists(path) {
    try { await access(path); return true; } catch { return false; }
}

function elapsed(start) {
    return ((Date.now() - start) / 1000).toFixed(1);
}

function truncate(str, max = 120) {
    const clean = str.replace(/\n/g, ' ').trim();
    return clean.length > max ? clean.slice(0, max - 3) + '...' : clean;
}

// ─────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────

async function main() {
    const globalStart = Date.now();

    console.log(`\n${C.bold}${'='.repeat(70)}${C.reset}`);
    console.log(`${C.bold}${C.cyan}  TEST TEMPS RÉEL : Mode Terminal ${INTERACTIVE ? 'INTERACTIF' : 'NON-INTERACTIF'}${C.reset}`);
    console.log(`${C.bold}${'='.repeat(70)}${C.reset}`);
    console.log(`${C.gray}  Workflow: ${WORKFLOW} | Tâche: ${truncate(TASK, 60)}${C.reset}`);
    console.log(`${C.gray}  Mode: ${INTERACTIVE ? 'Interactif (TUI) - tapez /exit pour terminer' : 'Non-interactif (--print) - exécution automatique'}${C.reset}\n`);

    // ──────────────────────────────────────────────────────────
    // 1. BUILD
    // ──────────────────────────────────────────────────────────
    step(1, 'Build TypeScript');
    try {
        execSync('npx tsc', { cwd: process.cwd(), stdio: 'pipe' });
        ok('Build réussi (0 erreurs)');
    } catch (err) {
        fail(`Build échoué:\n${err.stdout?.toString() || err.message}`);
        process.exit(1);
    }

    // ──────────────────────────────────────────────────────────
    // 2. INITIALISATION
    // ──────────────────────────────────────────────────────────
    step(2, 'Initialisation Orchestrator');
    const orch = new Orchestrator(process.cwd());
    await orch.initialize();
    ok('Orchestrator initialisé');

    // Annuler tout workflow existant
    const existing = await orch.getWorkflowStatus();
    if (existing && (existing.status === 'RUNNING' || existing.status === 'PAUSED')) {
        await orch.cancelWorkflow();
        info('Ancien workflow annulé');
    }

    // Configurer le mode
    orch.setDispatchMode('terminal');
    orch.setTerminalInteractive(INTERACTIVE);
    ok(`Mode: terminal | Interactive: ${INTERACTIVE}`);

    // ──────────────────────────────────────────────────────────
    // 3. DÉMARRAGE DU WORKFLOW
    // ──────────────────────────────────────────────────────────
    step(3, 'Démarrage du workflow');
    const startResult = await orch.startWorkflow('CUSTOM', TASK, WORKFLOW);
    if (!startResult.success) {
        fail(`Impossible de démarrer le workflow: ${startResult.error?.message}`);
        process.exit(1);
    }
    ok(`Workflow démarré: ${startResult.data.id} (${startResult.data.phases.length} phases)`);
    for (const phase of startResult.data.phases) {
        info(`  Phase "${phase.name}" → agents: [${phase.agents.join(', ')}]`);
    }

    // ──────────────────────────────────────────────────────────
    // 4. DISPATCH (LANCEMENT DES PANES)
    // ──────────────────────────────────────────────────────────
    step(4, 'Dispatch des agents (lancement des panes)');
    const dispatchStart = Date.now();
    const dispatchResult = await orch.dispatchPhase();

    if (!dispatchResult.success) {
        fail(`Dispatch échoué: ${dispatchResult.error?.message}`);
        process.exit(1);
    }

    ok(`Dispatch réussi en mode "${dispatchResult.data.mode}" (${elapsed(dispatchStart)}s)`);

    const session = dispatchResult.data.terminalSession;
    if (!session) {
        fail('Pas de session terminal retournée');
        process.exit(1);
    }

    ok(`Session: ${session.sessionId}`);
    info(`Répertoire: ${session.sessionDir}`);
    info(`Interactive: ${session.interactive || false}`);

    for (const agent of session.agents) {
        info(`  Agent "${agent.agentName}" (${agent.agentId})`);
        info(`    Script:  ${agent.scriptPath}`);
        info(`    Output:  ${agent.outputPath}`);
        info(`    Done:    ${agent.donePath}`);
    }

    // ──────────────────────────────────────────────────────────
    // 5. VÉRIFICATION DU CONTEXTE SUR DISQUE
    // ──────────────────────────────────────────────────────────
    step(5, 'Vérification du contexte sur disque');
    let contextOk = true;

    for (const agent of session.agents) {
        const sysFile = join(session.sessionDir, `system_${agent.agentId}.txt`);
        const usrFile = join(session.sessionDir, `user_${agent.agentId}.txt`);

        if (await fileExists(sysFile)) {
            const sys = await readFile(sysFile, 'utf-8');
            ok(`system_${agent.agentId}.txt: ${sys.length} chars`);
        } else {
            fail(`system_${agent.agentId}.txt ABSENT`);
            contextOk = false;
        }

        if (await fileExists(usrFile)) {
            const usr = await readFile(usrFile, 'utf-8');
            ok(`user_${agent.agentId}.txt: ${usr.length} chars`);

            // Vérifier les sections clés du contexte
            const checks = [
                ['Task', usr.includes('## Task')],
                ['Phase', usr.includes('Current Phase')],
                ['Project Info', usr.includes('## Project Info')],
            ];
            for (const [label, passed] of checks) {
                if (passed) {
                    ok(`  ✓ Section "${label}" présente`);
                } else {
                    warn(`  ✗ Section "${label}" absente`);
                }
            }
        } else {
            fail(`user_${agent.agentId}.txt ABSENT`);
            contextOk = false;
        }

        if (await fileExists(agent.scriptPath)) {
            const script = await readFile(agent.scriptPath, 'utf-8');
            ok(`agent_${agent.agentId}.ps1: ${script.length} chars`);

            if (INTERACTIVE) {
                if (script.includes('INTERACTIVE')) ok('  ✓ Mode INTERACTIVE détecté');
                if (script.includes('--append-system-prompt')) ok('  ✓ --append-system-prompt présent');
                if (script.includes('--continue')) ok('  ✓ Export step --continue présent');
            } else {
                if (script.includes("'--print'")) ok("  ✓ Mode --print (non-interactif)");
                if (script.includes('WriteAllText')) ok('  ✓ UTF-8 NoBOM output via WriteAllText');
            }
        } else {
            fail(`agent_${agent.agentId}.ps1 ABSENT`);
            contextOk = false;
        }
    }

    if (!contextOk) {
        fail('Contexte incomplet - vérifier TerminalDispatcher.prepareAgent()');
        process.exit(1);
    }

    // ──────────────────────────────────────────────────────────
    // 6. POLLING DE PROGRESSION
    // ──────────────────────────────────────────────────────────
    step(6, 'Attente de fin des agents');
    if (INTERACTIVE) {
        console.log(`${C.yellow}  → Interagissez avec les agents dans les panes Windows Terminal`);
        console.log(`  → Tapez /exit dans chaque pane pour terminer l'agent${C.reset}\n`);
    } else {
        console.log(`${C.gray}  → Les agents s'exécutent automatiquement en mode --print${C.reset}\n`);
    }

    const pollStart = Date.now();
    const completedSoFar = new Set();
    let finalStatus = null;

    while (Date.now() - pollStart < TIMEOUT) {
        const statusResult = await orch.getTerminalStatus();
        if (!statusResult.success || !statusResult.data) {
            warn('Pas de session terminal active');
            await sleep(POLL_INTERVAL);
            continue;
        }

        const status = statusResult.data;

        // Afficher les nouvelles complétions
        for (const agentId of status.completed) {
            if (!completedSoFar.has(agentId)) {
                completedSoFar.add(agentId);
                const detail = status.agentDetails[agentId];
                const icon = detail.status === 'success' ? '✓' : '✗';
                const color = detail.status === 'success' ? C.green : C.red;
                console.log(`  ${color}${icon} ${agentId}${C.reset}: ${detail.status} (${(detail.duration || 0).toFixed(1)}s) @ ${elapsed(pollStart)}s`);
            }
        }

        if (status.allDone) {
            finalStatus = status;
            console.log();
            ok(`Tous les agents terminés en ${elapsed(pollStart)}s`);
            break;
        }

        // Indicateur de progression
        const bar = status.completed.map(() => '█').join('') + status.running.map(() => '░').join('');
        process.stdout.write(`\r  ${C.gray}[${bar}] ${status.completed.length}/${status.total} agents | ${elapsed(pollStart)}s${C.reset}  `);

        await sleep(POLL_INTERVAL);
    }

    if (!finalStatus) {
        fail(`Timeout après ${TIMEOUT / 1000}s - tous les agents n'ont pas terminé`);
        const lastStatus = await orch.getTerminalStatus();
        if (lastStatus.success && lastStatus.data) {
            warn(`Running: ${lastStatus.data.running.join(', ')}`);
            warn(`Completed: ${lastStatus.data.completed.join(', ')}`);
        }
        await orch.cancelWorkflow();
        process.exit(1);
    }

    // ──────────────────────────────────────────────────────────
    // 7. COLLECTE DES OUTPUTS
    // ──────────────────────────────────────────────────────────
    step(7, 'Collecte des outputs + consolidation');
    const collectStart = Date.now();
    const collectResult = await orch.collectTerminalResults();

    if (!collectResult.success) {
        fail(`Collecte échouée: ${collectResult.error?.message}`);
        await orch.cancelWorkflow();
        process.exit(1);
    }

    const phaseOutput = collectResult.data;
    ok(`${Object.keys(phaseOutput.agentOutputs).length} outputs collectés (${elapsed(collectStart)}s)`);

    if (phaseOutput.errors.length > 0) {
        for (const err of phaseOutput.errors) {
            warn(`Erreur: ${err}`);
        }
    }

    if (phaseOutput.warnings?.length > 0) {
        for (const w of phaseOutput.warnings) {
            warn(w);
        }
    }

    // Afficher un aperçu de chaque output
    for (const [agentId, ao] of Object.entries(phaseOutput.agentOutputs)) {
        const statusIcon = ao.status === 'SUCCESS' ? `${C.green}SUCCESS${C.reset}` : `${C.red}FAILED${C.reset}`;
        console.log(`\n  ${C.bold}${agentId}${C.reset} [${statusIcon}] (${ao.duration.toFixed(1)}s, ${ao.output.length} chars)`);
        console.log(`  ${C.gray}${truncate(ao.output, 200)}${C.reset}`);
    }

    // ──────────────────────────────────────────────────────────
    // 8. CONSOLIDATION
    // ──────────────────────────────────────────────────────────
    step(8, 'Rapport consolidé');

    if (phaseOutput.consolidatedOutput) {
        ok(`Consolidation réussie (${phaseOutput.consolidatedOutput.length} chars)`);
        console.log(`\n${C.bold}${C.cyan}${'─'.repeat(60)}${C.reset}`);
        console.log(`${C.bold}${C.cyan}  RAPPORT CONSOLIDÉ${C.reset}`);
        console.log(`${C.bold}${C.cyan}${'─'.repeat(60)}${C.reset}\n`);
        console.log(phaseOutput.consolidatedOutput);
        console.log(`\n${C.bold}${C.cyan}${'─'.repeat(60)}${C.reset}`);
    } else {
        warn('Pas de rapport consolidé (consolidation désactivée ou échec)');
        info('Les outputs individuels sont disponibles ci-dessus');
    }

    // ──────────────────────────────────────────────────────────
    // 9. ÉTAT FINAL DU WORKFLOW
    // ──────────────────────────────────────────────────────────
    step(9, 'État final');
    const wf = await orch.getWorkflowStatus();
    if (wf) {
        console.log(`  Workflow: ${wf.id} (${wf.status})`);
        for (const phase of wf.phases) {
            const phaseIcon = phase.status === 'PASS' ? '✓' :
                              phase.status === 'RUNNING' ? '▶' :
                              phase.status === 'PENDING' ? '○' :
                              phase.status === 'FAIL' ? '✗' : '~';
            const scoreStr = phase.score !== null ? `score: ${phase.score}/100` : 'pas de score';
            console.log(`  ${phaseIcon} Phase "${phase.name}": ${phase.status} (${scoreStr})`);
            if (phase.output) {
                const agents = Object.keys(phase.output.agentOutputs);
                console.log(`    ${C.gray}Agents: ${agents.join(', ')}${C.reset}`);
                if (phase.output.consolidatedOutput) {
                    console.log(`    ${C.gray}Consolidation: ${phase.output.consolidatedOutput.length} chars${C.reset}`);
                }
            }
        }
    }

    // ──────────────────────────────────────────────────────────
    // BILAN
    // ──────────────────────────────────────────────────────────
    console.log(`\n${C.bold}${'='.repeat(70)}${C.reset}`);
    const totalTime = elapsed(globalStart);
    const allSuccess = Object.values(phaseOutput.agentOutputs).every(ao => ao.status === 'SUCCESS');
    const hasConsolidation = !!phaseOutput.consolidatedOutput;

    if (allSuccess && hasConsolidation) {
        console.log(`${C.bold}${C.green}  ✓ TEST COMPLET RÉUSSI${C.reset} (${totalTime}s)`);
        console.log(`${C.green}    - Panes lancés automatiquement${C.reset}`);
        console.log(`${C.green}    - Contexte vérifié sur disque${C.reset}`);
        console.log(`${C.green}    - ${Object.keys(phaseOutput.agentOutputs).length} agents exécutés${C.reset}`);
        console.log(`${C.green}    - Outputs collectés${C.reset}`);
        console.log(`${C.green}    - Consolidation multi-agents réussie${C.reset}`);
    } else if (allSuccess) {
        console.log(`${C.bold}${C.yellow}  ~ TEST PARTIEL${C.reset} (${totalTime}s)`);
        console.log(`${C.green}    - Agents exécutés avec succès${C.reset}`);
        console.log(`${C.yellow}    - Consolidation absente ou échouée${C.reset}`);
    } else {
        console.log(`${C.bold}${C.red}  ✗ TEST AVEC ERREURS${C.reset} (${totalTime}s)`);
        for (const [id, ao] of Object.entries(phaseOutput.agentOutputs)) {
            if (ao.status !== 'SUCCESS') {
                console.log(`${C.red}    - ${id}: ${ao.status}${C.reset}`);
            }
        }
    }
    console.log(`${C.bold}${'='.repeat(70)}${C.reset}\n`);

    // Nettoyage
    await orch.cancelWorkflow();
}

main().catch(err => {
    console.error(`\n${C.red}Fatal: ${err.message}${C.reset}`);
    console.error(err.stack);
    process.exit(1);
});
