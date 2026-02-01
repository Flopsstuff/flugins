---
allowed-tools: Bash(git *), Read, AskQuestion
description: Smart merge with upstream branch with conflict resolution
disable-model-invocation: false
---

# Git Upstream Merge

Usage: `/git:upstream-merge`

Intelligently merges changes from upstream branch into current branch with automatic conflict resolution based on understanding the implementation intent.

## Steps

1. **Check for uncommitted changes**
   ```bash
   git status --porcelain
   ```
   - If there are uncommitted changes, ask the user using AskQuestion:
     - "You have uncommitted changes. Should I stash them before merge? (yes/no)"
   - If yes, run `git stash push -m "Auto-stash before upstream merge"`
   - Remember to pop stash after successful merge

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

8. **Attempt merge**
   ```bash
   git merge UPSTREAM_BRANCH --no-commit --no-ff
   ```

9. **Check for conflicts**
   ```bash
   git status --porcelain
   ```
   - Look for lines starting with `UU`, `AA`, `DD`, `AU`, `UA`, `DU`, `UD` (conflict markers)

10. **If conflicts exist:**
    - List all conflicted files: `git diff --name-only --diff-filter=U`
    - For each conflicted file:
      a. Read the file content with conflict markers
      b. Analyze both versions (HEAD and UPSTREAM_BRANCH) using context from step 6 & 7
      c. Determine resolution strategy based on:
         - Intent of current branch changes
         - Intent of upstream changes
         - Which changes should take precedence
         - How to combine both changes if possible
      d. Resolve conflict by editing the file with appropriate resolution
      e. Stage resolved file: `git add FILENAME`
    - After all conflicts resolved, show summary of resolution decisions

11. **Complete merge**
    ```bash
    git commit -m "Merge UPSTREAM_BRANCH into CURRENT_BRANCH with intelligent conflict resolution"
    ```

12. **Show merge result**
    ```bash
    git log -1
    git diff HEAD~1 --stat
    ```
    - Summarize what was merged and how conflicts were resolved
    - If stash was created in step 1, run `git stash pop` to restore changes

## Notes

- Always explain reasoning for conflict resolution decisions
- Preserve the intent of current branch implementation
- If uncertain about conflict resolution, ask user for guidance
- Use `git merge --abort` if user wants to cancel during conflict resolution
