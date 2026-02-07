---
description: Rebase current branch onto upstream branch with conflict resolution
allowed-tools: Bash(git *), Read, AskUserQuestion
disable-model-invocation: false
---

# Git Upstream Rebase

Usage: `/git:upstream-rebase`

Intelligently rebases current branch onto upstream branch with automatic conflict resolution based on understanding the implementation intent. Produces a clean, linear history.

## Steps

1. **Check for uncommitted changes**
   ```bash
   git status --porcelain
   ```
   - If there are uncommitted changes, ask the user using AskQuestion:
     - "You have uncommitted changes. Should I stash them before rebase? (yes/no)"
   - If yes, run `git stash push -m "Auto-stash before upstream rebase"`
   - Remember to pop stash after successful rebase

2. **Get current branch name**
   ```bash
   git rev-parse --abbrev-ref HEAD
   ```

3. **Find upstream branch**
   - Run: `git rev-parse --abbrev-ref @{upstream}` to get configured upstream
   - If fails or user wants to specify different upstream:
     - List available remote branches: `git branch -r`
     - Ask user to select upstream branch using AskQuestion tool
     - Common patterns: `origin/main`, `origin/master`, `upstream/main`

4. **Fetch latest changes**
   ```bash
   git fetch --all
   ```

5. **Check how far upstream is ahead**
   ```bash
   git rev-list --left-right --count HEAD...UPSTREAM_BRANCH
   ```
   - Parse output: `X	Y` where X=commits ahead, Y=commits behind
   - If Y=0, inform user that upstream has no new changes and exit

6. **Analyze current branch changes**
   - Get diff of current branch vs upstream:
     ```bash
     git diff UPSTREAM_BRANCH...HEAD
     ```
   - Get the list of commits that will be rebased:
     ```bash
     git log --oneline UPSTREAM_BRANCH..HEAD
     ```
   - Analyze the diff to understand:
     - What features/changes were implemented in current branch
     - What files were modified and why
     - The intent and purpose of the changes
   - Summarize findings to user

7. **Analyze upstream changes**
   - Get diff of upstream vs current branch:
     ```bash
     git diff HEAD...UPSTREAM_BRANCH
     ```
   - Analyze what changed in upstream:
     - New features added
     - Bug fixes
     - Refactoring
     - Potential conflict areas
   - Summarize findings to user

8. **Attempt rebase**
   ```bash
   git rebase UPSTREAM_BRANCH
   ```

9. **Check for conflicts**
   - If the rebase stops with conflicts:
     ```bash
     git status --porcelain
     ```
   - Look for lines starting with `UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD` (conflict markers)

10. **If conflicts exist:**
    - List all conflicted files: `git diff --name-only --diff-filter=U`
    - Check which commit is being applied:
      ```bash
      git log --oneline -1 REBASE_HEAD
      ```
    - For each conflicted file:
      a. Read the file content with conflict markers
      b. Analyze both versions using context from step 6 & 7
      c. Determine resolution strategy based on:
         - Intent of current branch changes (the commit being replayed)
         - Intent of upstream changes
         - Which changes should take precedence
         - How to combine both changes if possible
      d. Resolve conflict by editing the file with appropriate resolution
      e. Stage resolved file: `git add FILENAME`
    - After all conflicts in current commit resolved:
      ```bash
      git rebase --continue
      ```
    - Repeat steps 9-10 if the next commit also has conflicts
    - After all conflicts resolved, show summary of resolution decisions

11. **Show rebase result**
    ```bash
    git log --oneline UPSTREAM_BRANCH..HEAD
    git diff UPSTREAM_BRANCH --stat
    ```
    - Summarize what was rebased and how conflicts were resolved
    - If stash was created in step 1, run `git stash pop` to restore changes

## Notes

- Always explain reasoning for conflict resolution decisions
- Preserve the intent of current branch implementation
- If uncertain about conflict resolution, ask user for guidance
- Use `git rebase --abort` if user wants to cancel during conflict resolution
- Rebase replays commits one by one, so conflicts may arise at multiple steps — handle each step separately
- After rebase, current branch commits will have new hashes — this is expected behavior
