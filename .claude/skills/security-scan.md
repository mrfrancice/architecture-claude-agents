---
name: security-scan
description: "Scan complet de sécurité OWASP du projet"

arguments:
  - name: target
    description: "Fichier, dossier, ou 'all' pour tout le projet"
    required: false
    default: "all"
  - name: level
    description: "Niveau de scan (quick, standard, deep)"
    required: false
    default: "standard"
  - name: framework
    description: "Framework (auto, laravel, django, angular, react, vue, nestjs)"
    required: false
    default: "auto"

examples:
  - prompt: "/security-scan"
    description: "Scan complet du projet"
  - prompt: "/security-scan src/api/ deep"
    description: "Scan approfondi du dossier api"
  - prompt: "/security-scan all standard laravel"
    description: "Scan Laravel standard"
---

# 🔒 Security Scan

## Instructions

Effectuer un scan de sécurité complet basé sur OWASP Top 10.

## Étapes

### 1. Détection du Framework

Si `auto`:
- Chercher `artisan` → Laravel
- Chercher `manage.py` → Django
- Chercher `angular.json` → Angular
- Chercher `next.config` ou `react` dans package.json → React
- Chercher `vue` dans package.json ou `nuxt.config` → Vue
- Chercher `@nestjs` dans package.json → NestJS

### 2. Scan selon le Niveau

#### Quick (< 1 min)
```yaml
checks:
  - secrets_scan
  - critical_vulnerabilities
  - dependency_check
```

#### Standard (2-5 min)
```yaml
checks:
  - secrets_scan
  - injection_scan (SQL, XSS, CMD)
  - auth_issues
  - access_control
  - dependency_check
  - security_headers
```

#### Deep (5-15 min)
```yaml
checks:
  - all_standard_checks
  - data_exposure
  - cryptographic_failures
  - ssrf_detection
  - logging_audit
  - configuration_review
  - transitive_dependencies
```

### 3. Scans par Catégorie OWASP

#### A01 - Broken Access Control
```bash
# Routes sans protection
search_for_pattern("Route::(get|post).*(?!middleware)", paths_include_glob="**/routes/*.php")
search_for_pattern("path:.*(?!canActivate)", paths_include_glob="**/*-routing.module.ts")

# Accès direct aux ressources
search_for_pattern("\\.find\\(.*params\\.", paths_include_glob="**/*.ts")
```

#### A02 - Cryptographic Failures
```bash
# Hashing faible
search_for_pattern("md5\\(|sha1\\(", paths_include_glob="**/*.{php,py,ts,js}")

# Clés hardcodées
search_for_pattern("(secret|key|password)\\s*[:=]\\s*['\"][^'\"]{16,}['\"]", paths_include_glob="**/*.{ts,js,php,py}")
```

#### A03 - Injection
```bash
# SQL Injection
search_for_pattern("(raw|query)\\s*\\([^)]*\\$|\\+|\\{", paths_include_glob="**/*.{php,py,ts,js}")

# XSS
search_for_pattern("(innerHTML|v-html|dangerouslySetInnerHTML)", paths_include_glob="**/*.{vue,tsx,jsx,html}")

# Command Injection
search_for_pattern("(exec|system|spawn)\\s*\\([^)]*\\$|\\+|\\{", paths_include_glob="**/*.{php,py,ts,js}")
```

#### A04 - Insecure Design
```bash
# Manque de rate limiting
search_for_pattern("@(Post|Put|Delete).*(?!Throttle)", paths_include_glob="**/*.ts")

# Endpoints sensibles sans validation
search_for_pattern("/api/(admin|user|auth)", paths_include_glob="**/*.{ts,js,php}")
```

#### A05 - Security Misconfiguration
```bash
# Debug activé
search_for_pattern("DEBUG\\s*=\\s*True|debug:\\s*true", paths_include_glob="**/*.{py,ts,js,json}")

# CORS permissif
search_for_pattern("origin:\\s*['\"]\\*['\"]|Access-Control-Allow-Origin.*\\*", paths_include_glob="**/*.{ts,js,php}")

# Stack traces exposés
search_for_pattern("app.use\\(errorHandler\\)(?!.*production)", paths_include_glob="**/*.ts")
```

#### A06 - Vulnerable Components
```bash
# Vérifier les dépendances
npm audit --json
pip-audit --format=json
composer audit --format=json
```

#### A07 - Auth Failures
```bash
# Token sans expiration
search_for_pattern("jwt\\.sign\\([^)]*(?!expiresIn)", paths_include_glob="**/*.{ts,js}")

# Session sans régénération
search_for_pattern("login\\([^)]*\\)(?!.*regenerate)", paths_include_glob="**/*.php")

# Pas de MFA
search_for_pattern("class.*Auth.*(?!.*2fa|mfa|otp)", paths_include_glob="**/*.{ts,php,py}")
```

#### A08 - Data Integrity Failures
```bash
# Désérialisation non sécurisée
search_for_pattern("unserialize\\(|pickle\\.load|yaml\\.load(?!.*Loader)", paths_include_glob="**/*.{php,py}")

# Vérification de signature manquante
search_for_pattern("jwt\\.decode(?!.*verify)", paths_include_glob="**/*.{ts,js,py}")
```

#### A09 - Logging Failures
```bash
# Logs de données sensibles
search_for_pattern("(log|console)\\.(info|log|debug).*password|token|secret", paths_include_glob="**/*.{ts,js,php,py}")

# Pas de logging sur auth
search_for_pattern("login|logout(?!.*log)", paths_include_glob="**/*.{ts,php,py}")
```

#### A10 - SSRF
```bash
# Requêtes avec URL utilisateur
search_for_pattern("(fetch|axios|http|request)\\([^)]*\\$|req\\.(body|params|query)", paths_include_glob="**/*.{ts,js,php,py}")

# Redirections ouvertes
search_for_pattern("redirect\\([^)]*\\$|req\\.", paths_include_glob="**/*.{ts,js,php,py}")
```

### 4. Scan des Secrets

```bash
# API Keys
search_for_pattern("(AKIA|AIza|sk_live|pk_live|ghp_|github_pat)", paths_include_glob="**/*")

# Passwords
search_for_pattern("password\\s*[:=]\\s*['\"][^'\"]{8,}['\"]", paths_include_glob="**/*")

# Private keys
search_for_pattern("-----BEGIN.*PRIVATE KEY-----", paths_include_glob="**/*")
```

### 5. Audit des Dépendances

```bash
# NPM
npm audit --json > .security/npm-audit.json

# Python
pip-audit --format=json > .security/pip-audit.json

# PHP
composer audit --format=json > .security/composer-audit.json
```

## Format de Sortie

```markdown
# 🔒 Rapport de Sécurité

**Projet:** {project_name}
**Date:** {date}
**Framework:** {framework}
**Niveau:** {level}

## Résumé Exécutif

| Sévérité | Count | Status |
|----------|-------|--------|
| 🔴 Critical | {critical} | {status} |
| 🟠 High | {high} | {status} |
| 🟡 Medium | {medium} | {status} |
| 🟢 Low | {low} | {status} |

**Score de Sécurité:** {score}/100

## Vulnérabilités par Catégorie OWASP

### A01 - Broken Access Control
| Fichier | Ligne | Issue | Sévérité |
|---------|-------|-------|----------|
{findings_a01}

### A03 - Injection
| Fichier | Ligne | Type | Sévérité |
|---------|-------|------|----------|
{findings_a03}

[... autres catégories ...]

## Secrets Détectés

| Type | Fichier | Ligne | Masqué |
|------|---------|-------|--------|
{secrets}

## Dépendances Vulnérables

| Package | Version | CVE | Sévérité | Fix |
|---------|---------|-----|----------|-----|
{dependencies}

## Recommandations Prioritaires

1. 🔴 **[CRITIQUE]** {recommendation_1}
2. 🔴 **[CRITIQUE]** {recommendation_2}
3. 🟠 **[HIGH]** {recommendation_3}

## Actions Automatiques Disponibles

- [ ] Corriger les injections SQL (X fichiers)
- [ ] Ajouter DOMPurify pour XSS (X fichiers)
- [ ] Mettre à jour les dépendances vulnérables
- [ ] Supprimer les secrets hardcodés

## Prochaines Étapes

1. Corriger les vulnérabilités critiques immédiatement
2. Planifier la correction des vulnérabilités high dans la semaine
3. Intégrer le scan dans le pipeline CI/CD
4. Former l'équipe sur les bonnes pratiques OWASP
```

## Score de Sécurité

```yaml
scoring:
  base: 100
  deductions:
    critical: -25
    high: -10
    medium: -5
    low: -2
    secrets: -15
    vulnerable_deps: -10

  grades:
    A: 90-100
    B: 80-89
    C: 70-79
    D: 60-69
    F: 0-59
```

