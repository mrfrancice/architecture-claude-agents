---
name: generate-tests
description: "Génère des tests pour un fichier ou une fonction"

arguments:
  - name: target
    description: "Fichier ou fonction à tester"
    required: true
  - name: framework
    description: "Framework (auto, jest, vitest, pytest)"
    required: false
    default: "auto"

examples:
  - prompt: "/generate-tests src/services/user.ts"
    description: "Génère des tests pour user.ts"
  - prompt: "/generate-tests calculateTotal vitest"
    description: "Tests pour calculateTotal avec Vitest"
---

# Générateur de Tests

## Instructions

Générer des tests unitaires pour le fichier ou la fonction spécifiée.

## Étapes

### 1. Détection du framework
Si `auto` :
- Chercher `jest.config` → Jest
- Chercher `vitest.config` → Vitest
- Chercher `pytest.ini` ou `pyproject.toml` → Pytest
- Sinon, utiliser le framework le plus courant pour le langage

### 2. Analyse du code cible
- Identifier les fonctions/méthodes publiques
- Détecter les paramètres et types
- Identifier les dépendances à mocker

### 3. Génération des cas de test

Pour chaque fonction, générer :

| Cas | Description |
|-----|-------------|
| Happy path | Cas nominal avec données valides |
| Edge cases | Valeurs limites (0, null, vide, max) |
| Error cases | Inputs invalides, erreurs attendues |

### 4. Structure du test

```typescript
describe('[Module/Class]', () => {
  // Setup si nécessaire
  beforeEach(() => {
    // Arrange commun
  });

  describe('[functionName]', () => {
    it('should [comportement attendu] when [condition]', () => {
      // Arrange
      const input = ...;

      // Act
      const result = functionName(input);

      // Assert
      expect(result).toBe/toEqual(...);
    });

    it('should throw when [condition invalide]', () => {
      expect(() => functionName(invalidInput)).toThrow();
    });
  });
});
```

## Format de sortie

```markdown
## Tests générés pour `[target]`

### Fichier créé
`[path]/__tests__/[name].test.ts`

### Cas couverts
- ✅ [Cas 1]
- ✅ [Cas 2]
- ✅ [Cas 3]

### Code
\`\`\`typescript
[code des tests]
\`\`\`

### Pour exécuter
\`\`\`bash
npm test [fichier]
\`\`\`
```
