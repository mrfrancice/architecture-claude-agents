---
name: validation-system
description: "Système de validation des outputs agents avec boucle de feedback.\\nDéfinit les critères, seuils et mécanismes de validation qualité.\\n"
model: opus
---

# Système de Validation - Boucle de Feedback

## Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VALIDATION PIPELINE                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │  INPUT   │───►│  AGENT   │───►│ VALIDATE │───►│  OUTPUT  │          │
│  │          │    │          │    │          │    │          │          │
│  └──────────┘    └────┬─────┘    └────┬─────┘    └──────────┘          │
│                       │               │                                  │
│                       │               ▼                                  │
│                       │        ┌─────────────┐                          │
│                       │        │   SCORE?    │                          │
│                       │        ├─────────────┤                          │
│                       │        │ ≥90%  → ✅ ACCEPT                      │
│                       │        │ 60-89% → ⚠️ ITERATE ◄─┐                │
│                       │        │ <60%  → ❌ REJECT    │                 │
│                       │        └─────────────┘        │                 │
│                       │               │               │                 │
│                       │               ▼               │                 │
│                       │        ┌─────────────┐        │                 │
│                       └────────│  FEEDBACK   │────────┘                 │
│                                └─────────────┘                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Critères de Validation

### 1.1 Critères universels (tous les agents)

| Critère | Description | Poids |
|---------|-------------|-------|
| `hasOutput` | L'agent a produit un output | BLOQUANT |
| `hasAutoEval` | Auto-évaluation présente | BLOQUANT |
| `noErrors` | Pas d'erreurs de syntaxe | BLOQUANT |
| `meetsRequirements` | Répond à la demande initiale | 30% |
| `isComplete` | Output complet, pas partiel | 25% |
| `isCorrect` | Output techniquement correct | 25% |
| `followsStandards` | Respecte les conventions | 20% |

### 1.2 Critères par domaine

#### Frontend

```yaml
ui-engineer:
  required:
    - hasCode: true
    - hasStyles: true
    - noConsoleErrors: true
  optional:
    - responsive: +10%
    - accessible: +10%
    - animated: +5%
  score_min: 80%

fullstack-ui-architect:
  required:
    - hasCode: true
    - hasStateManagement: true
    - hasTypes: true
    - hasErrorBoundary: true
  optional:
    - hasTests: +15%
    - hasStorybook: +5%
  score_min: 80%

ux-design-strategist:
  required:
    - hasWireframes: true
    - hasUserFlow: true
    - hasAccessibilityNotes: true
  optional:
    - hasPrototype: +10%
    - hasResearch: +10%
  score_min: 80%
```

#### Backend

```yaml
distributed-systems-architect:
  required:
    - hasArchitecture: true
    - hasScalabilityPlan: true
    - hasFailoverStrategy: true
    - hasDataFlow: true
  optional:
    - hasDiagram: +10%
    - hasTradeoffs: +5%
  score_min: 84%

database-optimization-expert:
  required:
    - hasQuery: true
    - hasExplainPlan: true
    - hasIndexStrategy: true
  optional:
    - hasBenchmarks: +10%
    - noNPlusOne: +10%
  score_min: 80%
```

#### Quality

```yaml
senior-code-reviewer:
  required:
    - hasReview: true
    - hasSuggestions: true
    - noMissedIssues: true
  optional:
    - hasPriorityRanking: +5%
    - hasCodeExamples: +5%
  score_min: 80%

test-automation-strategist:
  required:
    - hasTests: true
    - hasAssertions: true
    - coverageTarget: true  # ≥80%
  optional:
    - hasE2E: +10%
    - hasMocks: +5%
  score_min: 80%

security-expert:
  required:
    - hasAudit: true
    - noVulnerabilities: true
    - hasRemediations: true
  optional:
    - hasPentestPlan: +10%
    - hasComplianceCheck: +5%
  score_min: 90%  # Plus strict !
```

#### Cross-cutting

```yaml
prompt-engineering-expert:
  required:
    - hasPrompt: true
    - hasExamples: true
    - hasEvaluation: true
  optional:
    - hasVariations: +5%
    - hasBenchmarks: +10%
  score_min: 80%

technical-writer:
  required:
    - hasDocumentation: true
    - isComplete: true
    - isAccurate: true
  optional:
    - hasExamples: +10%
    - hasAPIRef: +5%
  score_min: 76%

devops-sre:
  required:
    - hasConfig: true
    - hasMonitoring: true
    - hasRollbackPlan: true
  optional:
    - hasAlerts: +5%
    - hasRunbook: +10%
  score_min: 80%
```

---

## 2. Calcul du Score

### 2.1 Formule

```
Score = (critères_requis_satisfaits / total_requis) × 100
      + bonus_optionnels
      - pénalités

Ajusté entre 0% et 100%
```

### 2.2 Pénalités

| Infraction | Pénalité |
|------------|----------|
| Issue CRITICAL non résolue | -30% |
| Issue MAJOR non résolue | -15% |
| Issue MINOR non résolue | -5% |
| Auto-évaluation absente | BLOQUANT |
| Auto-évaluation irréaliste (±1.5 vs réel) | -10% |
| Même erreur répétée | -20% |

### 2.3 Exemple de calcul

```markdown
## Calcul pour nestjs-expert

### Critères requis (4)
- hasCode: ✅ (1/4)
- hasDTO: ✅ (2/4)
- hasValidation: ❌ (2/4)
- hasErrorHandling: ✅ (3/4)

Base: 3/4 = 75%

### Bonus optionnels
- hasTests: ✅ (+15%)
- hasSwagger: ❌ (+0%)

Avec bonus: 75% + 15% = 90%

### Pénalités
- Issue MAJOR (validation manquante): -15%

Score final: 90% - 15% = 75%

### Décision
75% est entre 60% et 90% → ⚠️ ITERATE
```

---

## 3. Boucle de Feedback

### 3.1 Déclenchement

| Score | Action | Description |
|-------|--------|-------------|
| ≥ 90% | ✅ ACCEPT | Output validé, passe à l'étape suivante |
| 60-89% | ⚠️ ITERATE | Feedback envoyé, agent doit corriger |
| < 60% | ❌ REJECT | Trop d'erreurs, escalade ou changement d'agent |

### 3.2 Format du feedback

```markdown
## 🔄 FEEDBACK - Itération [N+1]

### Score actuel
**[X]%** (minimum requis: **90%**)

### Critères échoués

| Critère | Attendu | Reçu | Impact |
|---------|---------|------|--------|
| hasValidation | true | false | -25% |

### Issues à résoudre

#### 🔴 CRITICAL (bloquants)
- [Aucun]

#### 🟠 MAJOR (doivent être corrigés)
1. **Validation DTO manquante**
   - Fichier: `src/users/dto/create-user.dto.ts`
   - Action: Ajouter décorateurs class-validator
   - Exemple:
     ```typescript
     @IsString()
     @MinLength(3)
     name: string;
     ```

#### 🟡 MINOR (améliorations)
- JSDoc incomplet sur la méthode `createUser`

### Instructions
1. Corriger les issues MAJOR listées ci-dessus
2. Conserver le code existant qui fonctionne
3. Retourner le code complet avec nouvelle auto-évaluation

### Ce qui est validé ✅
- Structure du module NestJS
- Service avec injection de dépendances
- Controller avec routes RESTful

### Limite
⚠️ Itération [N+1]/3 - Plus que [3-N-1] tentatives
```

### 3.3 Règles d'itération

```yaml
iteration_rules:
  max_iterations: 3

  iteration_1:
    feedback_level: detailed
    include_examples: true
    timeout: 5min

  iteration_2:
    feedback_level: very_detailed
    include_examples: true
    include_context: true
    timeout: 5min

  iteration_3:
    feedback_level: complete
    include_working_code: true
    last_chance: true
    timeout: 7min

  after_iteration_3:
    action: escalate
    options:
      - try_different_agent
      - ask_user
      - partial_accept_with_warnings
```

---

## 4. Auto-évaluation Agent

### 4.1 Format obligatoire

Chaque agent DOIT inclure à la fin de son output :

```markdown
---
## 📊 AUTO-ÉVALUATION

### Score global : [X.X]/5

### Checklist

| Critère | Status | Confiance | Notes |
|---------|--------|-----------|-------|
| hasCode | ✅ | HIGH | Code complet fourni |
| hasDTO | ✅ | HIGH | DTOs avec validation |
| hasTests | ⚠️ | MEDIUM | Tests unitaires seulement |
| hasErrorHandling | ✅ | HIGH | Try-catch + filtres |

### Issues identifiées

#### CRITICAL (0)
Aucune

#### MAJOR (1)
- Tests E2E non inclus (hors scope demandé)

#### MINOR (2)
- JSDoc partiel
- Pas de commentaires inline

### Confiance globale : [HIGH/MEDIUM/LOW]

### Justification
[Pourquoi ce score est approprié]
```

### 4.2 Grille de scoring agent

| Score | Signification | Quand l'utiliser |
|-------|---------------|------------------|
| 5.0 | Parfait, aucune amélioration possible | Rare, justifier |
| 4.5 | Excellent, améliorations mineures | Objectif standard |
| 4.0 | Bon, quelques points à améliorer | Acceptable |
| 3.5 | Correct, améliorations nécessaires | Needs work |
| 3.0 | Minimum acceptable | Limite basse |
| < 3.0 | Insuffisant | Ne pas soumettre |

### 4.3 Calibration

Pour éviter l'auto-complaisance :

```
Si auto_eval - validation_score > 1.0 :
  → Pénalité de -10%
  → Flag "auto-évaluation irréaliste"
  → Inclure dans feedback
```

---

## 5. Mécanisme de Rollback

### 5.1 Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         ROLLBACK MECHANISM                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │ VERSION  │───►│  AGENT   │───►│ VALIDATE │───►│  ACCEPT  │          │
│  │    N     │    │  OUTPUT  │    │          │    │    ?     │          │
│  └────┬─────┘    └──────────┘    └────┬─────┘    └────┬─────┘          │
│       │                               │               │                  │
│       │         SNAPSHOT              │               │                  │
│       ▼              ▼                ▼               ▼                  │
│  ┌──────────┐   ┌──────────┐    ┌──────────┐   ┌──────────┐            │
│  │ ROLLBACK │◄──│ RESTORE  │◄───│  FAILED  │◄──│    NO    │            │
│  │  POINT   │   │  STATE   │    │  3x ITR  │   │          │            │
│  └──────────┘   └──────────┘    └──────────┘   └──────────┘            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Snapshots Automatiques

```yaml
snapshot_system:
  trigger: "before_agent_execution"

  captures:
    code_state:
      - files_modified: []
      - git_diff: "staged + unstaged"
      - git_stash: "auto if needed"

    context_state:
      - agent_name
      - task_description
      - iteration_number
      - score_history: []

    validation_state:
      - criteria_met: []
      - criteria_failed: []
      - feedback_given: []

  storage:
    location: ".claude/snapshots/"
    retention: "session"  # ou "24h" ou "permanent"
    format: "json + git-patch"
    index_file: ".claude/snapshots/index.json"

  naming: "snap_{timestamp}_{agent}"
```

### 5.3 Conditions de Rollback

```yaml
rollback_triggers:
  automatic:
    - iterations_exhausted: 3
      action: "rollback_to_pre_agent_state"

    - score_degradation: true
      condition: "score[n] < score[n-1] - 20%"
      action: "rollback_to_best_iteration"

    - critical_error: true
      types: [syntax_error, build_failure, test_regression]
      action: "immediate_rollback"

    - security_violation: true
      types: [secret_exposed, vulnerability_introduced]
      action: "immediate_rollback + alert"

  manual:
    - user_request: "/rollback"
      action: "show_snapshots + confirm + restore"

    - agent_request: "ROLLBACK_NEEDED"
      action: "escalate_with_rollback_option"
```

### 5.4 Stratégies de Rollback

```yaml
rollback_strategies:
  full_rollback:
    description: "Retour complet à l'état avant l'agent"
    when: "Échec total, code inutilisable"
    restores:
      - all_files_to_snapshot
      - git_state
      - context_cleared
    preserves:
      - error_logs
      - learnings_for_next_attempt

  partial_rollback:
    description: "Garde le code valide, retire les erreurs"
    when: "Certaines parties sont bonnes"
    restores:
      - failed_files_only
    preserves:
      - passing_code
      - passing_tests

  selective_rollback:
    description: "Choix utilisateur des fichiers"
    when: "Situation complexe, besoin intervention"
    presents:
      - list_of_changes
      - impact_analysis
    user_selects:
      - files_to_keep
      - files_to_revert

  best_iteration_rollback:
    description: "Retour à la meilleure itération"
    when: "Dégradation progressive"
    algorithm: |
      best = max(iterations, key=lambda i: i.score)
      restore(best.snapshot)
    preserves:
      - learnings_from_later_iterations
```

### 5.5 Workflow de Rollback

```yaml
rollback_workflow:
  step_1_detect:
    trigger: "validation_failed OR user_request OR critical_error"
    action: "initiate_rollback_process"

  step_2_analyze:
    actions:
      - identify_rollback_point
      - calculate_impact
      - check_dependencies
    output: rollback_plan

  step_3_confirm:
    if: "not automatic_rollback"
    present:
      - current_state_summary
      - rollback_target
      - files_affected
      - side_effects
    wait_for: user_confirmation

  step_4_execute:
    actions:
      - create_safety_snapshot  # Point de non-retour
      - restore_files
      - restore_git_state
      - clear_failed_context
    verify: "restored_state_valid"

  step_5_report:
    generate:
      - rollback_summary
      - root_cause_analysis
      - recommendations
    log: "rollback_history.json"
```

### 5.6 Format du Rapport de Rollback

```markdown
## 🔄 RAPPORT DE ROLLBACK

### Informations
| Champ | Valeur |
|-------|--------|
| Agent | {agent_name} |
| Tâche | {task_description} |
| Itérations | {iterations}/3 |
| Score final | {final_score}% |

### Raison du Rollback
**Type**: {automatic | manual | critical}
**Cause**: {description}

### État Restauré
- **Snapshot**: {snapshot_id}
- **Date snapshot**: {timestamp}
- **Fichiers restaurés**: {count}

### Fichiers Affectés
| Fichier | Action | Diff Lines |
|---------|--------|------------|
| {file1} | reverted | +{added}/-{removed} |
| {file2} | kept | - |

### Analyse
**Pourquoi l'échec ?**
{root_cause_analysis}

**Ce qui a été tenté :**
1. Itération 1: {summary} → Score {score}%
2. Itération 2: {summary} → Score {score}%
3. Itération 3: {summary} → Score {score}%

### Recommandations
1. [ ] {recommendation_1}
2. [ ] {recommendation_2}

### Prochaines Étapes
- [ ] Essayer avec agent alternatif: {suggested_agent}
- [ ] Demander clarification utilisateur
- [ ] Découper la tâche en sous-tâches
```

### 5.7 Commandes Rollback

```yaml
rollback_commands:
  list_snapshots:
    command: "/rollback list"
    shows: "Available snapshots for current session"

  rollback_last:
    command: "/rollback last"
    action: "Rollback to previous snapshot"

  rollback_specific:
    command: "/rollback {snapshot_id}"
    action: "Rollback to specific snapshot"

  rollback_best:
    command: "/rollback best"
    action: "Rollback to highest-scoring iteration"

  rollback_preview:
    command: "/rollback preview {snapshot_id}"
    shows: "Diff between current and target state"
```

---

## 6. Escalade

### 6.1 Conditions d'escalade

| Condition | Action |
|-----------|--------|
| 3 itérations échouées | Escalade automatique |
| Score < 60% | Escalade immédiate |
| Issue CRITICAL non résolvable | Escalade immédiate |
| Agent request | Escalade sur demande |
| Timeout dépassé | Escalade + warning |

### 5.2 Options d'escalade

```yaml
escalation_options:
  try_different_agent:
    condition: "score >= 40%"
    action: "Router vers agent alternatif du même domaine"
    example: "ui-engineer → fullstack-ui-architect"

  escalate_to_architect:
    condition: "score >= 30% AND score < 40%"
    action: "Router vers agent architect"
    example: "→ distributed-systems-architect"

  ask_user:
    condition: "score < 30% OR conflict"
    action: "Demander intervention utilisateur"
    format: |
      ## ⚠️ ESCALADE UTILISATEUR

      **Raison** : [raison]
      **Score** : [X]%
      **Tentatives** : 3/3

      ### Options
      1. [ ] Accepter en l'état avec warnings
      2. [ ] Fournir clarifications
      3. [ ] Abandonner cette tâche
      4. [ ] Changer d'approche
```

### 5.3 Format d'escalade

```markdown
## 🚨 ESCALADE

### Source
- **Agent** : [nom]
- **Itérations** : 3/3
- **Score final** : [X]%

### Problème
[Description du blocage]

### Tentatives effectuées
1. [Tentative 1] → [Résultat]
2. [Tentative 2] → [Résultat]
3. [Tentative 3] → [Résultat]

### Analyse
[Pourquoi ça ne fonctionne pas]

### Recommandation
- [ ] Option A : [description]
- [ ] Option B : [description]

### Contexte à transmettre
[Code/Artefacts pertinents]
```

---

## 6. Métriques et Reporting

### 6.1 Métriques par workflow

```yaml
metrics:
  - total_agents: int
  - total_iterations: int
  - average_score: float
  - time_total: duration
  - time_per_agent: duration[]
  - escalations: int
  - success_rate: float  # outputs acceptés / total
```

### 6.2 Rapport de validation

```markdown
## 📊 RAPPORT DE VALIDATION

### Vue d'ensemble

| Métrique | Valeur |
|----------|--------|
| Workflow | [nom-workflow] |
| Status | ✅ SUCCESS / ⚠️ PARTIAL / ❌ FAILED |
| Agents | [N] |
| Itérations | [N] |
| Temps | [Xm Ys] |
| Score global | [X]% |

### Détail par agent

| Agent | Iter | Score init | Score final | Δ | Status |
|-------|------|------------|-------------|---|--------|
| nestjs-expert | 2 | 75% | 94% | +19% | ✅ |
| database-expert | 1 | 91% | 91% | +0% | ✅ |
| security-expert | 2 | 82% | 96% | +14% | ✅ |
| test-strategist | 1 | 88% | 88% | +0% | ✅ |

### Graphique d'itérations

```
nestjs-expert:    [██████████░░] 75% → [████████████] 94%
database-expert:  [███████████░] 91%
security-expert:  [█████████░░░] 82% → [████████████] 96%
test-strategist:  [██████████░░] 88%
```

### Issues résolues

| Agent | Issue | Résolution |
|-------|-------|------------|
| nestjs-expert | Validation DTO | Ajout class-validator |
| security-expert | CORS config | Headers sécurisés |

### Qualité globale

🟢 **EXCELLENT** (Score: 92%)

> Output prêt pour production avec confiance élevée.

### Recommandations
1. Considérer l'ajout de tests E2E
2. Documenter les endpoints API
```

---

## 7. Configuration

### 7.1 Paramètres globaux

```yaml
validation_config:
  enabled: true

  thresholds:
    accept: 90
    iterate: 60
    reject: 0

  iterations:
    max: 3
    timeout_per_iteration: 300  # secondes

  penalties:
    critical_issue: 30
    major_issue: 15
    minor_issue: 5
    unrealistic_self_eval: 10
    repeated_error: 20

  escalation:
    auto_after_iterations: 3
    min_score_for_alt_agent: 40
    min_score_for_architect: 30
```

### 7.2 Override par agent

```yaml
agent_overrides:
  security-expert:
    thresholds:
      accept: 95  # Plus strict
      iterate: 70
    penalties:
      critical_issue: 50  # Pénalité plus lourde

  technical-writer:
    thresholds:
      accept: 85  # Plus souple
      iterate: 55
```

---

## 8. Tests de Non-Régression (Obligatoire)

### 8.1 Critères de Test

```yaml
test_requirements:
  # Tests OBLIGATOIRES pour validation ≥90%
  mandatory:
    tests_exist: true           # Au moins 1 test
    tests_pass: true            # Tous les tests passent
    no_regression: true         # Pas de nouveaux échecs vs baseline

  # Bonus pour tests avancés
  bonus:
    coverage_80: +10%           # Couverture ≥80%
    coverage_90: +15%           # Couverture ≥90%
    e2e_tests: +5%              # Tests E2E présents
    no_flaky: +5%               # Pas de tests flaky

  # Pénalités
  penalties:
    test_failure: -25%          # Un test échoue
    regression: -30%            # Régression détectée
    no_tests: -20%              # Aucun test pour le code modifié
    low_coverage: -10%          # Couverture <50%
```

### 8.2 Workflow de Validation avec Tests

```
┌─────────────────────────────────────────────────────────────────────────┐
│                  VALIDATION AVEC TESTS DE NON-RÉGRESSION                │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐          │
│  │  AGENT   │───►│  CODE    │───►│  TESTS   │───►│ VALIDATE │          │
│  │  OUTPUT  │    │  REVIEW  │    │  RUN     │    │          │          │
│  └──────────┘    └──────────┘    └────┬─────┘    └──────────┘          │
│                                       │                                  │
│                                       ▼                                  │
│                                ┌─────────────┐                          │
│                                │ TESTS PASS? │                          │
│                                ├─────────────┤                          │
│                                │ ✅ OUI → Continue validation           │
│                                │ ❌ NON → BLOQUE (score -25%)           │
│                                └─────────────┘                          │
│                                       │                                  │
│                                       ▼                                  │
│                                ┌─────────────┐                          │
│                                │ RÉGRESSION? │                          │
│                                ├─────────────┤                          │
│                                │ ✅ NON → Continue                      │
│                                │ ❌ OUI → BLOQUE (score -30%)           │
│                                └─────────────┘                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### 8.3 Exécution Automatique des Tests

```yaml
test_execution:
  trigger: "after_agent_output"

  steps:
    1_identify_tests:
      action: "Trouver tests liés aux fichiers modifiés"
      method:
        - naming_convention   # file.ts → file.spec.ts
        - import_analysis     # Tests qui importent le fichier
        - lsp_references      # Serena find_referencing_symbols

    2_run_tests:
      command:
        jest: "npx jest --findRelatedTests {files} --json"
        vitest: "npx vitest run {files} --reporter=json"
        pytest: "pytest {files} --json-report"
        phpunit: "vendor/bin/phpunit --filter {pattern}"
      timeout: 60s
      parallel: true

    3_compare_baseline:
      action: "Comparer avec dernière exécution réussie"
      detect:
        - new_failures       # Tests qui passaient avant
        - fixed_tests        # Tests qui échouaient avant
        - new_tests          # Nouveaux tests ajoutés

    4_calculate_impact:
      action: "Calculer l'impact sur le score"
      formula: |
        if tests_fail:
          score -= 25%
        if regression_detected:
          score -= 30%
        if coverage >= 80%:
          score += 10%
        if coverage >= 90%:
          score += 15%
```

### 8.4 Format du Rapport de Test

```markdown
## 🧪 RAPPORT DE TESTS

### Résumé
| Métrique | Valeur | Impact Score |
|----------|--------|--------------|
| Tests exécutés | {total} | - |
| ✅ Passés | {passed} | - |
| ❌ Échoués | {failed} | -{penalty}% |
| 📊 Couverture | {coverage}% | +{bonus}% |
| 🔄 Régressions | {regressions} | -{penalty}% |

### Régressions Détectées

| Test | Avant | Après | Cause Probable |
|------|-------|-------|----------------|
| {test_name} | ✅ PASS | ❌ FAIL | {analysis} |

### Action Requise
{action_required}

### Impact sur Validation
Score ajusté: {original_score}% → {adjusted_score}%
```

### 8.5 Conditions de Blocage

```yaml
blocking_conditions:
  # BLOQUE la validation si:
  - tests_fail: true
    message: "Tests échoués - correction requise"
    action: "ITERATE"

  - regression_detected: true
    message: "Régression détectée vs baseline"
    action: "ITERATE"

  - no_tests_for_new_code: true
    severity: "WARNING"  # Ne bloque pas mais pénalise
    penalty: -20%
    message: "Nouveau code sans tests"

# EXCEPTION: L'utilisateur peut forcer
force_accept:
  allowed: true
  requires: "// @skip-test-validation: {reason}"
  logs: true
```

---

## 9. Intégration

### 9.1 Avec routing-matrix

La validation s'intègre aux workflows définis :

```
BUILD workflow + validation:
1. [Domain Expert] → Implémentation → VALIDATE
2. test-automation-strategist → Tests → VALIDATE
3. senior-code-reviewer → Review → VALIDATE
4. Consolidation → Output Final
```

### 8.2 Avec collaboration-protocols

Handoff enrichi avec statut validation :

```markdown
## 🔄 HANDOFF CONTEXT

### Validation Status
- **Score** : [X]%
- **Itérations** : [N]
- **Issues résolues** : [liste]
- **Warnings** : [liste]
```
