---
name: resolve-coderabbit
description: Walk through unresolved CodeRabbit inline review comments on a GitHub PR one by one — verify each claim against the current code, fix/reject with the user's approval, commit locally, then validate + push + reply + resolve everything in one batched final step. Use this skill whenever the user asks to resolve CodeRabbit comments, address PR review from the CodeRabbit bot, go through inline suggestions, handle the bot review, or anything similar — even when they phrase it as "walk through the comments", "resolve review", "fix the bot's suggestions", or just name-drop CodeRabbit alongside a PR number.
disable-model-invocation: false
user-invocable: true
---

Resolve unresolved **CodeRabbit** inline review comments on a GitHub PR. Loop through each thread, verify the bot's claim against the current code with the user, apply a fix (with a full unit-test gate) or reject with justification, and commit locally. After the loop, run any needed E2E, ask the user to confirm, then push once and batch the replies + thread-resolves against the now-published SHAs.

**Input**: `$ARGUMENTS` — optional PR number. If empty, resolve to the PR attached to the current branch via `gh pr view --json number --jq .number`. If that fails, ask the user for the PR number.

## Why the loop looks the way it does

CodeRabbit has a hard-earned habit of attaching a `🤖 Prompt for AI Agents` block to every inline comment, prefixed with "Verify each finding against the current code and only fix it if needed." The bot can be wrong (mismatched versions of the code, outdated assumptions, style nits that don't apply in this repo), so slavishly applying suggestions is worse than doing nothing. This skill mirrors that instruction: always read the code the claim refers to *before* deciding to fix.

Also: replies reference commit SHAs, so commits must be pushed before the reply is posted. One commit per comment keeps each reply's SHA meaningful and the PR history legible.

## Steps

### 0. Dependency self-check (run this first, always)

Before touching the PR — before any `gh api` call, any Task list, any file read — run the bundled self-check:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/self-check.sh"
```

It verifies `git`, `gh`, `jq`, `gh auth status`, and that the current directory is inside a git working tree, printing a ✅/❌ report with short tags (`gh`, `gh-auth`, `jq`, `git`, `git-repo`).

**If the script exits 0 with all ✅** — continue to step 1.

**If it exits non-zero** — do **not** proceed with the PR loop. Instead:

1. Read `${CLAUDE_SKILL_DIR}/docs/setup-dependencies.md`. Each section is keyed to the tags the self-check prints, so map each ❌ to the matching section.
2. Walk the user through fixing each failing item — present the relevant section, confirm the user's OS/package manager if the choice matters, and wait for them to run the install/auth step.
3. Re-run the self-check. Repeat until it exits 0.
4. Only then move to step 1. Never attempt to "work around" a missing dependency — the skill depends on `gh` + `jq` for every API call and there is no fallback path.

This step is not optional and not skippable, even for "I just did this yesterday" scenarios — `gh auth` tokens can expire, `jq` can disappear after a system update, and a silent tool failure partway through the comment loop is far worse than a 200ms check at the start.

### 1. Pull the unresolved CodeRabbit comments

Use the bundled helper. It wraps a single GraphQL `reviewThreads` query (the body lives on the thread's first comment, so no extra REST round-trip is needed) and prints a JSON array of **only** unresolved threads authored by `coderabbitai` directly to stdout:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/fetch-comments.sh" "${ARGUMENTS:-}"
```

`$ARGUMENTS` is the optional PR number; if empty, the script auto-detects the PR from the current branch. Don't redirect the output to a file — read it straight from stdout into context.

Each element of the array is shaped:

```json
{
  "thread_id":  "PRRT_kwDO...",
  "comment_id": 1234567890,
  "path":       "src/foo.ts",
  "line":       42,
  "body":       "**issue**\n\n..."
}
```

An empty array means there's nothing to do — either the bot hasn't reviewed the PR, or everything is already resolved. Exit code is still 0 in that case; surface the result to the user and stop.

Hold onto the `$PR` value — when you invoke `resolve-comment.sh` in steps 3d and 5 below, **always pass it as the 4th argument**. The helper can auto-detect from the current branch as a fallback, but that only matches if you happen to be on the PR's branch. Passing `$PR` through explicitly keeps every reply pinned to the PR you actually started with, regardless of which branch is checked out at reply time.

### 2. Seed a task list — one task per unresolved comment

Use `TaskCreate` to create one task per comment (subject: severity marker + short file:line, e.g. "🟠 C1: CHANGELOG.md:15"). This makes progress visible in the spinner and lets the user see at a glance what's left. Skip threads already resolved and comments from non-CodeRabbit authors.

### 3. For each unresolved comment — verify, then ask the user

Claude Code runs this skill in **with-confirmation mode**: for every comment, present the user with enough context to decide, *then* wait for explicit approval before touching anything.

**3a. Extract the CodeRabbit signal**

From the comment body, pull out:
- **Severity** — `🟠 Major` / `🟡 Minor` / `🔵 Trivial` / `🧹 Nitpick` / `⚠️ Potential issue`
- **Claim** — the bold-headed problem statement (first `**...**` line in the comment)
- **Suggested fix** — the diff block inside `<summary>💡 Proposed fix</summary>` or `<summary>📝 Committable suggestion</summary>`
- **AI prompt** — the contents of `<details><summary>🤖 Prompt for AI Agents</summary>` (optional but usually informative)

**3b. Verify against the current code**

Read the file at `path` around `line`. Ask: does the bot's claim still match what's there? Common mismatches:

- The bot is looking at a stale version; the issue was already fixed in a later commit on the branch.
- The "suggested fix" overlaps with a pattern elsewhere in the repo that's intentional (e.g. a project's own style rules in `CLAUDE.md` / `CONTRIBUTING.md` might conflict with a bot suggestion that prefers a different convention).
- The bot's type assumption is wrong (e.g. it says "the method expects `X`" when the local signature is broader).
- The claim is technically true but the fix is cosmetic overreach — the bot cropped parts of a sentence without understanding their purpose.

If the claim is a real problem in the current code, it's a **fix**. If the code is already fine, or the suggested fix would make things worse, it's a **reject** — but still thread-resolve with a short justification so the reviewer (or the next person) sees a closed, explained thread instead of lingering noise.

**3c. Present the decision to the user**

Prefer the native `AskUserQuestion` tool — it renders each comment as a radio question with a side-by-side preview pane showing the code and the bot's proposed diff, so the user can triage several comments in one dialog instead of typing `y/n/s` for each.

Rules:
- **Batch by 4.** `AskUserQuestion` accepts 1–4 questions per call. If there are more comments, issue multiple `AskUserQuestion` calls back-to-back (one per batch of ≤4), don't try to cram everything into one.
- **One question per comment.** Use the `question` field for `C<N>/<TOTAL> · <severity> · <path:line>: <one-line claim>` and the `header` field for a short chip like `C3: foo.ts:42`.
- **Three options, single-select (not `multiSelect`):**
  - **FIX** — `description`: one-line summary of the edit you'll make (e.g. "Add null check before .trim() on line 42"). Put the real surrounding code + the bot's proposed diff into the `preview` field so the user sees what they're approving.
  - **REJECT** — `description`: one-line reason the claim doesn't apply here (e.g. "Already guarded at caller, see foo.ts:20"). No preview needed unless the code context helps justify it.
  - **SKIP** — `description`: `Leave the thread open for human judgment.` No preview.
- If you recommend one option, put it first and add `(Recommended)` to its `label` per the `AskUserQuestion` contract.
- The tool auto-adds an **Other** free-text option — the user can override your framing with any text. Treat that text as a hint and re-read the code before acting on it.

If the user picks an option that contradicts your recommendation (e.g. you proposed FIX, they picked REJECT), honor their choice — they see context you may have missed. Don't second-guess.

**Fallback (headless / non-interactive sessions where `AskUserQuestion` isn't available):** print this compact block per comment and wait for `y` / `n` / `s`:

```text
━━━ C<N>/<TOTAL> · 🟠 Major · path/to/file.ts:42 ━━━

Claim: <one-line bold summary from the bot>

Relevant code (path/to/file.ts:40-45):
   …actual lines…

AI prompt summary: <1-2 lines from the bot's Prompt for AI Agents>

Proposed action:
  [x] FIX — <concrete edit you will make>
  (or)
  [x] REJECT — <reason the bot is wrong / out of scope>

OK to proceed? (y/apply = go, n/reject = reject instead, s/skip = leave open)
```

Either way, wait for the user's answer before doing anything destructive.

**3d. Apply the decision**

The loop *commits* every FIX locally, but defers `git push`, the reply, and the thread-resolve until the final step. That keeps the project's conventions honest (full test suite must pass before committing), respects the "never push without explicit user authorization" rule common across projects, and means no broken SHA ever reaches origin attached to a reply. REJECT decisions, by contrast, don't touch git at all and can be replied + resolved immediately.

**FIX path:**

1. Edit the file(s) — use `Edit` with exact surrounding context from step 3b so we don't drift.
2. **Validate the full unit suite before committing** — determine the project's unit-test command from the project itself: check `CLAUDE.md`, `README.md`, `CONTRIBUTING.md`, and language manifests (`package.json` scripts, `Makefile`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, etc.). Run the **full** unit suite, not a focused test. Examples of typical commands:
   - Node/TS: `npm test` / `yarn test` / `pnpm test` (plus `npm run lint` if lint is part of the gate)
   - Python: `pytest` / `python -m pytest` / `tox`
   - Rust: `cargo test`
   - Go: `go test ./...`
   - Java/Kotlin: `mvn test` / `./gradlew test`
   - Ruby: `bundle exec rspec` / `rake test`

   Docs- or CHANGELOG-only fixes skip this step because their test impact is zero. If a test fails, do **not** commit: either refine the fix, flip to REJECT, or SKIP and surface the failure to the user.
3. Commit locally (no push yet):

   ```text
   <type>(<scope>): <short imperative summary>

   Per CodeRabbit PR review on #<PR>: <one or two sentences on what
   and why, referencing the file/line that was off>.

   Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
   ```

   `<type>` follows the project's convention (commonly `fix`, `feat`, `docs`, `test`, `chore`, `refactor` under Conventional Commits; some repos use gitmoji instead — check recent `git log` to match).
4. Record the pending reply — stash `{comment_id, thread_id, sha, short_note}` in an in-memory list to replay after step 5's push. Do **not** reply or resolve yet; the reply would reference a SHA that isn't on origin.

**REJECT path:**

1. No edit. No commit.
2. Compose the reply body — specific (not "disagree"): cite the file/line, the project convention, or the existing test that already covers it.
3. Reply + resolve in one call with the bundled script:

   ```bash
   bash "${CLAUDE_SKILL_DIR}/scripts/resolve-comment.sh" "$COMMENT_ID" "$THREAD_ID" "$REPLY_BODY" "$PR"
   ```

   The script auto-detects the repo; pass `$PR` as the 4th argument so the reply lands on the right PR regardless of current branch. It posts the REST reply, then marks the thread resolved via GraphQL. If the reply fails, the thread stays open. If the resolve fails after a successful reply, the script exits non-zero and prints which thread still needs manual resolution.

**SKIP path:**

Leave the thread open and move on. Use this only when the comment needs human judgment you can't supply (e.g. architectural question, missing context).

### 4. Posting replies and resolving threads

Both the REJECT path above and the final batch in step 5 use the bundled helper:

```bash
bash "${CLAUDE_SKILL_DIR}/scripts/resolve-comment.sh" "$COMMENT_ID" "$THREAD_ID" "$REPLY_BODY" "$PR"
```

It encapsulates the two-API dance: **REST** for the reply (`POST /pulls/<pr>/comments/<id>/replies`) and **GraphQL** for the thread resolve (`resolveReviewThread(input:{threadId:$t})`). The script detects the repo via `gh repo view` and the PR number via `gh pr view`, so only the three arguments need to be provided by the caller.

If you ever need to do this by hand (debugging, the script is unavailable, whatever), here's the underlying dance — plus two traps easy to hit:

```bash
# Reply (REST)
gh api "repos/$OWNER/$REPO/pulls/$PR/comments/$COMMENT_ID/replies" \
  -f body="$REPLY_BODY" --jq '.id'

# Resolve the thread (GraphQL)
gh api graphql \
  -f query='mutation($t:ID!){resolveReviewThread(input:{threadId:$t}){thread{isResolved}}}' \
  -f t="$THREAD_ID" \
  --jq '.data.resolveReviewThread.thread.isResolved'
```

- The GraphQL `input` is an **object**, not a string. `input:"PRRT_..."` → `argumentLiteralsIncompatible`. Always `input:{threadId:"..."}` (or pass via a GraphQL variable as above).
- If `$REPLY_BODY` has apostrophes, don't nest HEREDOCs inside `gh api ... -f body="$(cat <<EOF…EOF)"` — bash quote-nesting will bite you. Put the body in a shell variable first and pass `-f body="$REPLY_BODY"`.

### 5. After the loop — validate, push once, batch the replies

Every FIX commit was already unit-tested individually in step 3d.2, but run the final gates on the whole batch before anything leaves the machine:

1. **Full unit suite on HEAD** — re-run the same command the project uses for unit tests (the one detected in step 3d.2). Per-commit runs catch *that* commit, but docs-only fixes skipped the gate by design, and the interaction of several fixes on HEAD isn't validated until now. This is cheap (seconds to a minute on most projects) and symmetric with the E2E gate below. If it fails, the offending commit is somewhere in the batch — bisect or fix the top of the stack, then retry.
2. **E2E / integration if needed** — if the project has an end-to-end or integration suite (typical names: `test:e2e`, `tests/integration/`, `pytest -m e2e`, `cargo test --test integration`, etc.) and **any commit in the batch touches integration boundaries** (HTTP clients, authentication, external APIs, databases, message queues, filesystem-as-contract) where unit mocks can't catch real regressions — run it. If the whole batch is docs + trivial refactors, skip it. Note that these suites are often slow and may hit live external services, so gate them intentionally.
3. **Ask the user to confirm the push** — the standard convention in most projects is that push is an explicit action, never implicit. Show the user the list of queued commits (`git log origin/<branch>..HEAD --oneline`) and the queued replies, then wait for a yes.
4. `git push`.
5. Replay the queued replies — for each `{comment_id, thread_id, sha, short_note}`, call the bundled helper:

   ```bash
   bash "${CLAUDE_SKILL_DIR}/scripts/resolve-comment.sh" \
     "$comment_id" "$thread_id" "Fixed in $sha. $short_note" "$PR"
   ```

   The script posts the reply and resolves the thread in one shot. If any individual call exits non-zero, note the failing `{comment_id, thread_id}`, move on to the rest, and surface the leftovers in the final summary so the user can resolve them by hand.

If any gate fails (unit or E2E), do **not** push. Fix the offending commit(s) (likely `git reset` or a follow-up fix), re-validate, then come back to step 3. The queued replies still apply as long as the SHAs don't change.

Report back to the user with a short summary:

```text
Processed <N> CodeRabbit comments on PR #<N>:
  ✅ <K> fixed and resolved (commits: <sha1>, <sha2>, …)
  ⚠️  <M> rejected with justification and resolved
  ⏸  <L> skipped (still open)

All threads that remain open: <list>
```

## Commit & reply examples

**Good commit message:**

```text
fix(http): normalize partial error payloads before constructing error

Per CodeRabbit PR review on #42: the error branch accepted any response
body with either `title` or `detail` set and passed it straight to the
error constructor, leaving `detail` / `status` / `title` as undefined on
the resulting instance whenever the server returned a partial Problem
Details shape. Always build a complete problem-details object with
sensible fallbacks before instantiating the error.

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>
```

**Good reply** (adopted partial, explains what was skipped):

```text
Applied in d5167fd. Took the intent of the suggestion but kept the original
wording where it was already user-focused:
- dropped "rollout 2026-04-16" (rollout timing, not user impact)
- dropped "dedicated error type/class" (lands in implementation detail)
- did not adopt "improves compatibility with current API behavior" — felt
  too vague vs. the concrete outcomes we can name.
```

**Good reject reply**:

```text
Leaving as-is: the project's `CONTRIBUTING.md` entry on changelog style
explicitly forbids method/class names in CHANGELOG entries, which is what
this suggestion would add back. The current wording is the user-facing
rewording that satisfies both the style rule and the version-traceability
requirement.
```

## When *not* to use this skill

- There are no CodeRabbit comments on the PR (human reviewers only) — use general PR review workflow, not this.
- The PR isn't yet opened / the branch hasn't been pushed.
- The user wants to dispute CodeRabbit's findings in bulk without going comment-by-comment — handle that conversationally, don't loop through the skill.
- The current working tree is dirty with unrelated changes — commit or stash first; one-commit-per-comment cannot coexist with "work in progress" in the staging area.
