/**
 * TerminalDispatcher - Mode terminal pour execution visuelle des agents
 *
 * Lance N instances PowerShell (1 par agent), chacune executant
 * `claude --print` (non-interactif, sortie streaming + exit).
 *
 * Strategie de lancement :
 * 1. Windows Terminal (wt) si disponible → panes dans une seule fenetre
 * 2. Fallback Start-Process pwsh → N fenetres PowerShell separees
 */

import { exec, execFile } from 'node:child_process';
import { mkdir, writeFile, readFile, access, rm, readdir, stat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type {
    AgentId,
    ManualDispatchPrompt,
    TerminalSession,
    AgentTerminalInfo,
    TerminalSessionStatus,
} from '../types/core.js';

// ============================================================================
// TYPES INTERNES
// ============================================================================

interface SplitCommand {
    type: 'split';
    direction: 'V' | 'H';
    agentIndex: number;
}

interface FocusCommand {
    type: 'focus';
    direction: 'left' | 'right' | 'up' | 'down';
}

type LayoutCommand = SplitCommand | FocusCommand;

// ============================================================================
// TERMINAL DISPATCHER
// ============================================================================

export class TerminalDispatcher {
    /**
     * Cree une session terminal : genere les fichiers, lance les panes
     */
    async spawnSession(
        prompts: ManualDispatchPrompt[],
        workDir: string,
        phaseInfo?: { phaseName: string; iteration: number; task: string },
        interactive?: boolean,
    ): Promise<TerminalSession> {
        const sessionId = `terminal_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const rawBaseDir = join(tmpdir(), 'mcp-orchestrator');
        await mkdir(rawBaseDir, { recursive: true });
        // Resolve short paths (e.g. BARNOI~1) to long paths for WT/pwsh compatibility
        const baseDir = await realpath(rawBaseDir);
        const sessionDir = join(baseDir, sessionId);

        await mkdir(sessionDir, { recursive: true });

        const agents: AgentTerminalInfo[] = [];

        // Generer les fichiers pour chaque agent
        for (const prompt of prompts) {
            const agentInfo = await this.prepareAgent(prompt, sessionDir, phaseInfo, interactive);
            agents.push(agentInfo);
        }

        // Lancer les panes Windows Terminal
        await this.launchTerminalPanes(agents, sessionDir);

        return {
            sessionId,
            sessionDir,
            agents,
            startedAt: new Date(),
            interactive,
        };
    }

    /**
     * Verifie le statut de chaque agent (fichiers .done)
     */
    async getStatus(session: TerminalSession): Promise<TerminalSessionStatus> {
        const completed: AgentId[] = [];
        const running: AgentId[] = [];
        const agentDetails: Record<AgentId, { status: 'running' | 'success' | 'failed'; duration?: number }> = {};

        for (const agent of session.agents) {
            const done = await this.fileExists(agent.donePath);
            if (done) {
                const content = await this.safeReadFile(agent.donePath);
                const [status, durationStr] = content.trim().split(':');
                const duration = parseFloat(durationStr) || 0;
                const isSuccess = status === 'SUCCESS';
                completed.push(agent.agentId);
                agentDetails[agent.agentId] = {
                    status: isSuccess ? 'success' : 'failed',
                    duration,
                };
            } else {
                running.push(agent.agentId);
                agentDetails[agent.agentId] = { status: 'running' };
            }
        }

        return {
            sessionId: session.sessionId,
            completed,
            running,
            total: session.agents.length,
            allDone: running.length === 0,
            agentDetails,
        };
    }

    /**
     * Collecte les outputs de tous les agents termines
     */
    async collectOutputs(session: TerminalSession): Promise<Record<AgentId, string>> {
        const outputs: Record<AgentId, string> = {};

        for (const agent of session.agents) {
            let content = await this.safeReadFile(agent.outputPath);
            if (session.interactive) {
                content = TerminalDispatcher.stripAnsiCodes(content);
            }
            outputs[agent.agentId] = content;
        }

        return outputs;
    }

    /**
     * Supprime recursivement le repertoire de session temporaire
     */
    async cleanupSession(session: TerminalSession): Promise<void> {
        await rm(session.sessionDir, { recursive: true, force: true });
    }

    /**
     * Supprime les sessions plus anciennes que maxAgeMs.
     * Retourne le nombre de sessions supprimees.
     */
    async cleanupOldSessions(maxAgeMs: number = 24 * 60 * 60 * 1000): Promise<number> {
        const rawBaseDir = join(tmpdir(), 'mcp-orchestrator');
        let baseDir: string;
        try {
            baseDir = await realpath(rawBaseDir);
        } catch {
            return 0;
        }
        let entries: string[];

        try {
            entries = await readdir(baseDir);
        } catch {
            return 0;
        }

        const now = Date.now();
        let deleted = 0;

        for (const entry of entries) {
            const entryPath = join(baseDir, entry);
            try {
                const info = await stat(entryPath);
                if (info.isDirectory() && (now - info.mtimeMs) > maxAgeMs) {
                    await rm(entryPath, { recursive: true, force: true });
                    deleted++;
                }
            } catch {
                // Skip entries that can't be stat'd or deleted
            }
        }

        return deleted;
    }

    // ========================================================================
    // PRIVATE - Preparation des fichiers
    // ========================================================================

    private async prepareAgent(
        prompt: ManualDispatchPrompt,
        sessionDir: string,
        phaseInfo?: { phaseName: string; iteration: number; task: string },
        interactive?: boolean,
    ): Promise<AgentTerminalInfo> {
        const id = prompt.agentId;

        const systemPath = join(sessionDir, `system_${id}.txt`);
        const userPath = join(sessionDir, `user_${id}.txt`);
        const scriptPath = join(sessionDir, `agent_${id}.ps1`);
        const outputPath = join(sessionDir, `output_${id}.txt`);
        const donePath = join(sessionDir, `done_${id}.txt`);
        const transcriptPath = interactive ? join(sessionDir, `transcript_${id}.txt`) : undefined;

        // Ecrire les prompts
        await writeFile(systemPath, prompt.systemPrompt, 'utf-8');
        await writeFile(userPath, prompt.userPrompt, 'utf-8');

        // Generer le script PowerShell
        const script = this.generatePowerShellScript({
            agentId: id,
            agentName: prompt.agentName,
            sessionDir,
            model: prompt.model,
            phaseName: phaseInfo?.phaseName || 'Unknown',
            iteration: phaseInfo?.iteration || 1,
            task: phaseInfo?.task || '',
            interactive,
        });
        await writeFile(scriptPath, script, 'utf-8');

        return {
            agentId: id,
            agentName: prompt.agentName,
            scriptPath,
            outputPath,
            donePath,
            transcriptPath,
        };
    }

    private generatePowerShellScript(params: {
        agentId: string;
        agentName: string;
        sessionDir: string;
        model?: string;
        phaseName: string;
        iteration: number;
        task: string;
        interactive?: boolean;
    }): string {
        const { agentId, agentName, model, phaseName, iteration, task, interactive } = params;

        // Escape single quotes for PS string literals
        const safeTask = task.replace(/'/g, "''");

        // Escape single quotes in model name for PS string literal
        const safeModel = model ? model.replace(/'/g, "''") : '';
        const modelArg = model ? `'--model', '${safeModel}',` : '';

        // Use $PSScriptRoot to resolve paths relative to the script file itself.
        // This avoids all short-path (8.3) and escaping issues.

        if (interactive) {
            return this.generateInteractiveScript({
                agentId, agentName, modelArg, phaseName, iteration, safeTask,
            });
        }

        return this.generateNonInteractiveScript({
            agentId, agentName, modelArg, phaseName, iteration, safeTask,
        });
    }

    private generateInteractiveScript(params: {
        agentId: string;
        agentName: string;
        modelArg: string;
        phaseName: string;
        iteration: number;
        safeTask: string;
    }): string {
        const { agentId, agentName, modelArg, phaseName, iteration, safeTask } = params;

        return `# UTF-8 encoding for proper accent/unicode support
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Global trap - catches ANY unhandled error and keeps window open
trap {
    Write-Host ""
    Write-Host "  === ERREUR FATALE: $($_.Exception.Message) ===" -ForegroundColor Red
    Write-Host "  $($_.ScriptStackTrace)" -ForegroundColor DarkRed
    try {
        $_.Exception.Message | Out-File (Join-Path $PSScriptRoot "output_${agentId}.txt") -Encoding UTF8
        "FAILED:0" | Out-File (Join-Path $PSScriptRoot "done_${agentId}.txt") -Encoding UTF8
    } catch {}
    Write-Host ""
    Write-Host "  Appuyez sur une touche pour fermer..." -ForegroundColor DarkGray
    [void][System.Console]::ReadKey($true)
    exit 0
    break
}

$host.UI.RawUI.WindowTitle = "[${phaseName}] ${agentName} (Interactive)"

# Resolve the session directory once and ensure it persists
$sessionDir = $PSScriptRoot
$outputFile = Join-Path $sessionDir "output_${agentId}.txt"
$doneFile   = Join-Path $sessionDir "done_${agentId}.txt"

# Helper: ensure session dir exists before writing (it may have been cleaned by another process)
function Ensure-SessionDir {
    if (!(Test-Path $sessionDir)) {
        New-Item -ItemType Directory -Path $sessionDir -Force | Out-Null
    }
}

try {
    $ErrorActionPreference = "Stop"

    $systemPrompt = Get-Content (Join-Path $sessionDir "system_${agentId}.txt") -Raw -Encoding UTF8
    $userPrompt   = Get-Content (Join-Path $sessionDir "user_${agentId}.txt") -Raw -Encoding UTF8

    # Verify claude CLI is accessible
    $null = Get-Command claude -ErrorAction Stop

    $ErrorActionPreference = "Continue"

    # ── Display full context before execution ──
    Write-Host ""
    Write-Host "  ================================================================" -ForegroundColor Cyan
    Write-Host "    AGENT: ${agentName} (INTERACTIVE)" -ForegroundColor Yellow
    Write-Host "    Phase: ${phaseName} | Iteration ${iteration}" -ForegroundColor Gray
    Write-Host "    Mode:  Tapez /exit pour terminer la session" -ForegroundColor Magenta
    Write-Host "  ================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  TACHE:" -ForegroundColor White
    Write-Host '  ${safeTask}' -ForegroundColor White
    Write-Host ""
    Write-Host "  CONTEXTE (user prompt):" -ForegroundColor DarkCyan
    $lines = $userPrompt -split "[\\r\\n]+"
    $preview = $lines | Select-Object -First 20
    foreach ($line in $preview) {
        Write-Host "    $line" -ForegroundColor DarkGray
    }
    if ($lines.Count -gt 20) {
        Write-Host "    ... ($($lines.Count - 20) more lines)" -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "  ----------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  Lancement de claude en mode interactif..." -ForegroundColor Green
    Write-Host "  ----------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""

    $startTime = Get-Date

    # Build the combined system prompt: original system prompt + task context as append
    # Claude launched WITHOUT a positional prompt argument stays in interactive TUI mode.
    # The user prompt is injected via --append-system-prompt so the agent has full context
    # but the user can still type and interact freely.
    $taskContext = "TASK CONTEXT (respond to this first, then the user can continue the conversation):" + [Environment]::NewLine + [Environment]::NewLine + $userPrompt
    $claudeArgs = @('--system-prompt', $systemPrompt, '--append-system-prompt', $taskContext, ${modelArg} '--verbose')
    & claude @claudeArgs

    $exitCode = $LASTEXITCODE
    $duration = ((Get-Date) - $startTime).TotalSeconds

    # After claude exits, export the conversation using claude --continue --print
    # to capture the full conversation as text output
    Write-Host ""
    Write-Host "  Exporting conversation..." -ForegroundColor DarkGray
    Ensure-SessionDir
    try {
        $exportArgs = @('--continue', '--print', '-p', 'Please output a complete summary of everything we discussed and all conclusions/code/recommendations produced in this session. Format as markdown.')
        $exportOutput = & claude @exportArgs 2>&1
        $exportOutput | Out-File $outputFile -Encoding UTF8
    } catch {
        # Fallback: write a note that export failed
        "Interactive session completed but export failed: $($_.Exception.Message)" | Out-File $outputFile -Encoding UTF8
    }

    Ensure-SessionDir
    if ($exitCode -and $exitCode -ne 0) {
        Write-Host ""
        Write-Host "  === ECHEC (exit code: $exitCode, $([math]::Round($duration))s) ===" -ForegroundColor Yellow
        "FAILED:$duration" | Out-File $doneFile -Encoding UTF8
    } else {
        Write-Host ""
        Write-Host "  === TERMINE ($([math]::Round($duration))s) ===" -ForegroundColor Green
        "SUCCESS:$duration" | Out-File $doneFile -Encoding UTF8
    }
} catch {
    $duration = if ($startTime) { ((Get-Date) - $startTime).TotalSeconds } else { 0 }
    $errMsg = $_.Exception.Message
    Write-Host ""
    Write-Host "  === ERREUR: $errMsg ===" -ForegroundColor Red
    Ensure-SessionDir
    try { $errMsg | Out-File $outputFile -Encoding UTF8 } catch {}
    try { "FAILED:$duration" | Out-File $doneFile -Encoding UTF8 } catch {}
}

Write-Host ""
Write-Host "  Appuyez sur une touche pour fermer..." -ForegroundColor DarkGray
[void][System.Console]::ReadKey($true)
exit 0
`;
    }

    private generateNonInteractiveScript(params: {
        agentId: string;
        agentName: string;
        modelArg: string;
        phaseName: string;
        iteration: number;
        safeTask: string;
    }): string {
        const { agentId, agentName, modelArg, phaseName, iteration, safeTask } = params;

        return `# UTF-8 encoding for proper accent/unicode support
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

# Global trap - catches ANY unhandled error and keeps window open
trap {
    Write-Host ""
    Write-Host "  === ERREUR FATALE: $($_.Exception.Message) ===" -ForegroundColor Red
    Write-Host "  $($_.ScriptStackTrace)" -ForegroundColor DarkRed
    try {
        $_.Exception.Message | Out-File (Join-Path $PSScriptRoot "output_${agentId}.txt") -Encoding UTF8
        "FAILED:0" | Out-File (Join-Path $PSScriptRoot "done_${agentId}.txt") -Encoding UTF8
    } catch {}
    Write-Host ""
    Write-Host "  Appuyez sur une touche pour fermer..." -ForegroundColor DarkGray
    [void][System.Console]::ReadKey($true)
    exit 0
    break
}

$host.UI.RawUI.WindowTitle = "[${phaseName}] ${agentName}"

$outputFile = Join-Path $PSScriptRoot "output_${agentId}.txt"
$doneFile   = Join-Path $PSScriptRoot "done_${agentId}.txt"

try {
    $ErrorActionPreference = "Stop"

    $systemPrompt = Get-Content (Join-Path $PSScriptRoot "system_${agentId}.txt") -Raw -Encoding UTF8
    $userPrompt   = Get-Content (Join-Path $PSScriptRoot "user_${agentId}.txt") -Raw -Encoding UTF8

    # Verify claude CLI is accessible
    $null = Get-Command claude -ErrorAction Stop

    $ErrorActionPreference = "Continue"

    # ── Display full context before execution ──
    Write-Host ""
    Write-Host "  ================================================================" -ForegroundColor Cyan
    Write-Host "    AGENT: ${agentName}" -ForegroundColor Yellow
    Write-Host "    Phase: ${phaseName} | Iteration ${iteration} | Mode: --print" -ForegroundColor Gray
    Write-Host "  ================================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "  TACHE:" -ForegroundColor White
    Write-Host '  ${safeTask}' -ForegroundColor White
    Write-Host ""
    Write-Host "  CONTEXTE (user prompt):" -ForegroundColor DarkCyan
    # Show first 20 lines of user prompt so the user sees what the agent received
    $lines = $userPrompt -split "[\\r\\n]+"
    $preview = $lines | Select-Object -First 20
    foreach ($line in $preview) {
        Write-Host "    $line" -ForegroundColor DarkGray
    }
    if ($lines.Count -gt 20) {
        Write-Host "    ... ($($lines.Count - 20) more lines)" -ForegroundColor DarkGray
    }
    Write-Host ""
    Write-Host "  ----------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host "  Execution en cours..." -ForegroundColor Green
    Write-Host "  ----------------------------------------------------------------" -ForegroundColor DarkGray
    Write-Host ""

    $startTime = Get-Date

    # Run claude in --print mode (non-interactive, output and exit)
    # Stream to console AND capture to variable, then write UTF-8 file.
    # Tee-Object writes UTF-16 on PowerShell 5.1, so we avoid it.
    $claudeArgs = @('--print', '--system-prompt', $systemPrompt, ${modelArg} $userPrompt)
    $claudeOutput = & claude @claudeArgs 2>&1 | ForEach-Object { Write-Host $_; $_ }

    $exitCode = $LASTEXITCODE

    # Write output as UTF-8 (no BOM) — works on both PS 5.1 and 7+
    $utf8NoBom = New-Object System.Text.UTF8Encoding $false
    [System.IO.File]::WriteAllText($outputFile, ($claudeOutput -join [Environment]::NewLine), $utf8NoBom)
    $duration = ((Get-Date) - $startTime).TotalSeconds

    if ($exitCode -and $exitCode -ne 0) {
        Write-Host ""
        Write-Host "  === ECHEC (exit code: $exitCode, $([math]::Round($duration))s) ===" -ForegroundColor Yellow
        "FAILED:$duration" | Out-File $doneFile -Encoding UTF8
    } else {
        Write-Host ""
        Write-Host "  === TERMINE ($([math]::Round($duration))s) ===" -ForegroundColor Green
        "SUCCESS:$duration" | Out-File $doneFile -Encoding UTF8
    }
} catch {
    $duration = if ($startTime) { ((Get-Date) - $startTime).TotalSeconds } else { 0 }
    $errMsg = $_.Exception.Message
    Write-Host ""
    Write-Host "  === ERREUR: $errMsg ===" -ForegroundColor Red
    try { $errMsg | Out-File $outputFile -Encoding UTF8 } catch {}
    try { "FAILED:$duration" | Out-File $doneFile -Encoding UTF8 } catch {}
}

Write-Host ""
Write-Host "  Appuyez sur une touche pour fermer..." -ForegroundColor DarkGray
[void][System.Console]::ReadKey($true)
exit 0
`;
    }

    // ========================================================================
    // PRIVATE - Lancement des agents
    // ========================================================================

    private async launchTerminalPanes(agents: AgentTerminalInfo[], _sessionDir: string): Promise<void> {
        if (agents.length === 0) return;

        const hasWt = await this.isWtAvailable();

        if (hasWt) {
            await this.launchWithWindowsTerminal(agents);
        } else {
            await this.launchWithPowerShell(agents);
        }
    }

    /**
     * Detecte le shell PowerShell disponible (pwsh > powershell)
     */
    private async findPowerShell(): Promise<string> {
        const hasPwsh = await this.commandExists('pwsh');
        return hasPwsh ? 'pwsh' : 'powershell';
    }

    /**
     * Lancement via Windows Terminal : panes dans une seule fenetre.
     * wt est une AppX, il faut passer par cmd.exe /c pour le résoudre.
     */
    private async launchWithWindowsTerminal(agents: AgentTerminalInfo[]): Promise<void> {
        const ps = await this.findPowerShell();
        const wtArgs = this.buildWtCommandArgs(agents, ps);

        // Build the full wt command as a single string for cmd.exe /c
        // wt is an AppX alias only resolvable through the Windows shell
        const parts = [
            'wt', '-w', 'new', 'nt',
            '--title', `"${agents[0].agentName}"`,
            ps, '-ExecutionPolicy', 'Bypass', '-File', `"${agents[0].scriptPath}"`,
            ...wtArgs,
        ];

        await this.execShellCommand(parts.join(' '));
    }

    /**
     * Fallback : N fenetres PowerShell separees.
     * Utilise cmd.exe /c start pour garantir une fenêtre visible,
     * même quand le processus parent est sans console.
     */
    private async launchWithPowerShell(agents: AgentTerminalInfo[]): Promise<void> {
        const ps = await this.findPowerShell();
        for (const agent of agents) {
            // "start" ouvre une nouvelle fenêtre visible avec le titre donné.
            // Le chemin du script est entre guillemets pour gérer les espaces.
            const cmd = `start "${agent.agentName}" ${ps} -ExecutionPolicy Bypass -File "${agent.scriptPath}"`;
            await this.execShellCommand(cmd);
        }
    }

    /**
     * Construit les arguments wt pour les splits apres le premier agent.
     * Retourne des fragments de commande (string) pour concaténation avec cmd.exe /c.
     */
    private buildWtCommandArgs(agents: AgentTerminalInfo[], ps: string): string[] {
        if (agents.length <= 1) return [];

        const layoutCommands = this.getLayoutCommands(agents.length);
        const args: string[] = [];

        for (const cmd of layoutCommands) {
            if (cmd.type === 'split') {
                const agent = agents[cmd.agentIndex];
                args.push(
                    ';',
                    'sp',
                    cmd.direction === 'V' ? '-V' : '-H',
                    '--title', `"${agent.agentName}"`,
                    ps, '-ExecutionPolicy', 'Bypass', '-File', `"${agent.scriptPath}"`,
                );
            } else if (cmd.type === 'focus') {
                args.push(';', 'mf', cmd.direction);
            }
        }

        return args;
    }

    /**
     * Calcule la sequence de splits pour N agents
     *
     * 1: pas de split
     * 2: [V]         → [ A | B ]
     * 3: [V, H]      → [ A | B ] / [   | C ]
     * 4: [V, focus left, H, focus right, H] → [ A | B ] / [ C | D ]
     * 5+: grille adaptative
     */
    getLayoutCommands(count: number): LayoutCommand[] {
        if (count <= 1) return [];

        if (count === 2) {
            return [
                { type: 'split', direction: 'V', agentIndex: 1 },
            ];
        }

        if (count === 3) {
            return [
                { type: 'split', direction: 'V', agentIndex: 1 },
                { type: 'split', direction: 'H', agentIndex: 2 },
            ];
        }

        if (count === 4) {
            return [
                { type: 'split', direction: 'V', agentIndex: 1 },
                { type: 'focus', direction: 'left' },
                { type: 'split', direction: 'H', agentIndex: 2 },
                { type: 'focus', direction: 'right' },
                { type: 'split', direction: 'H', agentIndex: 3 },
            ];
        }

        // 5+ agents : grille adaptative
        // Nombre de colonnes = ceil(sqrt(count))
        const cols = Math.ceil(Math.sqrt(count));
        const commands: LayoutCommand[] = [];
        let agentIdx = 1;

        // D'abord, creer les colonnes (splits verticaux)
        for (let c = 1; c < cols && agentIdx < count; c++) {
            commands.push({ type: 'split', direction: 'V', agentIndex: agentIdx++ });
        }

        // Ensuite, pour chaque colonne, ajouter les lignes (splits horizontaux)
        // On commence par la derniere colonne (focus actuel) et on remonte
        for (let c = cols - 1; c >= 0 && agentIdx < count; c--) {
            const rowsInCol = Math.ceil((count - c) / cols);
            for (let r = 1; r < rowsInCol && agentIdx < count; r++) {
                commands.push({ type: 'split', direction: 'H', agentIndex: agentIdx++ });
            }
            if (c > 0 && agentIdx < count) {
                commands.push({ type: 'focus', direction: 'left' });
            }
        }

        return commands;
    }

    // ========================================================================
    // STATIC UTILITIES
    // ========================================================================

    /**
     * Strips ANSI/VT100 escape sequences from text.
     * Used to clean transcript output from interactive sessions.
     */
    static stripAnsiCodes(text: string): string {
        // Matches ANSI escape sequences: CSI (ESC[), OSC (ESC]), and single-char escapes
        return text.replace(
            // eslint-disable-next-line no-control-regex
            /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><~]/g,
            '',
        );
    }

    // ========================================================================
    // PRIVATE - Utilitaires
    // ========================================================================

    /**
     * Detecte si Windows Terminal (wt) est disponible.
     * wt est une AppX — on doit passer par cmd.exe /c pour le résoudre.
     */
    private async isWtAvailable(): Promise<boolean> {
        return this.commandExists('wt');
    }

    /**
     * Vérifie si une commande est disponible via cmd.exe /c where
     */
    private commandExists(cmd: string): Promise<boolean> {
        return new Promise((resolve) => {
            execFile('cmd.exe', ['/c', 'where', cmd], (error) => {
                resolve(!error);
            });
        });
    }

    /**
     * Exécute une commande shell via cmd.exe /c.
     * Utilise exec() pour que la commande soit passée comme une string brute
     * au shell — pas de quoting automatique par Node.js.
     * Nécessaire pour que "start" interprète correctement le titre et les args.
     */
    private execShellCommand(command: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const child = exec(command, { windowsHide: false }, (error) => {
                // On ignore l'erreur car start/wt retournent immédiatement
                // et le processus enfant vit indépendamment
            });
            child.unref();

            child.on('error', (err) => {
                reject(new Error(`Failed to launch command: ${err.message}`));
            });

            // Fire-and-forget : la fenêtre est lancée, on resolve immédiatement
            setTimeout(() => resolve(), 500);
        });
    }

    private async fileExists(path: string): Promise<boolean> {
        try {
            await access(path);
            return true;
        } catch {
            return false;
        }
    }

    private async safeReadFile(path: string): Promise<string> {
        try {
            return await readFile(path, 'utf-8');
        } catch {
            return '';
        }
    }
}
