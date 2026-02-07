---
description: Create a new branch with a git worktree in a sibling directory
allowed-tools: Bash(git *), Bash(cd *), Bash(ls *), Bash(pwd), Bash(basename *), Bash(dirname *), Read, AskUserQuestion
disable-model-invocation: false
---

# Git Worktree Start

Usage: `/git:worktree-start [branch-name]`

Creates a new branch and a git worktree for it in a sibling directory named after the current repo with a branch suffix. Then switches to the new worktree directory.

## Steps

1. **Get repository info**
   ```bash
   git rev-parse --show-toplevel
   ```
   - Extract the repo directory name (e.g., `flugins`)
   - Extract the parent directory path

2. **Determine branch name**
   - If `$ARGUMENTS` is provided, use it as the branch name
   - Otherwise, ask the user using AskQuestion:
     - "What should the new branch be called?"
   - Validate the branch name doesn't already exist:
     ```bash
     git branch --list BRANCH_NAME
     git branch -r --list "*/BRANCH_NAME"
     ```
   - If branch already exists, ask the user whether to use the existing branch or pick a different name

3. **Compute worktree directory path**
   - Sanitize branch name for use as directory suffix: replace `/` with `-` (e.g., `feature/auth` → `feature-auth`)
   - Target path: `PARENT_DIR/REPO_NAME-SANITIZED_BRANCH` (e.g., `../flugins-feature-auth`)
   - Check if directory already exists:
     ```bash
     ls -d TARGET_PATH 2>/dev/null
     ```
   - If exists, ask user: "Directory already exists. Should I use it or pick a different name?"

4. **Check for uncommitted changes**
   ```bash
   git status --porcelain
   ```
   - If there are uncommitted changes, inform the user:
     - "You have uncommitted changes in the current worktree. They won't affect the new worktree but you may want to commit or stash them first."
   - Continue regardless (worktrees are independent)

5. **Create the worktree with new branch**
   - If the branch does NOT exist yet:
     ```bash
     git worktree add -b BRANCH_NAME TARGET_PATH
     ```
   - If the branch already exists:
     ```bash
     git worktree add TARGET_PATH BRANCH_NAME
     ```

6. **Verify worktree creation**
   ```bash
   git worktree list
   ```
   - Confirm the new worktree appears in the list

7. **Switch to the new worktree directory**
   ```bash
   cd TARGET_PATH
   ```

8. **Show result**
   - Print the new worktree path
   - Print the branch name
   - Show `git status` in the new worktree
   - Inform the user that they are now in the new worktree directory and can start working

## Notes

- Worktrees share the same `.git` objects — no extra clone needed
- Changes in one worktree don't affect other worktrees
- To remove a worktree later: `git worktree remove TARGET_PATH`
- To list all worktrees: `git worktree list`
- The user's shell working directory outside of Claude Code won't change — remind them to `cd` manually if needed
