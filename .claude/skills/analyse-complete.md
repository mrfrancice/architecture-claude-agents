---
name: analyse-complete
description: "Analyse exhaustive d'un projet : acquis, insuffisances, corrections, améliorations avec plan d'action priorisé"

arguments:
  - name: target
    description: "Chemin du projet à analyser"
    required: false
    default: "."
  - name: focus
    description: "Focus particulier: all, backend, frontend, security, performance, quality"
    required: false
    default: "all"
  - name: depth
    description: "Profondeur: quick (5min), standard (15min), deep (30min+)"
    required: false
    default: "standard"
  - name: output
    description: "Format de sortie: report, json, actionable"
    required: false
    default: "report"

examples:
  - prompt: "/analyse-complete"
    description: "Analyse complète du projet courant"
  - prompt: "/analyse-complete ./mon-projet"
    description: "Analyse d'un projet spécifique"
  - prompt: "/analyse-complete . security deep"
    description: "Analyse approfondie focus sécurité"
  - prompt: "/analyse-complete . frontend quick"
    description: "Analyse rapide du frontend"
---

# Analyse Complète de Projet

## Mission

Effectuer une analyse exhaustive et structurée d'un projet pour identifier :
- **ACQUIS** : Bonnes pratiques, points forts, code de qualité
- **INSUFFISANCES** : Manques, faiblesses, zones à risque
- **CORRECTIONS** : Bugs, vulnérabilités, erreurs à corriger urgemment
- **AMÉLIORATIONS** : Évolutions recommandées, optimisations possibles

Produire un **plan d'action priorisé** avec matrice Impact/Effort.

---

## Workflow d'Analyse en 5 Phases

### Phase 1 : Découverte (OBLIGATOIRE)

```yaml
decouverte:
  structure:
    - Lister l'arborescence du projet (2 niveaux)
    - Identifier les fichiers clés (package.json, composer.json, etc.)
    - Détecter le type de projet (web, api, cli, library)

  stack_technique:
    - Langages principaux
    - Frameworks utilisés
    - Base de données
    - Services externes

  architecture:
    - Pattern (MVC, Clean, Hexagonal, etc.)
    - Monolithe vs Microservices
    - Points d'entrée

  outils:
    - Serena: get_symbols_overview pour vue globale
    - list_dir récursif
    - Lecture des fichiers de config
```

### Phase 2 : Audits Automatiques

```yaml
audits:
  global:
    command: "/audit all"
    produit: Score global /100 + scores par domaine

  securite:
    command: "/audit security"
    agent: security-expert
    weight: x2

  architecture:
    command: "/audit architecture"
    agent: distributed-systems-architect ou fullstack-ui-architect

  performance:
    command: "/audit performance"
    agent: database-optimization-expert

  qualite:
    command: "/audit dette"
    analyse: complexité, duplication, god classes

  tests:
    command: "/generate-tests --dry-run"
    agent: test-automation-strategist

  documentation:
    agent: technical-writer
```

### Phase 3 : Analyses Spécialisées par Focus

```yaml
focus_all:
  description: Tous les domaines analysés
  agents: Tous

focus_backend:
  priorite: [API, BDD, Sécurité, Performance serveur]
  agents: [distributed-systems-architect, database-optimization-expert, security-expert]

focus_frontend:
  priorite: [Composants, State, Bundle, Accessibilité, UX]
  agents: [fullstack-ui-architect, ux-design-strategist, web-tester]

focus_security:
  priorite: [OWASP Top 10, Secrets, Auth, Validation, CVE]
  agents: [security-expert]
  commands: ["/security-scan deep"]

focus_performance:
  priorite: [Queries N+1, Response times, Bundle size, Caching]
  agents: [database-optimization-expert, distributed-systems-architect]

focus_quality:
  priorite: [Duplication, Complexité, Tests, Documentation]
  agents: [test-automation-strategist, technical-writer]
```

### Phase 4 : Classification des Findings

```yaml
acquis:
  format: "✅ [Domaine] Description"
  criteres:
    - Bonnes pratiques respectées
    - Patterns bien implémentés
    - Code maintenable
    - Tests pertinents
    - Documentation claire

insuffisances:
  format: "❌ [Domaine] Description"
  criteres:
    - Fonctionnalités manquantes
    - Couverture tests insuffisante
    - Documentation absente
    - Dette technique

corrections:
  format: "🔧 [PRIORITÉ] Description - Fichier:ligne - Action"
  priorites:
    CRITIQUE: Sécurité, data loss, crash prod
    HAUTE: Bugs bloquants, perf critique
    MOYENNE: Bugs mineurs, dette importante
    BASSE: Code style

ameliorations:
  format: "🚀 [Impact/Effort] Description"
  criteres:
    - Optimisations possibles
    - Refactoring recommandé
    - Modernisation stack
```

### Phase 5 : Plan d'Action

```yaml
matrice_priorisation:
  DO_FIRST: Impact Fort + Effort Faible
  SCHEDULE: Impact Fort + Effort Important
  QUICK_WINS: Impact Faible + Effort Faible
  DEFER: Impact Faible + Effort Important

timeline:
  court_terme: "1-2 semaines - Corrections CRITIQUES + Quick wins"
  moyen_terme: "1-3 mois - Corrections MOYENNES + Améliorations"
  long_terme: "3-6 mois - Évolutions majeures + Dette profonde"
```

---

## Profondeur d'Analyse

### Quick (5 minutes)
- Structure projet
- /audit all (scores)
- Top 5 problèmes critiques
- Actions immédiates

### Standard (15 minutes)
- Découverte complète
- Tous les audits
- Agents pertinents
- Rapport complet + plan d'action

### Deep (30+ minutes)
- Tout de Standard
- Analyse fichier par fichier zones critiques
- Tests E2E si applicable
- Comparaison best practices framework
- Exemples de code corrigé

---

## Format de Sortie : Report

```markdown
# 📊 RAPPORT D'ANALYSE COMPLÈTE

## Informations Projet
| Champ | Valeur |
|-------|--------|
| Nom | [nom] |
| Stack | [stack] |
| Type | [type] |

## Score Global : XX/100

### Scores par Domaine
| Domaine | Score | Statut |
|---------|-------|--------|
| 🔒 Sécurité | /100 | 🟢🟡🔴 |
| 🏗️ Architecture | /100 | 🟢🟡🔴 |
| ⚡ Performance | /100 | 🟢🟡🔴 |
| 📝 Qualité Code | /100 | 🟢🟡🔴 |
| 🧪 Tests | /100 | 🟢🟡🔴 |
| 📚 Documentation | /100 | 🟢🟡🔴 |

**Légende** : 🟢 ≥80 | 🟡 50-79 | 🔴 <50

---

## ✅ ACQUIS (Points Forts)
- ✅ [acquis 1]
- ✅ [acquis 2]

## ❌ INSUFFISANCES (Points Faibles)
- ❌ [insuffisance 1]
- ❌ [insuffisance 2]

## 🔧 CORRECTIONS URGENTES

### CRITIQUE 🔴
| Problème | Fichier | Action |
|----------|---------|--------|
| [desc] | [file:line] | [action] |

### HAUTE 🟠
| Problème | Fichier | Action |
|----------|---------|--------|

### MOYENNE 🟡
| Problème | Fichier | Action |
|----------|---------|--------|

## 🚀 AMÉLIORATIONS

### Matrice Impact/Effort
| Impact↓ Effort→ | Faible | Important |
|-----------------|--------|-----------|
| **Fort** | ⭐ DO FIRST | 📅 SCHEDULE |
| **Faible** | 🎯 QUICK WINS | ⏸️ DEFER |

## 📅 PLAN D'ACTION

### Court Terme (1-2 semaines)
- [ ] [Action CRITIQUE]
- [ ] [Quick Win]

### Moyen Terme (1-3 mois)
- [ ] [Amélioration]

### Long Terme (3-6 mois)
- [ ] [Évolution majeure]

## 📈 Métriques
| Métrique | Valeur | Cible |
|----------|--------|-------|
| Couverture tests | X% | 80% |
| Vulnérabilités | X | 0 |
| TODO/FIXME | X | 0 |
```

---

## Exemples

```bash
/analyse-complete                           # Analyse standard projet courant
/analyse-complete ./mon-projet              # Projet spécifique
/analyse-complete . security deep           # Sécurité approfondie
/analyse-complete . frontend quick          # Frontend rapide
/analyse-complete . all deep actionable     # Complet avec actions uniquement
```

---

## Anti-Patterns

- ❌ Analyser sans découvrir la structure d'abord
- ❌ Lister des problèmes sans solutions
- ❌ Ne pas prioriser les actions
- ❌ Oublier de mentionner les acquis
- ❌ Proposer des breaking changes sans justification
