# Plugin Catalog

This catalog provides detailed documentation for all available plugins in the Flugins collection.

## Available Plugins

- [Docs Plugin](docs-plugin.md) - Generate and keep documentation in sync with your codebase
- [Git Plugin](git-plugin.md) - Smart git workflow commands with intelligent conflict resolution
- [Resolve CodeRabbit Plugin](resolve-coderabbit-plugin.md) - Walk through CodeRabbit inline PR comments, verify, fix, and batch-resolve
- [X Twitter Scraper Plugin](x-twitter-scraper-plugin.md) - Use Xquik for X data, exports, monitors, webhooks, and confirmation-gated publishing

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
