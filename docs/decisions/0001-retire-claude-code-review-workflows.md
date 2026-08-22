# 1. Retire the automatic Claude Code Review gate

- Status: accepted
- Date: 2026-08-22

## Context

The repository ran two workflows built on `anthropics/claude-code-action`:

- `.github/workflows/claude-code-review.yml` - automatic, triggered on every pull request, publishing a `Claude Code Review` check.
- `.github/workflows/claude.yml` - on demand, triggered only when someone writes `@claude` in an issue or pull request comment.

Both authenticate with the repository secret `CLAUDE_CODE_OAUTH_TOKEN`, last set 2026-04-19. Investigating the persistently red check turned up two separate problems.

**The credential is revoked, not expired.** The OAuth grant behind the token was revoked, and every call now returns `401 OAuth access token has been revoked`. A revocation invalidates every token minted from that grant, so nothing short of a fresh interactive `claude setup-token` restores it. The gate failed on every pull request from 2026-07-21 onward and nobody noticed for a month.

**The gate can report green without reviewing anything.** `claude-code-action` validates the workflow file against the copy on the default branch. When that validation trips, which it does for any pull request that touches `.github/workflows/**`, the job exits `success` having performed no review. The run history shows exactly that: a `success` conclusion on 2026-08-18 for a branch that only edited the workflow file, sitting among failures on every other branch in the same period. A check that turns green precisely on the pull requests that change CI is worse than an honest red, because a reviewer reads it as coverage that was never there.

## Options considered

### Rotate the credential and add a liveness watcher

Mint a fresh token and add monitoring that alerts when the gate starts failing.

Rejected. The token can only be minted interactively, so it cannot be renewed by automation and will eventually lapse again. The watcher is standing machinery to maintain for a check that nobody missed during the month it was dead. It also does nothing about the false-green mode, which is a property of the action, not of the credential.

### Rotate the credential and change nothing else

Rejected. This restores the gate and restarts the same silent clock that just ran out, leaving both failure modes intact.

### Retire the automatic gate and keep the on-demand workflow

Chosen.

## Decision

Delete `.github/workflows/claude-code-review.yml`.

Keep `.github/workflows/claude.yml`. Being on demand, it fails loudly at the moment someone asks for a review rather than decorating every pull request with a check that means nothing.

Rotating `CLAUDE_CODE_OAUTH_TOKEN` is deliberately not part of this decision. If a valid token is set later, the on-demand workflow resumes working with no code change.

## Consequences

- Pull requests no longer show a `Claude Code Review` check. Nothing is lost: that check has not reviewed anything since 2026-07-21.
- Automatic review coverage is unchanged in practice. CodeRabbit still reviews every pull request, and the project still requires reviewer sign-off before merge.
- On-demand Claude review stays reachable by commenting `@claude`, and starts working again as soon as the repository secret holds a valid token. Until then it fails visibly, which is the intended behaviour.
- This is a two-way door: restoring the gate is a single `git revert` of the commit that removed it. Anyone doing so should first understand the false-green mode described above and decide how the gate's liveness will be watched, otherwise it will die the same silent death.
