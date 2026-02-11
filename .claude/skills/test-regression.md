---
name: test-regression
description: "Exécute les tests de non-régression avec analyse complète"

arguments:
  - name: target
    description: "Fichier, dossier, 'changed' (fichiers modifiés), ou 'all'"
    required: false
    default: "changed"
  - name: mode
    description: "Mode: quick, standard, full, coverage"
    required: false
    default: "standard"
  - name: baseline
    description: "Branche/commit de référence pour comparaison"
    required: false
    default: "main"

examples:
  - prompt: "/test-regression"
    description: "Tests sur fichiers modifiés vs main"
  - prompt: "/test-regression src/services/ full"
    description: "Tests complets du dossier services"
  - prompt: "/test-regression changed standard develop"
    description: "Tests fichiers modifiés vs develop"
  - prompt: "/test-regression all coverage"
    description: "Tous les tests avec rapport de couverture"
---

# 🧪 Tests de Non-Régression

## Instructions

Exécuter une suite complète de tests de non-régression avec analyse d'impact et comparaison de baseline.

## Étapes

### 1. Détection de l'Environnement

```yaml
detect:
  framework:
    - jest.config → Jest
    - vitest.config → Vitest
    - pytest.ini → Pytest
    - phpunit.xml → PHPUnit
    - go.mod → Go Test
    - Gemfile + spec/ → RSpec

  package_manager:
    - package-lock.json → npm
    - yarn.lock → yarn
    - pnpm-lock.yaml → pnpm
    - Pipfile.lock → pipenv
    - poetry.lock → poetry
```

### 2. Identification des Fichiers à Tester

#### Si target = "changed"

```bash
# Fichiers modifiés par rapport à la baseline
git diff --name-only {baseline}...HEAD -- "*.ts" "*.js" "*.py" "*.php"

# Fichiers staged
git diff --cached --name-only

# Fichiers non commités
git diff --name-only
```

#### Si target = fichier/dossier

```bash
# Utiliser directement le target
files = glob(target)
```

### 3. Analyse d'Impact (via LSP/Serena)

```yaml
impact_analysis:
  for_each_file:
    # Trouver les symboles modifiés
    - get_symbols_overview(file)

    # Trouver les dépendances
    - find_referencing_symbols(symbol, file)

    # Construire le graphe d'impact
    - build_impact_graph()

  output:
    direct_tests: []      # Tests du fichier lui-même
    indirect_tests: []    # Tests des dépendances
    e2e_tests: []        # Tests end-to-end impactés
```

### 4. Exécution selon le Mode

#### Mode: quick (< 1 min)

```yaml
quick:
  run:
    - direct_tests only
    - max 10 tests
    - timeout 30s par test

  command:
    jest: "npx jest --findRelatedTests {files} --maxWorkers=2"
    vitest: "npx vitest run {files} --reporter=basic"
    pytest: "pytest {files} -x -q"
    phpunit: "vendor/bin/phpunit --filter {pattern}"
```

#### Mode: standard (2-5 min)

```yaml
standard:
  run:
    - direct_tests
    - indirect_tests (1 niveau)
    - timeout 60s par test

  command:
    jest: "npx jest --findRelatedTests {files}"
    vitest: "npx vitest run --changed {baseline}"
    pytest: "pytest {files} -v"
    phpunit: "vendor/bin/phpunit --testsuite unit"
```

#### Mode: full (5-15 min)

```yaml
full:
  run:
    - all related tests
    - e2e_tests
    - timeout 120s par test

  command:
    jest: "npx jest"
    vitest: "npx vitest run"
    pytest: "pytest -v"
    phpunit: "vendor/bin/phpunit"
```

#### Mode: coverage

```yaml
coverage:
  run:
    - all tests
    - collect coverage
    - compare with baseline

  command:
    jest: "npx jest --coverage --coverageReporters=json-summary"
    vitest: "npx vitest run --coverage"
    pytest: "pytest --cov={package} --cov-report=json"
    phpunit: "vendor/bin/phpunit --coverage-clover coverage.xml"
```

### 5. Comparaison avec Baseline

```yaml
baseline_comparison:
  # Récupérer les résultats de la baseline
  checkout_baseline:
    command: "git stash && git checkout {baseline}"
    run_tests: true
    save_results: ".claude/baseline-results.json"
    restore: "git checkout - && git stash pop"

  # Comparer
  compare:
    - tests_added
    - tests_removed
    - tests_changed_status (pass→fail, fail→pass)
    - coverage_diff
    - duration_diff
```

### 6. Analyse des Échecs

```yaml
failure_analysis:
  for_each_failure:
    # Identifier le type d'échec
    type:
      - assertion_failure  # Expected vs Actual
      - timeout           # Test trop long
      - error             # Exception/Error
      - snapshot          # Snapshot mismatch

    # Analyser la cause
    root_cause:
      - diff_with_baseline
      - recent_changes_in_file
      - dependency_changes

    # Suggérer correction
    suggestion:
      - update_test
      - fix_code
      - update_snapshot
```

## Format de Sortie

```markdown
# 🧪 Rapport de Non-Régression

**Date:** {date}
**Baseline:** {baseline}
**Mode:** {mode}
**Target:** {target}

## Résumé Exécutif

| Métrique | Valeur | vs Baseline |
|----------|--------|-------------|
| Tests exécutés | {total} | {diff} |
| ✅ Passés | {passed} | {diff} |
| ❌ Échoués | {failed} | {diff} |
| ⏭️ Ignorés | {skipped} | {diff} |
| 📊 Couverture | {coverage}% | {diff}% |
| ⏱️ Durée | {duration}s | {diff}s |

## Status

{status_badge}

- ✅ **PASS** - Aucune régression détectée
- ⚠️ **WARN** - Nouveaux tests échoués (peuvent être attendus)
- ❌ **FAIL** - Régressions détectées

## Analyse d'Impact

### Fichiers Modifiés
| Fichier | Symboles | Tests Impactés |
|---------|----------|----------------|
{impact_table}

### Graphe de Dépendances
```
{file_modified}
├── utilisé par: {dep1} → {tests1}
├── utilisé par: {dep2} → {tests2}
└── utilisé par: {dep3} → {tests3}
```

## Tests Échoués

### ❌ {test_name}

**Fichier:** `{test_file}:{line}`
**Type:** {failure_type}
**Nouveau dans cette branche:** {is_new}

**Message:**
```
{error_message}
```

**Diff:**
```diff
- Expected: {expected}
+ Received: {actual}
```

**Cause probable:**
{root_cause_analysis}

**Suggestion:**
{suggestion}

---

## Couverture (si mode coverage)

### Par Fichier Modifié
| Fichier | Lignes | Couverture | Δ Baseline |
|---------|--------|------------|------------|
{coverage_table}

### Lignes Non Couvertes Critiques
| Fichier | Ligne | Code |
|---------|-------|------|
{uncovered_critical}

## Nouveaux Tests Suggérés

Basé sur l'analyse du code modifié, ces tests sont manquants:

### {suggested_test_1}
```typescript
{test_code_1}
```

### {suggested_test_2}
```typescript
{test_code_2}
```

## Actions Recommandées

1. {action_1}
2. {action_2}
3. {action_3}

## Commandes Utiles

```bash
# Ré-exécuter les tests échoués
{rerun_failed_command}

# Mettre à jour les snapshots
{update_snapshots_command}

# Voir la couverture détaillée
{coverage_report_command}
```
```

## Intégration CI/CD

```yaml
ci_integration:
  github_actions:
    on_pr:
      - run: /test-regression changed standard ${{ github.base_ref }}
      - comment: results on PR
      - block_merge: if failed

  gitlab_ci:
    merge_request:
      script:
        - claude "/test-regression changed standard $CI_MERGE_REQUEST_TARGET_BRANCH_NAME"

  jenkins:
    stage: "Regression Tests"
    when: "PR"
```

