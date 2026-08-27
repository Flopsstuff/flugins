# Plugin Catalog

This catalog provides detailed documentation for all available plugins in the Flugins collection.

## Available Plugins

- [Docs Plugin](docs-plugin.md) - Generate and keep documentation in sync with your codebase
- [Git Plugin](git-plugin.md) - Smart git workflow commands with intelligent conflict resolution
- [KSeF Plugin](ksef-plugin.md) - Send and receive KSeF (Polish e-invoice system) invoices via the ksef CLI, with guided onboarding for regular users
- [Resolve CodeRabbit Plugin](resolve-coderabbit-plugin.md) - Walk through CodeRabbit inline PR comments, verify, fix, and batch-resolve
- [Meshy Plugin](meshy-plugin.md) - Generate 3D models, textures, rigs and animations from text or images via the Meshy AI API
- [Codex Review Plugin](codex-review-plugin.md) - Run a codex review against a base branch, triage each finding with you, and land every accepted fix as its own commit

## Extras

- [Statusline](statusline.md) - A custom Claude Code statusline (model, effort, context bar, branch, PR/MR status) as a standalone script

## Installation Reference

### Installing the Flugins Marketplace

Before installing individual plugins, add the Flugins marketplace:

```bash
claude plugin marketplace add Flopsstuff/flugins
```

### Installing Plugins

```bash
claude plugin install <plugin-name>@flugins
```

### Updating Plugins

```bash
claude plugin update <plugin-name>@flugins
```

---

## Coming Soon

More plugins are in development! Check the [Flugins repository](https://github.com/Flopsstuff/flugins) for updates.

Interested in contributing? See the [Creating Plugins](../contribution/creating-plugins.md) guide.
