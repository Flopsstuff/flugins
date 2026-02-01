---
description: Squash commits to base branch into one or N commits with intelligent naming
allowed-tools: Read, Write, Bash(git *), AskUserQuestion
disable-model-invocation: false
---

# Squash Commits

**Usage:** `/git:squash [N]`

Squash all commits from current branch down to the base branch. By default squashes into a single commit. Optionally specify N to squash into N logically grouped commits.

**Arguments:**
- `$ARGUMENTS` — Optional number of target commits (default: 1)

## Steps

1. **Check for uncommitted changes:**
   - Run `git status --porcelain`
   - If there are uncommitted changes, ask the user:
     - "You have uncommitted changes. Should I stash them before squash? (yes/no)"
   - If yes, run `git stash push -m "Auto-stash before squash"`
   - Remember to pop stash after successful squash

2. **Get current branch name:**
   ```bash
   git branch --show-current
   ```
   - Store as CURRENT_BRANCH
   - If on main/master, abort: "Cannot squash on the main branch"

3. **Determine the base branch:**
   - Check which common base branches exist:
     ```bash
     git branch -a | grep -E '(main|master|develop)'
     ```
   - Try to find merge-base with each candidate:
     ```bash
     git merge-base HEAD origin/main
     git merge-base HEAD origin/master
     git merge-base HEAD origin/develop
     ```
   - Select the branch with the most recent merge-base
   - If multiple or unclear, ask user: "Which base branch? (main/master/develop)"
   - Store as BASE_BRANCH

4. **Count commits to squash:**
   ```bash
   git rev-list --count BASE_BRANCH..HEAD
   ```
   - Store as TOTAL_COMMITS
   - If TOTAL_COMMITS = 0, inform user "No commits to squash" and exit
   - If TOTAL_COMMITS = 1, inform user "Only one commit exists, nothing to squash" and exit

5. **Parse target commit count:**
   - If `$ARGUMENTS` is provided and is a number, store as TARGET_N
   - Otherwise, TARGET_N = 1 (default)
   - If TARGET_N > TOTAL_COMMITS:
     - Ask user: "You have only TOTAL_COMMITS commits, but requested TARGET_N. Use TOTAL_COMMITS instead? (yes/no/specify other)"
     - Adjust TARGET_N based on response
   - If TARGET_N < 1, set TARGET_N = 1

6. **Analyze commits to understand changes:**
   ```bash
   git log BASE_BRANCH..HEAD --oneline
   git log BASE_BRANCH..HEAD --format="%s%n%b" 
   ```
   - Read commit messages and understand what each commit does
   - Identify logical groups of changes (features, fixes, refactoring, etc.)

7. **Prepare squash strategy:**

   **If TARGET_N = 1 (single commit):**
   - Analyze all changes to create one comprehensive commit message
   - Message format: `<type>: <summary of all changes>`
   - Include bullet points for major changes in commit body

   **If TARGET_N > 1 (multiple commits):**
   - Group TOTAL_COMMITS into TARGET_N logical groups based on:
     - Related functionality (same feature/module)
     - Type of change (feature, fix, refactor, docs)
     - Chronological phases of work
   - If commits cannot be logically grouped into exactly TARGET_N:
     - Suggest better number M based on natural groupings
     - Ask user: "Commits naturally group into M groups. Use M instead of TARGET_N? (yes/no/force TARGET_N)"
   - Prepare commit message for each group

8. **Show squash plan to user:**
   - Display which commits will be combined
   - Show proposed commit message(s)
   - Ask for confirmation: "Proceed with this squash plan? (yes/no/edit messages)"
   - If user wants to edit, allow them to provide new messages

9. **Execute squash:**

   **Method: Soft reset + recommit**
   ```bash
   # Save current HEAD for safety
   git rev-parse HEAD > /tmp/pre-squash-head
   
   # Soft reset to base
   git reset --soft BASE_BRANCH
   ```

   **If TARGET_N = 1:**
   ```bash
   git commit -m "PREPARED_MESSAGE"
   ```

   **If TARGET_N > 1:**
   - For each group (in reverse order, oldest first):
     - Stage only files related to that group
     - Create commit with group's message
   - This requires careful staging:
     ```bash
     # For complex multi-commit squash, use interactive approach
     git reset BASE_BRANCH  # mixed reset
     # Then selectively stage and commit each group
     ```

10. **Handle failures:**
    - If something goes wrong, offer recovery:
      ```bash
      git reset --hard $(cat /tmp/pre-squash-head)
      ```
    - Inform user: "Squash failed. Restored to original state."

11. **Verify and complete:**
    ```bash
    git log --oneline -10
    git diff BASE_BRANCH --stat
    ```
    - Show the new commit(s)
    - Confirm total changes match original
    - If stash was created in step 1, run `git stash pop`

## Commit Message Guidelines

When generating squash commit messages:

- **Single commit:** Summarize the overall purpose, list key changes
  ```
  feat: implement user authentication system
  
  - Add login/logout endpoints
  - Implement JWT token handling  
  - Add password hashing utilities
  - Create auth middleware
  ```

- **Multiple commits:** Each should have clear scope
  ```
  feat: add authentication endpoints
  refactor: extract token utilities
  fix: handle edge cases in auth flow
  ```

## Notes

- Always create backup reference before destructive operations
- If uncertain about grouping, prefer fewer commits with clear messages
- Preserve important context from original commit messages
- Never squash commits that have been pushed to shared branches without user confirmation
- Check if branch has been pushed: `git rev-list --count origin/CURRENT_BRANCH..HEAD` (if remote exists)
