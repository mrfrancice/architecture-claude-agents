---
name: refactor
description: "Refactoring assisté avec analyse d'impact et préservation du comportement"

arguments:
  - name: operation
    description: "Type: rename, extract, move, inline, split, merge"
    required: true
  - name: target
    description: "Cible: fichier:ligne, symbole, ou pattern"
    required: true
  - name: destination
    description: "Nouveau nom, fichier destination, etc."
    required: false

examples:
  - prompt: "/refactor rename UserService.getUser getUserById"
    description: "Renommer une méthode partout dans le projet"
  - prompt: "/refactor extract src/services/OrderService.ts:45-80 calculateDiscount"
    description: "Extraire des lignes dans une nouvelle fonction"
  - prompt: "/refactor move src/utils/helpers.ts src/utils/string/"
    description: "Déplacer un fichier et mettre à jour les imports"
  - prompt: "/refactor split src/services/GodService.ts"
    description: "Découper une god class en modules"
---

# Refactoring Assisté

## Mission

Effectuer des refactorings sécurisés avec :
- Analyse d'impact via Serena/LSP avant modification
- Préservation garantie du comportement
- Mise à jour automatique de toutes les références
- Tests de non-régression après modification

---

## Opérations Disponibles

### 1. rename - Renommer un symbole

```yaml
rename:
  scope: "Projet entier"
  supports:
    - Classes, interfaces, types
    - Méthodes, fonctions
    - Variables, constantes
    - Fichiers (avec mise à jour imports)
    - Paramètres

  workflow:
    1_find_symbol:
      tool: "mcp__plugin_serena_serena__find_symbol"
      params:
        name_path_pattern: "{target}"
        include_body: false

    2_find_references:
      tool: "mcp__plugin_serena_serena__find_referencing_symbols"
      params:
        name_path: "{symbol}"
        relative_path: "{file}"

    3_preview:
      show:
        - Nombre de références trouvées
        - Fichiers impactés
        - Aperçu des changements

    4_execute:
      tool: "mcp__plugin_serena_serena__rename_symbol"
      params:
        name_path: "{symbol}"
        relative_path: "{file}"
        new_name: "{destination}"

    5_verify:
      - Lancer les tests impactés
      - Vérifier la compilation/lint

  example:
    input: "/refactor rename getUserById findUserById"
    output: |
      Renommage: getUserById → findUserById

      Références trouvées: 23
      Fichiers impactés: 8

      Aperçu:
      - src/services/UserService.ts:45 → findUserById
      - src/controllers/UserController.ts:23 → findUserById
      - src/tests/user.test.ts:12 → findUserById
      ...

      Procéder au renommage? [O/n]
```

### 2. extract - Extraire du code

```yaml
extract:
  types:
    function: "Extraire des lignes dans une fonction"
    method: "Extraire dans une méthode de classe"
    variable: "Extraire une expression dans une variable"
    constant: "Extraire une valeur dans une constante"
    component: "Extraire du JSX dans un composant"
    hook: "Extraire de la logique dans un custom hook"
    class: "Extraire des méthodes dans une nouvelle classe"
    module: "Extraire dans un nouveau fichier"

  workflow:
    1_read_code:
      tool: "mcp__plugin_serena_serena__read_file"
      params:
        relative_path: "{file}"
        start_line: "{start}"
        end_line: "{end}"

    2_analyze:
      check:
        - Variables utilisées (inputs)
        - Variables modifiées (outputs)
        - Dépendances externes
        - Side effects

    3_generate:
      create:
        - Signature de la nouvelle fonction
        - Corps extrait
        - Appel de remplacement

    4_apply:
      tool: "mcp__plugin_serena_serena__replace_content"
      actions:
        - Insérer nouvelle fonction
        - Remplacer code original par appel

    5_verify:
      - Tests de non-régression

  example:
    input: "/refactor extract src/services/Order.ts:45-80 calculateDiscount"
    output: |
      Extraction: lignes 45-80 → calculateDiscount()

      Analyse:
      - Inputs: order, customer, couponCode
      - Outputs: discountAmount
      - Side effects: aucun

      Nouvelle fonction:
      ```typescript
      function calculateDiscount(
        order: Order,
        customer: Customer,
        couponCode?: string
      ): number {
        // ... code extrait
      }
      ```

      Remplacement:
      ```typescript
      const discountAmount = calculateDiscount(order, customer, couponCode);
      ```
```

### 3. move - Déplacer du code

```yaml
move:
  types:
    file: "Déplacer un fichier entier"
    symbol: "Déplacer une classe/fonction vers un autre fichier"
    folder: "Réorganiser un dossier"

  workflow:
    1_analyze_dependencies:
      tool: "mcp__plugin_serena_serena__find_referencing_symbols"
      collect:
        - Qui importe ce fichier/symbole
        - Ce que ce fichier/symbole importe

    2_plan_move:
      calculate:
        - Nouveau chemin
        - Imports à mettre à jour
        - Exports à modifier

    3_preview:
      show:
        - Fichiers à modifier
        - Imports avant/après

    4_execute:
      steps:
        - Créer le nouveau fichier (si nécessaire)
        - Déplacer le code
        - Mettre à jour tous les imports
        - Supprimer l'ancien (si vide)

    5_verify:
      - Compilation
      - Tests

  example:
    input: "/refactor move src/utils/validation.ts src/validators/"
    output: |
      Déplacement: validation.ts → src/validators/validation.ts

      Imports à mettre à jour: 12 fichiers

      Changements:
      - src/services/UserService.ts
        - import { validate } from '../utils/validation'
        + import { validate } from '../validators/validation'
      ...
```

### 4. inline - Inliner du code

```yaml
inline:
  types:
    variable: "Remplacer variable par sa valeur"
    function: "Remplacer appel par le corps"
    constant: "Remplacer constante par sa valeur"

  workflow:
    1_find_definition:
      tool: "mcp__plugin_serena_serena__find_symbol"
      get: "Corps de la définition"

    2_find_usages:
      tool: "mcp__plugin_serena_serena__find_referencing_symbols"
      get: "Tous les endroits d'utilisation"

    3_verify_safety:
      check:
        - Pas de side effects
        - Valeur constante (pas de réassignation)
        - Pas de référence circulaire

    4_replace_all:
      tool: "mcp__plugin_serena_serena__replace_content"
      action: "Remplacer chaque usage par la valeur/corps"

    5_remove_definition:
      action: "Supprimer la définition originale"
```

### 5. split - Découper une god class

```yaml
split:
  workflow:
    1_analyze:
      tool: "mcp__plugin_serena_serena__get_symbols_overview"
      identify:
        - Groupes de méthodes liées
        - Dépendances entre méthodes
        - Responsabilités distinctes

    2_propose_split:
      suggest:
        - Nouveaux modules/classes
        - Répartition des méthodes
        - Interfaces entre modules

    3_preview:
      show:
        - Nouvelle structure
        - Diagramme de dépendances

    4_execute:
      steps:
        - Créer nouveaux fichiers
        - Déplacer les méthodes
        - Créer interfaces/abstractions
        - Mettre à jour les références

    5_verify:
      - Tests
      - Vérifier que le comportement est identique

  example:
    input: "/refactor split src/services/GodService.ts"
    output: |
      Analyse de GodService.ts:
      - 850 lignes
      - 32 méthodes
      - 5 responsabilités identifiées

      Proposition de découpage:

      ├── UserManagement (8 méthodes)
      │   └── createUser, updateUser, deleteUser...
      ├── OrderProcessing (10 méthodes)
      │   └── createOrder, processPayment...
      ├── NotificationService (6 méthodes)
      │   └── sendEmail, sendSMS...
      ├── ReportGenerator (5 méthodes)
      │   └── generatePDF, exportCSV...
      └── AnalyticsTracker (3 méthodes)
          └── trackEvent, getMetrics...

      Procéder au découpage? [O/n]
```

### 6. merge - Fusionner du code

```yaml
merge:
  types:
    files: "Fusionner plusieurs fichiers en un"
    classes: "Fusionner des classes similaires"
    functions: "Combiner des fonctions dupliquées"

  workflow:
    1_analyze_similarities:
      find:
        - Code dupliqué
        - Patterns communs
        - Différences à paramétrer

    2_design_merged:
      create:
        - Interface unifiée
        - Paramètres pour les variantes
        - Gestion des cas spécifiques

    3_implement:
      steps:
        - Créer la version fusionnée
        - Remplacer les usages
        - Supprimer les doublons

    4_verify:
      - Tests couvrent tous les cas
```

---

## Sécurités Intégrées

```yaml
safety_checks:
  before_refactor:
    - Vérifier que les tests passent
    - Créer un point de restauration (git stash ou branch)
    - Analyser l'impact complet

  during_refactor:
    - Prévisualiser tous les changements
    - Demander confirmation pour >10 fichiers
    - Atomic: tout ou rien

  after_refactor:
    - Exécuter les tests impactés
    - Vérifier la compilation
    - Proposer de rollback si échec

  rollback:
    command: "git checkout -- . && git stash pop"
    automatic: "Si tests échouent après refactor"
```

---

## Intégration Serena/LSP

```yaml
serena_tools:
  find_symbol:
    usage: "Localiser le symbole à refactorer"

  find_referencing_symbols:
    usage: "Trouver toutes les références"

  rename_symbol:
    usage: "Renommer partout dans le projet"

  replace_symbol_body:
    usage: "Modifier le corps d'une fonction"

  replace_content:
    usage: "Modifications textuelles précises"

  get_symbols_overview:
    usage: "Analyser la structure d'un fichier"
```

---

## Format de Sortie

```markdown
# Refactoring Report

**Opération:** {operation}
**Cible:** {target}
**Destination:** {destination}

## Analyse d'Impact

| Métrique | Valeur |
|----------|--------|
| Fichiers impactés | {n} |
| Lignes modifiées | {n} |
| Références mises à jour | {n} |

## Changements Effectués

### Fichier: {file1}
```diff
- ancien code
+ nouveau code
```

### Fichier: {file2}
...

## Vérification

| Test | Status |
|------|--------|
| Compilation | ✅ |
| Tests unitaires | ✅ |
| Tests intégration | ✅ |

## Rollback (si nécessaire)

```bash
git checkout {commit_before}
```
```
