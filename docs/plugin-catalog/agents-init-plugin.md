# Agents Init Plugin

**Name:** `agents-init`

**Description:** Bootstrap a repository's agent instructions as one tool-agnostic AGENTS.md, with CLAUDE.md and GEMINI.md symlinked to it

**Author:** Flop (flopspm@gmail.com)

**Version:** 0.1.0

**Keywords:** agents, agents-md, claude-md, gemini-md, init, documentation, symlink, tool-agnostic

Every coding agent looks for its own instruction file: Claude Code reads `CLAUDE.md`, Gemini CLI reads `GEMINI.md`, and `AGENTS.md` is the cross-vendor convention. Maintaining all three as real files means three copies that drift apart, and stale instructions are worse than none. This plugin produces one real document and points the vendor filenames at it with symlinks, so there is only ever one thing to edit.

## Installation

```bash
claude plugin install agents-init@flugins
```

**Important:** After installing the plugin, restart Claude Code to activate skills.

**Tip:** Enable auto-update via `/plugin` → **Installed** → select the plugin → enable auto-update.

## Requirements

- Nothing beyond a working directory. `git` is used when the repository is tracked, so the rename keeps its history, but the skill works in an untracked directory too.
- A filesystem that supports symlinks. macOS and Linux are fine; see [Windows](#windows) below.

## Usage

```
/agents-init
/agents-init --lang ru
/agents-init --link .cursorrules
```

| Argument | Effect |
|---|---|
| `--lang <language>` | Write the document in this language. Default: English, regardless of the conversation's language. |
| `--link <name>` | Add another symlink alias (repeatable). Defaults are `CLAUDE.md` and `GEMINI.md`. |

The skill is also model-invoked: asking for agent docs to be set up, or for an existing `CLAUDE.md` to be made readable by other agents, is enough to trigger it.

## What it does

1. **Surveys** `AGENTS.md`, `CLAUDE.md` and `GEMINI.md`, classifying each as absent, a real file, or already a symlink. A hand-written file is never discarded — if two sources disagree, it asks rather than picking one.
2. **Generates** the document by invoking the built-in `init`, which analyzes the codebase for the commands that actually build, test and run it, plus the architecture that only emerges from reading several files together.
3. **Translates** if `--lang` asks for it, leaving code identifiers, paths and commands in their original form.
4. **Strips the vendor framing** — the `# CLAUDE.md` header and instructions addressed to one named tool — while keeping statements that are simply true about the repo, such as a real `.claude/settings.json` or a hook the project ships.
5. **Renames** to `AGENTS.md` with `git mv` when tracked, and creates relative symlinks for each alias.
6. **Verifies** by reading back through the symlinks, then reports. Changes are staged but not committed.

## Result

```
-rw-r--r--  AGENTS.md
lrwxr-xr-x  CLAUDE.md -> AGENTS.md
lrwxr-xr-x  GEMINI.md -> AGENTS.md
```

Re-running on a repository that is already in this shape is a no-op, so the skill is safe to invoke again after the instructions have been edited.

## Notes

### Windows

Git stores symlinks correctly, but cloning on Windows without developer mode or `core.symlinks=true` materializes them as plain text files containing the target path. The skill flags this when relevant rather than avoiding the layout.

### Ignored CLAUDE.md

Some repositories list `CLAUDE.md` in `.gitignore` as a personal scratch file. The skill checks with `git check-ignore` and points it out, because an ignored symlink never reaches other clones. It does not edit ignore rules on its own.

### Nested instruction files

Agent instructions can live in subdirectories and apply to that subtree. The skill handles one directory per run — the repository root unless told otherwise — so that its survey of existing files stays accurate.
