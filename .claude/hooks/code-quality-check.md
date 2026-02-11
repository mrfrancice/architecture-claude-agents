---
name: code-quality-check
description: Vérifie la qualité du code après écriture

hooks:
  - event: PostToolUse
    match_tools: ["Write", "Edit"]
---

# Code Quality Check Hook

## Objectif
Après chaque Write/Edit sur du code, vérifier rapidement la qualité.

## Fichiers concernés

Extensions à analyser :
- `.ts`, `.tsx`, `.js`, `.jsx`
- `.py`
- `.java`, `.kt`
- `.go`
- `.rs`

## Vérifications rapides

### Erreurs (signaler immédiatement)

| Pattern | Message |
|---------|---------|
| `console.log` (en production) | "console.log détecté - retirer avant commit" |
| `// TODO` sans context | "TODO sans description" |
| `any` en TypeScript | "Type 'any' détecté - typer explicitement" |
| `password = "..."` hardcodé | "Secret hardcodé détecté!" |
| `eval(` | "eval() est dangereux" |

### Avertissements (mentionner)

| Pattern | Message |
|---------|---------|
| Fonction > 50 lignes | "Fonction longue - considérer extraction" |
| Plus de 3 niveaux d'indentation | "Complexité élevée" |
| Catch vide `catch {}` | "Catch vide - gérer l'erreur" |
| `!important` en CSS | "!important détecté" |

## Format de sortie

Si problèmes détectés, ajouter après le résultat de l'outil :

```
📋 Quality Check:
- ⚠️ [Issue 1]
- ⚠️ [Issue 2]
```

Si aucun problème :
Ne rien ajouter (silencieux si OK).

## Exceptions

Ne pas vérifier :
- Fichiers de test (`*.test.ts`, `*.spec.js`)
- Fichiers de config (`*.config.js`)
- Fichiers générés (`*.generated.ts`)
