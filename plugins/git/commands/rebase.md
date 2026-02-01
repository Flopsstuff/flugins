---
description: Rebase current branch onto base branch and resolve conflicts automatically
allowed-tools: Read, Bash(git *), AskQuestion
disable-model-invocation: false
---

# Rebase Branch

**Usage:** `/git:rebase`

Rebase the current branch onto a base branch and resolve any conflicts that arise.

## Steps

1. **Check for uncommitted changes:**
   - Run `git status --porcelain`
   - If there are uncommitted changes, ask the user:
     - "You have uncommitted changes. Should I stash them before rebase? (yes/no)"
   - If yes, run `git stash push -m "Auto-stash before rebase"`
   - Remember to pop stash after successful rebase

2. **Determine the base branch:**
   - Get the current branch name with `git branch --show-current`
   - Check which common base branches exist with `git branch -a | grep -E '(main|master|develop)'`
   - If multiple base branches exist or it's unclear, ask the user: "Which base branch should I rebase onto? (main/master/develop)"
   - Store the selected base branch name for use in subsequent steps

2. **Understand the current changes:**
   - Run `git diff <base-branch>...HEAD` to see all changes in the current branch
   - Analyze and understand the purpose and context of these changes
   - Take note of which files have been modified and what the changes accomplish

3. **Attempt the rebase:**
   - Run `git rebase <base-branch>` to start rebasing onto the base branch
   - Check the output for conflicts

4. **If conflicts occur:**
   - Run `git status` to identify conflicted files
   - For each conflicted file:
     - Read the file to see the conflict markers (<<<<<<, =======, >>>>>>)
     - Understand the incoming changes from base branch (between <<<<<<< and =======)
     - Understand the current branch changes (between ======= and >>>>>>>)
     - Based on the context you learned in step 2, resolve the conflict by:
       - Keeping both changes if they don't overlap logically
       - Prioritizing current branch changes for feature-specific logic
       - Prioritizing base branch changes for refactoring or infrastructure updates
       - Merging both intelligently when both make sense
     - Remove all conflict markers
     - Stage the resolved file with `git add <file>`
   - After resolving all conflicts, run `git rebase --continue`
   - Repeat step 4 if more conflicts appear

5. **Handle critical failures:**
   - If rebase becomes too complex or user wants to abort:
     - Run `git rebase --abort` to restore original state
     - Inform user that the branch is back to its original state
   - If rebase fails with unrecoverable error, always offer `git rebase --abort`

6. **Verify completion:**
   - Once rebase is complete, run `git status` to confirm
   - Run `git log --oneline -5` to show the rebased commits
   - If stash was created in step 1, run `git stash pop` to restore changes
   - Summarize what conflicts were resolved and how

**Important guidelines:**
- Always preserve the intent of the current branch changes
- Be conservative: when in doubt, ask the user before making decisions
- Never skip commits or use `git rebase --skip` without explicit user approval
- If a conflict is too complex or ambiguous, stop and ask the user for guidance
- After resolving each file, verify it makes sense before staging

Begin the rebase process now.
