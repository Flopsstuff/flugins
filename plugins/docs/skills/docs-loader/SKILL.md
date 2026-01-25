---
name: docs-loader
description: Automatically load and reference project documentation before performing tasks. Use this skill when working with code (adding features, refactoring, fixing bugs, explaining architecture) to ensure changes align with project patterns, architecture, and conventions. The skill finds documentation in docs/, documentation/, or .docs/ folders, reads the index file (index.md or README.md), and loads relevant documentation into context based on the task at hand.
---

# Documentation Loader

Automatically load project documentation into context before performing code-related tasks.

## When This Skill Activates

This skill should activate proactively for any code-related work:

- Adding new features or functionality
- Refactoring existing code
- Fixing bugs that require architectural understanding
- Explaining how the codebase works
- Making changes that affect multiple files
- Any task requiring alignment with project patterns

## Workflow

Follow these steps sequentially:

### 1. Assess Documentation Need

Before starting any code task, determine if documentation would be helpful:

**Load documentation when:**
- Adding new features (need architecture patterns)
- Refactoring (need to maintain consistency)
- Multi-file changes (need overall structure)
- Unclear architecture or patterns
- User asks about "how it works"

**Skip documentation when:**
- Simple typo fixes
- One-line changes to known code
- User explicitly says to skip docs
- Pure debugging with stack traces

### 2. Locate Documentation Directory

Search for documentation in this order:

1. `docs/` (most common)
2. `documentation/`
3. `.docs/`

Use Glob to find the directory:

```
pattern: "**/docs"
or
pattern: "**/documentation"
or
pattern: "**/.docs"
```

**If no directory found:** Ask the user where documentation is located or if it exists.

### 3. Read Index File

Once documentation directory is found, read the index file:

**Try in order:**
1. `docs/index.md`
2. `docs/README.md`

The index file typically contains:

- Table of contents
- Documentation structure
- Links to specific docs
- Brief descriptions of each document

**Example index structure:**
```markdown
# Project Documentation

## Architecture
- [Overview](architecture/overview.md) - System architecture
- [Data Flow](architecture/data-flow.md) - How data moves

## Development
- [Setup](development/setup.md) - Getting started
- [Patterns](development/patterns.md) - Code patterns

## API
- [Endpoints](api/endpoints.md) - API reference
```

### 4. Determine Relevant Documentation

Based on the task and index contents, identify which documents to load:

**For feature additions:**
- Architecture overview
- Code patterns/conventions
- API documentation (if applicable)
- Similar feature examples

**For refactoring:**
- Code patterns
- Architecture overview
- Style guides

**For bug fixes:**
- Architecture overview
- Module-specific docs
- Common issues/troubleshooting

**For explanations:**
- Start with overview/architecture
- Add specific module docs as needed

### 5. Load Documentation

Read the identified documentation files into context using the Read tool:

```
Read: docs/architecture/overview.md
Read: docs/development/patterns.md
```

**Loading strategy:**
- Load overview/architecture first (provides context)
- Load 2-4 most relevant documents initially
- Can load more if needed during work
- Prioritize shorter documents over long ones

### 6. Reference During Work

As you work on the task:

- Align with patterns described in docs
- Follow architectural principles
- Match code style from examples
- Reference specific sections when making decisions

**Cite documentation when relevant:**
"According to docs/architecture/overview.md, the project uses a layered architecture..."

## Common Documentation Structures

### Typical doc organization patterns:

**Pattern 1: By topic**
```
docs/
├── index.md
├── architecture/
├── development/
├── api/
└── deployment/
```

**Pattern 2: Flat structure**
```
docs/
├── README.md
├── architecture.md
├── setup.md
└── api-reference.md
```

**Pattern 3: Framework docs (e.g., VitePress, Docusaurus)**
```
docs/
├── .vitepress/
├── index.md
├── guide/
└── reference/
```

## Decision Tree

```
Task received
    ↓
Is it code-related? → NO → Skip this skill
    ↓ YES
    ↓
Will docs help? → NO → Skip this skill
    ↓ YES
    ↓
Find docs directory
    ↓
Found? → NO → Ask user
    ↓ YES
    ↓
Read index file (index.md or README.md)
    ↓
Identify relevant docs based on task
    ↓
Load 2-4 most relevant docs
    ↓
Begin task with documentation context
    ↓
Load additional docs if needed during work
```

## Tips

- **Be selective**: Don't load all documentation, only what's relevant
- **Start broad**: Load overview/architecture first
- **Progressive loading**: Load more specific docs as needed
- **Check freshness**: If docs seem outdated, mention this to user
- **No docs found**: If no documentation exists, work without it and suggest creating docs afterward
- **Ask when unsure**: If multiple docs could be relevant, ask user which to prioritize

**Need more examples?** See [decision-examples.md](references/decision-examples.md) for detailed scenarios and decision patterns.

## Example Usage

**User request:** "Add a new authentication endpoint"

**Skill workflow:**
1. ✓ Code task requiring architecture knowledge
2. Find docs directory → `docs/`
3. Read `docs/index.md` → see structure:
   - architecture/api-patterns.md
   - security/auth.md
   - development/coding-style.md
4. Load relevant docs:
   - `docs/architecture/api-patterns.md` (endpoint patterns)
   - `docs/security/auth.md` (auth implementation)
5. Create endpoint following patterns from documentation
6. Reference: "Following the pattern in api-patterns.md, I've created..."

## Error Handling

**Documentation directory not found:**
- Inform user: "I couldn't find a docs/ directory. Where is the project documentation located?"
- Offer to proceed without docs if none exists

**Index file missing:**
- List available .md files in docs/
- Ask user which documents are most important
- Or load README.md as fallback

**Documentation seems outdated:**
- Mention to user: "The documentation in X references outdated code"
- Proceed with current code as source of truth
- Suggest updating docs after task completion

**Too many documentation files:**
- Load overview first
- Ask user: "I found 20+ doc files. Which areas should I focus on for this task?"
