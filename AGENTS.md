# AGENTS.md

Guidance for AI coding agents working in this repository. `CLAUDE.md` is a symlink to this file, so any agent that looks for either name reads the same instructions.

The subject matter is Claude Code plugins, so product-specific names (`plugin.json`, `${CLAUDE_SKILL_DIR}`, the `claude` CLI) appear throughout — those are facts about the artifacts being built, not assumptions about which agent is reading this.

## Repository Overview

**Flugins** is a marketplace and collection of Claude Code plugins. This is a plugin development repository that:
- Hosts multiple plugins in the `plugins/` directory
- Maintains a plugin marketplace via `.claude-plugin/marketplace.json`
- Uses VitePress for documentation hosted on GitHub Pages
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
├── docs/                       # VitePress documentation source
│   ├── .vitepress/
│   │   └── config.mts         # VitePress configuration
│   ├── index.md               # Documentation homepage
│   ├── contribution/          # Development guides
│   ├── decisions/             # Engineering decision records (excluded from the built site)
│   └── plugin-catalog/        # Plugin documentation
├── statusline/                 # Standalone statusline script (not a plugin)
├── .env.example                # Every environment variable, grouped by plugin
└── package.json               # VitePress devDependency + docs scripts
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
├── hooks/                      # Optional: event handlers
│   └── hooks.json
└── .mcp.json                   # Optional: MCP servers bundled with the plugin
```

**CRITICAL**: Do not put `commands/`, `agents/`, `skills/`, or `hooks/` inside `.claude-plugin/`. Only `plugin.json` belongs there.

**CRITICAL**: A skill lives at `skills/{skill-name}/SKILL.md`, never at the plugin root. A root-level `SKILL.md` may still load, but it breaks the `${CLAUDE_SKILL_DIR}` contract described below — the variable would resolve to the plugin root instead of the skill directory.

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

Step-by-step instructions for the agent executing the command...
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

**Keep `marketplace.json` and each `plugin.json` in agreement.** `description` and `keywords` must match verbatim between the two — the marketplace entry is what users see when browsing, the plugin manifest is what they see once installed, and a drift between them is a documentation bug.

## Documentation System

### VitePress Structure

Documentation uses VitePress (default theme) with local search:
- `docs/index.md` — Main documentation homepage (hero layout)
- `docs/contribution/` — Plugin development guides
- `docs/plugin-catalog/` — Individual plugin documentation pages
- `docs/decisions/` — Engineering decision records, excluded from the build via `srcExclude`
- `docs/.vitepress/config.mts` — VitePress site configuration

Use **VitePress container syntax** for callouts (`::: tip`, `::: warning`, `::: danger` … `:::`). MkDocs-style admonitions (`!!! note`) render as plain text.

Every page added under `docs/plugin-catalog/` must also be registered in the sidebar in `docs/.vitepress/config.mts` — the catalog `index.md` link alone is not enough.

### Documentation Commands

Build and serve documentation locally:
```bash
# Install dependencies
npm install

# Serve locally at http://localhost:5173/flugins/
npm run docs:dev

# Build static site to docs/.vitepress/dist/
npm run docs:build

# Preview the built site
npm run docs:preview
```

### Auto-Deployment

Documentation automatically deploys to GitHub Pages when:
- Changes pushed to `main` branch
- Files modified in `docs/**`, `package.json`, `package-lock.json`, or `.github/workflows/docs.yml`

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
3. Add command files in `commands/` and/or skills in `skills/{skill-name}/SKILL.md`
4. Register plugin in `.claude-plugin/marketplace.json` (description and keywords identical to `plugin.json`)
5. Add plugin documentation page in `docs/plugin-catalog/`
6. Update `docs/plugin-catalog/index.md` with plugin entry
7. Register the page in the sidebar in `docs/.vitepress/config.mts`
8. Add the plugin to the table in `README.md` and to the plugin list at the bottom of this file
9. Document any environment variables in `.env.example`
10. Test locally before committing

### Modifying an Existing Plugin

**IMPORTANT**: When adding, removing, or changing commands/skills in a plugin, always bump the version in that plugin's `.claude-plugin/plugin.json` (semver: patch for fixes, minor for new commands, major for breaking changes). Metadata-only edits to `plugin.json` also warrant a patch bump so the marketplace picks the change up.

After bumping, update the `**Version:**` line on that plugin's page in `docs/plugin-catalog/` — the catalog header block mirrors `plugin.json` (name, description, version, keywords) and is easy to leave stale.

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

**Referencing bundled scripts & supporting files from a skill:**

Use `${CLAUDE_SKILL_DIR}` — it's the officially documented variable that resolves to the directory containing the skill's `SKILL.md` file. For plugin skills it points to `plugins/<plugin>/skills/<skill>/`, **not** the plugin root. Place scripts, reference docs, templates, etc. **inside the skill directory** (e.g. `skills/<skill>/scripts/*.sh`, `skills/<skill>/docs/*.md`) and invoke them as:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/self-check.sh"
```

Do **not** rely on `${CLAUDE_PLUGIN_ROOT}` inside skill or command markdown — that variable is documented but not reliably expanded by Claude Code's Bash tool when a skill/command executes shell snippets (see [anthropics/claude-code#9354](https://github.com/anthropics/claude-code/issues/9354) — long-open bug, has regressed multiple times). It *does* work inside JSON configs like `hooks/hooks.json` and `.mcp.json`, so it's fine there. For everything that lives in `SKILL.md` / `commands/*.md`, prefer `${CLAUDE_SKILL_DIR}` and keep all referenced files inside the skill.

Canonical skill layout (from the official docs):

```
skills/<skill-name>/
├── SKILL.md           # required
├── scripts/           # executable helpers, invoked via ${CLAUDE_SKILL_DIR}/scripts/...
├── docs/              # long-form reference material (loaded on demand, not into every session)
└── templates/         # anything the agent fills in
```

Reference: https://code.claude.com/docs/en/skills

## Key Concepts

### Skills vs Commands

- **Commands**: User-invoked via `/plugin:command` syntax. Explicit execution.
- **Skills**: Model-invoked automatically based on task context. Defined in `skills/{skill-name}/SKILL.md`.

Skills activate proactively when the runtime judges them relevant to the current task.

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
- A header block mirroring `plugin.json`: name, description, author, version, keywords
- Overview of what the plugin does
- Installation instructions
- Requirements (external CLIs, runtimes, environment variables)
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
- `ksef` — Send and receive KSeF (Polish National e-Invoice System) invoices via the `ksef` CLI
  - Skills: `ksef` (model-invoked or user-invocable)
  - Features: Guided onboarding (npm install → token generation in the government portal → NIP + token → login), invoice send/query/download, UPO retrieval, error triage keyed to KSeF status codes
- `resolve-coderabbit` — Walk through CodeRabbit inline PR comments with per-comment user approval, then batch push + reply + resolve
  - Skills: `resolve-coderabbit` (model-invoked or user-invocable)
  - Features: Per-comment verify-before-fix loop, one-commit-per-fix, unit-test gate, batched push with SHA-referenced replies and GraphQL thread resolves
- `codex-review` — Run a Codex code review against a base branch and triage every finding with the user
  - Skills: `codex-review` (model-invoked or user-invocable, accepts `--yes`, `--base`, `--uncommitted`, `--commit`)
  - Features: Findings extracted from the `codex review` session log, each claim re-verified against the current code, one commit per accepted fix, clean-tree gate with stash/pop
- `meshy` — Generate 3D models, textures, rigs and animations from text or images via the Meshy AI API
  - Skills: `meshy` (model-invoked)
  - Features: Zero-dependency Node client (`meshy.mjs`) handling the async create → poll → download lifecycle, credit balance checks, `--no-wait` fire-and-forget with later `status`/`download`, free test-mode key for dry runs
- `n8n` — Build n8n workflows and drive any instance through its Public REST API
  - Skills: `n8n-build` (authoring), `n8n-api` (operations) — split by verb: build vs inspect/run
  - Features: Zero-dependency Node client over `/api/v1`, live OpenAPI introspection (`spec`), raw `call` escape hatch, cursor auto-pagination, read-only field stripping on workflow updates, execution failure triage, and `trigger` to run a workflow through its webhook
  - Bundles two MCP servers (`plugins/n8n/.mcp.json`): the official n8n docs server, and the instance's own MCP server (`N8N_MCP_URL`/`N8N_MCP_TOKEN`) carrying the Workflow SDK used by `n8n-build`

**Not a plugin:** `statusline/` ships a standalone bash statusline script, wired through the `statusLine` entry in `settings.json` rather than through the marketplace. Documented at `docs/plugin-catalog/statusline.md`.

Refer to `plugins/docs/` and `plugins/git/` as reference implementations for command-based plugins, and `plugins/n8n/` or `plugins/meshy/` for skill-based ones with bundled scripts.

## Important Notes

- Maximum 3 levels of nesting in documentation structure (prefer 2)
- Each documentation folder MUST have an `index.md` with links and descriptions
- Plugin names use lowercase with hyphens (e.g., `my-plugin`)
- Skills namespace matches plugin name (e.g., `plugin-name:skill-name`)
- After modifying plugins, restart Claude Code to pick up changes
