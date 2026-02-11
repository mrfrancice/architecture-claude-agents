import { Orchestrator } from './dist/core/Orchestrator.js';
import { readFile } from 'node:fs/promises';

const SESSION_DIR = 'C:\\Users\\BARNOIN INFORMATIQUE\\AppData\\Local\\Temp\\mcp-orchestrator\\terminal_1770753394610_qui0';

const orch = new Orchestrator(process.cwd());
await orch.initialize();

// Cancel any existing workflow
const existing = await orch.getWorkflowStatus();
if (existing && (existing.status === 'RUNNING' || existing.status === 'PAUSED')) {
    await orch.cancelWorkflow();
}

// Read the actual outputs from the session
const output1 = await readFile(`${SESSION_DIR}\\output_security-expert.txt`, 'utf-8');
const output2 = await readFile(`${SESSION_DIR}\\output_fullstack-ui-architect.txt`, 'utf-8');

console.log(`Output 1 (security-expert): ${output1.length} chars`);
console.log(`Output 2 (fullstack-ui-architect): ${output2.length} chars`);

// Build a PhaseOutput manually
const phaseOutput = {
    agentOutputs: {
        'security-expert': { agentId: 'security-expert', status: 'SUCCESS', output: output1, filesCreated: [], filesModified: [], duration: 35, score: null },
        'fullstack-ui-architect': { agentId: 'fullstack-ui-architect', status: 'SUCCESS', output: output2, filesCreated: [], filesModified: [], duration: 56, score: null },
    },
    filesModified: [],
    errors: [],
    warnings: [],
};

console.log('\nLancement de la consolidation...');
const start = Date.now();
const consolidated = await orch.consolidatePhaseOutput(phaseOutput);
const elapsed = ((Date.now() - start) / 1000).toFixed(1);

if (consolidated) {
    console.log(`\nCONSOLIDATION RÉUSSIE en ${elapsed}s (${consolidated.length} chars)`);
    console.log('─'.repeat(60));
    console.log(consolidated);
    console.log('─'.repeat(60));
} else {
    console.log(`\nCONSOLIDATION ÉCHOUÉE (${elapsed}s)`);
}

process.exit(0);
