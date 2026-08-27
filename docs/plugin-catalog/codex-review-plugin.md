# Codex Review Plugin

**Name:** `codex-review`

**Description:** Run a codex code review against a base branch, triage every finding with the user, and land each accepted fix as its own verified commit

**Author:** Flop (flopspm@gmail.com)

**Version:** 0.1.0

**Keywords:** review, codex, code-review, refactor, bugfix, git

The Codex Review plugin wires the [Codex CLI](https://github.com/openai/codex) into a triage loop. It runs `codex review` against a base branch, extracts the findings from the review's session log, checks each claim against the code you actually have, asks you what to do about it, and commits every accepted fix separately. It is language-agnostic — the review tool reads the diff, not a particular ecosystem.

## Installation

```bash
claude plugin install codex-review@flugins
```

**Important:** After installing the plugin, restart Claude Code to activate skills.

**Tip:** Enable auto-update via `/plugin` → **Installed** → select the plugin → enable auto-update.

## Requirements

- [Codex CLI](https://github.com/openai/codex) installed and signed in, recent enough to have the `codex review` subcommand (`npm install -g @openai/codex`)
- `git`, with the current directory inside a working tree
- A **clean** working tree. The skill lands one commit per finding, so unrelated modified files would be swept into whichever fix committed first. It offers to stash for you and pops the stash when the loop ends.

There is no dependency pre-flight. If the CLI is missing, too old for `codex review`, or not signed in, the review command says so and the skill reads its own failure — `docs/troubleshooting.md` is keyed to those symptoms rather than to a checklist.

## Usage

```
/codex-review:codex-review [--yes] [--base <branch>] [--uncommitted] [--commit <sha>] [instructions]
```

The skill is also model-invoked — asking Claude to "run a codex review against main" or "go through the codex findings" reaches it without the slash command.

| Argument | Effect |
|---|---|
| `--yes` / `-y` | Take the recommended action on every finding without asking |
| `--base <branch>` | Review against this branch. Default: `origin/HEAD`, else `main`, else `master` |
| `--uncommitted` | Review staged, unstaged and untracked changes instead of a branch diff |
| `--commit <sha>` | Review the changes introduced by one commit |
| anything else | Passed to `codex review` as custom review instructions |

Examples:

```bash
/codex-review:codex-review                          # current branch vs. its base
/codex-review:codex-review --base develop           # against a different base
/codex-review:codex-review --yes                    # unattended
/codex-review:codex-review focus on error handling  # steer the reviewer
```

## What it does

**1. Check the worktree is clean.** One commit per finding only means something if nothing unrelated is staged alongside it. The skill offers to stash and pops the stash at the end.

**2. Run the review.** Claude invokes `codex review` directly, redirecting the output to a log file rather than into its own context. That redirect is the point: `codex review` streams its whole agent session to stdout — every exec call, every tool result, every line of shell noise from your profile — so a real run is comfortably 200KB and several thousand lines, while the findings themselves are a few hundred bytes at the very end. Claude reads the tail, deduplicates (Codex repeats its final message), and makes the absolute paths repo-relative.

**3. Verify each claim before deciding.** A review proposes; it does not know. The skill reads the code each finding points at and specifically checks four things: whether the base branch already contains the fix (in which case the right move is a `cherry-pick`, not a hand-written duplicate that will conflict later), whether a later commit on this branch already fixed it, whether a claim that is true in general is false at this call site, and whether the suggested fix overreaches the actual defect. Where reproducing the bug is cheap, it reproduces it first — so "fixed" can be demonstrated rather than asserted.

**4. Ask you, one finding at a time.** Findings are presented in batches of four as radio questions, each with a recommendation, a concrete description of the edit, and a specific statement of what stays broken if you skip. Where a genuinely different approach exists — fix the code, or fix the documentation that promised the behavior — it is offered as its own option instead of buried in prose. A free-text option is always available to override the framing.

**5. Commit each fix separately.** One finding, one commit, in whatever convention the repository already uses (Conventional Commits, gitmoji, plain imperative — read from `git log`). Each message carries what the reviewer could not: what broke, why, and what was run to confirm the fix. The test suite runs before every commit; a failure means no commit.

**6. Report.** What landed with SHAs, what was skipped and what stays broken as a result, and — named plainly — what could not be verified.

The skill never pushes. Committing is where its git authority ends; pushing, opening a PR and merging are separate acts that need you to ask.

## Unattended mode

`--yes` removes the questions and nothing else. The skill still reads the code, still reproduces where cheap, still commits one finding at a time, still refuses to push.

Crucially, `--yes` means *don't ask me*, not *apply everything*. Where the skill's recommendation would have been to skip — the claim does not hold, the code is already correct, the fix would overreach — it skips, and says so in the report. A reviewer that is right four times out of five would otherwise land a bad commit on nearly every five-finding run.

Two things still stop the loop under `--yes`: a test failure after a fix (the edit is reverted, the finding skipped and reported), and a finding whose correct handling is a genuine judgment call — one whose fix would change a public interface, delete a feature, or contradict the project's own `CLAUDE.md`. Those are left for a human and listed at the end.

## Skills

### `codex-review`

Model-invoked and user-invocable. Triggers on requests to run a codex review, review a branch with codex, triage codex findings, or fix what codex found.

## Bundled files

| Path | Purpose |
|---|---|
| `skills/codex-review/SKILL.md` | The workflow itself |
| `skills/codex-review/docs/troubleshooting.md` | Loaded on demand when the review command fails, keyed to what it printed |

No scripts. Claude runs `codex review` itself and reads what comes back, including the failures.

## Related

- [Resolve CodeRabbit Plugin](resolve-coderabbit-plugin.md) — the same verify-then-approve shape, for CodeRabbit's inline comments on a GitHub PR
