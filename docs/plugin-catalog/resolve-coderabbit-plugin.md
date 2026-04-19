# Resolve CodeRabbit Plugin

**Name:** `resolve-coderabbit`

**Description:** Walk through CodeRabbit inline PR comments, verify each against the current code, and batch-resolve with commits and replies

**Author:** Flop (flopspm@gmail.com)

**Version:** 0.1.0

**Keywords:** review, coderabbit, github, pr, pull-request, bot-comments

The Resolve CodeRabbit plugin gives Claude Code a structured, safe workflow for handling CodeRabbit's automated review comments on GitHub pull requests. It's language-agnostic — works with Node, Python, Rust, Go, Java, Ruby, or anything else — as long as the project has a unit test command and uses the GitHub CLI (`gh`).

## Installation

```bash
claude plugin install resolve-coderabbit@flugins
```

**Important:** After installing the plugin, restart Claude Code to activate skills.

**Tip:** Enable auto-update via `/plugin` → **Installed** → select the plugin → enable auto-update.

## Requirements

- [`gh`](https://cli.github.com) CLI installed and authenticated against the repo's GitHub host
- [`jq`](https://jqlang.github.io/jq/) installed (used to parse the GitHub API responses)
- `git` installed and the current directory inside a git working tree
- The PR must already be opened and the branch pushed (the skill pushes **new** commits, but the PR itself must exist)
- CodeRabbit (`coderabbitai`) must have posted inline review comments on the PR
- A clean working tree on the PR branch — uncommitted unrelated changes will collide with one-commit-per-comment

The skill's first step is an automated dependency self-check (`skills/resolve-coderabbit/scripts/self-check.sh`) that verifies the first three bullets and walks you through `skills/resolve-coderabbit/docs/setup-dependencies.md` if anything is missing — so there's no guesswork about what to install.

## Features

### Skills

- [Resolve CodeRabbit Comments](#resolve-coderabbit-comments) - Walk through unresolved CodeRabbit inline comments one by one, verify, fix or reject with user approval, then batch-push and resolve threads

---

## Resolve CodeRabbit Comments

**Skill:** `resolve-coderabbit`
**Type:** Model-invoked (automatic) / user-invocable

Walks through every **unresolved** CodeRabbit inline comment on a PR, verifies the bot's claim against the *current* state of the code, applies a fix (or rejects with justification) only after explicit user approval, commits each fix locally, and then — in a single batched final step — validates the whole batch, pushes, posts SHA-referenced replies, and resolves the review threads.

### How it Activates

The skill activates when you reference CodeRabbit or bot PR comments. Examples that will trigger it:

- "resolve the CodeRabbit comments on PR #42"
- "go through the bot's suggestions"
- "address the PR review"
- "walk through the comments"
- "fix the CodeRabbit nits"

You can also invoke it explicitly via the Claude Code skill UI.

### Workflow

0. **Dependency self-check.** Runs the bundled `skills/resolve-coderabbit/scripts/self-check.sh` first, which verifies `git`, `gh`, `jq`, a valid `gh auth` session, and that the current directory is inside a git working tree. If anything fails, the skill stops and walks you through `skills/resolve-coderabbit/docs/setup-dependencies.md` for your OS before continuing.
1. **Resolve PR context.** Reads the PR number from arguments, or falls back to the PR attached to the current branch (`gh pr view --json number --jq .number`), or asks you.
2. **Pull the comment set.**
   - REST (`/pulls/{n}/comments`) for comment bodies, file paths, lines.
   - GraphQL (`reviewThreads`) for thread IDs and the `isResolved` flag — REST alone can't resolve threads.
   - Filters to unresolved threads where the first comment author is `coderabbitai`.
3. **Seeds a task list** — one task per unresolved comment with a severity marker and `file:line`.
4. **Loops over each comment** — for every one:
   - Extracts severity, the bolded claim, the proposed fix diff, and the 🤖 Prompt for AI Agents block.
   - Reads the real file at the claimed line and checks if the bot's claim still holds.
   - Presents a compact decision block to you with the relevant code and a proposed action (FIX / REJECT / SKIP).
   - **Waits for your explicit approval** before touching anything.
5. **Applies the decision.**
   - **FIX** → edit → run the project's full unit test suite (auto-detected from `CLAUDE.md`, `README`, `package.json`, `Makefile`, `pyproject.toml`, `Cargo.toml`, etc.) → one commit per fix → **queue** the reply (don't post yet).
   - **REJECT** → reply + resolve in one call via the bundled `skills/resolve-coderabbit/scripts/resolve-comment.sh` helper. No git changes.
   - **SKIP** → leave the thread open, move on.
6. **Batched final step.**
   - Runs E2E/integration suite only if the batch touches integration boundaries (HTTP, auth, external APIs, DBs).
   - Shows you the queued commits and queued replies, asks for push confirmation.
   - `git push` once.
   - Replays all queued replies by calling `resolve-comment.sh` once per item (REST reply + GraphQL thread-resolve in one shot).
7. **Summary** — reports fixed / rejected / skipped counts and which threads remain open.

### Why Batched Replies

Replies to inline comments reference commit SHAs. If replies were posted before the push, their SHAs wouldn't be on origin yet — confusing for reviewers and fragile against force-pushes. One-commit-per-fix keeps each reply's SHA meaningful, and batching the push + reply + resolve at the end means no broken SHA ever reaches origin attached to a reply.

### Commit Message Convention

Each FIX commit uses the project's own convention (Conventional Commits or gitmoji — the skill checks recent `git log`) with a body explaining the CodeRabbit feedback:

```
fix(scope): short imperative summary

Per CodeRabbit PR review on #42: one or two sentences on what and why,
referencing the file/line that was off.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

### What the Skill Will NOT Do

- Never pushes without explicit user confirmation
- Never commits if unit tests fail
- Never posts replies against unpushed SHAs
- Never mass-accepts suggestions — every comment requires per-comment approval
- Never touches threads from non-CodeRabbit reviewers
- Never handles merge conflicts or branch management (use the `git` plugin for that)

### When to Use Something Else

- **No CodeRabbit on the PR** — use the standard human review workflow, not this skill.
- **PR not opened yet / branch not pushed** — open the PR first.
- **Bulk dispute** — if you want to dismiss most of CodeRabbit's findings without per-comment discussion, handle that conversationally, don't loop through the skill.
- **Dirty working tree with unrelated changes** — commit or stash first; one-commit-per-comment can't coexist with in-progress work.

See the [SKILL.md reference](https://github.com/Flopsstuff/flugins/blob/main/plugins/resolve-coderabbit/skills/resolve-coderabbit/SKILL.md) for the full behavior specification and the exact `gh api` calls used.
