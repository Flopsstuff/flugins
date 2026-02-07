---
description: Destroy worktree and delete its branch without saving
allowed-tools: Bash(git *), Bash(cd *), Bash(pwd), Read, AskUserQuestion
disable-model-invocation: false
---

# Git Worktree Kill

Usage: `/git:worktree-kill`

Destroys the current worktree and deletes its branch. No squash, no push — just clean removal. Use when the work in the worktree is no longer needed.

## Steps

1. **Verify we are in a worktree (not the main working tree)**
   ```bash
   git rev-parse --git-common-dir
   git rev-parse --git-dir
   ```
   - If `--git-dir` points to a `.git` file (not directory), we are in a worktree
   - Alternatively check: `git worktree list` and see if current directory is not the first entry (main worktree)
   - If we are in the main worktree, inform the user and exit:
     - "You are in the main working tree, not a worktree. Switch to a worktree first."

2. **Get context**
   ```bash
   git rev-parse --abbrev-ref HEAD
   git worktree list
   git rev-parse --show-toplevel
   ```
   - Record current branch name
   - Record current worktree path
   - Identify the main worktree path (first entry in `git worktree list`)

3. **Confirm with the user**
   - Show what will be destroyed using AskQuestion:
     - "This will permanently remove worktree at WORKTREE_PATH and delete branch BRANCH_NAME. All uncommitted and unpushed work will be lost. Proceed?"
     - Option 1: "Yes, destroy it"
     - Option 2: "Abort"
   - If user aborts, exit immediately

4. **Switch back to main worktree**
   ```bash
   cd MAIN_WORKTREE_PATH
   ```

5. **Force remove the worktree**
   ```bash
   git worktree remove --force WORKTREE_PATH
   ```

6. **Delete the branch**
   ```bash
   git branch -D BRANCH_NAME
   ```
   - Use `-D` (force delete) since the branch is unmerged

7. **Clean up remote tracking branch (if exists)**
   ```bash
   git push origin --delete BRANCH_NAME 2>/dev/null
   ```
   - If the branch was pushed to remote, delete it there too
   - If it wasn't pushed, this step silently skips

8. **Show result**
   ```bash
   git worktree list
   ```
   - Confirm worktree was removed
   - Confirm branch was deleted
   - Confirm current directory is the main worktree

## Notes

- This is a destructive command — always confirms with the user before proceeding
- All uncommitted changes in the worktree will be lost
- All unpushed commits on the branch will be lost
- The remote branch is also deleted if it exists
- Use `/git:worktree-done` instead if you want to preserve work (squash, push)
