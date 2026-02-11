---
name: security-guard
description: Bloque les commandes dangereuses et détecte les secrets

hooks:
  - event: PreToolUse
    match_tools: ["Bash"]
---

# Security Guard Hook

## Objectif
Intercepter les commandes Bash dangereuses AVANT exécution.

## Commandes à BLOQUER (décision: block)

| Pattern | Risque |
|---------|--------|
| `rm -rf /` | Destruction système |
| `rm -rf ~` | Destruction home |
| `chmod 777` | Permissions dangereuses |
| `:(){ :\|:& };:` | Fork bomb |
| `> /dev/sda` | Destruction disque |
| `mkfs.` | Formatage disque |
| `dd if=` sur disque système | Destruction données |

## Commandes à AVERTIR (décision: warn)

| Pattern | Action |
|---------|--------|
| `sudo` | Demander confirmation |
| `curl \| bash` | Avertir du risque |
| `wget \| sh` | Avertir du risque |
| Secrets dans commande | Suggérer variable env |

## Détection de secrets

Patterns à détecter :
- `password=`, `pwd=`
- `api_key=`, `apikey=`
- `secret=`, `token=`
- `AWS_`, `GITHUB_TOKEN`

## Format de réponse

Si BLOQUÉ :
```
🛑 COMMANDE BLOQUÉE

Raison : [explication]
Commande : [commande détectée]

Alternative suggérée : [si applicable]
```

Si AVERTISSEMENT :
```
⚠️ ATTENTION

Risque détecté : [description]
Voulez-vous continuer ? (expliquer pourquoi)
```

Si OK :
Laisser passer sans commentaire.

## Logging

Chaque déclenchement doit être loggé dans `.claude/logs/hooks-history.json` :

```yaml
logging:
  file: ".claude/logs/hooks-history.json"

  on_trigger:
    update_stats:
      path: "stats.by_hook.security-guard.triggers"
      action: "increment"

  on_block:
    add_event:
      hook: "security-guard"
      event: "PreToolUse"
      result: "BLOCK"
      details:
        command: "{blocked_command}"
        pattern_matched: "{pattern}"
        reason: "{reason}"
    update_stats:
      path: "stats.by_hook.security-guard.blocks"
      action: "increment"

  on_warn:
    update_stats:
      path: "stats.by_hook.security-guard.warnings"
      action: "increment"
```
