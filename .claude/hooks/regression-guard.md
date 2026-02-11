# 🧪 Regression Guard Hook

---
name: regression-guard
description: "Exécute automatiquement les tests liés aux fichiers modifiés"
event: PostToolUse
match_tools: ["Write", "Edit", "mcp__plugin_serena_serena__replace_symbol_body", "mcp__plugin_serena_serena__replace_content"]
---

## Instructions

Ce hook exécute automatiquement les tests pertinents APRÈS chaque modification de code pour détecter les régressions immédiatement.

## Configuration

```yaml
config:
  # Activer/désactiver
  enabled: true

  # Timeout max pour les tests (en secondes)
  timeout: 30

  # Mode: quick (tests directs) | related (+ dépendances) | full (tous)
  mode: "quick"

  # Exécuter seulement si fichier source (pas test)
  skip_test_files: true

  # Bloquer si tests échouent
  block_on_failure: true
```

## Détection du Framework de Test

```yaml
detection:
  javascript:
    jest:
      config: ["jest.config.js", "jest.config.ts", "package.json:jest"]
      command: "npx jest --findRelatedTests {file} --passWithNoTests"
      pattern: "**/*.{test,spec}.{js,ts,jsx,tsx}"

    vitest:
      config: ["vitest.config.ts", "vite.config.ts:test"]
      command: "npx vitest run --reporter=json {file}"
      pattern: "**/*.{test,spec}.{js,ts,jsx,tsx}"

    mocha:
      config: [".mocharc.js", ".mocharc.json"]
      command: "npx mocha --grep {testPattern}"
      pattern: "**/*.{test,spec}.js"

  python:
    pytest:
      config: ["pytest.ini", "pyproject.toml:pytest", "setup.cfg:pytest"]
      command: "pytest {test_file} -v --tb=short"
      pattern: "**/test_*.py"

    unittest:
      config: []
      command: "python -m unittest {module}"
      pattern: "**/test_*.py"

  php:
    phpunit:
      config: ["phpunit.xml", "phpunit.xml.dist"]
      command: "vendor/bin/phpunit --filter {testClass}"
      pattern: "**/Test*.php"

    pest:
      config: ["pest.php"]
      command: "vendor/bin/pest --filter {test}"
      pattern: "**/*Test.php"

  ruby:
    rspec:
      config: [".rspec", "spec/spec_helper.rb"]
      command: "bundle exec rspec {spec_file}"
      pattern: "**/*_spec.rb"

  go:
    go_test:
      config: ["go.mod"]
      command: "go test -v -run {testFunc} ./{package}"
      pattern: "**/*_test.go"
```

## Mapping Fichier → Test

### Stratégie 1: Convention de Nommage

```yaml
naming_conventions:
  # src/services/user.service.ts → src/services/user.service.spec.ts
  same_directory:
    source: "{name}.{ext}"
    test: "{name}.{spec|test}.{ext}"

  # src/services/user.service.ts → tests/services/user.service.spec.ts
  parallel_directory:
    source: "src/**/{name}.{ext}"
    test: "tests/**/{name}.{spec|test}.{ext}"

  # src/services/user.service.ts → __tests__/user.service.test.ts
  __tests__:
    source: "**/{name}.{ext}"
    test: "**/__tests__/{name}.{test|spec}.{ext}"
```

### Stratégie 2: Analyse des Imports

```yaml
import_analysis:
  enabled: true

  # Analyser les fichiers de test qui importent le fichier modifié
  scan_pattern: |
    import.*from.*{modified_file}
    require.*{modified_file}
    from {module} import
```

### Stratégie 3: LSP (Serena)

```yaml
lsp_analysis:
  enabled: true

  # Utiliser find_referencing_symbols pour trouver les tests
  command: |
    find_referencing_symbols("{symbol}", "{file}")
    filter: path contains "test" or "spec"
```

## Workflow d'Exécution

```yaml
workflow:
  1_identify_modified:
    description: "Identifier le fichier modifié"
    action: |
      file = tool_result.file_path
      symbols = get_modified_symbols(file)

  2_find_tests:
    description: "Trouver les tests liés"
    action: |
      tests = []

      # Convention de nommage
      tests += find_by_naming_convention(file)

      # Analyse des imports
      tests += find_by_import_analysis(file)

      # LSP (si mode 'related')
      if mode == "related":
        tests += find_by_lsp(symbols)

  3_prioritize:
    description: "Prioriser les tests"
    action: |
      # Tests directs = priorité haute
      # Tests de dépendances = priorité moyenne
      # Tests E2E = priorité basse (skip si mode quick)

      sorted_tests = prioritize(tests)

      if mode == "quick":
        sorted_tests = sorted_tests[:5]  # Max 5 tests

  4_execute:
    description: "Exécuter les tests"
    action: |
      for test in sorted_tests:
        result = run_test(test, timeout=30)
        if result.failed:
          failures.append(result)

  5_report:
    description: "Rapporter les résultats"
    action: |
      if failures:
        block_and_report(failures)
      else:
        log_success(tests)
```

## Actions

### Si Tests Réussissent

```yaml
action: PASS
response: |
  ✅ **Tests de non-régression passés**

  | Test | Durée |
  |------|-------|
  {test_results}

  Total: {count} tests en {duration}s
```

### Si Tests Échouent

```yaml
action: BLOCK
response: |
  ❌ **RÉGRESSION DÉTECTÉE - Modification bloquée**

  ## Tests échoués

  | Test | Erreur |
  |------|--------|
  {failed_tests}

  ## Détails

  ### {test_name}

  **Fichier:** `{test_file}:{line}`

  **Attendu:**
  ```
  {expected}
  ```

  **Reçu:**
  ```
  {actual}
  ```

  ## Actions suggérées

  1. **Corriger le code** si c'est un bug
  2. **Mettre à jour le test** si le comportement a changé intentionnellement
  3. **Annuler la modification** avec: `git checkout {file}`

  Voulez-vous que j'analyse la cause de l'échec?
```

### Si Aucun Test Trouvé

```yaml
action: WARN
response: |
  ⚠️ **Aucun test trouvé pour `{file}`**

  Ce fichier n'a pas de tests associés.

  Voulez-vous que je génère des tests avec `/generate-tests {file}`?
```

## Exceptions

```yaml
exceptions:
  # Fichiers ignorés
  ignored_files:
    - "**/*.md"
    - "**/*.json"
    - "**/*.yaml"
    - "**/*.css"
    - "**/*.scss"
    - "**/migrations/**"
    - "**/.env*"

  # Fichiers de test (ne pas tester les tests)
  test_files:
    - "**/*.test.*"
    - "**/*.spec.*"
    - "**/__tests__/**"
    - "**/tests/**"

  # Skip temporaire avec commentaire
  skip_comment: "// @skip-regression-test: {reason}"
```

## Métriques

```yaml
metrics:
  track:
    - tests_executed
    - tests_passed
    - tests_failed
    - execution_time
    - regressions_caught
    - false_positives

  log_path: ".claude/logs/regression-guard.log"
```

## Intégration avec Autres Hooks

```yaml
integration:
  # Exécuter APRÈS security-validator
  after: ["security-validator", "secrets-scanner"]

  # Si régression détectée, ne pas exécuter code-quality-check
  blocks: ["code-quality-check"]
```

## Logging

```yaml
logging:
  # Log détaillé des tests
  detailed_log: ".claude/logs/regression-guard.log"

  # Historique des hooks
  history_file: ".claude/logs/hooks-history.json"

  on_trigger:
    update_stats:
      path: "stats.by_hook.regression-guard.triggers"
      action: "increment"

  on_pass:
    log_to_file:
      file: ".claude/logs/regression-guard.log"
      format: "[{timestamp}] PASS - {file} - {tests_count} tests en {duration}s"
    update_stats:
      path: "stats.by_hook.regression-guard.passed"
      action: "increment"

  on_fail:
    log_to_file:
      file: ".claude/logs/regression-guard.log"
      format: "[{timestamp}] FAIL - {file} - {failed_tests}"
    add_event:
      hook: "regression-guard"
      event: "PostToolUse"
      result: "BLOCK"
      details:
        file: "{modified_file}"
        tests_failed: "{failed_tests}"
        error_messages: "{errors}"
    update_stats:
      path: "stats.by_hook.regression-guard.failed"
      action: "increment"
```

