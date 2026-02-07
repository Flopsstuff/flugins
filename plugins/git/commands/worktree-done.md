---
description: Finalize worktree — squash, push, and clean up
allowed-tools: Bash(git *), Bash(cd *), Bash(ls *), Bash(pwd), Bash(basename *), Bash(dirname *), Bash(rm *), Read, AskUserQuestion
disable-model-invocation: false
---

# Git Worktree Done

Usage: `/git:worktree-done`

Finalizes work in the current worktree: optionally squashes commits and pushes the branch, then removes the worktree and switches back to the main worktree.

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

3. **Determine the base branch**
   - Try to detect the branch this was forked from:
     ```bash
     git log --oneline --merges --first-parent -1 main 2>/dev/null || git log --oneline --merges --first-parent -1 master 2>/dev/null
     ```
   - Default to `main` or `master` (whichever exists)
   - If unclear, ask the user using AskQuestion: "What is the base branch for this worktree?"

4. **Check for uncommitted changes**
   ```bash
   git status --porcelain
   ```
   - If there are uncommitted changes, ask the user using AskQuestion:
     - Option 1: "Commit them before finishing"
     - Option 2: "Discard them"
     - Option 3: "Abort — I'm not done yet"
   - If user chooses to commit, make a WIP commit:
     ```bash
     git add -A
     git commit -m "WIP: uncommitted changes before worktree cleanup"
     ```
   - If user chooses abort, stop and exit

5. **Analyze commits on the branch**
   ```bash
   git log --oneline BASE_BRANCH..HEAD
   git rev-list --count BASE_BRANCH..HEAD
   ```
   - Show the commit list and count to the user

6. **Offer to squash commits**
   - If there are more than 1 commit on the branch, ask the user using AskQuestion:
     - Option 1: "Squash all into a single commit" (Recommended)
     - Option 2: "Keep commits as they are"
     - Option 3: "Squash into N commits (I'll specify)"
   - If squashing:
     - Analyze all commit messages and diffs
     - Generate a descriptive commit message
     - Perform soft reset and recommit:
       ```bash
       git reset --soft BASE_BRANCH
       git commit -m "GENERATED_MESSAGE"
       ```
     - If squashing into N, group logically and create N commits (same approach as `/git:squash`)

7. **Offer to push the branch**
   - Ask the user using AskQuestion:
     - Option 1: "Push to remote" (Recommended)
     - Option 2: "Skip push"
   - If pushing:
     ```bash
     git push -u origin BRANCH_NAME
     ```
   - If branch was already pushed and history was rewritten (squash), use:
     ```bash
     git push --force-with-lease origin BRANCH_NAME
     ```

8. **Switch back to main worktree**
   ```bash
   cd MAIN_WORKTREE_PATH
   ```

9. **Remove the worktree**
   ```bash
   git worktree remove WORKTREE_PATH
   ```
   - If removal fails (dirty worktree), ask user whether to force:
     ```bash
     git worktree remove --force WORKTREE_PATH
     ```

10. **Optionally clean up the branch**
    - Check if the branch has been merged into the base branch:
      ```bash
      git branch --merged BASE_BRANCH | grep BRANCH_NAME
      ```
    - If merged, ask the user using AskQuestion:
      - "Branch has been merged. Delete it? (yes/no)"
    - If yes:
      ```bash
      git branch -d BRANCH_NAME
      ```

11. **Show result**
    ```bash
    git worktree list
    ```
    - Confirm worktree was removed
    - Confirm current directory is the main worktree
    - Summarize what was done (squash, push, cleanup)

## Notes

- Always confirm destructive actions (discard changes, force push, delete branch) with the user
- If the user hasn't pushed yet and doesn't want to, the branch still exists locally
- The main worktree is always the first entry in `git worktree list`
- Use `--force-with-lease` instead of `--force` for safer force pushes after squash
