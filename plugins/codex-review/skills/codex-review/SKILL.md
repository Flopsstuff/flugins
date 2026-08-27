---
name: codex-review
description: Run a Codex code review against a base branch, then walk its findings one at a time — verify each claim against the current code, get the user's call on it, and land every accepted fix as its own commit with a reproduction before and a check after. Use this skill whenever the user asks to run a codex review, review the branch with codex, triage codex findings, or fix what codex found — including phrasings like "codex review against main", "run codex on this branch", "go through the codex findings", or just "codex review" with or without a base branch. Pass --yes to take the recommended action on every finding without asking.
disable-model-invocation: false
user-invocable: true
allowed-tools: >-
  Read Edit Write Grep Glob AskUserQuestion TaskCreate
  Bash(codex review:*) Bash(codex --version:*) Bash(codex --help:*)
  Bash(mktemp:*) Bash(tail:*) Bash(head:*) Bash(sed:*) Bash(awk:*) Bash(grep:*) Bash(wc:*)
  Bash(git log:*) Bash(git status:*) Bash(git diff:*) Bash(git show:*)
  Bash(git add:*) Bash(git commit:*) Bash(git branch:*) Bash(git stash:*)
  Bash(git cherry-pick:*) Bash(git merge-base:*) Bash(git rev-parse:*)
  Bash(git fetch:*) Bash(git ls-tree:*) Bash(git symbolic-ref:*)
---

Run `codex review` against a base branch and turn its output into landed, verified commits — one per finding, each approved by the user unless they asked for `--yes`.

**Input**: `$ARGUMENTS` — all optional, in any order:

| Argument | Effect |
|---|---|
| `--yes` / `-y` | Take the recommended option on every finding without asking. See [Unattended mode](#unattended-mode---yes). |
| `--base <branch>` | Review against this branch. Default: `origin/HEAD`, else `main`, else `master`. |
| `--uncommitted` | Review staged, unstaged and untracked changes instead of a branch diff. |
| `--commit <sha>` | Review the changes introduced by one commit. |
| anything else | Passed to `codex review` as custom review instructions. |

## Why the loop looks the way it does

A review tool proposes; it does not know. In practice a meaningful share of findings are already fixed on the base branch, rest on an assumption that does not hold in this repo, or are real but worth fixing differently than suggested. Applying them wholesale produces churn and, occasionally, regressions. So every finding gets read against the actual code before anyone decides anything, and the user gets the call.

One commit per finding is not bookkeeping fussiness. It keeps each fix independently revertible, keeps the commit message honest about a single cause, and means a later bisect lands on one claim rather than a bundle.

## Steps

### 1. Establish what is being reviewed

**The default is committed work on this branch against the base branch.** That is what "review my branch" means almost every time, and it is the only target the fix loop can commit into cleanly.

But `--uncommitted` is a real target too, and the two are mutually exclusive in a way that is easy to get wrong: reviewing uncommitted work means the working tree *must stay dirty*, while reviewing a branch means it must be clean. Resolve this before running anything.

```bash
git status --porcelain
```

| Situation | What to do |
|---|---|
| User passed `--base`, `--commit` or `--uncommitted` | They said what they want. Use it, do not ask. |
| No flag, worktree clean | Branch review against the base. Do not ask — there is nothing else it could mean. |
| No flag, worktree dirty | **Ambiguous. Ask.** "Review my changes" could mean either the commits on this branch or the edits sitting in the tree. |

For the ambiguous case use `AskUserQuestion` with three options: review the branch against its base (recommended — stash the working changes first and pop them at the end), review the uncommitted changes instead, or commit the working changes first and then review the branch. If `AskUserQuestion` is unavailable, print the same three and wait.

Once the target is settled:

- **Base or commit review** — the worktree must be clean. The loop lands one commit per accepted finding, and `git add` would otherwise sweep unrelated work into whichever fix commits first, making each commit a lie about its own cause. `git stash push -u` if needed and remember to pop at the end.
- **Uncommitted review** — do **not** clean the worktree; those changes are the input. This mode also changes the end of the loop: **fixes stay uncommitted**. Edit the working tree, verify, and leave the result for the user alongside their own work — do not commit, because there is no way to separate a fix from the WIP it sits inside. Say so in the final report, and skip step 5e's commit entirely.

There is no dependency pre-flight beyond this. If `codex` is missing or not signed in, the review command in step 2 says so plainly — read what it printed and handle it there.

### 2. Run the review

For a base review with no branch given, resolve it as `git symbolic-ref refs/remotes/origin/HEAD`, else `main`, else `master`.

**Redirect the output to a file. Do not let it into context directly.**

```bash
LOG="$(mktemp "${TMPDIR:-/tmp}/codex-review-XXXXXX")"
codex review --base main > "$LOG" 2>&1; echo "exit=$? log=$LOG"
wc -l "$LOG"
```

Write the template with six trailing `X`s and no suffix after them. `mktemp -t codex-review` is a BSD-ism that fails on GNU/Linux with *too few X's in template*; a `"$(mktemp …).log"` form then leaves `LOG` as a bare `.log` in the current directory, dropping a six-figure log into the repository and breaking the clean-worktree invariant this skill just established.

This matters more than it looks. `codex review` streams its entire agent session to stdout — every exec call, every tool result, the shell noise from the user's profile. A real run is comfortably 200KB and several thousand lines, while the findings are a few hundred bytes at the very end. Reading it whole wastes most of a context window and, past a point, truncates the part you actually need.

**If the command failed**, the tail of the log explains why. Read it, tell the user in one line, and load `${CLAUDE_SKILL_DIR}/docs/troubleshooting.md` if the symptom matches something there — a missing binary, a CLI too old for the `review` subcommand, a login prompt, no upstream. Do not retry blindly and do not work around it.

### 3. Extract the findings

They live at the very end, after the last bare `codex` line. Slice exactly that — do not guess a line count with `tail -n`, because the findings block grows with the number of findings and a guess either truncates it or drags in session noise:

```bash
awk '/^codex$/{o="";next}{o=o $0 ORS}END{printf "%s", o}' "$LOG"
```

The `awk` resets its buffer at every `codex` marker, so what survives is everything after the last one — a few dozen lines regardless of whether the log is 2,000 lines or 20,000.

The shape to look for:

```text
codex
<one-paragraph verdict>

Full review comments:

- [P2] Read native fetch error codes from `cause` — /abs/path/file.mjs:528-528
  <prose explaining the claim>

- [P2] Include multi-view thumbnails in downloads — /abs/path/file.mjs:670-673
  <prose>
```

Three things to know about that block:

- **Codex repeats its final message.** The same verdict and the same findings usually appear twice. Deduplicate — do not report or fix anything twice.
- **The verdict comes before the first `Full review comments:`; the findings come after the last one.** Taking both from the same occurrence either pulls the whole list into the summary or glues the repeated verdict onto the final finding's body.
- **Paths are absolute.** Make them repo-relative before showing them to the user or putting them in a commit message.

If the slice comes back empty — no `codex` marker in the log — fall back to `grep -n "Full review comments:" "$LOG"` and `sed -n '<start>,$p' "$LOG"`. Note that `grep` will also match this file and any other document that quotes the header, so trust the line numbers in the log, not the count.

A cleaner source exists if the stdout parse ever gets awkward: Codex writes the session to `~/.codex/sessions/<yyyy>/<mm>/<dd>/rollout-*-<session-id>.jsonl`, where the final message is a single record with `type: response_item` and `payload.role: assistant` — no duplication, no session noise. The session id is in the log's header (`grep -m1 'session id:' "$LOG"`).

If the review genuinely produced no findings, that is a valid outcome — report the verdict and stop. Do not go hunting for something to fix.

### 4. Seed a task list

Use `TaskCreate`, one task per finding, subject `<id> <severity> <file>:<line>` (e.g. `F1 P2 meshy.mjs:528`). It makes progress visible while the loop runs and shows what is left.

### 5. For each finding — verify before deciding

**5a. Read the code the claim points at.** Open the file around the line. The claim is about code, so the code decides. Four mismatches are common enough to check for by name:

- **Already fixed on the base branch.** Compare against the base: `git show <base>:<file>`. If the base has the fix and the branch does not, the branch is stale, and the right move is to take the upstream commit rather than write a duplicate that will conflict later. Find it with `git log --oneline <base> -- <file>`, then apply it **without committing**:

  ```bash
  git cherry-pick -x -n <sha>
  ```

  A bare `git cherry-pick` commits the moment it applies, which would jump the verification gate in 5e and put a possibly-failing commit in history before anyone ran a test. `-n` stages the change and stops; verify it in this branch's context, then commit it like any other fix. If verification fails, `git cherry-pick --abort` (or `git reset --hard HEAD` once staged) leaves no trace.
- **Already fixed later on this branch.** The reviewer may be reading an earlier state. `git log -p --oneline -- <file>` settles it.
- **True in general, false here.** A claim about an API's behavior can be right about the API and wrong about this call site.
- **Real but the suggested fix overreaches.** Fix the defect; do not adopt a rewrite that carries unrelated opinions.

**5b. Reproduce it, when reproducing is cheap.** A finding you can demonstrate is a finding you can verify you fixed. For a CLI, that is often a single command against a bad input or a local mock; for a library, a few lines in a scratch file. Do not build elaborate harnesses — if reproduction would take more than a couple of minutes, note that it is unverified and move on. Never invent a reproduction you did not run.

**5c. Form a recommendation.** Decide what you would do and why, in one line. This matters even in `--yes` mode, where it is the only judgment applied.

**5d. Ask the user** (skip in `--yes` mode — see below).

Use `AskUserQuestion`:

- **Batch by 4.** The tool accepts 1–4 questions per call. More findings means back-to-back calls, not a crammed one.
- **One question per finding.** `question`: `<id>/<total> · <severity> · <file>:<line> — <the claim in one line>`. `header`: a short chip like `F3 · flags`.
- **Two to four options, single-select.** Always include:
  - **Fix** — `description`: the concrete edit, one line. Where a genuinely different approach exists (fix the code vs. fix the documentation that promises the behavior; narrow fix vs. broad fix), offer it as its own option rather than burying it in prose.
  - **Skip** — `description`: what stays broken if skipped. Be specific: "`--retries` stays a no-op flag" beats "leave as is".
- Put your recommendation first and append `(Recommended)` to its label.
- The tool adds a free-text **Other** automatically. Treat that text as instruction, re-read the code, and act on it.

If the user contradicts your recommendation, follow them without arguing. They see context you do not.

**Fallback for non-interactive sessions** where `AskUserQuestion` is unavailable — print this and wait for `y` / `n`:

```text
━━━ F<N>/<TOTAL> · P2 · path/to/file.ts:42 ━━━

Claim:   <one line>
Checked: <what you found in the code, and whether you reproduced it>

Proposed: FIX — <the concrete edit>
Instead:  SKIP — <what stays broken>

Apply? (y = fix, n = skip)
```

**5e. Apply the accepted decision.**

1. **Edit.** Use `Edit` with exact surrounding context, or leave the staged result of a `cherry-pick -n` from 5a in place. Keep the change scoped to the finding — an accepted finding is not a licence to refactor the file.
2. **Verify.** Re-run whatever you ran in 5b and confirm the behavior flipped. Then run the project's test suite if it has one — find the command from `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, or the language manifest (`package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`). If a test fails, do not commit: refine the fix, or flip to skip and surface the failure.
3. **Commit, one finding per commit** — *unless this is an uncommitted review*, where step 1 established that fixes stay in the working tree. In that mode, stop after verifying and move to the next finding. Otherwise, match the repo's existing convention — read `git log --oneline -10` and copy what you see (Conventional Commits, gitmoji, or plain imperative). The body should carry what the reviewer could not: what breaks, why, and what you ran to confirm the fix.

   ```text
   <convention-matching subject line>

   <What was wrong and what it broke, in the repo's own terms —
   not a paraphrase of the review comment.>

   <What you ran to verify, and what it showed before and after.>
   ```

   Do not credit the review tool as an author. Attribute per the repo's convention and your own harness's rules.
4. **Never push.** Committing is the end of this skill's git authority. Pushing, opening a PR and merging are separate acts that need the user to ask for them, each time.

### 6. Report

When the loop ends, give the user:

- What landed, one line per commit, with its SHA.
- What was skipped and what stays broken because of it.
- What you could not verify, named plainly — findings you fixed by reasoning without reproducing, and any test suite that does not exist. Do not let "committed" imply "proven".
- The log path, in case they want the reviewer's full session.

If you stashed in step 1, `git stash pop` now and say so.

## Unattended mode (`--yes`)

`--yes` replaces step 5d only. Everything else holds: still read the code, still reproduce where cheap, still one commit per finding, still no push.

For each finding, take the option you would have marked `(Recommended)`. Where your recommendation would have been **Skip** — the claim does not hold, the code is already correct, the fix would overreach — skip it, and say so in the final report. `--yes` means "do not ask me", not "apply everything": a review tool that is right four times out of five will, on a five-finding run, land one bad commit if the loop cannot say no.

Two things still stop the loop even under `--yes`:

- A failing test after a fix. Revert the edit, skip the finding, keep going, and report it.
- A finding whose correct handling is a judgment call with no defensible default — a claim that is real but whose fix would change a public interface, delete a feature, or contradict something stated in `CLAUDE.md`. Leave it, and list it at the end as needing a human.

## Notes

- **The review costs time and tokens.** Run it once per invocation. If the user wants another pass after fixes land, that is a new invocation — say so rather than silently re-reviewing.
- **Severity is the reviewer's opinion, not a queue.** Work findings in the order returned; do not reorder by severity or quietly drop the low ones.
- **Keep the log until the end.** It is the only record of what the reviewer actually said, and the user may want it after the loop finishes.
