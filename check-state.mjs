import { Orchestrator } from './dist/core/Orchestrator.js';
const orch = new Orchestrator(process.cwd());
await orch.initialize();
const wf = await orch.getWorkflowStatus();
if (!wf) { console.log('Pas de workflow'); process.exit(0); }
console.log('Workflow:', wf.id, '- Status:', wf.status);
for (const p of wf.phases) {
    console.log('  Phase:', p.name, '- Status:', p.status);
    if (p.output) {
        const agents = Object.keys(p.output.agentOutputs);
        console.log('    Agents:', agents.join(', '));
        for (const [id, ao] of Object.entries(p.output.agentOutputs)) {
            console.log('    -', id, ':', ao.status, '|', ao.output.length, 'chars');
        }
        if (p.output.consolidatedOutput) {
            console.log('    CONSOLIDATION:', p.output.consolidatedOutput.length, 'chars');
            console.log('    ---');
            console.log(p.output.consolidatedOutput);
            console.log('    ---');
        } else {
            console.log('    CONSOLIDATION: absente');
        }
    }
}
process.exit(0);
