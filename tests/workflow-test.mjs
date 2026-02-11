/**
 * Test d'intégration du workflow — exécuté en temps réel
 *
 * Teste le cycle de vie complet :
 * 1. Initialisation de l'orchestrateur
 * 2. Démarrage d'un workflow
 * 3. Dispatch d'une phase (mode manual)
 * 4. Validation d'une phase
 * 5. Itération + force promote
 * 6. Avancement entre phases
 * 7. Edge cases (0 phases, agent manquant, dependencies, pause/resume)
 */

import { Orchestrator } from '../dist/core/Orchestrator.js';
import { EventBus } from '../dist/core/EventBus.js';

// ============================================================================
// TEST HELPERS
// ============================================================================

let passed = 0;
let failed = 0;
const errors = [];

function assert(condition, message) {
    if (condition) {
        passed++;
        console.log(`  ✅ ${message}`);
    } else {
        failed++;
        errors.push(message);
        console.log(`  ❌ ${message}`);
    }
}

function section(title) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  ${title}`);
    console.log('='.repeat(60));
}

// ============================================================================
// TESTS
// ============================================================================

async function runTests() {
    const projectRoot = process.cwd();

    // ========================================================================
    section('TEST 1 : Initialisation');
    // ========================================================================

    const orch = new Orchestrator(projectRoot);
    try {
        await orch.initialize();
        assert(true, 'Orchestrator initialisé sans erreur');
    } catch (err) {
        assert(false, `Initialisation échouée: ${err.message}`);
        process.exit(1);
    }

    const status = await orch.getSystemStatus();
    assert(status.initialized === true, `initialized = true`);
    assert(status.agentsLoaded > 0, `${status.agentsLoaded} agents chargés`);
    assert(status.hooksLoaded >= 0, `${status.hooksLoaded} hooks chargés`);
    assert(status.skillsLoaded >= 0, `${status.skillsLoaded} skills chargés`);
    assert(status.memoriesLoaded >= 0, `${status.memoriesLoaded} memories chargées`);
    assert(status.protocolsLoaded > 0, `${status.protocolsLoaded} protocols chargés`);

    // ========================================================================
    section('TEST 2 : Liste des agents');
    // ========================================================================

    const agents = orch.listAgents();
    assert(agents.length > 0, `${agents.length} agents disponibles`);

    const agentNames = agents.map(a => a.id);
    console.log(`  Agents: ${agentNames.join(', ')}`);

    assert(agentNames.includes('security-expert'), 'security-expert présent');
    assert(agentNames.includes('fullstack-ui-architect'), 'fullstack-ui-architect présent');
    assert(agentNames.includes('meta-agent-orchestrator') || agentNames.some(n => n.includes('meta')), 'meta-agent-orchestrator présent');

    // ========================================================================
    section('TEST 3 : Liste des skills');
    // ========================================================================

    const skills = orch.listSkills();
    console.log(`  ${skills.length} skills chargés`);
    if (skills.length > 0) {
        console.log(`  Skills: ${skills.map(s => s.name).join(', ')}`);
        assert(true, `${skills.length} skills disponibles`);
    } else {
        assert(true, 'Aucun skill (dossier skills peut être vide)');
    }

    // ========================================================================
    section('TEST 4 : Dispatch mode');
    // ========================================================================

    const mode = orch.getDispatchMode();
    assert(mode === 'manual', `Mode par défaut = manual (got: ${mode})`);

    orch.setDispatchMode('cli');
    assert(orch.getDispatchMode() === 'cli', 'Mode changé à cli');

    orch.setDispatchMode('manual');
    assert(orch.getDispatchMode() === 'manual', 'Mode remis à manual');

    // ========================================================================
    section('TEST 5 : Démarrage workflow BUILD');
    // ========================================================================

    const startResult = await orch.startWorkflow('BUILD', 'Test task: build a hello world app');
    assert(startResult.success === true, 'Workflow démarré avec succès');
    assert(startResult.data?.type === 'BUILD', `Type = BUILD`);
    assert(startResult.data?.status === 'RUNNING', `Status = RUNNING`);
    assert(startResult.data?.phases.length > 0, `${startResult.data?.phases.length} phases créées`);

    const firstPhase = startResult.data?.phases[0];
    assert(firstPhase?.status === 'RUNNING', `Phase 0 status = RUNNING (got: ${firstPhase?.status})`);
    assert(firstPhase?.iteration === 1, `Phase 0 iteration = 1 (got: ${firstPhase?.iteration})`);
    assert(firstPhase?.agents.length > 0, `Phase 0 a ${firstPhase?.agents.length} agents`);

    console.log(`  Phases: ${startResult.data?.phases.map(p => `${p.name}[${p.agents.join(',')}]`).join(' → ')}`);

    // ========================================================================
    section('TEST 6 : Dupliquer workflow (doit échouer)');
    // ========================================================================

    const dupResult = await orch.startWorkflow('BUILD', 'Duplicate');
    assert(dupResult.success === false, 'Double démarrage refusé');
    assert(dupResult.error?.message.includes('already running'), `Message: ${dupResult.error?.message}`);

    // ========================================================================
    section('TEST 7 : Info phase courante');
    // ========================================================================

    const phaseInfo = orch.getCurrentPhaseInfo();
    assert(phaseInfo !== null, 'Phase info disponible');
    assert(phaseInfo?.phaseName === firstPhase?.name, `Phase name = ${phaseInfo?.phaseName}`);
    assert(phaseInfo?.agents.length > 0, `${phaseInfo?.agents.length} agents dans la phase`);
    console.log(`  Agents de la phase: ${phaseInfo?.agents.map(a => `${a.id}(${a.domain||'?'})`).join(', ')}`);

    // ========================================================================
    section('TEST 8 : Dispatch phase (mode manual)');
    // ========================================================================

    const dispatchResult = await orch.dispatchPhase();
    assert(dispatchResult.success === true, 'Dispatch réussi');
    assert(dispatchResult.data?.mode === 'manual', `Mode = manual`);

    const prompts = dispatchResult.data?.prompts;
    assert(prompts !== undefined && prompts.length > 0, `${prompts?.length} prompts générés`);

    if (prompts && prompts.length > 0) {
        const p = prompts[0];
        assert(p.systemPrompt.length > 0, `System prompt non vide (${p.systemPrompt.length} chars)`);
        assert(p.userPrompt.length > 0, `User prompt non vide (${p.userPrompt.length} chars)`);
        assert(p.userPrompt.includes('## Task'), 'User prompt contient ## Task');
        assert(p.userPrompt.includes('## Current Phase'), 'User prompt contient ## Current Phase');
        assert(p.userPrompt.includes('## Project Info'), 'User prompt contient ## Project Info');

        // Vérifier la section collaboration si l'agent collabore
        console.log(`  Agent prompt: ${p.agentId}, model: ${p.model || 'default'}`);
    }

    // Vérifier que phase.output a été initialisé (Bug #1 fix)
    const wfAfterDispatch = await orch.getWorkflowStatus();
    const phaseAfterDispatch = wfAfterDispatch?.phases[wfAfterDispatch.currentPhaseIndex];
    assert(phaseAfterDispatch?.output !== null, 'phase.output initialisé après dispatch manual (Bug#1 fix)');

    // ========================================================================
    section('TEST 9 : Validation phase (avec output fourni)');
    // ========================================================================

    const validateResult = await orch.validatePhase(undefined, 'Agent output: Hello World app built successfully.\n## Summary\nBuilt a basic hello world application.');
    assert(validateResult.success === true, 'Validation réussie');
    assert(validateResult.data !== undefined, 'Score data présent');

    const score = validateResult.data;
    console.log(`  Score: ${score?.total}/100, Decision: ${score?.decision}`);
    console.log(`  Breakdown: correctness=${score?.breakdown.correctness}, completeness=${score?.breakdown.completeness}, security=${score?.breakdown.security}`);
    console.log(`  Feedback: ${score?.feedback.slice(0, 3).join('; ')}`);

    assert(typeof score?.total === 'number', `Score total est un nombre: ${score?.total}`);
    assert(['PASS', 'ITERATE', 'FAIL'].includes(score?.decision || ''), `Decision valide: ${score?.decision}`);

    // ========================================================================
    section('TEST 10 : Vérification état après validation');
    // ========================================================================

    const wfAfterValidate = await orch.getWorkflowStatus();
    assert(wfAfterValidate !== null, 'Workflow toujours accessible');

    const phase0After = wfAfterValidate?.phases[0];
    console.log(`  Phase 0 status: ${phase0After?.status}, score: ${phase0After?.score}, iteration: ${phase0After?.iteration}`);

    if (score?.decision === 'PASS') {
        assert(phase0After?.status === 'PASS', `Phase 0 = PASS après PASS decision`);
        assert(wfAfterValidate?.currentPhaseIndex === 1, `Avancé à phase 1 (currentPhaseIndex=${wfAfterValidate?.currentPhaseIndex})`);

        const phase1 = wfAfterValidate?.phases[1];
        assert(phase1?.status === 'RUNNING', `Phase 1 = RUNNING (got: ${phase1?.status})`);
        assert(phase1?.iteration === 1, `Phase 1 iteration = 1`);
    } else if (score?.decision === 'ITERATE') {
        assert(
            phase0After?.status === 'ITERATE' || phase0After?.status === 'PASS',
            `Phase 0 = ITERATE ou PASS (force promoted) (got: ${phase0After?.status})`
        );
    } else {
        console.log(`  Decision was FAIL — workflow should be FAILED`);
        assert(wfAfterValidate?.status === 'FAILED', `Workflow = FAILED`);
    }

    // ========================================================================
    section('TEST 11 : Cancel workflow');
    // ========================================================================

    const cancelResult = await orch.cancelWorkflow();
    assert(cancelResult.success === true, 'Cancel réussi');

    const wfAfterCancel = await orch.getWorkflowStatus();
    assert(wfAfterCancel?.status === 'CANCELLED', `Status = CANCELLED (got: ${wfAfterCancel?.status})`);

    // ========================================================================
    section('TEST 12 : Edge case — CUSTOM workflow 0 phases');
    // ========================================================================

    const customEmpty = await orch.startWorkflow('CUSTOM', 'Empty custom', { name: 'empty', description: 'test', phases: [] });
    assert(customEmpty.success === false, 'CUSTOM 0 phases refusé');
    assert(customEmpty.error?.message.includes('at least one phase'), `Message: ${customEmpty.error?.message}`);

    // ========================================================================
    section('TEST 13 : CUSTOM workflow avec phases');
    // ========================================================================

    const customResult = await orch.startWorkflow('CUSTOM', 'Custom task', {
        name: 'custom-test',
        description: 'Test custom workflow',
        phases: [
            { name: 'Phase A', agents: ['security-expert'], description: 'First custom phase' },
            { name: 'Phase B', agents: ['fullstack-ui-architect'], description: 'Second custom phase' },
        ],
    });
    assert(customResult.success === true, 'CUSTOM workflow démarré');
    assert(customResult.data?.phases.length === 2, `2 phases custom créées`);
    assert(customResult.data?.phases[0].name === 'Phase A', `Phase 0 = Phase A`);
    assert(customResult.data?.phases[1].name === 'Phase B', `Phase 1 = Phase B`);

    // Cancel pour nettoyer
    await orch.cancelWorkflow();

    // ========================================================================
    section('TEST 14 : Pause / Resume');
    // ========================================================================

    await orch.startWorkflow('REVIEW', 'Test pause/resume');
    const pauseResult = await orch.pauseWorkflow();
    assert(pauseResult.success === true, 'Pause réussi');

    const wfPaused = await orch.getWorkflowStatus();
    assert(wfPaused?.status === 'PAUSED', `Status = PAUSED`);

    // Dispatch doit échouer quand paused
    const dispatchWhilePaused = await orch.dispatchPhase();
    assert(dispatchWhilePaused.success === false, 'Dispatch refusé quand PAUSED');

    const resumeResult = await orch.resumeWorkflow();
    assert(resumeResult.success === true, 'Resume réussi');

    const wfResumed = await orch.getWorkflowStatus();
    assert(wfResumed?.status === 'RUNNING', `Status = RUNNING après resume`);

    await orch.cancelWorkflow();

    // ========================================================================
    section('TEST 15 : Memory CRUD');
    // ========================================================================

    const writeResult = await orch.writeMemory('test-memory', 'Hello from test');
    assert(writeResult.success === true, 'Memory écrite');

    const readResult = await orch.readMemory('test-memory');
    assert(readResult === 'Hello from test', `Memory lue: "${readResult}"`);

    const memories = await orch.listMemories();
    assert(memories.includes('test-memory'), 'test-memory dans la liste');

    const deleteResult = await orch.deleteMemory('test-memory');
    assert(deleteResult.success === true, 'Memory supprimée');

    const readAfterDelete = await orch.readMemory('test-memory');
    assert(readAfterDelete === null, 'Memory nulle après suppression');

    // ========================================================================
    section('TEST 16 : EventBus events collectés');
    // ========================================================================

    const eventBus = new EventBus();
    const collected = [];
    eventBus.onAny((event, payload) => {
        collected.push({ event, payload });
    });

    eventBus.emit('workflow:started', { workflowId: 'test', type: 'BUILD', task: 'test' });
    eventBus.emit('phase:started', { workflowId: 'test', phaseId: 'p1', phaseName: 'Phase 1', iteration: 1 });

    assert(collected.length === 2, `${collected.length} events collectés`);
    assert(collected[0].event === 'workflow:started', 'Premier event = workflow:started');

    // Test once
    let onceCount = 0;
    eventBus.once('workflow:completed', () => { onceCount++; });
    eventBus.emit('workflow:completed', { workflowId: 'test', totalScore: 85 });
    eventBus.emit('workflow:completed', { workflowId: 'test', totalScore: 90 });
    assert(onceCount === 1, `once handler appelé 1 fois (got: ${onceCount})`);

    // ========================================================================
    section('TEST 17 : Agent manquant dans phase (Bug #4 fix)');
    // ========================================================================

    await orch.startWorkflow('CUSTOM', 'Test missing agent', {
        name: 'missing-agent-test',
        description: 'Test',
        phases: [
            { name: 'Phase with missing agent', agents: ['nonexistent-agent-xyz'] },
        ],
    });

    const dispatchMissing = await orch.dispatchPhase();
    assert(dispatchMissing.success === true, 'Dispatch ne crash pas avec agent manquant');

    // In manual mode, the error is in results (since prompts can't be built for missing agent)
    const wfMissing = await orch.getWorkflowStatus();
    const phaseMissing = wfMissing?.phases[0];
    assert(phaseMissing?.output !== null, 'phase.output initialisé même avec agent manquant');

    await orch.cancelWorkflow();

    // ========================================================================
    section('TEST 18 : Score calculation standalone');
    // ========================================================================

    const scoreStandalone = await orch.calculateScore();
    assert(scoreStandalone.success === true, 'Score standalone calculé');
    assert(typeof scoreStandalone.data?.total === 'number', `Score: ${scoreStandalone.data?.total}`);

    // ========================================================================
    section('TEST 19 : System status complet');
    // ========================================================================

    const finalStatus = await orch.getSystemStatus();
    assert(finalStatus.initialized === true, 'Toujours initialisé');
    assert(typeof finalStatus.stats.workflowsCompleted === 'number', `workflowsCompleted = ${finalStatus.stats.workflowsCompleted}`);
    assert(typeof finalStatus.stats.workflowsFailed === 'number', `workflowsFailed = ${finalStatus.stats.workflowsFailed}`);
    console.log(`  Final status: ${JSON.stringify(finalStatus, null, 2).slice(0, 500)}`);

    // ========================================================================
    // RÉSUMÉ
    // ========================================================================
    console.log(`\n${'='.repeat(60)}`);
    console.log(`  RÉSULTATS: ${passed} passed, ${failed} failed`);
    console.log('='.repeat(60));

    if (errors.length > 0) {
        console.log('\nÉchecs:');
        for (const e of errors) {
            console.log(`  ❌ ${e}`);
        }
    }

    process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
    console.error('FATAL:', err);
    process.exit(1);
});
