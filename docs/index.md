# Home

Flugins is a curated collection of Claude Code plugins developed and maintained by Flopsstuff.
It serves as a hub for extending Claude Code's capabilities with custom tools, integrations, and functionality.

## Goals

- **Extend Claude Code**: Provide additional tools and capabilities beyond the built-in features
- **Community-Driven**: Create a collection of useful plugins based on community needs
- **Easy Distribution**: Offer a simple marketplace-based installation system
- **Quality Assurance**: Maintain high-quality, well-tested plugins

## Quick Start

```bash
# Add the marketplace
claude plugin marketplace add Flopsstuff/flugins

# Install a plugin
claude plugin install <plugin-name>@flugins

# Update plugins
claude plugin update <plugin-name>@flugins
```

## Documentation

- [Getting Started](getting-started.md) — Installation and setup
- [Plugin Catalog](plugin-catalog/index.md) — Available plugins
- [Contribution](contribution/index.md) — Creating plugins, API reference, contributing guidelines

## Architecture

```
flugins/
├── .claude-plugin/
│   └── marketplace.json    # Marketplace metadata
├── plugins/                 # Plugin implementations
├── docs/                    # Documentation
└── README.md
```

## Links

- [GitHub Repository](https://github.com/Flopsstuff/flugins)
- [Issue Tracker](https://github.com/Flopsstuff/flugins/issues)
- [License](../LICENSE) (MIT)
