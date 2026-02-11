---
name: audit
description: "Audit complet du projet avec scoring, analyse multi-domaines et recommandations priorisées"

arguments:
  - name: type
    description: "Type d'audit: all, security, deps, quality, architecture, performance, dette, conformite"
    required: false
    default: "all"
  - name: target
    description: "Cible: chemin du dossier/fichier ou '.' pour tout le projet"
    required: false
    default: "."
  - name: baseline
    description: "Branche de comparaison pour voir l'évolution"
    required: false
  - name: format
    description: "Format de sortie: md, json, summary"
    required: false
    default: "md"

examples:
  - prompt: "/audit"
    description: "Audit complet avec score global"
  - prompt: "/audit security"
    description: "Audit sécurité uniquement"
  - prompt: "/audit architecture src/"
    description: "Audit architecture d'un dossier"
  - prompt: "/audit all . main"
    description: "Audit complet comparé à la branche main"
  - prompt: "/audit dette"
    description: "Audit de la dette technique"
---

# Audit Complet du Projet

## Mission

Effectuer un audit approfondi du projet avec :
- Scoring numérique par domaine (/100)
- Score global pondéré
- Analyse via LSP/Serena quand pertinent
- Recommandations priorisées avec estimation d'effort
- Comparaison avec baseline si fournie

---

## Types d'Audit Disponibles

### 1. security (Pondération x2)

```yaml
analyses:
  owasp_top_10:
    A01_broken_access_control:
      - Routes sans authentification
      - Élévation de privilèges possible
      - IDOR (références directes)

    A02_cryptographic_failures:
      - Mots de passe en clair
      - Algorithmes faibles (MD5, SHA1)
      - Secrets hardcodés

    A03_injection:
      - SQL sans paramètres préparés
      - XSS (innerHTML, dangerouslySetInnerHTML)
      - Command injection (exec, system)
      - Path traversal

    A05_security_misconfiguration:
      - Debug activé en prod
      - Headers de sécurité manquants
      - CORS trop permissif

    A07_auth_failures:
      - Session management faible
      - Tokens non sécurisés
      - Rate limiting absent

  secrets_detection:
    patterns:
      - API keys (AWS, Google, Stripe, GitHub)
      - Passwords, tokens, credentials
      - Private keys, certificates
      - Connection strings

scoring:
  critical: -20  # Injection, secrets exposés
  high: -10      # Auth failures, crypto faible
  medium: -5     # Misconfiguration
  low: -2        # Best practices manquantes
  base: 100
```

### 2. deps (Pondération x1.5)

```yaml
analyses:
  vulnerabilities:
    command:
      npm: "npm audit --json"
      pip: "pip-audit --format json"
      composer: "composer audit --format json"
      go: "govulncheck ./..."

    scoring:
      critical: -20
      high: -10
      moderate: -5
      low: -2

  outdated:
    check:
      - Dépendances majeures en retard (>1 version majeure)
      - Dépendances abandonnées (>2 ans sans update)
      - Dépendances dépréciées

    scoring:
      major_outdated: -5
      abandoned: -10
      deprecated: -15

  quality:
    check:
      - Licences compatibles
      - Taille des dépendances (bundle size)
      - Dépendances dupliquées

    scoring:
      incompatible_license: -15
      oversized_bundle: -5
      duplicates: -3
```

### 3. quality (Pondération x1)

```yaml
analyses:
  test_coverage:
    thresholds:
      excellent: ">= 80%"   # +10 bonus
      good: ">= 60%"        # 0
      low: ">= 40%"         # -10
      critical: "< 40%"     # -20

    check:
      - Couverture globale
      - Couverture des fichiers critiques
      - Tests manquants sur code récent

  code_quality:
    linting:
      - ESLint/Prettier violations
      - Type errors (TypeScript strict)
      - Conventions de nommage

    scoring:
      error: -2
      warning: -0.5
      max_penalty: -30

  documentation:
    check:
      - README existe et complet
      - JSDoc/docstrings sur fonctions publiques
      - CHANGELOG maintenu
      - API documentée

    scoring:
      no_readme: -10
      no_api_docs: -5
      missing_jsdoc: -1 per function
```

### 4. architecture (Pondération x1)

```yaml
analyses:
  structure:
    detect_patterns:
      - MVC / MVVM
      - Clean Architecture
      - DDD (Domain-Driven Design)
      - Microservices
      - Monolithe modulaire

    evaluate:
      - Séparation des responsabilités
      - Couches bien définies
      - Interfaces claires entre modules

  dependencies_graph:
    using: "serena/find_referencing_symbols"
    check:
      - Dépendances circulaires (-15 chacune)
      - Couplage excessif (>10 imports d'un module)
      - Modules "god" (tout dépend d'eux)

  solid_principles:
    S_single_responsibility:
      - Classes > 500 lignes
      - Fichiers > 20 fonctions/méthodes

    O_open_closed:
      - Switch/if-else géants (>5 cases)
      - Modifications fréquentes du même fichier

    D_dependency_inversion:
      - Dépendances concrètes vs abstractions
      - Injection de dépendances utilisée

  scoring:
    no_pattern: -10
    circular_dependency: -15
    god_module: -10
    solid_violation: -5
```

### 5. performance (Pondération x1)

```yaml
analyses:
  database:
    using: "database-optimization-expert patterns"
    check:
      - Requêtes N+1 potentielles
      - SELECT * au lieu de colonnes spécifiques
      - Absence d'index sur colonnes filtrées
      - Transactions trop longues

    scoring:
      n_plus_1: -10
      select_star: -3
      missing_index: -5

  frontend:
    check:
      - Bundle size > 500KB
      - Images non optimisées
      - Pas de lazy loading
      - Re-renders inutiles (React)
      - Imports non tree-shakés

    scoring:
      large_bundle: -10
      no_lazy_loading: -5
      unoptimized_images: -5

  backend:
    check:
      - Endpoints sans pagination
      - Pas de cache sur données statiques
      - Synchrone au lieu d'async
      - Memory leaks potentiels

    scoring:
      no_pagination: -10
      no_cache: -5
      sync_blocking: -5
```

### 6. dette (Pondération x1)

```yaml
analyses:
  markers:
    patterns:
      - "TODO"
      - "FIXME"
      - "HACK"
      - "XXX"
      - "TEMPORARY"
      - "WORKAROUND"

    scoring:
      ratio: "(count / total_lines) * 1000"
      threshold:
        good: "< 5"      # 0
        warning: "5-15"  # -10
        bad: "> 15"      # -20

  complexity:
    using: "serena/get_symbols_overview + analysis"
    metrics:
      cyclomatic_complexity:
        good: "<= 10"
        warning: "11-20"  # -5 par fonction
        critical: "> 20"  # -10 par fonction

      cognitive_complexity:
        good: "<= 15"
        warning: "16-30"
        critical: "> 30"

  god_classes:
    thresholds:
      lines: "> 500"
      methods: "> 20"
      dependencies: "> 10"

    scoring: -10 par god class

  duplication:
    check:
      - Blocs > 30 lignes identiques
      - Fonctions quasi-identiques
      - Copy-paste détecté

    scoring:
      duplicated_block: -5
      duplicated_function: -10

  age_analysis:
    check:
      - Fichiers non modifiés > 2 ans
      - Code legacy identifié
      - Migrations en attente
```

### 7. conformite (Pondération x0.5)

```yaml
analyses:
  coding_standards:
    check:
      - ESLint/Prettier configuré et passant
      - EditorConfig présent
      - Pre-commit hooks configurés

    scoring:
      no_linter: -10
      linter_errors: -1 per 10 errors
      no_formatter: -5

  naming_conventions:
    check:
      - camelCase / PascalCase cohérent
      - Noms significatifs (pas de x, tmp, data)
      - Conventions du framework respectées

    scoring:
      inconsistent: -5
      meaningless_names: -3

  project_structure:
    check:
      - Structure standard du framework
      - Séparation src/tests
      - Configuration externalisée

    scoring:
      non_standard: -10
      mixed_concerns: -5

  git_hygiene:
    check:
      - .gitignore complet
      - Pas de fichiers générés commités
      - Commits atomiques
      - Messages de commit clairs

    scoring:
      missing_gitignore: -5
      generated_files: -10
```

---

## Calcul du Score Global

```yaml
formula:
  weighted_score: |
    (security * 2 + deps * 1.5 + quality + architecture + performance + dette + conformite * 0.5)
    / (2 + 1.5 + 1 + 1 + 1 + 1 + 0.5)

  # = score / 8.5

interpretation:
  90-100: "A - Excellent"
  80-89: "B - Bon"
  70-79: "C - Acceptable"
  60-69: "D - À améliorer"
  0-59: "F - Critique"
```

---

## Workflow d'Exécution

```yaml
workflow:
  1_detect_environment:
    - Framework (Laravel, Django, React, Angular, etc.)
    - Langage principal
    - Package manager
    - Test framework

  2_run_analyses:
    parallel:
      - security_scan
      - deps_audit
      - quality_check

    sequential:  # Nécessite contexte
      - architecture_analysis (via Serena)
      - performance_check
      - dette_evaluation
      - conformite_check

  3_calculate_scores:
    - Score par domaine /100
    - Score global pondéré
    - Comparaison baseline (si fournie)

  4_prioritize_issues:
    matrix:
      high_impact_low_effort: "P1 - Quick Wins"
      high_impact_high_effort: "P2 - Projets majeurs"
      low_impact_low_effort: "P3 - Nice to have"
      low_impact_high_effort: "P4 - À éviter"

  5_generate_report:
    - Résumé exécutif
    - Scores détaillés
    - Top 10 issues prioritaires
    - Estimation effort total
    - Roadmap suggérée
```

---

## Intégration avec les Agents

```yaml
agent_delegation:
  security:
    agent: security-expert
    for: "Analyse approfondie des vulnérabilités OWASP"

  architecture:
    agent: distributed-systems-architect
    for: "Évaluation des patterns et du design"

  performance_db:
    agent: database-optimization-expert
    for: "Analyse des requêtes N+1 et indexation"

  performance_frontend:
    agent: fullstack-ui-architect
    for: "Bundle size, lazy loading, optimisations"

  quality:
    agent: test-automation-strategist
    for: "Couverture de tests et stratégie"
```

---

## Utilisation de Serena/LSP

```yaml
serena_usage:
  architecture:
    - get_symbols_overview: "Compter méthodes, identifier god classes"
    - find_referencing_symbols: "Détecter couplage, dépendances circulaires"
    - search_for_pattern: "Trouver patterns problématiques"

  complexity:
    - get_symbols_overview depth=1: "Lister toutes les fonctions"
    - read_file + analysis: "Calculer complexité cyclomatique"

  duplication:
    - search_for_pattern: "Identifier blocs similaires"
```

---

## Format de Sortie

```markdown
# Audit Report - {project_name}

**Date:** {date}
**Version:** {git_commit_short}
**Baseline:** {baseline_branch} (si fourni)

---

## Score Global

```
╔══════════════════════════════════════════════════════════════╗
║                         {score}/100                          ║
║                      Grade: {grade}                          ║
╠══════════════════════════════════════════════════════════════╣
║  {progress_bar_visual}                                       ║
╚══════════════════════════════════════════════════════════════╝
```

## Scores par Domaine

| Domaine | Score | Poids | Évolution | Status |
|---------|-------|-------|-----------|--------|
| Sécurité | {sec}/100 | x2 | {diff} | {status} |
| Dépendances | {deps}/100 | x1.5 | {diff} | {status} |
| Qualité | {qual}/100 | x1 | {diff} | {status} |
| Architecture | {arch}/100 | x1 | {diff} | {status} |
| Performance | {perf}/100 | x1 | {diff} | {status} |
| Dette Tech. | {dette}/100 | x1 | {diff} | {status} |
| Conformité | {conf}/100 | x0.5 | {diff} | {status} |

```
Sécurité     ████████████████░░░░ 80%
Dépendances  ██████████████░░░░░░ 70%
Qualité      ████████████░░░░░░░░ 60%
Architecture ██████████████████░░ 90%
Performance  ████████░░░░░░░░░░░░ 40%
Dette Tech.  ██████████░░░░░░░░░░ 50%
Conformité   ████████████████░░░░ 80%
```

---

## Top 10 Issues Prioritaires

| # | Priorité | Domaine | Issue | Fichier | Effort |
|---|----------|---------|-------|---------|--------|
| 1 | P1 | {dom} | {issue} | `{file}:{line}` | {effort} |
| 2 | P1 | {dom} | {issue} | `{file}:{line}` | {effort} |
| ... | | | | | |

### Matrice Impact/Effort

```
        Impact Élevé
             │
    P2       │       P1
  (Projets)  │  (Quick Wins)
             │
─────────────┼─────────────
             │
    P4       │       P3
  (Éviter)   │  (Nice to have)
             │
        Impact Faible
      Effort Élevé ←→ Effort Faible
```

---

## Détails par Domaine

### Sécurité ({sec}/100)

**Vulnérabilités trouvées:**
| Sévérité | Count | Exemples |
|----------|-------|----------|
| Critique | {n} | {examples} |
| Haute | {n} | {examples} |
| Moyenne | {n} | {examples} |

**Fichiers concernés:**
- `{file}:{line}` - {issue}
- ...

### Dépendances ({deps}/100)

**CVE détectées:**
| Package | Version | CVE | Sévérité | Fix |
|---------|---------|-----|----------|-----|
| {pkg} | {ver} | {cve} | {sev} | {fix_ver} |

**Dépendances outdated:**
| Package | Actuelle | Dernière | Retard |
|---------|----------|----------|--------|
| {pkg} | {current} | {latest} | {lag} |

### Architecture ({arch}/100)

**Pattern détecté:** {pattern}

**Dépendances circulaires:**
```
{module_a} → {module_b} → {module_c} → {module_a}
```

**God classes:**
| Fichier | Lignes | Méthodes | Dépendances |
|---------|--------|----------|-------------|
| {file} | {lines} | {methods} | {deps} |

### Dette Technique ({dette}/100)

**Marqueurs de dette:**
| Type | Count | Fichiers |
|------|-------|----------|
| TODO | {n} | {files} |
| FIXME | {n} | {files} |
| HACK | {n} | {files} |

**Complexité excessive:**
| Fonction | Fichier | Complexité |
|----------|---------|------------|
| {func} | `{file}:{line}` | {complexity} |

---

## Estimation d'Effort

| Priorité | Issues | Effort Total | Impact Score |
|----------|--------|--------------|--------------|
| P1 (Quick Wins) | {n} | {hours}h | +{points} pts |
| P2 (Projets) | {n} | {hours}h | +{points} pts |
| P3 (Nice to have) | {n} | {hours}h | +{points} pts |

**Projection:**
- Effort P1 seul: {hours}h → Score: {new_score}/100
- Effort P1+P2: {hours}h → Score: {new_score}/100
- Effort total: {hours}h → Score: {new_score}/100

---

## Roadmap Suggérée

### Semaine 1 (Quick Wins)
1. {action_1}
2. {action_2}
3. {action_3}

### Semaine 2-3 (Fondations)
1. {action_1}
2. {action_2}

### Mois 1-2 (Consolidation)
1. {action_1}
2. {action_2}

---

## Commandes Utiles

```bash
# Corriger les vulnérabilités deps
{fix_command}

# Lancer les tests manquants
{test_command}

# Formatter le code
{format_command}
```

---

*Généré par Claude Code Multi-Agents*
*Prochaine recommandation: /audit all . main dans 1 semaine*
```

---

## Historique et Tendances

```yaml
history:
  storage: ".claude/audits/{date}-audit.json"

  track:
    - score_global
    - scores_par_domaine
    - issues_count
    - top_issues

  compare:
    - vs_previous: "Évolution depuis dernier audit"
    - vs_baseline: "Diff avec branche de référence"

  alerts:
    - score_drop: "> 5 points de baisse"
    - new_critical: "Nouvelle issue critique"
    - regression: "Issue corrigée réapparaît"
```
