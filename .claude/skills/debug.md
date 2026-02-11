---
name: debug
description: "Analyse et résolution de bugs, stack traces, et erreurs"

arguments:
  - name: error
    description: "Message d'erreur, stack trace, ou description du bug"
    required: true
  - name: context
    description: "Fichier ou zone du code concerné"
    required: false
  - name: mode
    description: "Mode: analyze, fix, explain"
    required: false
    default: "analyze"

examples:
  - prompt: "/debug TypeError: Cannot read property 'id' of undefined"
    description: "Analyser une erreur JavaScript"
  - prompt: "/debug 'Le paiement échoue silencieusement' src/services/Payment.ts"
    description: "Investiguer un bug fonctionnel"
  - prompt: "/debug [stack trace collé] fix"
    description: "Analyser et proposer un fix"
  - prompt: "/debug SQLSTATE[23000] explain"
    description: "Expliquer une erreur SQL"
---

# Debug Assisté

## Mission

Analyser les erreurs et bugs avec :
- Parsing intelligent des stack traces
- Localisation du code problématique via Serena/LSP
- Analyse de la cause racine
- Proposition de fix avec tests

---

## Modes d'Opération

### 1. analyze - Analyse complète

```yaml
analyze:
  steps:
    1_parse_error:
      extract:
        - Type d'erreur
        - Message
        - Stack trace (si présent)
        - Fichier et ligne

    2_locate_code:
      tool: "mcp__plugin_serena_serena__read_file"
      action: "Lire le code autour de l'erreur"

    3_understand_context:
      tool: "mcp__plugin_serena_serena__find_symbol"
      action: "Comprendre la fonction/méthode concernée"

    4_trace_data_flow:
      tool: "mcp__plugin_serena_serena__find_referencing_symbols"
      action: "D'où viennent les données problématiques?"

    5_identify_cause:
      analyze:
        - Conditions qui mènent à l'erreur
        - Données manquantes ou invalides
        - Race conditions potentielles

    6_report:
      output:
        - Cause probable
        - Chemin d'exécution
        - Variables impliquées
```

### 2. fix - Proposer une correction

```yaml
fix:
  extends: "analyze"

  additional_steps:
    7_design_fix:
      consider:
        - Solution minimale (quick fix)
        - Solution robuste (proper fix)
        - Impact sur le reste du code

    8_generate_fix:
      create:
        - Code corrigé
        - Validation ajoutée
        - Gestion d'erreur améliorée

    9_generate_test:
      create:
        - Test reproduisant le bug
        - Test vérifiant le fix
        - Tests de non-régression

    10_apply:
      action: "Appliquer le fix si confirmé"
```

### 3. explain - Explication pédagogique

```yaml
explain:
  focus:
    - Qu'est-ce que cette erreur signifie?
    - Pourquoi elle se produit en général?
    - Comment l'éviter à l'avenir?
    - Patterns et bonnes pratiques

  output:
    - Explication claire
    - Exemples de code
    - Ressources pour approfondir
```

---

## Types d'Erreurs Supportés

### JavaScript / TypeScript

```yaml
javascript_errors:
  TypeError:
    patterns:
      - "Cannot read property '(.+)' of undefined"
      - "Cannot read property '(.+)' of null"
      - "(.+) is not a function"
      - "(.+) is not iterable"

    common_causes:
      - Accès à une propriété sur undefined/null
      - Données async non attendues
      - Import manquant

    analysis:
      - Tracer la variable undefined
      - Vérifier les appels async
      - Vérifier les imports

  ReferenceError:
    patterns:
      - "(.+) is not defined"

    common_causes:
      - Variable non déclarée
      - Import manquant
      - Scope incorrect

  SyntaxError:
    patterns:
      - "Unexpected token (.+)"
      - "Unexpected end of input"

    common_causes:
      - JSON invalide
      - Parenthèse/accolade manquante
      - Template literal mal fermé

  RangeError:
    patterns:
      - "Maximum call stack size exceeded"
      - "Invalid array length"

    common_causes:
      - Récursion infinie
      - Boucle infinie

  NetworkError:
    patterns:
      - "Failed to fetch"
      - "Network request failed"
      - "CORS"

    common_causes:
      - API down
      - CORS mal configuré
      - URL incorrecte
```

### Python

```yaml
python_errors:
  AttributeError:
    patterns:
      - "'(.+)' object has no attribute '(.+)'"
      - "'NoneType' object has no attribute"

    common_causes:
      - Objet None inattendu
      - Typo dans le nom d'attribut

  KeyError:
    patterns:
      - "KeyError: '(.+)'"

    common_causes:
      - Clé manquante dans dict
      - Données manquantes

  ImportError:
    patterns:
      - "No module named '(.+)'"
      - "cannot import name '(.+)'"

    common_causes:
      - Package non installé
      - Import circulaire

  ValueError:
    patterns:
      - "invalid literal for int()"
      - "could not convert string to float"

    common_causes:
      - Conversion de type invalide
      - Données mal formées
```

### SQL / Base de données

```yaml
sql_errors:
  SQLSTATE_23000:
    name: "Integrity constraint violation"
    common_causes:
      - Duplicate key
      - Foreign key violation
      - NOT NULL violation

    fix_suggestions:
      - Vérifier les contraintes
      - Utiliser ON CONFLICT
      - Valider les données avant insert

  SQLSTATE_42000:
    name: "Syntax error"
    common_causes:
      - Requête mal formée
      - Mot-clé réservé utilisé comme identifiant

  Connection_errors:
    patterns:
      - "Connection refused"
      - "Too many connections"
      - "Authentication failed"

    common_causes:
      - Serveur down
      - Credentials incorrects
      - Pool de connexions épuisé
```

### PHP / Laravel

```yaml
php_errors:
  FatalError:
    patterns:
      - "Class '(.+)' not found"
      - "Call to undefined method"

    common_causes:
      - Autoload manquant
      - Namespace incorrect
      - composer dump-autoload nécessaire

  Laravel_specific:
    ModelNotFoundException:
      cause: "findOrFail() sur ID inexistant"
      fix: "Utiliser find() + vérification null"

    ValidationException:
      cause: "Validation échouée"
      fix: "Vérifier les règles de validation"

    QueryException:
      cause: "Erreur SQL"
      fix: "Voir l'erreur SQL sous-jacente"
```

---

## Workflow d'Analyse

```yaml
workflow:
  1_parse_input:
    extract:
      error_type: "Type d'erreur détecté"
      message: "Message principal"
      stack_trace: "Pile d'appels (si présente)"
      file_line: "Fichier:ligne (si disponible)"

  2_locate_in_code:
    if: "file_line disponible"
    tool: "mcp__plugin_serena_serena__read_file"
    params:
      relative_path: "{file}"
      start_line: "{line - 10}"
      end_line: "{line + 10}"

  3_understand_function:
    tool: "mcp__plugin_serena_serena__find_symbol"
    params:
      name_path_pattern: "{function_name}"
      include_body: true

  4_trace_call_chain:
    from: "stack trace"
    for_each_frame:
      - Lire le code appelant
      - Comprendre les données passées

  5_identify_data_source:
    tool: "mcp__plugin_serena_serena__find_referencing_symbols"
    purpose: "D'où vient la donnée problématique?"

  6_analyze_conditions:
    check:
      - Conditions qui mènent à l'erreur
      - Cas non gérés
      - Validations manquantes

  7_formulate_hypothesis:
    output:
      - Cause probable principale
      - Causes alternatives possibles
      - Confiance (%)

  8_propose_fix:
    if: "mode == fix"
    generate:
      - Code corrigé
      - Test de régression
```

---

## Format de Sortie

### Mode: analyze

```markdown
# Debug Analysis

## Erreur

**Type:** {error_type}
**Message:** {message}
**Localisation:** `{file}:{line}`

## Stack Trace

```
{formatted_stack_trace}
```

## Code Concerné

```{language}
{code_with_highlight_on_error_line}
```

## Analyse

### Cause Probable (Confiance: {confidence}%)

{explanation}

### Chemin d'Exécution

```
1. {caller_1} appelle {function}
2. {function} reçoit {params}
3. À la ligne {line}, {variable} est {state}
4. L'erreur se produit car {reason}
```

### Variables Impliquées

| Variable | Valeur Attendue | Valeur Réelle |
|----------|-----------------|---------------|
| {var1} | {expected} | {actual} |

## Causes Alternatives

1. {alternative_cause_1}
2. {alternative_cause_2}
```

### Mode: fix

```markdown
# Debug Analysis + Fix

[... analyse ci-dessus ...]

## Correction Proposée

### Option 1: Quick Fix

```{language}
{quick_fix_code}
```

**Avantages:** Rapide à appliquer
**Inconvénients:** Ne traite pas la cause racine

### Option 2: Proper Fix (Recommandé)

```{language}
{proper_fix_code}
```

**Changements:**
- Ajout de validation sur {variable}
- Gestion du cas {edge_case}
- Message d'erreur explicite

## Test de Régression

```{language}
{test_code}
```

## Appliquer le Fix?

- [ ] Appliquer Option 1 (Quick Fix)
- [ ] Appliquer Option 2 (Proper Fix)
- [ ] Investiguer davantage
```

### Mode: explain

```markdown
# Explication: {error_type}

## Qu'est-ce que cette erreur?

{explanation_simple}

## Pourquoi elle se produit?

{common_scenarios}

## Comment l'éviter?

### Pattern 1: {pattern_name}

```{language}
// Mauvais
{bad_code}

// Bon
{good_code}
```

### Pattern 2: {pattern_name}

```{language}
{example}
```

## Ressources

- [Documentation officielle]({url})
- [Article recommandé]({url})
```

---

## Intégration avec Autres Skills

```yaml
integrations:
  after_fix:
    - "/test-regression {file}"  # Vérifier pas de régression

  if_recurring:
    - "/audit quality {file}"  # Vérifier la qualité globale

  if_complex:
    - "Utilise distributed-systems-architect"  # Pour bugs distribués
    - "Utilise database-optimization-expert"  # Pour bugs DB
```
