# 📦 Dependency Audit Hook

---
name: dependency-audit
description: "Vérifie les vulnérabilités des dépendances avant installation"
event: PreToolUse
match_tools: ["Bash"]
match_commands: ["npm install", "npm i ", "yarn add", "pip install", "composer require", "go get", "cargo add"]
---

## Instructions

Ce hook analyse les dépendances AVANT installation pour détecter les vulnérabilités connues.

## Déclencheurs

```yaml
triggers:
  npm:
    - "npm install"
    - "npm i "
    - "npm add"
    - "yarn add"
    - "yarn install"
    - "pnpm add"
    - "pnpm install"

  python:
    - "pip install"
    - "pip3 install"
    - "poetry add"
    - "pipenv install"

  php:
    - "composer require"
    - "composer install"
    - "composer update"

  go:
    - "go get"
    - "go install"

  rust:
    - "cargo add"
    - "cargo install"

  ruby:
    - "gem install"
    - "bundle install"
    - "bundle add"
```

## Vérifications

### 1. Avant Installation (Pre-check)

```yaml
pre_install_checks:
  npm:
    command: "npm audit --json"
    parse: "json"
    severity_threshold: "high"

  python:
    command: "pip-audit --format=json"
    fallback: "safety check --json"
    severity_threshold: "high"

  php:
    command: "composer audit --format=json"
    severity_threshold: "high"

  go:
    command: "govulncheck ./..."
    severity_threshold: "high"

  rust:
    command: "cargo audit --json"
    severity_threshold: "high"
```

### 2. Analyse des Vulnérabilités

```yaml
vulnerability_analysis:
  sources:
    - name: "NVD (National Vulnerability Database)"
      url: "https://nvd.nist.gov/"

    - name: "GitHub Advisory Database"
      url: "https://github.com/advisories"

    - name: "Snyk Vulnerability DB"
      url: "https://snyk.io/vuln/"

    - name: "OSV (Open Source Vulnerabilities)"
      url: "https://osv.dev/"

  severity_levels:
    CRITICAL:
      action: BLOCK
      cvss: "9.0-10.0"

    HIGH:
      action: BLOCK
      cvss: "7.0-8.9"

    MEDIUM:
      action: WARN
      cvss: "4.0-6.9"

    LOW:
      action: INFO
      cvss: "0.1-3.9"
```

### 3. Packages Blacklistés

```yaml
blacklist:
  # Packages malveillants connus
  malicious:
    - "event-stream"  # Supply chain attack 2018
    - "flatmap-stream"
    - "ua-parser-js"  # Compromised versions
    - "coa"
    - "rc"

  # Packages dépréciés avec vulnérabilités
  deprecated_vulnerable:
    - "request"  # Deprecated, use axios/got
    - "querystring"  # Use URLSearchParams
    - "moment"  # Use dayjs/date-fns

  # Packages avec vulnérabilités critiques non corrigées
  unpatched:
    - "log4j < 2.17.0"  # Log4Shell
    - "lodash < 4.17.21"
    - "minimist < 1.2.6"
    - "node-forge < 1.3.0"
```

## Actions

### Si Vulnérabilité Critique/High

```yaml
action: BLOCK
response: |
  📦 **SÉCURITÉ: Installation bloquée - Vulnérabilités détectées**

  ## Vulnérabilités Critiques

  | Package | Version | CVE | Sévérité | CVSS |
  |---------|---------|-----|----------|------|
  {vulnerability_table}

  ## Détails

  ### {package_name}@{version}

  **CVE:** {cve_id}
  **Description:** {description}
  **Vecteur d'attaque:** {attack_vector}

  ## Solutions

  1. **Mettre à jour vers une version sécurisée:**
     ```bash
     npm install {package}@{safe_version}
     ```

  2. **Utiliser une alternative:**
     - {alternative_1}
     - {alternative_2}

  3. **Forcer l'installation (non recommandé):**
     ```bash
     # @security-override: {justification}
     npm install {package} --force
     ```

  ⚠️ Voulez-vous continuer malgré les risques?
```

### Si Vulnérabilité Medium/Low

```yaml
action: WARN
response: |
  ⚠️ **Avertissement: Vulnérabilités détectées**

  | Package | Version | Sévérité | Fix disponible |
  |---------|---------|----------|----------------|
  {vulnerability_table}

  L'installation continue mais pensez à mettre à jour ces packages.
```

## Vérification Post-Installation

```yaml
post_install:
  npm:
    - "npm audit"
    - "npm outdated"

  python:
    - "pip-audit"
    - "pip list --outdated"

  php:
    - "composer audit"

  report:
    generate: true
    path: ".security/dependency-audit-{date}.json"
```

## Fichiers de Lock

```yaml
lock_file_analysis:
  files:
    - "package-lock.json"
    - "yarn.lock"
    - "pnpm-lock.yaml"
    - "Pipfile.lock"
    - "poetry.lock"
    - "composer.lock"
    - "Cargo.lock"
    - "go.sum"
    - "Gemfile.lock"

  checks:
    - "integrity_verification"
    - "version_pinning"
    - "transitive_dependencies"
```

## Exceptions

```yaml
exceptions:
  # Packages avec vulnérabilités acceptées
  accepted_risks:
    - package: "example-package"
      version: "1.2.3"
      cve: "CVE-2023-XXXX"
      reason: "Vulnérabilité non exploitable dans notre contexte"
      approved_by: "security-team"
      expires: "2024-12-31"

  # Environnements de développement uniquement
  dev_only:
    - "devDependencies"
    - "dev-packages"
```

## Intégration CI/CD

```yaml
ci_integration:
  github_actions:
    workflow: |
      - name: Dependency Audit
        run: |
          npm audit --audit-level=high
          if [ $? -ne 0 ]; then
            echo "::error::Vulnerabilities found"
            exit 1
          fi

  gitlab_ci:
    script: |
      - npm audit --audit-level=high
      - composer audit

  jenkins:
    stage: "Security"
    steps:
      - "npm audit"
      - "dependency-check"
```

## Rapport

```yaml
report:
  format: markdown
  template: |
    # 📦 Rapport d'Audit des Dépendances

    **Date:** {date}
    **Projet:** {project_name}

    ## Résumé

    | Sévérité | Count |
    |----------|-------|
    | 🔴 Critical | {critical_count} |
    | 🟠 High | {high_count} |
    | 🟡 Medium | {medium_count} |
    | 🟢 Low | {low_count} |

    ## Vulnérabilités

    {vulnerabilities_details}

    ## Recommandations

    {recommendations}

    ## Prochaines Actions

    - [ ] Mettre à jour les packages critiques
    - [ ] Évaluer les alternatives pour les packages dépréciés
    - [ ] Configurer les alertes Dependabot/Snyk
```

