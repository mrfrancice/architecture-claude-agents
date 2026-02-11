---
name: memory-system
version: "1.0"
description: |
  Documentation du système de mémoires persistantes.
  Permet aux agents de conserver et partager des connaissances entre sessions.

type: system-documentation
integrates_with:
  - meta-agent-orchestrator
  - all-agents
---

# Système de Mémoires Persistantes

## Vue d'Ensemble

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         MEMORY SYSTEM                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐               │
│  │   SESSION   │     │   AGENT     │     │   PROJECT   │               │
│  │   CONTEXT   │     │  LEARNINGS  │     │   CONTEXT   │               │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘               │
│         │                   │                   │                        │
│         └───────────────────┼───────────────────┘                        │
│                             ▼                                            │
│                    ┌─────────────────┐                                  │
│                    │    MEMORIES/    │                                  │
│                    │   (Persistent)  │                                  │
│                    └────────┬────────┘                                  │
│                             │                                            │
│         ┌───────────────────┼───────────────────┐                        │
│         ▼                   ▼                   ▼                        │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐               │
│  │ conventions │     │ architecture│     │  workflow   │               │
│  │   -code.md  │     │ -projet.md  │     │ -equipe.md  │               │
│  └─────────────┘     └─────────────┘     └─────────────┘               │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 1. Objectifs du Système

### 1.1 Persistance des Connaissances

```yaml
persistence:
  what: "Informations qui survivent aux sessions"
  why:
    - Éviter de redemander les mêmes infos
    - Maintenir la cohérence des décisions
    - Accélérer l'onboarding sur un projet
    - Capitaliser sur les apprentissages

  types:
    project_context:
      - Architecture du projet
      - Stack technique
      - Conventions de code
      - Patterns utilisés

    team_context:
      - Workflow de l'équipe
      - Processus de review
      - Standards de qualité
      - Contacts et responsabilités

    security_context:
      - Règles de sécurité
      - Secrets à ne pas exposer
      - Compliance requirements

    historical:
      - Décisions importantes prises
      - Erreurs à ne pas répéter
      - Optimisations réussies
```

### 1.2 Partage Inter-Agents

```yaml
sharing:
  mechanism: "Fichiers markdown dans .claude/memories/"

  read_access:
    who: "Tous les agents"
    when: "Début de tâche si pertinent"
    how: "read_memory(filename)"

  write_access:
    who: "Agents autorisés ou orchestrateur"
    when: "Nouvelle connaissance importante"
    how: "write_memory(filename, content)"

  update_access:
    who: "Orchestrateur ou utilisateur"
    when: "Information obsolète ou incorrecte"
    how: "edit_memory(filename, changes)"
```

---

## 2. Structure des Mémoires

### 2.1 Emplacement

```
.claude/
└── memories/
    ├── README.md              # Documentation du dossier
    ├── conventions-code.md    # Conventions de nommage, style
    ├── architecture-projet.md # Architecture et patterns
    ├── stack-technique.md     # Technologies et versions
    ├── regles-securite.md     # Règles de sécurité
    ├── workflow-equipe.md     # Processus de l'équipe
    └── [custom-memories].md   # Mémoires spécifiques projet
```

### 2.2 Format Standard

Chaque fichier de mémoire suit ce format :

```markdown
# [Titre de la Mémoire]

## Métadonnées
- **Créé**: [date]
- **Dernière mise à jour**: [date]
- **Auteur**: [agent ou utilisateur]
- **Pertinence**: [tous | agent-specific | project-specific]

## Contenu

### Section 1
[Contenu structuré...]

### Section 2
[Contenu structuré...]

## Tags
#tag1 #tag2 #tag3

## Historique des Modifications
| Date | Modification | Par |
|------|--------------|-----|
| [date] | [description] | [auteur] |
```

---

## 3. Types de Mémoires

### 3.1 Conventions de Code

```yaml
file: conventions-code.md
purpose: "Standards de code du projet"

content:
  naming:
    variables: "camelCase"
    functions: "camelCase"
    classes: "PascalCase"
    constants: "UPPER_SNAKE_CASE"
    files: "kebab-case.ts"

  formatting:
    indentation: "2 spaces"
    line_length: 100
    quotes: "single"
    semicolons: true

  patterns:
    - "Prefer async/await over callbacks"
    - "Use functional components in React"
    - "DTOs for API boundaries"

  anti_patterns:
    - "No console.log in production"
    - "No any type in TypeScript"
    - "No magic numbers"

used_by:
  - fullstack-ui-architect
  - senior-code-reviewer
  - test-automation-strategist
```

### 3.2 Architecture Projet

```yaml
file: architecture-projet.md
purpose: "Structure et patterns architecturaux"

content:
  type: "Monolith | Microservices | Modular Monolith"

  layers:
    - presentation: "React/Next.js"
    - application: "Services, Use Cases"
    - domain: "Entities, Value Objects"
    - infrastructure: "Repositories, External APIs"

  patterns:
    - "Clean Architecture"
    - "CQRS for commands"
    - "Repository pattern"
    - "Dependency Injection"

  directories:
    src/:
      - components/: "UI components"
      - services/: "Business logic"
      - repositories/: "Data access"
      - utils/: "Shared utilities"

used_by:
  - distributed-systems-architect
  - fullstack-ui-architect
  - meta-agent-orchestrator
```

### 3.3 Stack Technique

```yaml
file: stack-technique.md
purpose: "Technologies et versions utilisées"

content:
  frontend:
    framework: "React 18.x"
    state: "Redux Toolkit"
    styling: "Tailwind CSS"
    build: "Vite"

  backend:
    runtime: "Node.js 20.x"
    framework: "NestJS 10.x"
    database: "PostgreSQL 15"
    orm: "Prisma"

  devops:
    ci: "GitHub Actions"
    deploy: "Docker + Kubernetes"
    monitoring: "Prometheus + Grafana"

  testing:
    unit: "Jest"
    e2e: "Playwright"
    api: "Supertest"

used_by:
  - all agents for context
```

### 3.4 Règles de Sécurité

```yaml
file: regles-securite.md
purpose: "Contraintes de sécurité spécifiques"

content:
  secrets:
    never_commit:
      - ".env files with real values"
      - "API keys"
      - "Database credentials"
      - "Private keys"

    use_instead:
      - "Environment variables"
      - "Secret managers (Vault, AWS Secrets)"

  validation:
    - "Always validate user input"
    - "Sanitize before database"
    - "Escape before render"

  authentication:
    method: "JWT with refresh tokens"
    session_duration: "15 minutes"
    refresh_duration: "7 days"

  authorization:
    model: "RBAC"
    enforcement: "Middleware + Guards"

  compliance:
    - "GDPR for EU users"
    - "Data encryption at rest"

used_by:
  - security-expert (primary)
  - all agents (awareness)
```

### 3.5 Workflow Équipe

```yaml
file: workflow-equipe.md
purpose: "Processus et standards de l'équipe"

content:
  git:
    branching: "GitFlow"
    commit_format: "Conventional Commits"
    pr_template: true
    reviewers_required: 2

  code_review:
    checklist:
      - "Tests present"
      - "No console.log"
      - "Types correct"
      - "Documentation updated"

    turnaround: "24h max"

  deployment:
    environments:
      - dev: "auto on merge to develop"
      - staging: "auto on merge to main"
      - prod: "manual approval required"

  communication:
    standup: "9h00 daily"
    channels:
      bugs: "#bugs"
      reviews: "#code-review"

used_by:
  - meta-agent-orchestrator
  - devops-sre
  - technical-writer
```

---

## 4. Opérations sur les Mémoires

### 4.1 Lecture

```yaml
read_memory:
  when:
    - "Début d'une tâche sur un projet"
    - "Besoin de contexte spécifique"
    - "Validation de conventions"

  how:
    agent: "Utilise read_memory(filename)"
    orchestrator: "Injecte contexte pertinent"

  best_practices:
    - "Lire uniquement les mémoires pertinentes"
    - "Ne pas relire dans la même conversation"
    - "Utiliser list_memories pour découvrir"

  example:
    trigger: "Agent commence à coder"
    reads:
      - conventions-code.md
      - architecture-projet.md
```

### 4.2 Écriture

```yaml
write_memory:
  when:
    - "Nouvelle connaissance projet importante"
    - "Décision architecturale prise"
    - "Pattern découvert à réutiliser"
    - "Utilisateur demande de mémoriser"

  authorization:
    - meta-agent-orchestrator: "full access"
    - specialized_agents: "avec validation"
    - user: "toujours autorisé"

  format:
    - "Markdown structuré"
    - "Sections claires"
    - "Tags pour recherche"

  validation:
    - "Information vérifiable"
    - "Non redondante"
    - "Utile pour futures sessions"
```

### 4.3 Mise à Jour

```yaml
edit_memory:
  when:
    - "Information obsolète"
    - "Correction d'erreur"
    - "Enrichissement"

  triggers:
    - "Utilisateur signale erreur"
    - "Agent détecte incohérence"
    - "Changement de stack/architecture"

  process:
    1: "Identifier la mémoire"
    2: "Lire le contenu actuel"
    3: "Appliquer les modifications"
    4: "Mettre à jour l'historique"
    5: "Notifier si critique"
```

### 4.4 Suppression

```yaml
delete_memory:
  when:
    - "Information plus pertinente"
    - "Projet terminé"
    - "Utilisateur demande explicitement"

  restrictions:
    - "Requiert confirmation utilisateur"
    - "Archiver avant suppression"
    - "Loguer la suppression"

  command: "delete_memory(filename)"
```

---

## 5. Workflow d'Utilisation

### 5.1 Onboarding Projet

```yaml
onboarding_flow:
  step_1:
    trigger: "Premier accès au projet"
    action: "list_memories()"
    result: "Découvrir les mémoires existantes"

  step_2:
    action: "read relevant memories"
    priorite:
      - stack-technique.md
      - architecture-projet.md
      - conventions-code.md

  step_3:
    action: "Intégrer contexte dans travail"
    result: "Agent adapté au projet"
```

### 5.2 Création de Nouvelles Mémoires

```yaml
creation_flow:
  trigger: "Information importante à persister"

  step_1:
    action: "Identifier le type de mémoire"
    categories:
      - project_context
      - team_process
      - technical_decision
      - security_rule

  step_2:
    action: "Vérifier si mémoire similaire existe"
    if_exists: "Enrichir plutôt que dupliquer"

  step_3:
    action: "Créer avec format standard"
    validate:
      - "Structure correcte"
      - "Tags présents"
      - "Non redondant"

  step_4:
    action: "Notifier utilisateur"
    message: "Nouvelle mémoire créée: {filename}"
```

### 5.3 Maintenance des Mémoires

```yaml
maintenance:
  periodic_review:
    frequency: "Mensuel ou sur demande"
    actions:
      - "Vérifier pertinence"
      - "Mettre à jour versions"
      - "Supprimer obsolètes"

  triggered_review:
    triggers:
      - "Changement majeur stack"
      - "Nouveau membre équipe"
      - "Erreurs répétées"

  cleanup:
    - "Archiver mémoires > 6 mois sans lecture"
    - "Fusionner mémoires redondantes"
    - "Mettre à jour métadonnées"
```

---

## 6. Intégration avec les Agents

### 6.1 Injection de Contexte

```yaml
context_injection:
  orchestrator_role:
    - "Analyser la tâche demandée"
    - "Identifier mémoires pertinentes"
    - "Injecter dans le prompt agent"

  format:
    prefix: "## Contexte Projet (Mémoires)"
    content: "Résumé des mémoires pertinentes"
    suffix: "Respecter ces conventions dans votre travail"

  example:
    task: "Créer un nouveau composant React"
    injected:
      - conventions-code.md → naming, patterns
      - architecture-projet.md → component structure
      - stack-technique.md → React version, styling
```

### 6.2 Apprentissage des Agents

```yaml
agent_learning:
  capture:
    what:
      - "Erreurs corrigées et solutions"
      - "Patterns qui ont bien fonctionné"
      - "Optimisations découvertes"

    when:
      - "Fin de tâche réussie"
      - "Résolution de bug complexe"
      - "Validation score > 95%"

  persist:
    format: "Ajout à mémoire existante ou nouvelle"
    validation: "Orchestrateur valide avant persist"

  share:
    scope: "Tous les agents du même domaine"
    mechanism: "Lecture au prochain onboarding"
```

---

## 7. Commandes Utilisateur

```yaml
memory_commands:
  list:
    command: "/memories list"
    description: "Liste toutes les mémoires disponibles"

  read:
    command: "/memories read {filename}"
    description: "Affiche le contenu d'une mémoire"

  create:
    command: "/memories create {filename}"
    description: "Crée une nouvelle mémoire (interactif)"

  update:
    command: "/memories update {filename}"
    description: "Met à jour une mémoire existante"

  delete:
    command: "/memories delete {filename}"
    description: "Supprime une mémoire (avec confirmation)"

  search:
    command: "/memories search {query}"
    description: "Recherche dans les mémoires par mot-clé"

  export:
    command: "/memories export"
    description: "Exporte toutes les mémoires en archive"
```

---

## 8. Bonnes Pratiques

### 8.1 Pour les Utilisateurs

```yaml
user_best_practices:
  do:
    - "Créer des mémoires pour les décisions importantes"
    - "Mettre à jour quand le contexte change"
    - "Utiliser des tags pour faciliter la recherche"
    - "Structurer clairement avec sections"

  dont:
    - "Stocker des secrets dans les mémoires"
    - "Créer des mémoires trop granulaires"
    - "Oublier de mettre à jour les versions"
    - "Dupliquer l'information"
```

### 8.2 Pour les Agents

```yaml
agent_best_practices:
  reading:
    - "Lire au début de session si pertinent"
    - "Ne pas relire ce qui a été lu"
    - "Inférer pertinence du nom de fichier"

  writing:
    - "Demander avant de créer une mémoire"
    - "Valider avec orchestrateur"
    - "Respecter le format standard"

  updating:
    - "Signaler les incohérences détectées"
    - "Proposer des mises à jour"
    - "Loguer les changements"
```

---

## 9. Sécurité

```yaml
memory_security:
  access_control:
    - "Mémoires lisibles par tous agents"
    - "Écriture contrôlée"
    - "Suppression requiert confirmation"

  content_restrictions:
    never_store:
      - "Mots de passe"
      - "Clés API"
      - "Tokens d'accès"
      - "Données personnelles (PII)"

    store_references:
      - "Nom de la variable d'environnement"
      - "Chemin vers secret manager"
      - "Documentation du secret"

  audit:
    - "Log toutes les opérations d'écriture"
    - "Tracer les suppressions"
    - "Alerter sur modifications sensibles"
```

---

## 10. Exemples de Mémoires

### 10.1 Mémoire de Décision

```markdown
# Décision: Migration vers PostgreSQL 15

## Métadonnées
- **Créé**: 2024-01-10
- **Auteur**: distributed-systems-architect
- **Pertinence**: project-specific

## Contexte
Migration depuis MySQL 8 vers PostgreSQL 15 pour le projet X.

## Décision
PostgreSQL 15 choisi pour :
- Meilleur support JSON
- Extensions PostGIS
- Performance sur requêtes analytiques

## Implications
- [ ] Réécrire les requêtes SQL spécifiques MySQL
- [ ] Configurer réplication PostgreSQL
- [ ] Mettre à jour ORM (Prisma)

## Tags
#database #migration #postgresql

## Historique
| Date | Modification | Par |
|------|--------------|-----|
| 2024-01-10 | Création | distributed-systems-architect |
```

### 10.2 Mémoire de Pattern

```markdown
# Pattern: Error Handling API

## Métadonnées
- **Créé**: 2024-01-08
- **Auteur**: fullstack-ui-architect
- **Pertinence**: tous

## Pattern

Toutes les erreurs API suivent ce format :

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "User-friendly message",
    "details": [
      {"field": "email", "message": "Invalid format"}
    ],
    "requestId": "uuid"
  }
}
```

## Codes d'Erreur Standard
| Code | HTTP Status | Description |
|------|-------------|-------------|
| VALIDATION_ERROR | 400 | Input invalide |
| UNAUTHORIZED | 401 | Non authentifié |
| FORBIDDEN | 403 | Non autorisé |
| NOT_FOUND | 404 | Ressource absente |
| INTERNAL_ERROR | 500 | Erreur serveur |

## Tags
#api #error-handling #pattern
```
