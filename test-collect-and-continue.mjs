/**
 * Test script: Collecte manuelle des outputs, consolidation, et suite du workflow
 *
 * Comme la session terminal n'est pas persistée entre instances,
 * on lit les fichiers directement et on appelle consolidatePhaseOutput.
 */
import { Orchestrator } from './dist/core/Orchestrator.js';
import { readFile } from 'node:fs/promises';

const SESSION_DIR = 'C:/Users/BARNOIN INFORMATIQUE/AppData/Local/Temp/mcp-orchestrator/terminal_1770648497872_wjrd';

async function main() {
    console.log('=== Collecte + Consolidation + Suite du Workflow ===\n');

    // 1. Initialiser (restaure le workflow en cours)
    const orch = new Orchestrator(process.cwd());
    await orch.initialize();

    // 2. Vérifier le workflow
    const wf = await orch.getWorkflowStatus();
    if (!wf || wf.status !== 'RUNNING') {
        console.error('[FAIL] Aucun workflow en cours');
        process.exit(1);
    }
    console.log(`[OK] Workflow: ${wf.type} - Phase: ${wf.phases.find(p => p.status === 'RUNNING')?.name}`);

    // 3. Lire les outputs manuellement
    console.log('\n--- Lecture des outputs ---');
    const securityOutput = await readFile(`${SESSION_DIR}/output_security-expert.txt`, 'utf-8');
    const architectOutput = await readFile(`${SESSION_DIR}/output_fullstack-ui-architect.txt`, 'utf-8');
    const securityDone = await readFile(`${SESSION_DIR}/done_security-expert.txt`, 'utf-8');
    const architectDone = await readFile(`${SESSION_DIR}/done_fullstack-ui-architect.txt`, 'utf-8');

    console.log(`  security-expert: ${securityDone.trim()} (${securityOutput.length} chars)`);
    console.log(`  fullstack-ui-architect: ${architectDone.trim()} (${architectOutput.length} chars)`);

    // 4. Construire le PhaseOutput manuellement
    const phaseOutput = {
        agentOutputs: {
            'security-expert': {
                agentId: 'security-expert',
                status: 'SUCCESS',
                output: securityOutput,
                filesCreated: [],
                filesModified: [],
                duration: parseFloat(securityDone.trim().split(':')[1]) || 0,
                score: null,
            },
            'fullstack-ui-architect': {
                agentId: 'fullstack-ui-architect',
                status: 'SUCCESS',
                output: architectOutput,
                filesCreated: [],
                filesModified: [],
                duration: parseFloat(architectDone.trim().split(':')[1]) || 0,
                score: null,
            },
        },
        filesModified: [],
        errors: [],
        warnings: [],
    };

    console.log(`\n[OK] PhaseOutput construit: ${Object.keys(phaseOutput.agentOutputs).length} agents`);

    // 5. Lancer la consolidation (2 agents → devrait consolider)
    console.log('\n--- Consolidation ---');
    console.log('[INFO] Appel de consolidatePhaseOutput (2 agents → consolidation attendue)...');

    try {
        const consolidated = await orch.consolidatePhaseOutput(phaseOutput);
        if (consolidated && consolidated.length > 0) {
            console.log(`[OK] Consolidation réussie ! (${consolidated.length} chars)`);
            console.log('\n========== RAPPORT CONSOLIDÉ ==========');
            console.log(consolidated);
            console.log('========================================');
        } else {
            console.log('[INFO] Consolidation a retourné vide (les outputs étaient peut-être trop courts)');
        }
    } catch (err) {
        console.error('[WARN] Consolidation échouée:', err.message);
        console.log('(C\'est normal si claude CLI n\'est pas accessible depuis ce contexte)');
    }

    // 6. État final du workflow
    console.log('\n--- État du workflow ---');
    const wf2 = await orch.getWorkflowStatus();
    for (const phase of wf2.phases) {
        console.log(`  Phase "${phase.name}": ${phase.status} (score: ${phase.score ?? 'N/A'})`);
    }

    console.log('\n=== Test terminé ===');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
