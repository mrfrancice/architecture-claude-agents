---
name: quick-review
description: "Review rapide de code ou de PR"

arguments:
  - name: target
    description: "Fichier, dossier, ou numéro de PR"
    required: true
  - name: focus
    description: "Focus (all, security, perf, style)"
    required: false
    default: "all"

examples:
  - prompt: "/quick-review src/api/"
    description: "Review du dossier api"
  - prompt: "/quick-review #123"
    description: "Review de la PR #123"
  - prompt: "/quick-review file.ts security"
    description: "Review sécurité de file.ts"
---

# Quick Code Review

## Instructions

Effectuer une review rapide et actionnable du code.

## Étapes

### 1. Identifier la cible
- Si numéro PR (#123) → `gh pr view 123 --json files,diff`
- Si fichier/dossier → lire les fichiers

### 2. Analyse selon le focus

#### Focus: all
Vérifier tout ci-dessous.

#### Focus: security
- Injections (SQL, XSS, Command)
- Secrets hardcodés
- Validation des inputs
- Authentification/Autorisation

#### Focus: perf
- N+1 queries
- Loops inefficaces
- Mémoire (fuites potentielles)
- Caching manquant

#### Focus: style
- Conventions de nommage
- Complexité des fonctions
- DRY violations
- Documentation manquante

### 3. Classification des issues

| Sévérité | Critère | Action |
|----------|---------|--------|
| 🔴 Critical | Sécurité, bug bloquant | Doit être corrigé |
| 🟠 Major | Bug, perf issue | Devrait être corrigé |
| 🟡 Minor | Style, amélioration | Peut être corrigé |
| 💡 Suggestion | Nice to have | Optionnel |

## Format de sortie

```markdown
# 📝 Code Review: `[target]`

## Résumé
| Sévérité | Count |
|----------|-------|
| 🔴 Critical | X |
| 🟠 Major | X |
| 🟡 Minor | X |
| 💡 Suggestions | X |

## Issues

### 🔴 Critical

#### [Titre]
**Fichier:** `path/file.ts:42`
**Problème:** [Description]
**Solution:**
\`\`\`typescript
// Code suggéré
\`\`\`

### 🟠 Major
[...]

### 🟡 Minor
[...]

### 💡 Suggestions
[...]

## Points positifs ✅
- [Ce qui est bien fait]
- [Bonnes pratiques observées]

## Verdict
[ ] ✅ Approuvé
[ ] ⚠️ Approuvé avec réserves
[ ] ❌ Changements requis
```
