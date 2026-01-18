# Getting Started

This guide will help you get started with using Flugins in your Claude Code environment.

## Prerequisites

Before you begin, ensure you have:

- Claude Code installed and configured
- Access to the command line interface
- Basic understanding of Claude Code plugins

## Installation

### Step 1: Add the Marketplace

First, add the Flugins marketplace to your Claude Code configuration:

```bash
/plugin marketplace add Flopsstuff/flugins
```

This command registers the Flugins marketplace, allowing you to discover and install plugins from this collection.

### Step 2: Browse Available Plugins

Once the marketplace is added, you can browse available plugins:

```bash
/plugin list
```

This will show all plugins available in the Flugins marketplace.

### Step 3: Install a Plugin

To install a specific plugin:

```bash
/plugin install <plugin-name>@flugins
```

Replace `<plugin-name>` with the name of the plugin you want to install.

### Step 4: Verify Installation

Check that the plugin is installed correctly:

```bash
/plugin list --installed
```

## Updating Plugins

To keep your plugins up to date with the latest features and bug fixes:

```bash
/plugin update
```

This command updates all installed plugins to their latest versions.

## Uninstalling Plugins

If you no longer need a plugin:

```bash
/plugin uninstall <plugin-name>
```

## Configuration

Some plugins may require additional configuration. Check the individual plugin documentation for specific setup instructions.

## Troubleshooting

### Plugin Not Found

If you receive a "plugin not found" error:

1. Ensure the marketplace is added correctly
2. Verify the plugin name spelling
3. Check that the plugin exists in the marketplace

### Installation Fails

If installation fails:

1. Check your internet connection
2. Verify you have the necessary permissions
3. Review the error message for specific issues

### Plugin Not Working

If a plugin isn't functioning as expected:

1. Check the plugin documentation
2. Verify compatibility with your Claude Code version
3. Try reinstalling the plugin
4. Report issues on the [GitHub repository](https://github.com/Flopsstuff/flugins/issues)

## Next Steps

- Learn how to [create your own plugins](creating-plugins.md)
- Explore the [API Reference](api-reference.md)
- [Contribute](contributing.md) to the Flugins collection

## Getting Help

If you need assistance:

- Check the documentation
- Search existing [issues](https://github.com/Flopsstuff/flugins/issues)
- Open a new issue with details about your problem
