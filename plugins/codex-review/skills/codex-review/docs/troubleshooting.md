# Troubleshooting `codex review`

Load this only when the review command in step 2 of the skill actually failed.
Each section is keyed to what the command printed, not to a pre-flight check —
the failure is the diagnosis.

---

## `codex: command not found`

The Codex CLI is not installed, or not on `PATH`.

```bash
npm install -g @openai/codex
```

Homebrew also carries it on macOS:

```bash
brew install codex
```

Verify with `codex --version`.

If it is installed but still not found, the usual cause is an npm global prefix
your shell does not search. `npm prefix -g` prints the root; add its `bin`
directory to `PATH` in the shell profile.

---

## `unrecognized subcommand 'review'` / `error: unexpected argument`

`codex` is installed but predates non-interactive review support.

```bash
npm install -g @openai/codex@latest
codex review --help
```

The help output should list `--base`, `--uncommitted` and `--commit`. If it
does not, check `codex --version` against the
[Codex CLI releases](https://github.com/openai/codex/releases).

---

## A login prompt, `not authenticated`, or a 401 in the log

The CLI is installed but has no valid session. It cannot be authenticated
non-interactively from inside the skill — the user has to do it.

Ask them to run this themselves (in Claude Code, prefixing a command with `!`
runs it in the session so the output lands in the conversation):

```bash
codex login
```

Then re-run the review. Do not attempt to work around an unauthenticated CLI.

---

## `fatal: ambiguous argument 'main'` / unknown revision

The base branch named in `--base` does not exist locally.

```bash
git branch -a          # what actually exists
git fetch origin       # if it is only on the remote
```

Common cases: the repo's default is `master`, or the base is a remote-only
branch that needs `origin/` (`--base origin/develop`), or the clone is shallow
and lacks the base entirely (`git fetch --unshallow`).

---

## The review ran but produced no findings block

The log has no `Full review comments:` line at all.

First check whether there was anything to review — an empty diff against the
base produces no findings, and that is a correct result, not a failure:

```bash
git diff --stat <base>...HEAD
```

If the diff is non-empty and the log still has no findings block, read the tail
of the log. The review may have failed partway (a sandbox denial, a token
limit, an API error) and the exit code will usually say so. Report what the log
says rather than presenting the run as a clean review.

---

## The findings look duplicated

They are — Codex repeats its final message, so the same verdict and the same
findings normally appear twice in the log. Deduplicate before acting. This is
expected output, not a symptom of anything wrong.
