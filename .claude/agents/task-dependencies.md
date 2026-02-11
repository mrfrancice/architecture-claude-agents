---
name: task-dependencies
version: "1.0"
description: |
  Système de dépendances entre tâches pour l'orchestration intelligente.
  Utilisé par meta-agent-orchestrator pour déterminer l'ordre d'exécution.

integrates_with:
  - meta-agent-orchestrator
  - validation-system
---

# Système de Dépendances des Tâches

## Mission

Définir l'ordre d'exécution des tâches pour éviter :
- Tests sur code inexistant
- Documentation obsolète
- Conflits de fichiers
- Incohérences entre agents

---

## Graphe de Dépendances

```
                    ┌─────────────────────────────────────────┐
                    │              DEPLOY                      │
                    └─────────────────────────────────────────┘
                                       ▲
                                       │
          ┌────────────────────────────┼────────────────────────────┐
          │                            │                            │
          ▼                            ▼                            ▼
    ┌──────────┐               ┌──────────────┐              ┌────────────┐
    │ SECURITY │               │    REVIEW    │              │    DOC     │
    └──────────┘               └──────────────┘              └────────────┘
          ▲                            ▲                            ▲
          │                            │                            │
          │                    ┌───────┴───────┐                    │
          │                    │               │                    │
          │                    ▼               │                    │
          │              ┌──────────┐          │                    │
          │              │  TESTS   │          │                    │
          │              └──────────┘          │                    │
          │                    ▲               │                    │
          │                    │               │                    │
          └────────────────────┼───────────────┴────────────────────┘
                               │
                               ▼
                         ┌──────────┐
                         │   CODE   │
                         └──────────┘
                               ▲
                               │
                    ┌──────────┴──────────┐
                    │                     │
              ┌───────────┐         ┌───────────┐
              │ UX_DESIGN │────────►│  DESIGN   │
              │ (UI/UX)   │◄────────│  (Archi)  │
              └───────────┘         └───────────┘
                    │                     │
                    └──────────┬──────────┘
                               │
                           (INPUT)
```

### Légende
- **DESIGN** : Architecture technique (distributed-systems-architect)
- **UX_DESIGN** : Design UI/UX (ux-design-strategist)
- Les deux phases DESIGN peuvent être parallèles et s'informent mutuellement

---

## Définition des Dépendances

```yaml
dependencies:
  # Phase 0: Conception
  design:
    depends_on: []
    description: "Architecture, specs, wireframes"
    agents:
      - ux-design-strategist
      - distributed-systems-architect
    outputs:
      - specs.md
      - architecture.md
      - wireframes

  # Phase 0.5: Design UI/UX (optionnel mais recommandé)
  ux_design:
    depends_on: [design]
    description: "Wireframes, maquettes, prototypes UI"
    agents:
      - ux-design-strategist
    outputs:
      - wireframes/
      - mockups/
      - design-system.md
      - user-flows.md
    handoff_to_code:
      required_artifacts:
        - component_list: "Liste des composants à implémenter"
        - design_tokens: "Couleurs, espacements, typographie"
        - interaction_specs: "Animations, états, comportements"
      validation:
        - mockups_approved: true
        - accessibility_reviewed: true

  # Phase 1: Développement
  code:
    depends_on: [design, ux_design]  # ux_design optionnel mais recommandé
    receives_from_ux:
      - component_specifications
      - design_tokens
      - interaction_patterns
      - accessibility_requirements
    description: "Écriture du code source"
    agents:
      - fullstack-ui-architect
      - distributed-systems-architect
      - database-optimization-expert
    outputs:
      - "*.ts"
      - "*.js"
      - "*.py"
      - "*.php"
    blocks:
      - tests      # Ne pas tester pendant l'écriture
      - doc        # Ne pas documenter pendant l'écriture

  # Phase 2: Tests
  tests:
    depends_on: [code]
    wait_for_completion: true
    description: "Tests unitaires, intégration, E2E"
    agents:
      - test-automation-strategist
    outputs:
      - "*.test.ts"
      - "*.spec.ts"
      - "test_*.py"
    requires:
      - code_compiles: true
      - no_syntax_errors: true

  # Phase 3: Qualité (peuvent être parallèles)
  security:
    depends_on: [code]
    parallel_with: [tests, doc]
    description: "Audit de sécurité OWASP"
    agents:
      - security-expert
    outputs:
      - security-report.md

  review:
    depends_on: [code, tests]
    description: "Review de code"
    agents:
      - meta-agent-orchestrator  # Délègue au bon agent
    requires:
      - tests_pass: true

  doc:
    depends_on: [code]
    parallel_with: [tests, security]
    description: "Documentation"
    agents:
      - technical-writer
    outputs:
      - README.md
      - API.md
      - "*.jsdoc"

  # Phase 4: Livraison
  deploy:
    depends_on: [code, tests, security, review]
    description: "Déploiement"
    requires:
      - tests_pass: true
      - security_score: ">= 70"
      - review_approved: true
```

---

## Règles d'Exécution

```yaml
rules:
  # Règle 1: Respect strict des dépendances
  strict_order:
    enabled: true
    description: "Ne jamais démarrer une tâche si ses dépendances ne sont pas terminées"

  # Règle 2: Parallélisation quand possible
  parallel_execution:
    enabled: true
    description: "Exécuter en parallèle les tâches sans dépendances mutuelles"
    example: "security + tests + doc peuvent être parallèles (tous dépendent de code)"

  # Règle 3: Attente de complétion
  wait_for_completion:
    enabled: true
    description: "Attendre la fin complète avant de passer à la suite"
    check:
      - no_errors
      - all_files_written
      - validation_passed

  # Règle 4: Rollback si échec
  rollback_on_failure:
    enabled: true
    description: "Si une tâche échoue, ne pas continuer les dépendantes"
    action: "Signaler l'échec et demander correction"
```

---

## Workflow d'Orchestration

```yaml
workflow:
  1_analyze_request:
    action: "Identifier les tâches demandées"
    example:
      input: "Crée une API avec tests et doc"
      tasks: [code, tests, doc]

  2_build_dependency_graph:
    action: "Construire le graphe de dépendances"
    example:
      code: []
      tests: [code]
      doc: [code]

  3_determine_order:
    action: "Calculer l'ordre d'exécution"
    algorithm: "Tri topologique"
    example:
      order: [code, tests, doc]  # tests et doc peuvent être parallèles

  4_identify_parallel:
    action: "Identifier les tâches parallélisables"
    example:
      sequential: [code]
      parallel_group_1: [tests, doc]

  5_execute_in_order:
    action: "Exécuter selon l'ordre"
    process: |
      for task in ordered_tasks:
        # Vérifier que les dépendances sont terminées
        if all(dep.completed for dep in task.dependencies):
          # Lancer la tâche
          agent = get_agent_for(task)
          result = execute(agent, task)

          # Vérifier le succès
          if result.failed:
            stop_and_report(result)
            return

          task.mark_completed()

  6_report_completion:
    action: "Signaler la fin de toutes les tâches"
```

---

## Intégration avec l'Orchestrateur

```yaml
orchestrator_integration:
  # L'orchestrateur consulte les dépendances
  on_request:
    1: "Recevoir la demande"
    2: "Consulter task-dependencies"
    3: "Construire le plan d'exécution"
    4: "Exécuter dans l'ordre"

  # Format de communication
  request_format:
    tasks: ["code", "tests", "doc"]
    context: "Créer API utilisateurs"

  response_format:
    execution_plan:
      - step: 1
        task: code
        agent: fullstack-ui-architect
        parallel: false
      - step: 2
        task: tests
        agent: test-automation-strategist
        parallel: true
      - step: 2  # Même step = parallèle
        task: doc
        agent: technical-writer
        parallel: true
```

---

## Détection Automatique des Tâches

```yaml
task_detection:
  # Mots-clés → Tâches
  keywords:
    code:
      - "crée"
      - "implémente"
      - "développe"
      - "code"
      - "ajoute"
      - "API"
      - "fonction"
      - "composant"

    tests:
      - "test"
      - "teste"
      - "TDD"
      - "couverture"
      - "unitaire"
      - "E2E"

    doc:
      - "documente"
      - "documentation"
      - "README"
      - "API docs"
      - "JSDoc"

    security:
      - "sécurise"
      - "audit"
      - "OWASP"
      - "vulnérabilité"

    review:
      - "review"
      - "vérifie"
      - "valide"

  # Exemples
  examples:
    "Crée une API avec tests":
      detected: [code, tests]
      order: [code, tests]

    "Implémente et documente l'authentification":
      detected: [code, doc]
      order: [code, doc]

    "Crée une feature complète":
      detected: [code, tests, doc, security]
      order: [code, [tests, doc, security]]  # Parallèle après code
```

---

## Gestion des Conflits

```yaml
conflict_resolution:
  # Deux agents veulent modifier le même fichier
  same_file:
    action: "Séquentiel obligatoire"
    priority: "Premier agent termine d'abord"

  # Dépendance circulaire détectée
  circular:
    action: "Erreur et signalement"
    message: "Dépendance circulaire détectée: {cycle}"

  # Tâche bloquée trop longtemps
  timeout:
    threshold: 300  # 5 minutes
    action: "Signaler et demander intervention"
```

---

## Rapport d'Exécution

```markdown
## Rapport d'Orchestration

**Demande:** {original_request}
**Date:** {date}

### Plan d'Exécution

| Étape | Tâche | Agent | Dépendances | Status |
|-------|-------|-------|-------------|--------|
| 1 | code | fullstack-ui-architect | - | ✅ |
| 2 | tests | test-automation-strategist | code | ✅ |
| 2 | doc | technical-writer | code | ✅ |
| 3 | security | security-expert | code | ✅ |

### Chronologie

```
[00:00] Début
[00:00] → code (start)
[02:30] ← code (done) ✅
[02:30] → tests (start) | → doc (start)  # Parallèle
[03:45] ← tests (done) ✅
[04:00] ← doc (done) ✅
[04:00] → security (start)
[04:30] ← security (done) ✅
[04:30] Fin - Toutes les tâches terminées
```

### Résultat

✅ **Succès** - Toutes les tâches complétées dans l'ordre
```

---

## Workflow UX → Code (Design-to-Implementation)

### Vue d'ensemble

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         WORKFLOW UX → CODE                               │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌───────────────┐     ┌───────────────┐     ┌───────────────┐          │
│  │  UX RESEARCH  │────►│   WIREFRAMES  │────►│   MOCKUPS     │          │
│  │               │     │               │     │               │          │
│  └───────────────┘     └───────────────┘     └───────┬───────┘          │
│                                                       │                  │
│                                                       ▼                  │
│                                              ┌───────────────┐          │
│                                              │ DESIGN TOKENS │          │
│                                              │ + COMPONENTS  │          │
│                                              └───────┬───────┘          │
│                                                       │                  │
│                    ═══════════════════════════════════╪══════════════   │
│                              HANDOFF POINT            │                  │
│                    ═══════════════════════════════════╪══════════════   │
│                                                       │                  │
│                                                       ▼                  │
│  ┌───────────────┐     ┌───────────────┐     ┌───────────────┐          │
│  │ IMPLEMENTATION│◄────│  COMPONENT    │◄────│   CODE GEN    │          │
│  │    REVIEW     │     │     CODE      │     │   (optionnel) │          │
│  └───────────────┘     └───────────────┘     └───────────────┘          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Artefacts du Handoff UX → Code

```yaml
ux_to_code_handoff:
  required_artifacts:
    component_specifications:
      description: "Liste détaillée des composants à créer"
      format: |
        ## Component: [Nom]
        - **Type**: Button | Input | Card | Modal | ...
        - **Variantes**: primary, secondary, disabled
        - **Props**: label, onClick, disabled, size
        - **États**: default, hover, active, focus, disabled
        - **Responsive**: breakpoints comportement

    design_tokens:
      description: "Variables de design système"
      includes:
        colors:
          - primary, secondary, accent
          - text, background, border
          - success, warning, error, info
        spacing:
          - xs, sm, md, lg, xl, 2xl
        typography:
          - font-family, sizes, weights, line-heights
        borders:
          - radius, widths
        shadows:
          - sm, md, lg, xl
        animations:
          - durations, easings

    interaction_specs:
      description: "Comportements et animations"
      includes:
        - hover_effects
        - click_feedback
        - loading_states
        - transitions
        - micro_animations

    accessibility_requirements:
      description: "Exigences a11y"
      includes:
        - contrast_ratios (WCAG AA minimum)
        - keyboard_navigation
        - screen_reader_labels
        - focus_indicators
        - reduced_motion_support

  optional_artifacts:
    - prototype_link (Figma, InVision)
    - user_flow_diagrams
    - storybook_specs
    - responsive_breakpoints

  validation_before_handoff:
    - [ ] Mockups approuvés par stakeholders
    - [ ] Accessibility review passé
    - [ ] Design tokens exportés
    - [ ] Component list complète
    - [ ] Interaction specs documentées
```

### Processus de Handoff

```yaml
handoff_process:
  step_1_prepare:
    agent: ux-design-strategist
    actions:
      - Finaliser mockups
      - Exporter design tokens (JSON/CSS)
      - Documenter composants
      - Créer specs interactions
    output: handoff_package.md

  step_2_review:
    agent: meta-agent-orchestrator
    actions:
      - Vérifier complétude artifacts
      - Valider accessibilité
      - Identifier gaps techniques
    validation:
      score_min: 80%

  step_3_transfer:
    from: ux-design-strategist
    to: fullstack-ui-architect
    context:
      - handoff_package.md
      - design_tokens.json
      - component_specs/
      - interaction_specs.md

  step_4_implement:
    agent: fullstack-ui-architect
    receives:
      - Design tokens → CSS variables / theme
      - Component specs → React/Vue/Angular components
      - Interaction specs → Animations, state management
    produces:
      - src/components/
      - src/styles/
      - src/theme/

  step_5_validate:
    checks:
      - Visual fidelity vs mockups
      - Responsive behavior
      - Accessibility compliance
      - Interaction matching specs
    agent: web-tester (Playwright screenshots)
```

### Détection Automatique UX Tasks

```yaml
ux_task_detection:
  keywords:
    ux_research:
      - "user research"
      - "persona"
      - "user journey"
      - "interviews"

    wireframes:
      - "wireframe"
      - "sketch"
      - "low-fidelity"
      - "structure"

    mockups:
      - "mockup"
      - "design"
      - "maquette"
      - "high-fidelity"
      - "UI design"

    design_system:
      - "design system"
      - "composants"
      - "tokens"
      - "theme"
      - "style guide"

  examples:
    "Design l'interface d'inscription":
      detected: [ux_design, code]
      order: [ux_design, code]
      agents: [ux-design-strategist, fullstack-ui-architect]

    "Crée une page dashboard avec maquettes":
      detected: [ux_design, code, tests]
      order: [ux_design, code, tests]

    "Implémente ce design Figma":
      detected: [code]  # UX déjà fait
      receives_from: external_design
      agents: [fullstack-ui-architect]
```

### Template Handoff Document

```markdown
# 🎨 HANDOFF UX → CODE

## Projet: [Nom]
**Date**: [date]
**UX Designer**: ux-design-strategist
**Développeur**: fullstack-ui-architect

---

## 1. Composants à Implémenter

| Composant | Priorité | Variantes | Status |
|-----------|----------|-----------|--------|
| Button | P0 | primary, secondary, ghost | ⏳ |
| Input | P0 | text, password, search | ⏳ |
| Card | P1 | default, clickable | ⏳ |

## 2. Design Tokens

```json
{
  "colors": {
    "primary": "#3B82F6",
    "secondary": "#6366F1"
  },
  "spacing": {
    "xs": "4px",
    "sm": "8px"
  }
}
```

## 3. Specs Interaction

### Button
- **Hover**: scale(1.02), shadow-lg
- **Active**: scale(0.98)
- **Focus**: ring-2 ring-primary
- **Disabled**: opacity-50, cursor-not-allowed

## 4. Accessibilité

- [ ] Contraste AA (4.5:1 texte, 3:1 UI)
- [ ] Focus visible sur tous éléments interactifs
- [ ] Labels ARIA sur icônes
- [ ] Navigation clavier complète

## 5. Responsive

| Breakpoint | Comportement |
|------------|--------------|
| < 640px | Stack vertical, full-width buttons |
| 640-1024px | Grid 2 colonnes |
| > 1024px | Grid 3 colonnes, sidebar visible |

---

**✅ Prêt pour implémentation**
```
