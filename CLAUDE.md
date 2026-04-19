# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

**Flugins** is a marketplace and collection of Claude Code plugins. This is a plugin development repository that:
- Hosts multiple plugins in the `plugins/` directory
- Maintains a plugin marketplace via `.claude-plugin/marketplace.json`
- Uses MkDocs for documentation hosted on GitHub Pages
- Follows a specific plugin structure standard for Claude Code

## Repository Structure

```
flugins/
├── .claude-plugin/
│   └── marketplace.json        # Marketplace registry of all plugins
├── plugins/                     # Individual plugin implementations
│   └── {plugin-name}/
│       ├── .claude-plugin/
│       │   └── plugin.json     # Plugin metadata
│       ├── commands/           # Command definitions (markdown files)
│       ├── skills/             # Agent skills (optional)
│       └── agents/             # Custom agents (optional)
├── docs/                       # MkDocs documentation source
│   ├── index.md               # Documentation homepage
│   ├── contribution/          # Development guides
│   └── plugin-catalog/        # Plugin documentation
└── mkdocs.yml                 # MkDocs configuration
```

## Plugin Architecture

### Plugin Structure Requirements

Each plugin MUST follow this structure:

```
plugins/{plugin-name}/
├── .claude-plugin/
│   └── plugin.json            # Required: name, description, version, author
├── commands/                   # Optional: command definitions
│   └── {command-name}.md      # Markdown with YAML frontmatter
├── skills/                     # Optional: model-invoked skills
│   └── {skill-name}/
│       └── SKILL.md
├── agents/                     # Optional: custom agents
└── hooks/                      # Optional: event handlers
    └── hooks.json
```

**CRITICAL**: Do not put `commands/`, `agents/`, `skills/`, or `hooks/` inside `.claude-plugin/`. Only `plugin.json` belongs there.

### Command File Format

Commands are markdown files with YAML frontmatter:

```markdown
---
allowed-tools: Read, Write, Bash(git *)
description: Brief command description
disable-model-invocation: false
---

# Command Title

Usage: `/plugin-name:command-name [args]`

Step-by-step instructions for Claude Code...
```

### Marketplace Registration

When adding a new plugin, update `.claude-plugin/marketplace.json`:

```json
{
  "plugins": [
    {
      "name": "plugin-name",
      "source": "./plugins/plugin-name",
      "description": "What it does",
      "author": {
        "name": "Name",
        "email": "email@example.com"
      },
      "keywords": ["keyword1", "keyword2"]
    }
  ]
}
```

## Documentation System

### MkDocs Structure

Documentation uses MkDocs Material theme with the awesome-pages plugin:
- `docs/index.md` — Main documentation homepage
- `docs/contribution/` — Plugin development guides
- `docs/plugin-catalog/` — Individual plugin documentation pages

### Documentation Commands

Build and serve documentation locally:
```bash
# Install dependencies
pip install mkdocs-material mkdocs-awesome-pages-plugin

# Serve locally at http://127.0.0.1:8000
mkdocs serve

# Build static site to site/
mkdocs build
```

### Auto-Deployment

Documentation automatically deploys to GitHub Pages when:
- Changes pushed to `main` branch
- Files modified in `docs/**` or `mkdocs.yml`

See `.github/workflows/docs.yml` for deployment workflow.

## Development Workflow

### Testing Plugins Locally

Use `--plugin-dir` flag to test plugins during development:

```bash
# Test single plugin
claude --plugin-dir ./plugins/plugin-name

# Test multiple plugins
claude --plugin-dir ./plugins/plugin-one --plugin-dir ./plugins/plugin-two
```

Or add as local marketplace:

```bash
# Add local marketplace
/plugin marketplace add .

# Install plugin
/plugin install plugin-name@flugins

# Test command
/plugin-name:command-name
```

### Adding a New Plugin

1. Create plugin directory structure in `plugins/`
2. Create `.claude-plugin/plugin.json` with metadata
3. Add command files in `commands/` directory
4. Register plugin in `.claude-plugin/marketplace.json`
5. Add plugin documentation page in `docs/plugin-catalog/`
6. Update `docs/plugin-catalog/index.md` with plugin entry
7. Test locally before committing

### Modifying an Existing Plugin

**IMPORTANT**: When adding, removing, or changing commands/skills in a plugin, always bump the version in that plugin's `.claude-plugin/plugin.json` (semver: patch for fixes, minor for new commands, major for breaking changes).

### Plugin Development Best Practices

**Command Instructions:**
- Write clear, step-by-step instructions
- Be explicit about when to ask user for input
- Include error handling in steps
- Specify output format

**Tool Permissions:**
- Request only necessary tools
- Use Bash patterns to restrict scope (e.g., `Bash(git log:*)`)
- Avoid broad permissions unless required

**Arguments:**
- Use `$ARGUMENTS` placeholder to capture user input
- Document expected argument format in command content

## Key Concepts

### Skills vs Commands

- **Commands**: User-invoked via `/plugin:command` syntax. Explicit execution.
- **Skills**: Model-invoked automatically based on task context. Defined in `skills/{skill-name}/SKILL.md`.

Skills activate proactively when Claude determines they're relevant to the current task.

### Allowed Tools

Common tools that can be specified in command frontmatter:
- `Read` — Read files
- `Write` — Create/overwrite files
- `Edit` — Edit existing files
- `Glob` — Find files by pattern
- `Grep` — Search file contents
- `Bash(pattern)` — Execute bash with restrictions
- `Task` — Launch specialized agents
- `AskUserQuestion` — Prompt user for input

## Documentation Requirements

### Plugin Documentation Page

Each plugin needs a documentation page at `docs/plugin-catalog/{plugin-name}.md` that includes:
- Overview of what the plugin does
- Installation instructions
- Available commands with usage examples
- Available skills (if any)
- Configuration details (if applicable)

### Catalog Index

Keep `docs/plugin-catalog/index.md` updated with links to all plugin documentation pages.

## Commit Conventions

This repository uses gitmoji (via `.gitpmoji/`). Common prefixes:
- `📝` (`:memo:`) — Documentation
- `✨` (`:sparkles:`) — New feature
- `🐛` (`:bug:`) — Bug fix
- `♻️` (`:recycle:`) — Refactoring
- `🔧` (`:wrench:`) — Configuration

## Plugin Examples

**Current plugins in repository:**
- `docs` — Documentation generation and synchronization tools
  - Commands: `/docs:generate-docs`, `/docs:sync-docs`
  - Skills: `docs-loader` (auto-loads project docs before code tasks)
- `git` — Smart git workflow commands with intelligent conflict resolution
  - Commands: `/git:rebase`, `/git:squash`, `/git:upstream-merge`, `/git:upstream-rebase`, `/git:worktree-start`, `/git:worktree-done`, `/git:worktree-kill`
  - Features: Intelligent conflict resolution, automatic commit squashing, upstream merging/rebasing, worktree lifecycle management
- `resolve-coderabbit` — Walk through CodeRabbit inline PR comments with per-comment user approval, then batch push + reply + resolve
  - Skills: `resolve-coderabbit` (model-invoked or user-invocable)
  - Features: Per-comment verify-before-fix loop, one-commit-per-fix, unit-test gate, batched push with SHA-referenced replies and GraphQL thread resolves

Refer to `plugins/docs/` and `plugins/git/` as reference implementations for plugin structure.

## Important Notes

- Maximum 3 levels of nesting in documentation structure (prefer 2)
- Each documentation folder MUST have an `index.md` with links and descriptions
- Plugin names use lowercase with hyphens (e.g., `my-plugin`)
- Skills namespace matches plugin name (e.g., `plugin-name:skill-name`)
- After modifying plugins, restart Claude Code to pick up changes
