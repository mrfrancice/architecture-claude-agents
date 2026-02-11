# 🔐 Secrets Scanner Hook

---
name: secrets-scanner
description: "Détecte et bloque les secrets, API keys, credentials dans le code"
event: PreToolUse
match_tools: ["Write", "Edit", "Bash", "mcp__plugin_serena_serena__replace_content", "mcp__plugin_serena_serena__create_text_file"]
---

## Instructions

Ce hook scanne le code AVANT écriture pour détecter les secrets et credentials hardcodés.

## Patterns de Détection

### 1. API Keys

```yaml
patterns:
  api_keys:
    # AWS
    - pattern: '(AKIA|ABIA|ACCA|ASIA)[0-9A-Z]{16}'
      type: "AWS Access Key"
      severity: CRITICAL

    - pattern: 'aws_secret_access_key\s*[=:]\s*["\'][A-Za-z0-9/+=]{40}["\']'
      type: "AWS Secret Key"
      severity: CRITICAL

    # Google
    - pattern: 'AIza[0-9A-Za-z-_]{35}'
      type: "Google API Key"
      severity: CRITICAL

    - pattern: '[0-9]+-[0-9A-Za-z_]{32}\.apps\.googleusercontent\.com'
      type: "Google OAuth Client ID"
      severity: HIGH

    # GitHub
    - pattern: 'gh[pousr]_[A-Za-z0-9_]{36,}'
      type: "GitHub Token"
      severity: CRITICAL

    - pattern: 'github_pat_[A-Za-z0-9_]{22,}'
      type: "GitHub Personal Access Token"
      severity: CRITICAL

    # Stripe
    - pattern: 'sk_live_[0-9a-zA-Z]{24,}'
      type: "Stripe Live Secret Key"
      severity: CRITICAL

    - pattern: 'pk_live_[0-9a-zA-Z]{24,}'
      type: "Stripe Live Public Key"
      severity: HIGH

    # Slack
    - pattern: 'xox[baprs]-[0-9]{10,13}-[0-9]{10,13}[a-zA-Z0-9-]*'
      type: "Slack Token"
      severity: CRITICAL

    # Twilio
    - pattern: 'SK[0-9a-fA-F]{32}'
      type: "Twilio API Key"
      severity: CRITICAL

    # SendGrid
    - pattern: 'SG\.[a-zA-Z0-9]{22}\.[a-zA-Z0-9]{43}'
      type: "SendGrid API Key"
      severity: CRITICAL

    # Mailchimp
    - pattern: '[0-9a-f]{32}-us[0-9]{1,2}'
      type: "Mailchimp API Key"
      severity: HIGH

    # Firebase
    - pattern: 'AAAA[A-Za-z0-9_-]{7}:[A-Za-z0-9_-]{140}'
      type: "Firebase Cloud Messaging Key"
      severity: CRITICAL
```

### 2. Passwords & Secrets

```yaml
patterns:
  passwords:
    # Password in variable
    - pattern: '(password|passwd|pwd|secret)\s*[=:]\s*["\'][^"\']{8,}["\']'
      type: "Hardcoded Password"
      severity: CRITICAL
      exceptions:
        - '(password|passwd|pwd)\s*[=:]\s*["\'](\$|process\.env|env\(|getenv)'

    # Connection strings
    - pattern: '(mysql|postgres|mongodb|redis)://[^:]+:[^@]+@'
      type: "Database Connection String with Password"
      severity: CRITICAL

    # Private keys
    - pattern: '-----BEGIN (RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----'
      type: "Private Key"
      severity: CRITICAL

    # JWT secrets
    - pattern: 'jwt[_-]?secret\s*[=:]\s*["\'][^"\']{16,}["\']'
      type: "JWT Secret"
      severity: CRITICAL
```

### 3. Tokens & Credentials

```yaml
patterns:
  tokens:
    # Bearer tokens
    - pattern: 'Bearer\s+[A-Za-z0-9-_=]+\.[A-Za-z0-9-_=]+\.?[A-Za-z0-9-_.+/=]*'
      type: "Bearer Token (JWT)"
      severity: HIGH

    # Basic auth
    - pattern: 'Basic\s+[A-Za-z0-9+/=]{20,}'
      type: "Basic Auth Credentials"
      severity: HIGH

    # OAuth tokens
    - pattern: 'ya29\.[0-9A-Za-z_-]+'
      type: "Google OAuth Access Token"
      severity: CRITICAL

    # Heroku
    - pattern: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}'
      type: "Possible Heroku API Key"
      severity: MEDIUM
```

### 4. Cloud Provider Credentials

```yaml
patterns:
  cloud:
    # Azure
    - pattern: 'AccountKey=[A-Za-z0-9+/=]{88}'
      type: "Azure Storage Account Key"
      severity: CRITICAL

    - pattern: '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
      type: "Azure Client ID/Tenant ID"
      severity: MEDIUM

    # DigitalOcean
    - pattern: 'dop_v1_[a-f0-9]{64}'
      type: "DigitalOcean Personal Access Token"
      severity: CRITICAL

    # Cloudflare
    - pattern: 'v1\.0-[a-f0-9]{24}-[a-f0-9]{146}'
      type: "Cloudflare API Token"
      severity: CRITICAL
```

### 5. Encryption Keys

```yaml
patterns:
  encryption:
    # Symmetric keys (hex)
    - pattern: '(aes|encryption|crypto)[_-]?key\s*[=:]\s*["\'][0-9a-fA-F]{32,}["\']'
      type: "Encryption Key (Hex)"
      severity: CRITICAL

    # Base64 keys
    - pattern: '(secret|key)\s*[=:]\s*["\'][A-Za-z0-9+/]{32,}={0,2}["\']'
      type: "Possible Base64 Encoded Key"
      severity: HIGH
```

## Actions

### Si Secret Détecté

```yaml
action: BLOCK
response: |
  🔐 **SÉCURITÉ: Secret détecté - Code bloqué**

  **Type:** {secret_type}
  **Sévérité:** {severity}
  **Fichier:** {file}:{line}
  **Aperçu:** {masked_preview}

  **Risques:**
  - Exposition des credentials en cas de fuite du code
  - Accès non autorisé aux services
  - Violation de conformité (PCI-DSS, SOC2, GDPR)

  **Solutions:**

  1. **Variables d'environnement:**
     ```
     # .env (ne pas commiter)
     API_KEY=votre_clé

     # Code
     const apiKey = process.env.API_KEY;
     ```

  2. **Gestionnaire de secrets:**
     - AWS Secrets Manager
     - HashiCorp Vault
     - Azure Key Vault
     - Google Secret Manager

  3. **Fichiers de configuration locaux:**
     ```
     # .gitignore
     .env
     .env.local
     secrets.json
     ```
```

### Masquage des Secrets dans les Logs

```yaml
masking:
  enabled: true
  pattern: '(.{4}).*(.{4})'
  replacement: '$1****$2'
  example: "AKIA1234****WXYZ"
```

## Fichiers à Surveiller

```yaml
high_risk_files:
  - "**/.env"
  - "**/.env.*"
  - "**/config.json"
  - "**/config.yaml"
  - "**/secrets.*"
  - "**/credentials.*"
  - "**/*.pem"
  - "**/*.key"
  - "**/id_rsa*"
```

## Exceptions

```yaml
exceptions:
  # Fichiers autorisés
  - path: ".env.example"
  - path: ".env.template"
  - path: "**/tests/**"
  - path: "**/*.test.*"

  # Valeurs placeholder
  - value: "your_api_key_here"
  - value: "CHANGE_ME"
  - value: "xxxxxxxxxx"
  - value: "TODO"
  - pattern: 'process\.env\.'
  - pattern: 'env\(["\']'
  - pattern: 'getenv\('
  - pattern: '\$\{.*\}'

  # Commentaire d'exception
  - comment: "// @secrets-ignore: {reason}"
```

## Intégration Git

```yaml
git_integration:
  # Bloquer les commits avec secrets
  pre_commit_check: true

  # Vérifier l'historique
  history_scan:
    enabled: true
    command: "git log -p | grep -E '{patterns}'"

  # Fichiers à ignorer automatiquement
  auto_gitignore:
    - ".env"
    - ".env.local"
    - "*.pem"
    - "*.key"
```

## Rapport

```yaml
report:
  format: |
    ## 🔐 Rapport Secrets Scanner

    | Type | Fichier | Ligne | Sévérité |
    |------|---------|-------|----------|
    {findings}

    ### Recommandations
    {recommendations}
```

