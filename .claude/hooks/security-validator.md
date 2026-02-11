# 🛡️ Security Validator Hook

---
name: security-validator
description: "Valide et bloque les injections (SQL, XSS, CMD) avant écriture"
event: PreToolUse
match_tools: ["Write", "Edit", "mcp__plugin_serena_serena__replace_content", "mcp__plugin_serena_serena__replace_symbol_body", "mcp__plugin_serena_serena__create_text_file"]
---

## Instructions

Ce hook analyse le code AVANT qu'il soit écrit pour détecter et bloquer les vulnérabilités d'injection.

## Patterns de Détection

### 1. SQL Injection

```yaml
patterns:
  critical:
    # Concaténation directe dans SQL
    - pattern: '(\$|request\.|req\.|params\.)[\w.]+.*(\+|concat).*["\']?(SELECT|INSERT|UPDATE|DELETE|DROP|UNION)'
      message: "SQL Injection: concaténation de variable dans requête SQL"

    # Interpolation dans SQL
    - pattern: '`SELECT.*\$\{.*\}`|f"SELECT.*\{.*\}"|f''SELECT.*\{.*\}'''
      message: "SQL Injection: interpolation de variable dans requête SQL"

    # Raw queries sans paramètres
    - pattern: '\.raw\s*\(\s*["\'].*\+|\.raw\s*\(\s*`.*\$\{'
      message: "SQL Injection: requête raw avec concaténation"

    # Query builder sans binding
    - pattern: 'whereRaw\s*\(\s*["\'].*\$|DB::select\s*\(\s*["\'].*\.'
      message: "SQL Injection: whereRaw/select sans binding"
```

### 2. XSS (Cross-Site Scripting)

```yaml
patterns:
  critical:
    # innerHTML avec variable
    - pattern: 'innerHTML\s*=\s*(\w+|`.*\$\{)'
      message: "XSS: innerHTML avec variable non sanitizée"

    # dangerouslySetInnerHTML React
    - pattern: 'dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html:\s*(?!DOMPurify)'
      message: "XSS: dangerouslySetInnerHTML sans DOMPurify"

    # v-html Vue sans sanitize
    - pattern: 'v-html\s*=\s*"(?!sanitize|purify)'
      message: "XSS: v-html sans sanitization"

    # Blade {!! !!} avec variable user
    - pattern: '\{!!\s*\$(request|input|user|_GET|_POST)'
      message: "XSS: Blade unescaped avec input utilisateur"

    # Django |safe avec variable
    - pattern: '\{\{\s*(request|user_input).*\|\s*safe\s*\}\}'
      message: "XSS: Django safe filter avec input utilisateur"

    # document.write
    - pattern: 'document\.write\s*\('
      message: "XSS: document.write est dangereux"
```

### 3. Command Injection

```yaml
patterns:
  critical:
    # exec/system avec variable
    - pattern: '(exec|system|shell_exec|passthru|popen)\s*\(\s*\$'
      message: "CMD Injection: exécution shell avec variable"

    # child_process avec concaténation
    - pattern: 'child_process\.(exec|spawn)\s*\([^)]*\+|\$\{'
      message: "CMD Injection: child_process avec concaténation"

    # subprocess sans shell=False
    - pattern: 'subprocess\.(run|call|Popen)\s*\([^)]*shell\s*=\s*True'
      message: "CMD Injection: subprocess avec shell=True"

    # os.system Python
    - pattern: 'os\.system\s*\(\s*(f["\']|["\'].*\+|\w+\s*\+)'
      message: "CMD Injection: os.system avec variable"

    # eval avec input
    - pattern: 'eval\s*\(\s*(\$|request|req\.|params\.|user)'
      message: "Code Injection: eval avec input utilisateur"
```

### 4. Path Traversal

```yaml
patterns:
  critical:
    # File operations avec input
    - pattern: '(file_get_contents|fopen|include|require)\s*\(\s*\$_(GET|POST|REQUEST)'
      message: "Path Traversal: opération fichier avec input direct"

    # Path sans validation
    - pattern: '(readFile|writeFile|readFileSync)\s*\([^)]*req\.(params|query|body)'
      message: "Path Traversal: opération fichier avec req params"

    # open() Python avec input
    - pattern: 'open\s*\(\s*(request\.|f["\'].*\{request)'
      message: "Path Traversal: open() avec request input"
```

### 5. LDAP/XML/NoSQL Injection

```yaml
patterns:
  critical:
    # LDAP filter avec variable
    - pattern: 'ldap_search\s*\([^)]*\$_(GET|POST)'
      message: "LDAP Injection: filtre avec input utilisateur"

    # XML parsing sans désactivation entities
    - pattern: 'simplexml_load_string\s*\(\s*\$|xml\.parse\s*\('
      message: "XXE: parsing XML potentiellement vulnérable"

    # MongoDB sans sanitize
    - pattern: '\.(find|findOne|update|delete)\s*\(\s*\{\s*\$where'
      message: "NoSQL Injection: $where avec input utilisateur"
```

## Actions

### Si Pattern Critique Détecté

```yaml
action: BLOCK
response: |
  ❌ **SÉCURITÉ: Code bloqué - Vulnérabilité détectée**

  **Type:** {vulnerability_type}
  **Pattern:** {matched_pattern}
  **Ligne:** {line_number}

  **Risque:** {risk_description}

  **Solution recommandée:**
  {remediation}

  Voulez-vous que je corrige automatiquement cette vulnérabilité?
```

### Remédiations Automatiques

```yaml
remediations:
  sql_injection:
    before: 'query("SELECT * FROM users WHERE id = " + userId)'
    after: 'query("SELECT * FROM users WHERE id = ?", [userId])'

  xss_innerhtml:
    before: 'element.innerHTML = userInput'
    after: 'element.textContent = userInput'

  xss_react:
    before: 'dangerouslySetInnerHTML={{ __html: content }}'
    after: 'dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content) }}'

  cmd_injection:
    before: 'exec("ls " + userPath)'
    after: 'execFile("ls", [userPath])'

  path_traversal:
    before: 'readFile(req.params.file)'
    after: 'readFile(path.join(SAFE_DIR, path.basename(req.params.file)))'
```

## Exceptions

```yaml
exceptions:
  # Fichiers de test
  - path: "**/*.test.ts"
  - path: "**/*.spec.ts"
  - path: "**/tests/**"

  # Fichiers de configuration sécurisés
  - path: "**/config/security.ts"

  # Avec commentaire explicite
  - comment: "// @security-ignore: {reason}"
```

## Logging

```yaml
logging:
  blocked:
    level: ERROR
    format: "[SECURITY] BLOCKED {vulnerability} in {file}:{line}"

  warning:
    level: WARN
    format: "[SECURITY] WARNING {vulnerability} in {file}:{line}"
```

