# Pre-Commit Validator Hook

---
name: pre-commit-validator
description: "Valide le code avant chaque commit git"
event: PreToolUse
match_tools: ["Bash"]
match_commands: ["git commit"]
---

## Instructions

Ce hook s'exécute automatiquement AVANT chaque `git commit` pour garantir la qualité du code commité.

## Déclenchement

```yaml
trigger:
  tool: "Bash"
  command_pattern: "git commit"
  excludes:
    - "git commit --amend"  # Amendement simple
    - "git commit --allow-empty"  # Commit vide intentionnel
```

## Validations Effectuées

### 1. Fichiers Staged

```yaml
get_staged_files:
  command: "git diff --cached --name-only --diff-filter=ACMR"
  filter:
    include:
      - "*.ts"
      - "*.tsx"
      - "*.js"
      - "*.jsx"
      - "*.py"
      - "*.php"
      - "*.go"
      - "*.java"
      - "*.rb"
    exclude:
      - "*.min.js"
      - "*.bundle.js"
      - "node_modules/**"
      - "vendor/**"
      - "dist/**"
      - "build/**"
```

### 2. Vérifications de Sécurité

```yaml
security_checks:
  secrets:
    description: "Détecter les secrets"
    patterns:
      - "(?i)(api[_-]?key|apikey)\\s*[:=]\\s*['\"][^'\"]{10,}"
      - "(?i)(secret|password|passwd|pwd)\\s*[:=]\\s*['\"][^'\"]{5,}"
      - "(?i)(token)\\s*[:=]\\s*['\"][^'\"]{10,}"
      - "AKIA[0-9A-Z]{16}"  # AWS
      - "ghp_[a-zA-Z0-9]{36}"  # GitHub
      - "sk-[a-zA-Z0-9]{32,}"  # OpenAI/Stripe

    action: "BLOCK"
    message: |
      ❌ SECRET DÉTECTÉ - Commit bloqué

      Fichier: {file}
      Ligne: {line}
      Type: {secret_type}

      Actions:
      1. Retirer le secret du code
      2. Utiliser des variables d'environnement
      3. git reset HEAD {file}

  injections:
    description: "Détecter les injections potentielles"
    patterns:
      - "eval\\s*\\("
      - "exec\\s*\\("
      - "innerHTML\\s*="
      - "\\$_GET\\[|\\$_POST\\[|\\$_REQUEST\\["

    action: "WARN"
    message: |
      ⚠️ CODE POTENTIELLEMENT DANGEREUX

      Fichier: {file}
      Pattern: {pattern}

      Vérifiez que c'est intentionnel et sécurisé.
```

### 3. Vérifications de Qualité

```yaml
quality_checks:
  debug_code:
    description: "Code de debug oublié"
    patterns:
      - "console\\.log\\("
      - "console\\.debug\\("
      - "print\\(.*#.*debug"
      - "debugger;"
      - "var_dump\\("
      - "dd\\("
      - "dump\\("

    action: "WARN"
    message: |
      ⚠️ CODE DE DEBUG DÉTECTÉ

      {matches}

      Voulez-vous continuer le commit? [o/N]

  todo_fixme:
    description: "TODO/FIXME dans le code staged"
    patterns:
      - "TODO:"
      - "FIXME:"
      - "XXX:"
      - "HACK:"

    action: "INFO"
    message: |
      ℹ️ Marqueurs de dette technique détectés:

      {matches}

      (Information seulement, commit autorisé)

  type_any:
    description: "TypeScript 'any' ajouté"
    file_pattern: "*.ts|*.tsx"
    patterns:
      - ": any"
      - "as any"

    action: "WARN"
    message: |
      ⚠️ TYPE 'any' DÉTECTÉ

      Fichier: {file}
      Lignes: {lines}

      Préférez un type explicite.
```

### 4. Vérifications de Format

```yaml
format_checks:
  large_files:
    description: "Fichiers trop volumineux"
    threshold: 500  # lignes ajoutées
    action: "WARN"
    message: |
      ⚠️ FICHIER VOLUMINEUX

      {file}: +{lines} lignes

      Considérez découper en plusieurs commits.

  conflict_markers:
    description: "Marqueurs de conflit git"
    patterns:
      - "<<<<<<< "
      - "======="
      - ">>>>>>> "

    action: "BLOCK"
    message: |
      ❌ MARQUEURS DE CONFLIT DÉTECTÉS

      Fichier: {file}

      Résolvez les conflits avant de committer.

  trailing_whitespace:
    description: "Espaces en fin de ligne"
    action: "INFO"
    auto_fix: true
```

### 5. Tests Associés

```yaml
test_checks:
  run_related_tests:
    enabled: true
    mode: "quick"  # quick | full
    timeout: 30  # secondes

    workflow:
      1_find_tests:
        for_each_staged_file:
          - Convention de nommage ({file}.test.ts)
          - Import analysis
          - git diff --name-only (tests modifiés)

      2_run_tests:
        command:
          jest: "npx jest --findRelatedTests {files} --passWithNoTests"
          vitest: "npx vitest run {files}"
          pytest: "pytest {test_files} -x -q"
          phpunit: "vendor/bin/phpunit --filter {pattern}"

      3_on_failure:
        action: "BLOCK"
        message: |
          ❌ TESTS ÉCHOUÉS - Commit bloqué

          {test_output}

          Corrigez les tests avant de committer.
```

## Workflow Global

```yaml
workflow:
  order:
    1: "security_checks"  # Bloquant
    2: "format_checks"    # Bloquant (conflits) ou Warning
    3: "quality_checks"   # Warning/Info
    4: "test_checks"      # Bloquant

  on_block:
    action: "REJECT"
    output: |
      ╔══════════════════════════════════════════════════════════╗
      ║              ❌ COMMIT BLOQUÉ                            ║
      ╠══════════════════════════════════════════════════════════╣
      ║  {block_reason}                                          ║
      ║                                                          ║
      ║  Fichiers concernés:                                     ║
      ║  {files}                                                 ║
      ║                                                          ║
      ║  Actions requises:                                       ║
      ║  {required_actions}                                      ║
      ╚══════════════════════════════════════════════════════════╝

  on_warn:
    action: "PROMPT"
    output: |
      ╔══════════════════════════════════════════════════════════╗
      ║              ⚠️ AVERTISSEMENTS                           ║
      ╠══════════════════════════════════════════════════════════╣
      ║  {warnings}                                              ║
      ║                                                          ║
      ║  Voulez-vous continuer le commit? [o/N]                  ║
      ╚══════════════════════════════════════════════════════════╝

  on_pass:
    action: "ALLOW"
    output: |
      ✅ Validations pre-commit passées

      Fichiers validés: {file_count}
      Tests exécutés: {test_count}
      Temps: {duration}s
```

## Configuration

```yaml
config:
  # Activer/désactiver le hook
  enabled: true

  # Mode strict (bloque sur warnings)
  strict_mode: false

  # Timeout global
  timeout: 60  # secondes

  # Skip avec message
  skip_pattern: "\\[skip-hooks\\]|\\[no-verify\\]"

  # Fichiers exclus
  exclude_paths:
    - "*.md"
    - "*.json"
    - "*.yaml"
    - "*.yml"
    - "*.lock"
    - "migrations/**"
```

## Bypass (Urgence)

```yaml
bypass:
  methods:
    # Via message de commit
    - pattern: "[skip-hooks]"
      example: "git commit -m 'hotfix: urgent [skip-hooks]'"

    # Via flag git
    - flag: "--no-verify"
      example: "git commit --no-verify -m 'message'"

  logging:
    log_bypasses: true
    file: ".claude/logs/hook-bypasses.log"

  warning: |
    ⚠️ Hook pre-commit bypassé

    Commit: {commit_hash}
    Auteur: {author}
    Raison: {bypass_method}

    Assurez-vous de valider manuellement.
```

## Rapport

```yaml
report:
  format: |
    ┌─────────────────────────────────────────────────┐
    │           Pre-Commit Validation                 │
    ├─────────────────────────────────────────────────┤
    │ Fichiers staged:     {staged_count}             │
    │ Fichiers analysés:   {analyzed_count}           │
    ├─────────────────────────────────────────────────┤
    │ ✅ Sécurité:         {security_status}          │
    │ ✅ Qualité:          {quality_status}           │
    │ ✅ Format:           {format_status}            │
    │ ✅ Tests:            {test_status}              │
    ├─────────────────────────────────────────────────┤
    │ Résultat:            {final_status}             │
    │ Durée:               {duration}s                │
    └─────────────────────────────────────────────────┘
```

## Intégration

```yaml
integration:
  # Avec le hook regression-guard
  after_commit:
    trigger: "regression-guard"
    mode: "quick"

  # Avec /audit
  weekly:
    suggest: "/audit all"
```
