# Flugins

Collection of Claude Code plugins by Flopsstuff.

**[Documentation](https://flopsstuff.github.io/flugins/)**

## Installation

### Add the marketplace

```bash
claude plugin marketplace add Flopsstuff/flugins
```

### Install a plugin

```bash
claude plugin install <plugin-name>@flugins
```

Restart Claude Code afterwards so the plugin's commands and skills become active.

## Available Plugins

| Plugin | What it does |
|--------|--------------|
| [`docs`](https://flopsstuff.github.io/flugins/plugin-catalog/docs-plugin) | Generate and keep documentation in sync with your codebase |
| [`git`](https://flopsstuff.github.io/flugins/plugin-catalog/git-plugin) | Smart git workflow commands with intelligent conflict resolution |
| [`ksef`](https://flopsstuff.github.io/flugins/plugin-catalog/ksef-plugin) | Send and receive KSeF (Polish National e-Invoice System) invoices via the `ksef` CLI, with guided onboarding |
| [`resolve-coderabbit`](https://flopsstuff.github.io/flugins/plugin-catalog/resolve-coderabbit-plugin) | Walk through CodeRabbit inline PR comments, verify each against the code, and batch-resolve with commits and replies |
| [`codex-review`](https://flopsstuff.github.io/flugins/plugin-catalog/codex-review-plugin) | Run a Codex code review against a base branch and land each accepted fix as its own verified commit |
| [`meshy`](https://flopsstuff.github.io/flugins/plugin-catalog/meshy-plugin) | Generate 3D models, textures, rigs and animations from text or images via the Meshy AI API |
| [`n8n`](https://flopsstuff.github.io/flugins/plugin-catalog/n8n-plugin) | Author n8n workflows and drive any instance through its Public REST API |

See the [Plugin Catalog](https://flopsstuff.github.io/flugins/plugin-catalog/) for full documentation of every plugin.

## Extras

- [Statusline](./statusline/) — a custom Claude Code statusline (model, effort, context bar, branch, PR/MR status) as a standalone script.

## Configuration

Some plugins read API keys and endpoints from the environment. See [`.env.example`](./.env.example) for every variable, grouped by plugin.

## Contributing

See [AGENTS.md](./AGENTS.md) for the repository layout and plugin authoring conventions, and the [contribution guide](https://flopsstuff.github.io/flugins/contribution/) for the full walkthrough.

## License

MIT
