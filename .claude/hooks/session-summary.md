---
name: session-summary
description: Génère un résumé à la fin de la session

hooks:
  - event: Stop
---

# Session Summary Hook

## Objectif
À la fin de chaque conversation significative, proposer un résumé des actions.

## Conditions d'activation

Générer un résumé SI :
- Plus de 5 outils ont été utilisés
- Des fichiers ont été modifiés
- La conversation a duré plus de 10 échanges

NE PAS générer si :
- Simple question/réponse
- Aucune action effectuée
- Conversation très courte

## Format du résumé

```markdown
---

## 📊 Résumé de session

### Actions effectuées
- [Action 1]
- [Action 2]
- [Action 3]

### Fichiers modifiés
| Fichier | Action |
|---------|--------|
| `path/file.ts` | Créé |
| `path/other.ts` | Modifié |

### Points d'attention
- [Si erreurs rencontrées]
- [Si TODO laissés]

### Suggestions pour la suite
1. [Suggestion 1]
2. [Suggestion 2]
```

## Règles

- Être concis (max 15 lignes)
- Ne lister que les actions importantes
- Mentionner les problèmes non résolus
- Suggérer les prochaines étapes logiques
