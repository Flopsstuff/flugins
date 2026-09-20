---
name: agents-init
description: Bootstrap a repository's AI agent instructions as a single tool-agnostic AGENTS.md, with CLAUDE.md and GEMINI.md symlinked to it. Runs the built-in init to analyze the codebase, writes the result in English by default, strips the vendor-specific framing so any agent can read it, renames the file to AGENTS.md, and creates the two symlinks. Use this skill whenever the user wants to set up, bootstrap or refresh agent instructions for a repository — phrasings like "init agent docs", "create AGENTS.md", "set up CLAUDE.md", "make an agents file", "run init and make it tool-agnostic", "add a GEMINI.md", or "consolidate my agent instruction files". Also use it when a repo already has a CLAUDE.md but no AGENTS.md and the user wants other agents (Gemini, Codex, Cursor) to read the same instructions.
disable-model-invocation: false
user-invocable: true
allowed-tools: >-
  Read Edit Write Grep Glob Skill AskUserQuestion
  Bash(ls:*) Bash(ln:*) Bash(mv:*) Bash(cat:*) Bash(readlink:*) Bash(test:*) Bash(file:*)
  Bash(git mv:*) Bash(git add:*) Bash(git status:*) Bash(git rev-parse:*) Bash(git check-ignore:*)
  Bash(grep:*) Bash(sed:*) Bash(head:*) Bash(wc:*)
---

Turn a repository's agent instructions into one file that every coding agent reads.

**Why this shape.** Each vendor hardcodes its own filename — Claude Code looks for `CLAUDE.md`, Gemini CLI for `GEMINI.md`, and `AGENTS.md` is the cross-vendor convention. Keeping three real files means three copies that drift apart within a week, and nobody notices until an agent acts on stale instructions. One real file plus symlinks gives every tool the filename it expects while there is only ever one thing to edit.

**Input**: `$ARGUMENTS` — all optional:

| Argument | Effect |
|---|---|
| `--lang <language>` | Write the document in this language. Default: **English**, regardless of the conversation's language. |
| `--link <name>` | Add another symlink alias (repeatable), e.g. `--link .cursorrules`. Default aliases are `CLAUDE.md` and `GEMINI.md`. |

English is the default because these files are read by models and by contributors who may not share the user's language — but it is a default, not a rule. Honor `--lang`, and honor it just as readily when the user asks in prose ("сделай на русском", "auf Deutsch").

## Step 1 — Survey before touching anything

Find out what already exists. The whole risk in this task is destroying instructions somebody wrote by hand, so look first:

```bash
ls -l AGENTS.md CLAUDE.md GEMINI.md 2>/dev/null
git rev-parse --is-inside-work-tree 2>/dev/null
```

Classify each of the three names as **absent**, a **real file**, or already a **symlink** (`ls -l` shows `->`). That gives you the situation:

- **Nothing exists** → fresh bootstrap, continue to step 2.
- **Only `CLAUDE.md` exists as a real file** → its content is the thing to preserve. Skip generating from scratch: this file becomes `AGENTS.md`. Offer to refresh it with `init` first if it looks thin or stale, but never discard it.
- **`AGENTS.md` already exists** → do not overwrite. Read it, and treat this as a repair job: report what is already correct and fix only what is missing, usually just the symlinks.
- **Both `AGENTS.md` and a real `CLAUDE.md` exist** → two sources that may disagree. Read both and ask the user which wins, or offer to merge; picking silently is how content gets lost.
- **Already symlinked correctly** → say so and stop. Re-running this skill on a finished repo should be a no-op, not churn.

## Step 2 — Generate the document with `init`

Invoke the built-in `init` skill (via the Skill tool, skill name `init`). It analyzes the codebase and writes `CLAUDE.md`.

Use it rather than writing the file yourself: it carries the current guidance on what belongs in an agent instruction file — the commands that actually build, test and run the project, and the architecture that only becomes clear after reading several files together. It also carries the guidance on what to leave out, which matters more: no generic advice, no restating what any agent can discover by listing the directory.

Two things to expect from it:

- It seeds the file with a `# CLAUDE.md` header and a line about Claude Code. Step 4 replaces that — the framing is the only vendor-coupled part, not the content.
- If `CLAUDE.md` already exists, `init` proposes improvements instead of overwriting. That is the behavior you want; apply the improvements to the existing content.

If the `init` skill is unavailable on the current surface, write the document yourself to the same standard: real build/lint/test commands including how to run a single test, the big-picture architecture that spans multiple files, and any non-obvious conventions the repo enforces. Skip anything a competent agent would infer in ten seconds.

## Step 3 — Language pass

If the generated text is not in the target language, rewrite it. Keep code identifiers, paths, commands and filenames in their original form — translating `npm run build` or `src/server/` helps nobody.

## Step 4 — Make it tool-agnostic

Replace the header so the document does not present itself as belonging to one vendor:

```markdown
# AGENTS.md

Guidance for AI coding agents working in this repository.
`CLAUDE.md` and `GEMINI.md` are symlinks to this file.
```

Then scan the body for remaining vendor coupling — `grep -in "claude\|anthropic\|gemini\|cursor\|copilot"` finds candidates fast.

Judgment is required here, and getting it wrong in either direction hurts:

- **Rewrite framing.** "Claude should run the tests before committing" → "Run the tests before committing." Instructions addressed to a named tool read as inapplicable to every other tool.
- **Keep facts.** If the repo genuinely has a `.claude/settings.json`, a Claude Code hook, a `plugins/` tree of Claude plugins, or a skill that shells out to a specific CLI, those are true statements about the codebase. Stripping them makes the document wrong. A repo that *builds* Claude tooling will mention Claude constantly, and should.

The test to apply: would this sentence still be accurate and useful if a different agent read it? If yes, keep it. If it only makes sense when a particular vendor's tool is the reader, rewrite it.

## Step 5 — Rename and link

Rename the real file, preserving history if the repo tracks it:

```bash
git mv CLAUDE.md AGENTS.md    # tracked
mv CLAUDE.md AGENTS.md        # untracked or no repo
```

Create the aliases as **relative** symlinks, from inside the directory holding `AGENTS.md`:

```bash
ln -s AGENTS.md CLAUDE.md
ln -s AGENTS.md GEMINI.md
```

Relative, not absolute — an absolute symlink breaks the moment the repo is cloned elsewhere or the directory is moved, and it leaks the author's home path into the repository.

Before creating each link, check the target name is free. If a real file sits there, stop and ask; its content may be the only copy. If a correct symlink already sits there, leave it alone.

Add any extra `--link` aliases the same way.

## Step 6 — Verify and report

Prove the result rather than assuming it:

```bash
ls -l AGENTS.md CLAUDE.md GEMINI.md
head -1 CLAUDE.md && head -1 GEMINI.md
```

Both symlinks should print the `AGENTS.md` heading — that confirms they resolve, which a bare `ls` does not.

Then tell the user what happened: which file is real, which are links, what language it is in, and anything you deliberately left alone. If you made a judgment call in step 4 about vendor-specific content that stays, say which and why — that is the decision most worth surfacing, because the user may disagree.

Stage the changes if the repo is tracked, but **do not commit** unless the user asks. Renames plus new symlinks are exactly the kind of change someone wants to look at before it lands.

## Notes worth passing on

**Windows.** Git stores symlinks fine, but a clone on Windows without developer mode or `core.symlinks=true` turns them into plain text files containing the target path. Mention this if the project has Windows contributors; it is not a reason to avoid the layout, just something that surprises people.

**`.gitignore`.** Some repos ignore `CLAUDE.md` as a personal-notes file. Check with `git check-ignore -v CLAUDE.md` — if it is ignored, the symlink will not be committed and other clones lose it. Point this out rather than silently editing the ignore rules.

**Nested files.** Agent instruction files can live in subdirectories, applying to that subtree. This skill handles one directory per run — the repository root unless the user names another. If the repo has several, do them one at a time so each survey in step 1 stays honest.
