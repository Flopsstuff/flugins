# Git Plugin

**Name:** `git`

**Description:** Smart git workflow commands with intelligent conflict resolution

**Author:** Flop (flop@hackerspace.by)

**Version:** 1.0.0

**Keywords:** git, version-control, merge, workflow

The Git plugin provides intelligent workflow management commands for common git operations with automated conflict resolution. It helps streamline rebasing, squashing commits, and merging from upstream branches while preserving the intent of your changes.

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

## Tips and Tricks

### Git Workflow Integration

1. **Feature Branch Workflow:**
   ```bash
   # Start feature
   git checkout -b feature/new-feature

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

   # Keep updated with upstream
   /git:upstream-merge

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
