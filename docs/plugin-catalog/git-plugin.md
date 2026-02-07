# Git Plugin

**Name:** `git`

**Description:** Smart git workflow commands with intelligent conflict resolution

**Author:** Flop (flop@hackerspace.by)

**Version:** 1.1.0

**Keywords:** git, version-control, merge, rebase, worktree, squash, workflow

The Git plugin provides intelligent workflow management commands for common git operations with automated conflict resolution. It helps streamline rebasing, squashing commits, merging from upstream branches, and managing worktrees while preserving the intent of your changes.

## Installation

```bash
claude plugin install git@flugins
```

**Important:** After installing the plugin, restart Claude Code to activate the commands.

**Tip:** Enable auto-update via `/plugin` → **Installed** → select the plugin → enable auto-update.

## Features

### Commands

- [Rebase](#rebase) - Rebase current branch with intelligent conflict resolution
- [Squash Commits](#squash-commits) - Consolidate commits into logical groups
- [Upstream Merge](#upstream-merge) - Merge from upstream with automatic conflict resolution
- [Upstream Rebase](#upstream-rebase) - Rebase onto upstream branch with automatic conflict resolution
- [Worktree Start](#worktree-start) - Create a new branch with a worktree in a sibling directory
- [Worktree Done](#worktree-done) - Finalize worktree — squash, push, and clean up
- [Worktree Kill](#worktree-kill) - Destroy worktree and delete branch without saving

---

## Rebase

**Command:** `/git:rebase`

Intelligently rebases the current branch onto a base branch and automatically resolves conflicts by understanding the implementation intent.

### Usage

```bash
/git:rebase
```

### What it does

1. **Pre-flight checks:**
   - Checks for uncommitted changes
   - Offers to stash changes if needed
   - Identifies current and base branches

2. **Change analysis:**
   - Analyzes all changes in your current branch
   - Understands the purpose and context of modifications
   - Maps file changes to their implementation goals

3. **Rebase execution:**
   - Rebases onto the base branch (main/master/develop)
   - Detects and analyzes conflicts when they occur

4. **Intelligent conflict resolution:**
   - Reads conflicted files with conflict markers
   - Understands both incoming (base) and current changes
   - Applies resolution strategy based on:
     - Feature-specific logic (prioritizes current branch)
     - Infrastructure/refactoring updates (prioritizes base branch)
     - Non-overlapping changes (keeps both)
     - Intelligent merging when both changes make sense
   - Stages resolved files automatically

5. **Completion:**
   - Continues rebase after each conflict resolution
   - Restores stashed changes if any
   - Shows final commit history
   - Provides summary of resolved conflicts

### Example Workflow

```bash
# Working on a feature branch
git checkout feature/new-api

# Rebase onto latest main
/git:rebase

# Claude analyzes your changes
# "I can see you've modified the authentication middleware and added
#  new API endpoints. Let me rebase onto main..."

# If conflicts occur:
# "Conflict in auth.js detected. The base branch refactored error handling,
#  while your branch added new auth methods. Merging both changes intelligently..."

# Rebase complete
# "Rebase successful! Resolved 2 conflicts in auth.js and api/routes.js.
#  Your feature changes are preserved while incorporating the refactored error handling."
```

### Best Practices

- Use `/git:rebase` before creating pull requests to ensure clean history
- Rebase regularly during feature development to stay up-to-date
- Let Claude analyze changes before resolving conflicts manually
- Review the final result to ensure conflict resolution aligns with intent

### When to Use

- **Before Pull Requests:** Clean up history before submitting for review
- **Long-running Branches:** Stay synchronized with main branch development
- **Conflict Resolution:** Let Claude intelligently resolve complex conflicts
- **Team Collaboration:** Incorporate upstream changes while preserving your work

### Recovery

If issues occur during rebase:
- Claude automatically offers `git rebase --abort` on critical failures
- Stashed changes are restored if rebase is aborted
- Original branch state is preserved for recovery

---

## Squash Commits

**Command:** `/git:squash [N]`

Consolidates all commits on your branch into one or N logically grouped commits with intelligent naming and organization.

### Usage

```bash
# Squash all commits into a single commit (default)
/git:squash

# Squash into 3 logically grouped commits
/git:squash 3

# Squash into 5 commits
/git:squash 5
```

### Parameters

- `N` (optional): Number of target commits. Default: 1

### What it does

1. **Pre-flight checks:**
   - Verifies you're not on main/master branch
   - Checks for uncommitted changes
   - Offers to stash if needed

2. **Commit analysis:**
   - Counts total commits to be squashed
   - Determines base branch (main/master/develop)
   - Reads all commit messages and diffs
   - Identifies logical groups (features, fixes, refactoring, docs)

3. **Intelligent grouping (when N > 1):**
   - Groups commits by related functionality
   - Considers type of change (feature, fix, refactor)
   - Respects chronological phases of work
   - Suggests alternative grouping if N doesn't match natural structure

4. **Commit message generation:**
   - Creates comprehensive messages for single commit squashes
   - Generates scoped messages for multi-commit squashes
   - Preserves important context from original messages
   - Follows conventional commit format

5. **Execution:**
   - Shows squash plan for approval
   - Safely backs up current HEAD
   - Performs soft reset to base branch
   - Creates new commit(s) with prepared messages
   - Verifies changes match original
   - Restores stashed changes if any

### Example Workflows

**Single Commit Squash:**

```bash
# You have 5 commits on your branch:
# - Add user model
# - Add user validation
# - Fix validation bug
# - Add tests
# - Update docs

/git:squash

# Claude analyzes and proposes:
# "Squashing 5 commits into 1 commit:
#
#  feat: implement user model with validation
#
#  - Add user model with email and name fields
#  - Implement validation for required fields
#  - Add comprehensive test coverage
#  - Update API documentation
#
#  Proceed? (yes/no/edit)"
```

**Multi-Commit Squash:**

```bash
# You have 8 commits implementing auth system
/git:squash 3

# Claude groups logically:
# "Squashing 8 commits into 3 logical groups:
#
#  1. feat: add authentication endpoints (commits 1-3)
#  2. refactor: extract token utilities (commits 4-6)
#  3. fix: handle edge cases in auth flow (commits 7-8)
#
#  Proceed? (yes/no/edit)"
```

### Best Practices

- Squash before creating pull requests for cleaner history
- Use N > 1 when commits represent distinct phases or features
- Review the proposed commit messages before confirming
- Don't squash commits that have already been pushed to shared branches
- Let Claude suggest the natural grouping count

### When to Use

- **Pre-PR Cleanup:** Clean commit history before submitting for review
- **Feature Branches:** Consolidate exploratory/WIP commits into logical units
- **Story Alignment:** Group commits to match user story or task breakdown
- **Readable History:** Make git log more meaningful for future reference

### Safety Features

- Creates backup reference before any destructive operations
- Warns if commits have been pushed to remote
- Offers abort and restore on any failure
- Preserves total changes (verified with diff)

---

## Upstream Merge

**Command:** `/git:upstream-merge`

Intelligently merges changes from an upstream branch into your current branch with automatic conflict resolution based on understanding implementation intent.

### Usage

```bash
/git:upstream-merge
```

### What it does

1. **Pre-flight checks:**
   - Checks for uncommitted changes (offers stashing)
   - Identifies current branch
   - Detects configured upstream branch
   - Allows manual upstream selection if needed

2. **Fetch and analysis:**
   - Fetches latest changes from all remotes
   - Checks how far upstream is ahead
   - Exits early if upstream has no new changes

3. **Change understanding:**
   - Analyzes your branch's changes and their intent
   - Analyzes upstream's changes and their purpose
   - Identifies potential conflict areas
   - Summarizes findings to you

4. **Merge execution:**
   - Performs merge with `--no-commit --no-ff`
   - Detects conflicts immediately

5. **Intelligent conflict resolution:**
   - Lists all conflicted files
   - For each conflict:
     - Reads conflict markers
     - Analyzes both versions in context
     - Determines resolution strategy based on:
       - Intent of your branch changes
       - Intent of upstream changes
       - Which changes should take precedence
       - How to combine both changes if possible
     - Resolves and stages the file
   - Provides summary of resolution decisions

6. **Completion:**
   - Creates merge commit with descriptive message
   - Shows merge result and statistics
   - Restores stashed changes if any

### Example Workflow

```bash
# Working on feature branch tracking upstream
git checkout feature/api-improvements

# Merge latest upstream changes
/git:upstream-merge

# Claude analyzes:
# "Your branch adds new API endpoints and validation.
#  Upstream added rate limiting middleware and updated error handling.
#  Fetching upstream changes..."

# If conflicts occur:
# "Conflict detected in api/server.js
#  - Your branch: Added new /users endpoint
#  - Upstream: Refactored middleware registration
#
#  Resolution: Keeping both changes. Registering your new endpoint
#  using the refactored middleware pattern from upstream."

# Merge complete:
# "Merge successful! Integrated upstream rate limiting with your
#  new endpoints. All conflicts resolved intelligently."
```

### Best Practices

- Merge from upstream regularly to avoid large conflicts
- Let Claude analyze changes before manual conflict resolution
- Review resolution decisions to ensure they match intent
- Use when working with forked repositories
- Helpful for keeping feature branches updated with main

### When to Use

- **Fork Maintenance:** Sync your fork with the original repository
- **Long-running Features:** Keep feature branches updated with main development
- **Collaborative Development:** Integrate team changes into your branch
- **Upstream Tracking:** Pull latest changes from tracked upstream branches

### Recovery

- Use `git merge --abort` to cancel during conflict resolution (Claude offers this)
- Stashed changes are automatically restored if merge is aborted
- Claude explains reasoning for each resolution decision

---

## Upstream Rebase

**Command:** `/git:upstream-rebase`

Intelligently rebases your current branch onto an upstream branch with automatic conflict resolution. Produces a clean, linear history without merge commits.

### Usage

```bash
/git:upstream-rebase
```

### What it does

1. **Pre-flight checks:**
   - Checks for uncommitted changes (offers stashing)
   - Identifies current branch
   - Detects configured upstream branch
   - Allows manual upstream selection if needed

2. **Fetch and analysis:**
   - Fetches latest changes from all remotes
   - Checks how far upstream is ahead
   - Exits early if upstream has no new changes

3. **Change understanding:**
   - Analyzes your branch's commits and their intent
   - Lists commits that will be rebased
   - Analyzes upstream's changes and their purpose
   - Identifies potential conflict areas
   - Summarizes findings to you

4. **Rebase execution:**
   - Replays your commits one by one onto the upstream branch
   - Detects conflicts at each commit step

5. **Intelligent conflict resolution:**
   - For each commit that conflicts:
     - Identifies which commit is being applied (`REBASE_HEAD`)
     - Lists all conflicted files
     - Reads conflict markers
     - Analyzes both versions in context
     - Determines resolution strategy based on intent
     - Resolves and stages files
     - Continues rebase to next commit
   - Repeats until all commits are replayed
   - Provides summary of all resolution decisions

6. **Completion:**
   - Shows rebased commit history
   - Displays change statistics
   - Restores stashed changes if any

### Example Workflow

```bash
# Working on feature branch tracking upstream
git checkout feature/api-improvements

# Rebase onto latest upstream
/git:upstream-rebase

# Claude analyzes:
# "Your branch has 4 commits adding new API endpoints.
#  Upstream added rate limiting middleware and updated error handling.
#  Rebasing your commits onto upstream..."

# If conflicts occur:
# "Conflict in commit 'Add /users endpoint' at api/server.js
#  - Your commit: Added new /users endpoint
#  - Upstream: Refactored middleware registration
#
#  Resolution: Adapting your endpoint to use the refactored
#  middleware pattern from upstream. Continuing rebase..."

# Rebase complete:
# "Rebase successful! Replayed 4 commits onto upstream.
#  Resolved 2 conflicts. Clean linear history preserved."
```

### Upstream Merge vs Upstream Rebase

| Aspect | `/git:upstream-merge` | `/git:upstream-rebase` |
|--------|----------------------|----------------------|
| History | Creates a merge commit | Linear history, no merge commit |
| Commit hashes | Preserved | New hashes for rebased commits |
| Conflict resolution | Once for all changes | Per-commit as each is replayed |
| Best for | Shared branches, preserving history | Feature branches, clean PRs |
| Safety | Non-destructive | Rewrites history (don't use on shared branches) |

### Best Practices

- Use for feature branches before creating pull requests
- Don't use on branches that others are working on (rewrites history)
- Let Claude analyze changes before resolving conflicts manually
- Review resolution decisions to ensure they match intent

### When to Use

- **Before Pull Requests:** Get a clean linear history on top of latest upstream
- **Feature Branches:** Replay your work onto the latest upstream state
- **Fork Contribution:** Rebase your changes onto the original repo's branch
- **Clean History:** When you prefer linear history over merge commits

### Recovery

- Use `git rebase --abort` to cancel during conflict resolution (Claude offers this)
- Stashed changes are automatically restored if rebase is aborted
- After rebase, commit hashes change — this is expected behavior

---

## Worktree Start

**Command:** `/git:worktree-start [branch-name]`

Creates a new branch and a git worktree for it in a sibling directory. The directory is named after the current repo with a branch suffix, allowing you to work on multiple branches simultaneously without stashing or switching.

### Usage

```bash
# Specify branch name
/git:worktree-start feature/auth

# Interactive — Claude will ask for the branch name
/git:worktree-start
```

### Parameters

- `branch-name` (optional): Name for the new branch. If omitted, Claude will ask.

### What it does

1. **Repository detection:**
   - Identifies the repo root directory and its parent
   - Determines the repo directory name (e.g., `my-project`)

2. **Branch setup:**
   - Uses provided branch name or asks the user
   - Validates the branch doesn't already exist (offers to reuse if it does)

3. **Directory creation:**
   - Sanitizes branch name for directory use (`/` → `-`)
   - Computes target path: `PARENT/REPO-BRANCH` (e.g., `../my-project-feature-auth`)
   - Checks for directory conflicts

4. **Worktree creation:**
   - Creates the worktree with a new branch: `git worktree add -b BRANCH PATH`
   - Or attaches to an existing branch: `git worktree add PATH BRANCH`

5. **Switch to new worktree:**
   - Changes into the new directory
   - Shows status and confirms setup

### Example Workflow

```bash
# You're in /projects/my-app on main branch
/git:worktree-start feature/notifications

# Claude creates:
# - Branch: feature/notifications
# - Worktree: /projects/my-app-feature-notifications
# - Switches to the new directory

# Now you can work on notifications without affecting main
# Your original worktree at /projects/my-app stays on main
```

### Managing Worktrees

```bash
# List all worktrees
git worktree list

# Remove a worktree when done
git worktree remove ../my-app-feature-notifications

# Prune stale worktree entries
git worktree prune
```

### Best Practices

- Use worktrees when you need to work on multiple branches simultaneously
- Useful for reviewing PRs while keeping your current work intact
- Each worktree is independent — changes don't affect other worktrees
- Remember to clean up worktrees when branches are merged

### When to Use

- **Parallel Development:** Work on a feature and a bugfix at the same time
- **PR Reviews:** Check out a PR branch without disrupting your current work
- **Quick Hotfixes:** Create a separate worktree for an urgent fix while mid-feature
- **Experiments:** Try something in isolation without stashing current changes

---

## Worktree Done

**Command:** `/git:worktree-done`

Finalizes work in the current worktree: squashes commits, pushes the branch, removes the worktree, and switches back to the main working tree.

### Usage

```bash
/git:worktree-done
```

### What it does

1. **Worktree verification:**
   - Confirms you are in a worktree (not the main working tree)
   - Identifies the main worktree path to return to

2. **Uncommitted changes check:**
   - If changes exist, offers to commit, discard, or abort

3. **Commit analysis:**
   - Lists all commits on the branch since the base branch
   - Shows commit count and summaries

4. **Squash (optional):**
   - If more than 1 commit, offers to squash into a single commit with a generated message
   - Can also squash into N logical groups
   - Or keep commits as-is

5. **Push (optional):**
   - Pushes the branch to remote
   - Uses `--force-with-lease` if history was rewritten by squash

6. **Cleanup:**
   - Switches back to the main worktree directory
   - Removes the worktree (`git worktree remove`)
   - If the branch was merged, offers to delete it

### Example Workflow

```bash
# You're in /projects/my-app-feature-auth worktree
# Done with your work, all committed

/git:worktree-done

# Claude analyzes:
# "Branch feature/auth has 5 commits:
#  - Add auth middleware
#  - Add login endpoint
#  - Add tests
#  - Fix token expiry
#  - Update docs
#
#  Squash into single commit? (Recommended)"

# After squash:
# "Squashed into: feat: add authentication with login endpoint and middleware
#  Push to origin? (Recommended)"

# After push:
# "Pushed feature/auth to origin.
#  Removing worktree /projects/my-app-feature-auth...
#  Switched back to /projects/my-app (main branch).
#  Done!"
```

### Full Worktree Lifecycle

```bash
# 1. Start — create worktree for a new task
/git:worktree-start feature/auth

# 2. Work — make changes, commit as you go
git add . && git commit -m "WIP"

# 3a. Finish — squash, push, clean up
/git:worktree-done

# 3b. Or abort — destroy everything and go back
/git:worktree-kill
```

### Best Practices

- Commit all your work before running this command
- Let Claude generate squash commit messages from your commit history
- Push before removing the worktree to avoid losing work
- Use this instead of manually cleaning up worktrees

---

## Worktree Kill

**Command:** `/git:worktree-kill`

Destroys the current worktree and deletes its branch. No squash, no push — just clean removal. Use when the work in the worktree is no longer needed.

### Usage

```bash
/git:worktree-kill
```

### What it does

1. **Worktree verification:**
   - Confirms you are in a worktree (not the main working tree)
   - Identifies the main worktree path to return to

2. **Confirmation:**
   - Shows the worktree path and branch name
   - Warns that all uncommitted and unpushed work will be lost
   - Requires explicit confirmation before proceeding

3. **Destruction:**
   - Switches back to the main worktree
   - Force-removes the worktree (`git worktree remove --force`)
   - Force-deletes the branch (`git branch -D`)
   - Deletes the remote branch if it was pushed

### Example Workflow

```bash
# You're in /projects/my-app-experiment-xyz worktree
# The experiment didn't work out

/git:worktree-kill

# Claude confirms:
# "This will permanently remove:
#  - Worktree: /projects/my-app-experiment-xyz
#  - Branch: experiment/xyz
#  All uncommitted and unpushed work will be lost.
#  Proceed?"

# After confirmation:
# "Worktree removed. Branch deleted.
#  Switched back to /projects/my-app (main branch)."
```

### Worktree Done vs Worktree Kill

| Aspect | `/git:worktree-done` | `/git:worktree-kill` |
|--------|---------------------|---------------------|
| Purpose | Finish and preserve work | Discard and clean up |
| Squash | Optional | No |
| Push | Optional | No (deletes remote branch if exists) |
| Branch | Kept (or deleted if merged) | Force-deleted |
| Data loss | None | All unpushed work lost |

### When to Use

- **Failed Experiments:** The approach didn't work, discard everything
- **Abandoned Features:** Requirements changed, work is no longer needed
- **Quick Cleanup:** Remove stale worktrees that are no longer relevant
- **Reset:** Start fresh on a different approach

---

## Tips and Tricks

### Git Workflow Integration

1. **Feature Branch Workflow:**
   ```bash
   # Start feature (choose one)
   git checkout -b feature/new-feature    # Same worktree
   /git:worktree-start feature/new-feature # Separate worktree

   # Work on feature with multiple commits
   git commit -m "WIP: initial implementation"
   git commit -m "WIP: add tests"
   git commit -m "fix bug"

   # Before PR: rebase and squash
   /git:rebase           # Update with latest main
   /git:squash           # Clean up commit history

   # Push and create PR
   git push -u origin feature/new-feature
   ```

2. **Fork Contribution Workflow:**
   ```bash
   # Fork repository and clone
   git clone your-fork-url
   git remote add upstream original-repo-url

   # Create feature branch
   git checkout -b feature/contribution

   # Keep updated with upstream (choose one)
   /git:upstream-merge    # Creates merge commit
   /git:upstream-rebase   # Clean linear history

   # Clean up before PR
   /git:squash
   ```

3. **Long-running Branch Maintenance:**
   ```bash
   # Regularly rebase to stay current
   /git:rebase

   # Or merge from upstream if rebase is too complex
   /git:upstream-merge

   # Squash into logical commits before merging
   /git:squash 3
   ```

### Performance Tips

- Let Claude analyze changes first - it's faster than manual conflict resolution
- Use `/git:rebase` for cleaner history (preferred for feature branches)
- Use `/git:upstream-merge` when rebasing would rewrite too much history
- Squash early and often during development to keep history manageable

### Safety Tips

- Always commit or stash changes before running git commands
- Review Claude's conflict resolution decisions
- Use `git reflog` to recover if something goes wrong
- Test after conflict resolution to ensure functionality is preserved
- Don't force-push to shared branches after rebasing

---

## Common Use Cases

### Preparing Pull Request

```bash
# Update with latest main
/git:rebase

# Clean up commit history
/git:squash

# Push
git push -u origin feature-branch
```

### Syncing Forked Repository

```bash
# Merge latest upstream
/git:upstream-merge

# Resolve any conflicts intelligently
# Push updated fork
git push origin main
```

### Cleaning Up WIP Commits

```bash
# You have many "WIP" or "fix typo" commits
/git:squash

# Claude consolidates into meaningful commit(s)
```

### Handling Complex Conflicts

```bash
# Attempt rebase
/git:rebase

# Claude analyzes conflicts and resolves based on
# understanding of both your changes and base changes
```

---

## Comparison with Manual Git

| Operation | Manual Git | With Git Plugin |
|-----------|-----------|-----------------|
| Rebase | `git rebase main` → manual conflict resolution | `/git:rebase` → intelligent auto-resolution |
| Squash | `git rebase -i HEAD~5` → interactive editing | `/git:squash 2` → automatic grouping & messages |
| Upstream merge | `git merge upstream/main` → manual conflicts | `/git:upstream-merge` → understands intent |
| Upstream rebase | `git rebase upstream/main` → manual per-commit conflicts | `/git:upstream-rebase` → intelligent per-commit resolution |
| Worktree | `git worktree add -b branch ../dir` → manual setup | `/git:worktree-start branch` → auto-naming, auto-switch |
| Worktree cleanup | `git worktree remove` + manual squash/push/cd | `/git:worktree-done` → squash, push, cleanup in one step |
| Worktree discard | `git worktree remove --force` + `git branch -D` | `/git:worktree-kill` → confirm and destroy |
| Conflict resolution | Read markers, decide, edit, stage | Claude analyzes and resolves intelligently |
| Commit messages | Write manually | Generated based on change analysis |

## Limitations

- Requires git repository (commands check for `.git` directory)
- Works best with branches that have clear base branches
- Complex 3-way conflicts may require user guidance
- Cannot resolve conflicts requiring domain-specific knowledge without context
- Assumes conventional commit message format for best results

## Advanced Configuration

### Custom Base Branches

The plugin automatically detects common base branches (main/master/develop). If your project uses different branches, Claude will ask you to specify.

### Conflict Resolution Strategies

Claude uses context-aware resolution:
- **Feature changes:** Preserved from current branch
- **Infrastructure changes:** Accepted from base/upstream
- **Non-conflicting:** Both changes kept
- **Ambiguous:** Claude asks for guidance

---

## Troubleshooting

### "Cannot squash on main branch"

You're currently on the main/master branch. Checkout a feature branch first:
```bash
git checkout -b feature-branch
```

### "No commits to squash"

Your branch has no commits beyond the base branch. Make some commits first.

### "Rebase conflict too complex"

Claude will offer to abort. You can:
- Abort and resolve manually: `git rebase --abort`
- Provide guidance when Claude asks
- Use `/git:upstream-merge` instead (creates merge commit)

### "Uncommitted changes detected"

Commit or stash your changes before running git commands:
```bash
git stash push -m "WIP"
# or
git commit -m "WIP: current progress"
```
