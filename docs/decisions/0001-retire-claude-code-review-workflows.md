# 1. Retire the Claude Code Review workflows

- Status: accepted
- Date: 2026-08-22

## Context

The repository ran two workflows built on `anthropics/claude-code-action`:

- `.github/workflows/claude-code-review.yml` - automatic, triggered on every pull request, publishing a `Claude Code Review` check.
- `.github/workflows/claude.yml` - on demand, triggered only when someone writes `@claude` in an issue or pull request comment.

Both authenticate with the repository secret `CLAUDE_CODE_OAUTH_TOKEN`, last set 2026-04-19. Investigating the persistently red check turned up two separate problems.

**The credential is revoked, not expired.** The OAuth grant behind the token was revoked, and every call now returns `401 OAuth access token has been revoked`. A revocation invalidates every token minted from that grant, so nothing short of a fresh interactive `claude setup-token` restores it - and that cannot be automated. The gate failed on every pull request from 2026-07-21 onward and nobody noticed for a month. The same revocation makes the on-demand workflow inert; it just fails silently, because nothing invokes it unless a human asks.

**The gate can report green without reviewing anything.** `claude-code-action` validates the workflow file against the copy on the default branch. When that validation trips, which it does for any pull request that touches `.github/workflows/**`, the job exits `success` having performed no review. The run history shows exactly that: a `success` conclusion on 2026-08-18 for a branch that only edited the workflow file, sitting among failures on every other branch in the same period. A check that turns green precisely on the pull requests that change CI is worse than an honest red, because a reviewer reads it as coverage that was never there.

## Options considered

### Rotate the credential and change nothing else

Rejected. This restores the gate and restarts the same silent clock that just ran out, leaving both failure modes intact.

### Rotate the credential and add a liveness watcher

Rejected. The token can only be minted interactively, so it cannot be renewed by automation and will eventually lapse again. The watcher is standing machinery to maintain for a check that nobody missed during the month it was dead. It also does nothing about the false-green mode, which is a property of the action, not of the credential.

### Retire the automatic gate, keep the on-demand workflow

Rejected. Leaving `claude.yml` behind keeps a second workflow wired to the same revoked credential and preserves the impression that Claude review is still part of how this repository is reviewed, when it is not. Its failure is quieter than the gate's, not more useful.

### Retire both workflows

Chosen.

## Decision

Delete `.github/workflows/claude-code-review.yml` and `.github/workflows/claude.yml`. Claude-based review is no longer part of how this repository is reviewed. `docs.yml` becomes the only workflow in the repository.

Rotating `CLAUDE_CODE_OAUTH_TOKEN` is deliberately not part of this decision. The secret is left in place, unused; removing it is a repository-settings action rather than a code change.

Engineering decision records live under `docs/decisions/` but are excluded from the published documentation site via `srcExclude` - this site is the public plugin catalog, and internal decisions do not belong in its navigation or search index.

## Consequences

- Pull requests no longer show a `Claude Code Review` check. Nothing is lost: that check has not reviewed anything since 2026-07-21.
- Review coverage is unchanged in practice. CodeRabbit still reviews every pull request, and the project still requires reviewer sign-off before merge.
- `@claude` no longer does anything in this repository. It had not worked since the revocation anyway.
- This is a two-way door: restoring either workflow is a single `git revert` plus a valid token. Anyone doing so should first understand the false-green mode described above and decide how the workflow's liveness will be watched, otherwise it will die the same silent death.
