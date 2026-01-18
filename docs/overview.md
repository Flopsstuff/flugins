# Overview

## What is Flugins?

Flugins is a curated collection of Claude Code plugins developed and maintained by Flopsstuff. It serves as a centralized marketplace for extending Claude Code's capabilities with custom tools, integrations, and functionality.

## Purpose

The main goals of Flugins are to:

1. **Extend Claude Code**: Provide additional tools and capabilities beyond the built-in features
2. **Community-Driven**: Create a collection of useful plugins based on community needs
3. **Easy Distribution**: Offer a simple marketplace-based installation system
4. **Quality Assurance**: Maintain high-quality, well-tested plugins

## Architecture

Flugins uses a marketplace-based architecture:

```
flugins/
├── .claude-plugin/
│   └── marketplace.json    # Marketplace metadata
├── plugins/                 # Plugin implementations (coming soon)
├── docs/                    # Documentation
└── README.md               # Main README
```

### Marketplace Configuration

The marketplace is defined in `.claude-plugin/marketplace.json`:

```json
{
  "name": "flugins",
  "owner": {
    "name": "Flopsstuff"
  },
  "metadata": {
    "description": "Collection of Claude Code plugins by Flopsstuff",
    "version": "0.0.1"
  },
  "plugins": []
}
```

## Current Status

Flugins is currently in its initial phase (v0.0.1):

- ✅ Marketplace structure established
- ✅ GitHub repository set up
- ✅ Claude Code integration configured
- ⏳ Plugins coming soon

## Integration with Claude Code

Flugins integrates seamlessly with Claude Code through:

1. **GitHub Actions**: Automated workflows for CI/CD
2. **Marketplace System**: Easy plugin discovery and installation
3. **Command Interface**: Simple `/plugin` commands for management

## License

Flugins is open-source software licensed under the MIT License. See [LICENSE](../LICENSE) for details.
