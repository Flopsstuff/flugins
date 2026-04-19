---
name: docs-loader
description: Load project documentation before code tasks (features, refactoring, bugs, architecture) to align with project patterns and conventions. Searches docs/, documentation/, .docs/ folders and loads relevant files into context.
disable-model-invocation: false
user-invocable: true
allowed-tools: Task
---

# Documentation Loader

**Skip this skill when:**
- Simple typo fixes
- One-line changes to known code
- User explicitly says to skip docs
- Pure debugging with stack traces

## Workflow

### 1. Launch Explore Subagent

**CRITICAL: You MUST use the Task tool with `subagent_type=Explore` for documentation loading.** Do NOT use Glob or Read directly — delegate everything to the Explore agent in a single call.

Compose a prompt for the Explore subagent that includes:
- **The user's task** — so the agent knows what documentation is relevant
- **Where to look** — `docs/`, `documentation/`, `.docs/` or similar directories
- **What to return** — contents of relevant documentation files
- **Verification** — check that documentation matches actual code

**Example prompt:**

```
The user wants to: [describe the task]

Find project documentation and return the contents of files relevant to this task.

1. Search for documentation directories: docs/, documentation/, .docs/
2. Read the index file (index.md or README.md) to understand the documentation structure
3. Based on the user's task, select and read the 2-4 most relevant documentation files
4. For each loaded doc, spot-check that key claims (file paths, function names, patterns) match the actual codebase
5. Return the full contents of each relevant file

If any documentation is outdated or contradicts the code, include a "⚠️ DOCS MISMATCH" section at the end of your response listing each discrepancy: which doc, what it claims, and what the code actually does.

Prioritize: architecture/overview docs first, then task-specific docs.
Use "medium" thoroughness.
```

The Explore agent will autonomously find, evaluate, and return the relevant documentation. You do not need to specify exact file paths — the agent will discover them.

### 2. Work with Documentation Context

Once the Explore agent returns, use the loaded documentation to:

- Align with patterns and conventions described in docs
- Follow architectural principles
- Match code style from examples
- Cite specific sections when making decisions

**If the agent reported "⚠️ DOCS MISMATCH":**
- Treat the actual code as the source of truth
- Warn the user about the discrepancies before starting work
- Suggest updating the outdated docs after the main task is done

**Cite documentation when relevant:**
"According to docs/architecture/overview.md, the project uses a layered architecture..."

If during work you realize you need additional documentation, launch another Explore subagent with a focused prompt.

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
Launch Explore subagent (task context + docs discovery + read relevant files)
    ↓
Found? → NO → Ask user where docs are
    ↓ YES
    ↓
Begin task using documentation context
```

## Example Usage

**User request:** "Add a new authentication endpoint"

**Skill workflow:**
1. Task requires architecture knowledge → activate skill
2. Launch Explore subagent with prompt:
   "The user wants to add a new authentication endpoint. Find project documentation (docs/, documentation/, .docs/), read the index, and return the contents of files about API patterns, authentication, and coding conventions."
3. Explore agent returns contents of `docs/architecture/api-patterns.md` and `docs/security/auth.md`
4. Create endpoint following patterns from documentation
5. Reference: "Following the pattern in api-patterns.md, I've created..."

## Tips

- **One launch is enough** — give the Explore agent enough context to find everything in one go
- **Include the task** — always describe the user's task in the prompt so the agent picks relevant docs
- **Be selective** — ask for 2-4 most relevant files, not everything
- **Progressive loading** — if you need more docs mid-task, launch another Explore agent with a focused prompt
- **No docs found** — if the agent finds nothing, ask the user or proceed without docs
- **Outdated docs** — if docs reference outdated code, mention it to the user and treat current code as source of truth
