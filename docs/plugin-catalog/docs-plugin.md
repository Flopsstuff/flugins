# Docs Plugin

**Name:** `docs`

**Description:** Generate and keep documentation in sync with your codebase

**Author:** Flop (flopspm@gmail.com)

**Version:** 1.2.0

**Keywords:** documentation, sync, git, automation

The Docs plugin helps automate documentation workflows by generating initial documentation for undocumented projects and keeping existing documentation synchronized with code changes.

## Installation

```bash
claude plugin install docs@flugins
```

**Important:** After installing the plugin, restart Claude Code to activate skills.

**Tip:** Enable auto-update via `/plugin` → **Installed** → select the plugin → enable auto-update.

## Features

### Commands

- [Generate Documentation](#generate-documentation) - Create initial docs for undocumented areas
- [Sync Documentation](#sync-documentation) - Update docs based on recent commits

### Skills

- [Documentation Loader](#documentation-loader) - Automatically loads project documentation before code tasks

---

## Generate Documentation

**Command:** `/docs:generate-docs`

Analyzes your project structure and creates initial documentation for undocumented areas.

### Usage

```bash
/docs:generate-docs
```

### What it does

1. Asks you to specify the documentation folder (e.g., `docs/`, `documentation/`)
2. Scans existing documentation to understand what's already covered
3. Analyzes project structure:
   - Identifies project type (Node.js, Python, Rust, Go, etc.)
   - Locates main source directories
   - Finds entry points and configuration files
4. Identifies documentation gaps:
   - Missing API documentation
   - Undocumented configuration options
   - Missing architecture overview
   - Missing getting started guide
   - Undocumented CLI commands
5. Proposes 3-5 most-needed documents
6. Creates approved documents with proper structure and content

### Example Workflow

```bash
# Run the command
/docs:generate-docs

# Claude will ask: "Which folder should I use for documentation?"
docs/

# Claude analyzes the project and proposes documents
# Example output:
# "I suggest creating the following documents:
#  1. api-reference.md - API endpoints and usage
#  2. architecture.md - System design and components
#  3. troubleshooting.md - Common issues and solutions
#  Confirm creation (yes/no) or specify which document numbers to create"

# Approve all or select specific documents
yes
# or
1, 3
```

### Best Practices

- Run this when starting a new project to establish documentation structure
- Use it to fill gaps in partially documented projects
- Review and customize generated documents to match your project's specific needs
- Keep the generated documents as a starting point and iterate on them

### Use Cases

- **New Project Setup:** Generate complete initial documentation set
- **Documentation Audit:** Identify and fill gaps in existing documentation
- **Onboarding:** Create comprehensive guides for new team members
- **Open Source:** Quickly establish professional documentation for public projects

---

## Sync Documentation

**Command:** `/docs:sync-docs [N]` (days) or `/docs:sync-docs [N]commits` (commit count)

Analyzes recent git history and updates documentation to reflect code changes. The lookback window is measured in **days by default**; commit counts are opt-in via an explicit `commit`/`commits` suffix.

### Usage

```bash
# Look back 1 day (default)
/docs:sync-docs

# Look back a number of days (bare number = days)
/docs:sync-docs 7
/docs:sync-docs 30

# Analyze an explicit number of commits (commit/commits suffix)
/docs:sync-docs 10commits
/docs:sync-docs 1commit
```

### Parameters

- `N` (optional): Lookback window. Interpreted as **days** when a bare number is given, defaulting to **1 day** if omitted.
- `Ncommits` / `Ncommit` (optional): Analyze exactly N recent commits instead of a day window (the `commit`/`commits` suffix may optionally be separated by a space, e.g. `10 commits`).

Invalid arguments (zero, negative, fractional, non-numeric, or unsupported suffixes) are rejected with a message explaining the accepted formats, and no `git` command is run.

### What it does

1. Parses the argument to pick a **days** window (default 1 day) or an explicit **commits** count, then gathers that history from git
2. Analyzes commit messages and full diffs to understand changes
3. Reads the current state of all modified files
4. Identifies the documentation folder automatically
5. Compares documentation with actual code:
   - New features not yet documented
   - Removed features still mentioned in docs
   - Changed APIs or configurations
   - Outdated code examples
   - Broken file references
6. Updates all affected documentation files
7. Provides a summary of changes made

### Example Workflow

```bash
# After making several code changes
git add .
git commit -m "Add authentication middleware"
git commit -m "Update API endpoints"
git commit -m "Refactor database connection"

# Sync documentation with the last 3 commits
/docs:sync-docs 3commits

# Claude analyzes changes and updates relevant docs
# Example output:
# "Updated documentation based on 3 recent commits:
#  - api-reference.md: Added new /auth endpoints
#  - architecture.md: Updated authentication flow diagram
#  - getting-started.md: Added authentication setup steps"
```

### Best Practices

- Run after completing a feature or significant change
- Widen the window for major refactors — more days (e.g. `14`) or a larger commit count (e.g. `20commits`)
- Review the changes to ensure accuracy
- Combine with regular code reviews
- Set up as a pre-release checklist item

### Use Cases

- **Feature Development:** Keep docs updated as you add new features
- **Refactoring:** Ensure architectural changes are reflected in docs
- **API Changes:** Automatically update endpoint documentation
- **Configuration Updates:** Sync environment variable docs with code
- **Pre-Release:** Verify documentation is current before releases
- **CI/CD Integration:** Run as part of your documentation validation pipeline

### Checked Areas

The sync command thoroughly checks:

- Architecture documentation
- Project structure and file listings
- Environment variables and configuration
- API endpoint documentation
- README files and navigation links
- Code examples and API usage
- Installation and setup instructions
- Dependencies and requirements

---

## Tips and Tricks

### Documentation Workflow

1. **Initial Setup:** Use `/docs:generate-docs` to create documentation structure
2. **Continuous Sync:** Use `/docs:sync-docs` regularly during development
3. **Pre-Release:** Run `/docs:sync-docs 20commits` (or a wider day window) before releases to catch all changes
4. **After Merges:** Sync after merging feature branches to update docs

### Performance Optimization

- Use a short window (the default 1 day, or a few `days`/`commits`) for quick daily syncs
- Use a wider window (more days, or `10commits`–`20commits`) for comprehensive pre-release checks
- Run generate-docs once, then rely on sync-docs for updates

### Integration Ideas

- Add sync-docs to your PR checklist
- Create a git hook to remind you to sync docs before pushing
- Document your documentation workflow in CONTRIBUTING.md
- Add Github action with Claude to update docs on commit

---

## Documentation Loader

**Skill:** `docs-loader`
**Type:** Model-invoked (automatic)

The Documentation Loader skill automatically loads relevant project documentation into context before Claude performs code-related tasks (features, refactoring, bugs, architecture). This ensures changes align with project patterns, architecture, and conventions.

### How it Works

When you ask Claude to work with code, this skill delegates discovery and reading to the `Explore` subagent in a single call. The subagent:

1. **Searches documentation directories** - Looks in `docs/`, `documentation/`, or `.docs/`
2. **Reads the index** - Loads `index.md` or `README.md` to understand the structure
3. **Selects relevant docs** - Picks the 2–4 most relevant files for the user's task
4. **Spot-checks claims** - Verifies key file paths, function names, and patterns against the actual code
5. **Returns the contents** - Hands back file contents plus a `⚠️ DOCS MISMATCH` block if any discrepancy was found

Claude then uses the loaded documentation to align with documented patterns, cite specific sections when making decisions, and warn the user about any drift between docs and code.

### When it Activates

The skill activates proactively for:

- ✓ Adding new features or functionality
- ✓ Refactoring existing code
- ✓ Fixing bugs requiring architectural understanding
- ✓ Explaining how the codebase works
- ✓ Multi-file changes
- ✓ Tasks requiring alignment with project patterns

The skill skips activation for:

- ✗ Simple typo fixes
- ✗ One-line changes to known code
- ✗ Pure debugging with stack traces
- ✗ When explicitly told to skip docs

### Example Usage

**Without docs-loader:**
```
User: "Add a POST /api/users endpoint"
Claude: Creates endpoint based on general best practices
```

**With docs-loader:**
```
User: "Add a POST /api/users endpoint"
Claude:
  1. Loads docs/architecture/api-patterns.md
  2. Loads docs/security/auth.md
  3. Creates endpoint following project's specific patterns
  4. Uses project's validation approach
  5. Matches existing API structure
```

### Benefits

- **Consistency:** New code matches existing patterns and conventions
- **Architecture alignment:** Changes respect documented architectural decisions
- **Faster development:** No need to manually read docs before each task
- **Better quality:** Code follows project-specific best practices
- **Context awareness:** Claude understands your project's unique structure

### What Documentation to Provide

For best results, maintain documentation covering:

- **Architecture overview** - System design and component relationships
- **Code patterns** - Naming conventions, file structure, common patterns
- **API documentation** - Endpoint structure, authentication, validation
- **Development guides** - Setup instructions, testing approaches
- **Configuration** - Environment variables, feature flags

The skill works with any documentation structure. See the [SKILL.md reference](https://github.com/Flopsstuff/flugins/blob/main/plugins/docs/skills/docs-loader/SKILL.md) for detailed behavior.

