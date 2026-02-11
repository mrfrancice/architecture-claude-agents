---
name: collaboration-protocols
version: "2.0"
description: |
  Protocoles standardisés pour la collaboration entre agents.
  Définit les formats d'échange, les règles de handoff et les patterns de workflow.
---

# Protocoles de Collaboration Inter-Agents

## 1. Format d'échange standard

### 1.1 Contexte de transfert (Handoff)

Lors du transfert d'une tâche d'un agent à un autre, utiliser ce format :

```markdown
## 🔄 HANDOFF CONTEXT

### Source
- **Agent origine** : [nom-agent]
- **Timestamp** : [ISO 8601]
- **Requête initiale** : [résumé en 1-2 phrases]

### Travail effectué
- **Actions réalisées** :
  1. [Action 1]
  2. [Action 2]
- **Décisions prises** :
  - [Décision 1] : [Justification]
  - [Décision 2] : [Justification]

### Artefacts produits
| Fichier | Type | Description |
|---------|------|-------------|
| [path] | [code/doc/config] | [description] |

### Contraintes identifiées
- [Contrainte 1]
- [Contrainte 2]

### Mission pour l'agent cible
- **Objectif** : [description claire]
- **Critères de succès** :
  - [ ] [Critère 1]
  - [ ] [Critère 2]
- **Livrable attendu** : [format et contenu]

### Contexte additionnel
[Toute information utile non couverte ci-dessus]
```

### 1.2 Rapport de complétion

À la fin d'une tâche, chaque agent produit :

```markdown
## ✅ COMPLETION REPORT

### Résumé
[Description en 2-3 phrases du travail accompli]

### Livrables
| Livrable | Status | Notes |
|----------|--------|-------|
| [Item 1] | ✅ Complet | [notes] |
| [Item 2] | ⚠️ Partiel | [raison] |

### Métriques (si applicable)
- [Métrique 1] : [valeur]
- [Métrique 2] : [valeur]

### Recommandations
1. **Immédiat** : [action suggérée]
2. **Court terme** : [amélioration possible]
3. **Long terme** : [considération architecturale]

### Follow-up suggéré
- [ ] [Agent X] pour [raison]
- [ ] [Agent Y] pour [raison]
```

---

## 2. Patterns de workflow

### 2.1 Workflow séquentiel (Chain)

```
┌─────────┐    ┌─────────┐    ┌─────────┐
│ Agent A │ → │ Agent B │ → │ Agent C │
└─────────┘    └─────────┘    └─────────┘
     │              │              │
     ▼              ▼              ▼
 [Output A]    [Output B]    [Output C]
                   ↑              ↑
              Input: A       Input: A+B
```

**Utilisation** : Tâches avec dépendances claires
**Exemple** : Design → Implementation → Testing

**Protocole** :
1. Agent A complète et produit Handoff
2. Agent B reçoit contexte complet de A
3. Agent B complète et produit Handoff incluant contexte A
4. Agent C reçoit contexte cumulatif

### 2.2 Workflow parallèle (Fan-out/Fan-in)

```
              ┌─────────┐
              │ Agent A │
              └────┬────┘
         ┌─────────┼─────────┐
         ▼         ▼         ▼
    ┌─────────┐┌─────────┐┌─────────┐
    │ Agent B ││ Agent C ││ Agent D │
    └────┬────┘└────┬────┘└────┬────┘
         └─────────┼─────────┘
                   ▼
              ┌─────────┐
              │ Agent E │ (consolidation)
              └─────────┘
```

**Utilisation** : Analyses indépendantes, audits multi-aspects
**Exemple** : Code review (qualité) + Security audit + Performance analysis

**Protocole** :
1. Agent A distribue la tâche avec contexte identique
2. Agents B, C, D travaillent en parallèle
3. Chaque agent produit un Completion Report
4. Agent E consolide les rapports

### 2.3 Workflow itératif (Loop)

```
┌─────────┐    ┌─────────┐
│ Agent A │ ↔ │ Agent B │
└─────────┘    └─────────┘
     │              │
     └──────┬───────┘
            ▼
       [Convergence]
```

**Utilisation** : Raffinement progressif, feedback loops
**Exemple** : Design ↔ Implementation jusqu'à satisfaction

**Protocole** :
1. Agent A produit version initiale
2. Agent B review et fournit feedback
3. Agent A intègre feedback
4. Répéter jusqu'à critères de succès atteints
5. Maximum 3 itérations avant escalade

### 2.4 Workflow conditionnel (Branch)

```
              ┌─────────┐
              │ Agent A │
              └────┬────┘
                   │
            ┌──────┴──────┐
            ▼             ▼
       [Condition]   [Condition]
       Si Frontend   Si Backend
            │             │
            ▼             ▼
       ┌─────────┐   ┌─────────┐
       │ Agent B │   │ Agent C │
       └─────────┘   └─────────┘
```

**Utilisation** : Routage basé sur l'analyse initiale
**Exemple** : Triage de bugs vers le bon spécialiste

**Protocole** :
1. Agent A analyse et détermine le chemin
2. Handoff vers l'agent approprié
3. Documentation de la décision de routage

---

## 3. Règles de collaboration

### 3.1 Règles générales

| Règle | Description |
|-------|-------------|
| **Contexte complet** | Toujours transmettre le contexte cumulatif |
| **Pas d'hypothèses** | Demander clarification plutôt qu'assumer |
| **Décisions documentées** | Justifier chaque décision importante |
| **Respect des domaines** | Ne pas empiéter sur l'expertise d'un autre agent |
| **Escalade rapide** | Signaler les blocages immédiatement |

### 3.2 Règles de communication

```
✅ À FAIRE :
- Utiliser les formats standardisés
- Inclure les fichiers/artefacts référencés
- Spécifier clairement le livrable attendu
- Mentionner les contraintes de temps/ressources

❌ À ÉVITER :
- Transferts sans contexte
- Instructions ambiguës
- Omission d'informations critiques
- Boucles infinies de clarification
```

### 3.3 Règles de qualité

Avant chaque handoff, vérifier :

```markdown
## Checklist pré-handoff

- [ ] Le contexte est-il suffisant pour l'agent cible ?
- [ ] Les artefacts sont-ils accessibles ?
- [ ] Les critères de succès sont-ils mesurables ?
- [ ] Les contraintes sont-elles explicites ?
- [ ] Le livrable attendu est-il clair ?
```

---

## 4. Gestion des conflits

### 4.1 Types de conflits

| Type | Description | Résolution |
|------|-------------|------------|
| **Recommandation** | Agents suggèrent des approches différentes | Escalade vers architect |
| **Domaine** | Chevauchement de responsabilités | Référer à routing-matrix |
| **Priorité** | Désaccord sur l'urgence | Décision utilisateur |
| **Technique** | Incompatibilité de solutions | senior-code-reviewer arbitre |

### 4.2 Protocole de résolution

```
1. IDENTIFICATION
   - Documenter le conflit précisément
   - Identifier les parties concernées

2. ANALYSE
   - Lister les arguments de chaque partie
   - Évaluer l'impact de chaque option

3. ESCALADE (si nécessaire)
   - Transmettre au meta-agent-orchestrator
   - Inclure toutes les options avec pros/cons

4. DÉCISION
   - Documenter la décision finale
   - Expliquer le raisonnement

5. COMMUNICATION
   - Informer tous les agents concernés
   - Mettre à jour les artefacts si nécessaire
```

### 4.3 Format de signalement de conflit

```markdown
## ⚠️ CONFLICT REPORT

### Nature du conflit
[Description]

### Agents impliqués
- [Agent A] : [Position]
- [Agent B] : [Position]

### Options identifiées
| Option | Proposé par | Avantages | Inconvénients |
|--------|-------------|-----------|---------------|
| [A] | Agent A | [...] | [...] |
| [B] | Agent B | [...] | [...] |

### Impact potentiel
- Si Option A : [conséquences]
- Si Option B : [conséquences]

### Recommandation
[Si une préférence existe]

### Escalade requise
- [ ] Oui, vers [agent/utilisateur]
- [ ] Non, résolution locale possible
```

---

## 5. Métriques de collaboration

### 5.1 KPIs à suivre

| Métrique | Cible | Description |
|----------|-------|-------------|
| Temps de handoff | < 1 min | Temps entre complétion et transfert |
| Clarifications requises | < 2 | Nombre de retours pour clarification |
| Taux de réussite workflow | > 90% | Workflows complétés sans escalade |
| Satisfaction contexte | > 4/5 | Qualité perçue du contexte reçu |

### 5.2 Amélioration continue

Après chaque workflow complexe :

```markdown
## 📊 POST-MORTEM

### Ce qui a bien fonctionné
- [Point 1]
- [Point 2]

### Ce qui peut être amélioré
- [Point 1] → [Action suggérée]
- [Point 2] → [Action suggérée]

### Patterns à documenter
- [Nouveau pattern identifié]

### Mise à jour des protocoles requise
- [ ] Oui : [description]
- [ ] Non
```

---

## 6. Intégration avec le Système de Validation

### 6.1 Workflow validé

Tout workflow peut être exécuté en mode validé :

```
┌─────────────────────────────────────────────────────────────────────┐
│                    WORKFLOW AVEC VALIDATION                          │
├─────────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Agent A ──► Validation ──► Score ≥90% ──► Handoff ──► Agent B      │
│                   │                                                  │
│                   └──► Score <90% ──► Feedback Loop ──► Retry       │
│                                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Handoff enrichi avec validation

```markdown
## 🔄 HANDOFF CONTEXT (VALIDÉ)

### Source
- **Agent origine** : [nom-agent]
- **Timestamp** : [ISO 8601]

### Validation Status
- **Score final** : [X]% ✅
- **Itérations** : [N]/3
- **Issues résolues** : [N]
- **Warnings restants** : [liste]

### Travail effectué
[...]

### Critères validés
| Critère | Status |
|---------|--------|
| hasCode | ✅ |
| hasTests | ✅ |
| noErrors | ✅ |
```

### 6.3 Référence aux documents

| Document | Contenu |
|----------|---------|
| `meta-agent-orchestrator.md` | Orchestration et coordination |
| `validation-system.md` | Critères, seuils et boucle de feedback |
| `routing-matrix.md` | Routage vers les agents |

---

## 7. Templates rapides

### 7.1 Handoff simple

```markdown
**De** : [agent] → **Vers** : [agent]
**Tâche** : [description courte]
**Fichiers** : [liste]
**Action requise** : [description]
```

### 7.2 Demande de review

```markdown
**Agent** : [nom]
**Type** : Review demandée
**Scope** : [fichiers/fonctionnalité]
**Focus** : [qualité/sécurité/performance]
**Deadline** : [si applicable]
```

### 7.3 Signalement de blocage

```markdown
**Agent** : [nom]
**Blocage** : [description]
**Impact** : [conséquences si non résolu]
**Aide requise** : [type d'aide/agent suggéré]
**Urgence** : [haute/moyenne/basse]
```