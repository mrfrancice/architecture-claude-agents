---
name: doc
description: "Génération automatique de documentation (README, API, JSDoc, ADR)"

arguments:
  - name: type
    description: "Type: readme, api, jsdoc, adr, changelog, all"
    required: false
    default: "all"
  - name: target
    description: "Cible: fichier, dossier, ou '.' pour tout le projet"
    required: false
    default: "."
  - name: format
    description: "Format: md, html, openapi, json"
    required: false
    default: "md"

examples:
  - prompt: "/doc"
    description: "Générer toute la documentation du projet"
  - prompt: "/doc readme"
    description: "Générer/mettre à jour le README"
  - prompt: "/doc api src/controllers/"
    description: "Documenter les endpoints API"
  - prompt: "/doc jsdoc src/services/UserService.ts"
    description: "Ajouter JSDoc aux fonctions"
  - prompt: "/doc adr 'Choix de PostgreSQL'"
    description: "Créer un Architecture Decision Record"
---

# Génération de Documentation

## Mission

Générer une documentation complète, à jour et utile :
- Analyse du code via Serena/LSP
- Extraction automatique des signatures et types
- Documentation contextuelle et exemples
- Formats standards (Markdown, OpenAPI, JSDoc)

---

## Types de Documentation

### 1. readme - README.md du projet

```yaml
readme:
  sections:
    header:
      - Nom du projet
      - Badges (build, coverage, version)
      - Description courte (1-2 phrases)

    about:
      - Description détaillée
      - Problème résolu
      - Public cible

    features:
      - Liste des fonctionnalités principales
      - Extraite de l'analyse du code

    tech_stack:
      - Langages détectés
      - Frameworks utilisés
      - Dépendances principales

    installation:
      - Prérequis
      - Étapes d'installation
      - Configuration initiale

    usage:
      - Exemples de code
      - Commandes principales
      - Screenshots (si applicable)

    api_overview:
      - Endpoints principaux (si API)
      - Lien vers doc API complète

    development:
      - Setup environnement dev
      - Scripts disponibles (npm run ...)
      - Tests

    contributing:
      - Guidelines
      - Process de PR
      - Code of conduct

    license:
      - Type de licence
      - Copyright

  workflow:
    1_analyze:
      - package.json / composer.json / requirements.txt
      - Structure des dossiers
      - Fichiers de config

    2_extract:
      tool: "mcp__plugin_serena_serena__get_symbols_overview"
      from: "Fichiers principaux"

    3_generate:
      - Compiler les informations
      - Formater en Markdown
      - Ajouter exemples

    4_output:
      file: "README.md"
```

### 2. api - Documentation API

```yaml
api:
  formats:
    openapi: "OpenAPI 3.0 (Swagger)"
    markdown: "Documentation Markdown"
    postman: "Collection Postman"

  extraction:
    routes:
      tool: "mcp__plugin_serena_serena__search_for_pattern"
      patterns:
        express: "@(Get|Post|Put|Delete|Patch)\\("
        fastify: "fastify\\.(get|post|put|delete)"
        laravel: "Route::(get|post|put|delete)"
        django: "path\\(|url\\("
        nestjs: "@(Get|Post|Put|Delete|Patch)\\("

    parameters:
      - Path params (:id, {id})
      - Query params
      - Body schema (depuis types/interfaces)
      - Headers requis

    responses:
      - Codes de status
      - Schémas de réponse
      - Exemples

  output:
    openapi:
      file: "docs/openapi.yaml"
      content: |
        openapi: 3.0.0
        info:
          title: {project_name} API
          version: {version}
        paths:
          {endpoints}
        components:
          schemas:
            {models}

    markdown:
      file: "docs/API.md"
      content: |
        # API Reference

        ## Endpoints

        ### {method} {path}

        **Description:** {description}

        **Parameters:**
        | Name | Type | Required | Description |
        |------|------|----------|-------------|

        **Request Body:**
        ```json
        {example}
        ```

        **Response:**
        ```json
        {example}
        ```
```

### 3. jsdoc - Documentation du code

```yaml
jsdoc:
  languages:
    javascript_typescript:
      format: "JSDoc / TSDoc"
      example: |
        /**
         * Calcule le prix total avec remise
         * @param {OrderItem[]} items - Liste des articles
         * @param {number} discountPercent - Pourcentage de remise (0-100)
         * @returns {number} Prix total après remise
         * @throws {InvalidDiscountError} Si le pourcentage est invalide
         * @example
         * const total = calculateTotal(items, 10);
         * // => 90.00
         */

    python:
      format: "Docstrings (Google style)"
      example: |
        def calculate_total(items: List[OrderItem], discount_percent: float) -> float:
            """Calcule le prix total avec remise.

            Args:
                items: Liste des articles
                discount_percent: Pourcentage de remise (0-100)

            Returns:
                Prix total après remise

            Raises:
                InvalidDiscountError: Si le pourcentage est invalide

            Example:
                >>> calculate_total(items, 10)
                90.00
            """

    php:
      format: "PHPDoc"
      example: |
        /**
         * Calcule le prix total avec remise
         *
         * @param OrderItem[] $items Liste des articles
         * @param float $discountPercent Pourcentage de remise
         * @return float Prix total après remise
         * @throws InvalidDiscountException
         */

  workflow:
    1_find_undocumented:
      tool: "mcp__plugin_serena_serena__get_symbols_overview"
      filter: "Fonctions/méthodes publiques sans doc"

    2_analyze_signature:
      tool: "mcp__plugin_serena_serena__find_symbol"
      extract:
        - Paramètres et types
        - Type de retour
        - Exceptions possibles

    3_analyze_body:
      understand:
        - Ce que fait la fonction
        - Cas limites
        - Effets de bord

    4_generate_doc:
      create:
        - Description claire
        - Params documentés
        - Exemples d'usage

    5_insert:
      tool: "mcp__plugin_serena_serena__insert_before_symbol"
      action: "Insérer le bloc de documentation"
```

### 4. adr - Architecture Decision Records

```yaml
adr:
  template: |
    # ADR-{number}: {title}

    **Date:** {date}
    **Status:** {proposed|accepted|deprecated|superseded}
    **Deciders:** {names}

    ## Context

    {Quel est le problème ou la situation qui nécessite une décision?}

    ## Decision

    {Quelle est la décision prise?}

    ## Alternatives Considered

    ### Option 1: {name}
    - **Pros:** {avantages}
    - **Cons:** {inconvénients}

    ### Option 2: {name}
    - **Pros:** {avantages}
    - **Cons:** {inconvénients}

    ## Consequences

    ### Positive
    - {conséquence positive}

    ### Negative
    - {conséquence négative}

    ### Risks
    - {risque identifié}

    ## References

    - {liens utiles}

  storage:
    folder: "docs/adr/"
    naming: "NNNN-{slug}.md"
    index: "docs/adr/README.md"

  workflow:
    1_get_context:
      ask:
        - Quel est le contexte de cette décision?
        - Quelles alternatives ont été considérées?

    2_generate:
      create: "ADR avec template"

    3_save:
      file: "docs/adr/{number}-{slug}.md"
      update_index: true
```

### 5. changelog - Journal des modifications

```yaml
changelog:
  format: "Keep a Changelog"

  template: |
    # Changelog

    All notable changes to this project will be documented in this file.

    The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
    and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

    ## [Unreleased]

    ### Added
    - {new features}

    ### Changed
    - {changes in existing functionality}

    ### Deprecated
    - {soon-to-be removed features}

    ### Removed
    - {removed features}

    ### Fixed
    - {bug fixes}

    ### Security
    - {security fixes}

    ## [{version}] - {date}
    ...

  automation:
    from_commits:
      - Analyser les commits depuis le dernier tag
      - Catégoriser par type (feat, fix, etc.)
      - Générer les entrées

    from_prs:
      - Extraire les titres des PRs mergées
      - Grouper par type
```

### 6. all - Documentation complète

```yaml
all:
  generate:
    - README.md
    - docs/API.md (si API détectée)
    - docs/CONTRIBUTING.md
    - docs/CHANGELOG.md
    - JSDoc sur fonctions publiques non documentées
    - docs/adr/README.md (index des ADRs)

  structure:
    project/
    ├── README.md
    ├── CHANGELOG.md
    ├── CONTRIBUTING.md
    └── docs/
        ├── API.md
        ├── ARCHITECTURE.md
        └── adr/
            ├── README.md
            └── 0001-initial-architecture.md
```

---

## Analyse via Serena/LSP

```yaml
serena_usage:
  get_symbols_overview:
    purpose: "Lister toutes les fonctions/classes à documenter"
    usage: "Identifier les exports publics"

  find_symbol:
    purpose: "Obtenir la signature complète"
    usage: "Extraire paramètres, types, retour"

  search_for_pattern:
    purpose: "Trouver les routes API, décorateurs"
    usage: "Détecter les endpoints à documenter"

  read_file:
    purpose: "Lire le contenu pour comprendre le contexte"
    usage: "Analyser le comportement pour la description"
```

---

## Format de Sortie

```markdown
# Documentation Report

**Projet:** {project_name}
**Date:** {date}

## Fichiers Générés

| Fichier | Type | Lignes |
|---------|------|--------|
| README.md | readme | {n} |
| docs/API.md | api | {n} |
| {file} | jsdoc | +{n} lignes |

## Couverture Documentation

| Catégorie | Avant | Après |
|-----------|-------|-------|
| Fonctions publiques | {x}% | {y}% |
| Endpoints API | {x}% | {y}% |
| Classes | {x}% | {y}% |

## Prochaines Actions

- [ ] Compléter les exemples dans API.md
- [ ] Ajouter des screenshots au README
- [ ] Créer ADR pour {decision}
```
