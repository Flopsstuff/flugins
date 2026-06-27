---
layout: home

hero:
  name: Flugins
  text: Claude Code plugins, curated.
  tagline: A hub of custom tools, integrations, and workflows that extend Claude Code — installable from one marketplace.
  actions:
    - theme: brand
      text: Getting Started
      link: /getting-started
    - theme: alt
      text: Plugin Catalog
      link: /plugin-catalog/
    - theme: alt
      text: View on GitHub
      link: https://github.com/Flopsstuff/flugins

features:
  - title: Extend Claude Code
    details: Add tools and capabilities beyond the built-in features — git workflows, documentation generation, PR review automation, and more.
    link: /plugin-catalog/
    linkText: Browse plugins
  - title: Easy distribution
    details: One marketplace command adds every plugin. Install, update, and manage plugins with a simple, consistent CLI flow.
    link: /getting-started
    linkText: Install in seconds
  - title: Community-driven
    details: A growing, open collection built around real workflows. Quality-focused and well-documented, with contributions welcome.
    link: /contribution/
    linkText: Start contributing
---

## Quick Start

```bash
# Add the marketplace
claude plugin marketplace add Flopsstuff/flugins

# Install a plugin
claude plugin install <plugin-name>@flugins

# Update plugins
claude plugin update <plugin-name>@flugins
```

## Goals

- **Extend Claude Code** — provide additional tools and capabilities beyond the built-in features.
- **Community-driven** — create a collection of useful plugins based on community needs.
- **Easy distribution** — offer a simple marketplace-based installation system.
- **Quality assurance** — maintain high-quality, well-tested plugins.

## Links

- [GitHub Repository](https://github.com/Flopsstuff/flugins)
- [Issue Tracker](https://github.com/Flopsstuff/flugins/issues)
- [License](https://github.com/Flopsstuff/flugins/blob/main/LICENSE) (MIT)
