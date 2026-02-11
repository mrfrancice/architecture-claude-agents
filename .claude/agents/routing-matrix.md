---
name: routing-matrix
version: "2.0"
description: |
  Matrice de décision pour le routage des requêtes vers les agents appropriés.
  Utilisée par le Meta-Agent Orchestrator.
---

# Matrice de Routage des Agents

## Vue d'ensemble des agents disponibles

| ID | Agent | Domaine | Niveau | Modèle |
|----|-------|---------|--------|--------|
| 00 | **meta-agent-orchestrator** | **orchestration** | **architect** | **opus** |
| 01 | ui-engineer | frontend | senior | opus |
| 02 | fullstack-ui-architect | frontend | architect | opus |
| 03 | ux-design-strategist | frontend | senior | opus |
| 04 | distributed-systems-architect | backend | architect | opus |
| 05 | database-optimization-expert | backend | senior | opus |
| 06 | senior-code-reviewer | quality | senior | opus |
| 07 | test-automation-strategist | quality | senior | opus |
| 08 | security-expert | quality | senior | opus |
| 09 | devops-sre | operations | senior | opus |
| 10 | prompt-engineering-expert | cross-cutting | expert | opus |
| 11 | technical-writer | cross-cutting | senior | sonnet |

> **Note**: L'agent `meta-agent-orchestrator` (ID 00) coordonne tous les workflows et gère la validation via le système défini dans `validation-system.md`.

---

## Routage par mots-clés

### Frontend (Domaine 01-03)

| Mots-clés | Agent principal | Secondaire | Escalade |
|-----------|-----------------|------------|----------|
| component, widget, button, form, modal | ui-engineer | - | fullstack-ui-architect |
| CSS, Tailwind, styled-components, SCSS | ui-engineer | - | - |
| responsive, mobile-first, breakpoint | ui-engineer | ux-design-strategist | - |
| React, hooks, useState, useEffect | ui-engineer | fullstack-ui-architect | - |
| Vue, Composition API, Pinia | ui-engineer | fullstack-ui-architect | - |
| Angular, NgRx, RxJS, signals | fullstack-ui-architect | ui-engineer | - |
| Svelte, SvelteKit | ui-engineer | fullstack-ui-architect | - |
| Next.js, Nuxt, SSR, SSG | fullstack-ui-architect | ui-engineer | distributed-systems |
| state management, Redux, Zustand | fullstack-ui-architect | ui-engineer | - |
| design system, tokens, atomic | ux-design-strategist | ui-engineer | - |
| wireframe, mockup, prototype | ux-design-strategist | - | - |
| user research, persona, journey map | ux-design-strategist | - | - |
| accessibility, WCAG, a11y, ARIA | ui-engineer | ux-design-strategist | - |
| animation, transition, Framer Motion | ui-engineer | - | - |

### Backend (Domaine 04-05)

| Mots-clés | Agent principal | Secondaire | Escalade |
|-----------|-----------------|------------|----------|
| microservices, service mesh, Istio | distributed-systems-architect | - | - |
| Kafka, RabbitMQ, message queue, event | distributed-systems-architect | - | - |
| CQRS, event sourcing, saga pattern | distributed-systems-architect | - | - |
| API gateway, load balancer | distributed-systems-architect | devops-sre | - |
| gRPC, GraphQL federation | distributed-systems-architect | - | - |
| SQL, PostgreSQL, MySQL, query | database-optimization-expert | - | distributed-systems |
| MongoDB, DynamoDB, NoSQL | database-optimization-expert | distributed-systems | - |
| Redis, cache, session | database-optimization-expert | distributed-systems | - |
| index, explain, slow query | database-optimization-expert | - | - |
| schema, migration, normalization | database-optimization-expert | - | - |
| sharding, replication, partition | database-optimization-expert | distributed-systems | - |
| transaction, ACID, consistency | database-optimization-expert | distributed-systems | - |
| Laravel, Django, Rails, backend | fullstack-ui-architect | distributed-systems | - |
| REST API, endpoint, controller | fullstack-ui-architect | distributed-systems | - |

### Quality (Domaine 06-08)

| Mots-clés | Agent principal | Secondaire | Escalade |
|-----------|-----------------|------------|----------|
| code review, PR, pull request | senior-code-reviewer | - | - |
| refactor, clean code, SOLID | senior-code-reviewer | - | - |
| architecture review, design review | senior-code-reviewer | distributed-systems | - |
| technical debt, legacy code | senior-code-reviewer | - | - |
| test, unit test, integration test | test-automation-strategist | - | - |
| TDD, BDD, coverage | test-automation-strategist | - | - |
| Jest, Cypress, Playwright, pytest | test-automation-strategist | - | - |
| flaky test, CI failure | test-automation-strategist | devops-sre | - |
| e2e, end-to-end, automation | test-automation-strategist | - | - |
| mock, stub, fixture | test-automation-strategist | - | - |
| security, vulnerability, CVE | security-expert | senior-code-reviewer | - |
| OWASP, XSS, SQL injection, CSRF | security-expert | - | - |
| authentication, authorization, OAuth | security-expert | distributed-systems | - |
| penetration test, pentest, audit | security-expert | - | - |
| secrets, encryption, TLS | security-expert | devops-sre | - |

### Operations (Domaine 09)

| Mots-clés | Agent principal | Secondaire | Escalade |
|-----------|-----------------|------------|----------|
| CI/CD, pipeline, GitHub Actions | devops-sre | test-automation-strategist | - |
| Docker, container, Dockerfile | devops-sre | - | - |
| Kubernetes, k8s, helm, pod | devops-sre | distributed-systems | - |
| deploy, deployment, release | devops-sre | - | - |
| monitoring, alerting, Prometheus | devops-sre | - | - |
| logging, ELK, observability | devops-sre | distributed-systems | - |
| terraform, infrastructure as code | devops-sre | - | - |
| AWS, GCP, Azure, cloud | devops-sre | distributed-systems | - |
| scaling, auto-scale, load | devops-sre | distributed-systems | - |

### Cross-cutting (Domaine 10-11)

| Mots-clés | Agent principal | Secondaire | Escalade |
|-----------|-----------------|------------|----------|
| prompt, LLM, GPT, Claude | prompt-engineering-expert | - | - |
| few-shot, zero-shot, chain-of-thought | prompt-engineering-expert | - | - |
| RAG, retrieval, embedding | prompt-engineering-expert | distributed-systems | - |
| AI agent, tool use, function calling | prompt-engineering-expert | - | - |
| documentation, README, wiki | technical-writer | - | - |
| ADR, decision record | technical-writer | senior-code-reviewer | - |
| API documentation, OpenAPI, Swagger | technical-writer | distributed-systems | - |
| tutorial, guide, onboarding | technical-writer | - | - |

---

## Routage par intent

### BUILD (Création de code/fonctionnalité)

```
Workflow standard:
1. [Domain Expert] → Implémentation
2. test-automation-strategist → Tests
3. senior-code-reviewer → Validation
4. (optionnel) security-expert → Audit sécurité
```

| Type de build | Agent principal | Chain obligatoire |
|---------------|-----------------|-------------------|
| Composant UI | ui-engineer | → test-auto → code-reviewer |
| Page/Feature complète | fullstack-ui-architect | → test-auto → code-reviewer |
| API endpoint | distributed-systems ou fullstack | → test-auto → security → code-reviewer |
| Service backend | distributed-systems-architect | → database → test-auto → security |
| Pipeline CI/CD | devops-sre | → test-auto |
| Prompt/Agent IA | prompt-engineering-expert | → test-auto |

### REVIEW (Analyse de code existant)

```
Workflow standard:
1. senior-code-reviewer → Analyse globale
2. [Domain Expert] → Analyse spécialisée (si nécessaire)
3. security-expert → Audit sécurité (si sensible)
```

| Type de review | Agents impliqués |
|----------------|------------------|
| PR standard | senior-code-reviewer |
| PR avec DB changes | senior-code-reviewer → database-expert |
| PR sécurité sensible | senior-code-reviewer → security-expert |
| Architecture review | senior-code-reviewer → distributed-systems |
| UI/UX review | senior-code-reviewer → ux-design-strategist |

### OPTIMIZE (Amélioration performance)

```
Workflow standard:
1. senior-code-reviewer → Identification des problèmes
2. [Spécialiste concerné] → Optimisation
3. test-automation-strategist → Benchmarks
```

| Type d'optimisation | Agent principal | Mesure par |
|---------------------|-----------------|------------|
| Query SQL lente | database-optimization-expert | test-auto (benchmarks) |
| Performance frontend | ui-engineer | test-auto (Lighthouse) |
| Scalabilité système | distributed-systems-architect | devops-sre (load tests) |
| Bundle size | ui-engineer ou fullstack | test-auto |
| Memory/CPU | distributed-systems ou devops | test-auto |

### DESIGN (Conception)

```
Workflow standard:
1. ux-design-strategist → Conception UX
2. [Domain Expert] → Spécifications techniques
3. senior-code-reviewer → Validation architecture
```

| Type de design | Agents impliqués |
|----------------|------------------|
| Interface utilisateur | ux-design-strategist → ui-engineer |
| Architecture système | distributed-systems → senior-code-reviewer |
| Schema base de données | database-expert → distributed-systems |
| Design system | ux-design-strategist → ui-engineer → technical-writer |

### DEBUG (Résolution de problèmes)

```
Workflow standard:
1. senior-code-reviewer → Analyse initiale
2. [Domain Expert] → Investigation approfondie
3. test-automation-strategist → Test de régression
```

| Type de bug | Agent principal | Support |
|-------------|-----------------|---------|
| Bug UI/frontend | ui-engineer | test-auto |
| Bug API/backend | distributed-systems ou fullstack | test-auto |
| Performance issue | database-expert ou distributed-systems | devops-sre |
| Security incident | security-expert | devops-sre |
| Flaky tests | test-automation-strategist | devops-sre |

---

## Règles de priorité

### Règle 1 : Sécurité d'abord
Si la requête mentionne des données sensibles, authentification, ou production :
→ Inclure `security-expert` dans le workflow

### Règle 2 : Tests obligatoires
Si du code est produit :
→ Proposer `test-automation-strategist` en follow-up

### Règle 3 : Review systématique
Si la complexité > simple :
→ Terminer par `senior-code-reviewer`

### Règle 4 : Documentation
Si nouvelle fonctionnalité majeure :
→ Proposer `technical-writer` pour documentation

### Règle 5 : Pas de sur-ingénierie
Si la requête est simple et claire :
→ Un seul agent suffit, pas de workflow complexe

---

## Conflits et résolution

### Chevauchement ui-engineer / fullstack-ui-architect

| Situation | Agent à utiliser |
|-----------|------------------|
| Composant isolé, styling | ui-engineer |
| Intégration API, state complexe | fullstack-ui-architect |
| Prototype rapide | ui-engineer |
| Architecture frontend complète | fullstack-ui-architect |
| Framework spécifique (Angular avancé) | fullstack-ui-architect |

### Chevauchement database-expert / distributed-systems

| Situation | Agent à utiliser |
|-----------|------------------|
| Optimisation query unique | database-expert |
| Sharding multi-région | distributed-systems (avec database-expert) |
| Schema design simple | database-expert |
| Data consistency multi-service | distributed-systems |

### Chevauchement code-reviewer / domain experts

| Situation | Agent à utiliser |
|-----------|------------------|
| Review qualité générale | senior-code-reviewer |
| Review spécialisation (perf DB) | Domain expert PUIS code-reviewer |
| Architecture decision | code-reviewer avec escalade si besoin |

---

## Signaux d'escalade

### Vers distributed-systems-architect
- Mention de "scale", "millions", "distributed"
- Problèmes de consistency cross-service
- Décisions d'infrastructure majeures

### Vers senior-code-reviewer
- Doutes sur la qualité du code produit
- Besoin de validation architecture
- Refactoring majeur

### Vers meta-agent-orchestrator
- Requête couvrant > 3 domaines
- Besoin de créer un nouvel agent
- Conflit entre recommandations d'agents