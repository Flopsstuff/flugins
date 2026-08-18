---
description: Create a new branch with a git worktree in ./.worktrees inside the repository
allowed-tools: Bash(git *), Bash(cd *), Bash(ls *), Bash(pwd), Bash(basename *), Bash(dirname *), Bash(echo *), Read, AskUserQuestion
disable-model-invocation: false
---

# Git Worktree Start

Usage: `/git:worktree-start [branch-name]`

Creates a new branch and a git worktree for it in `.worktrees/{branch}` inside the main repository directory. Then switches to the new worktree directory.

## Steps

1. **Get repository info**
   ```bash
   git rev-parse --path-format=absolute --git-common-dir
   ```
   - The main repository root is the parent directory of the common git dir (e.g., `/path/to/repo/.git` → `/path/to/repo`). Call it `MAIN_ROOT`, and the common git dir `COMMON_GIT_DIR`.
   - Always derive paths from `MAIN_ROOT` (via `--git-common-dir`), NOT from `git rev-parse --show-toplevel` — otherwise running this command from inside another worktree would create nested `.worktrees/{a}/.worktrees/{b}` directories.

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
   - Sanitize branch name for use as a directory name: replace `/` with `-` (e.g., `feature/auth` → `feature-auth`)
   - Target path: `MAIN_ROOT/.worktrees/SANITIZED_BRANCH` (e.g., `/path/to/repo/.worktrees/feature-auth`)
   - Check if directory already exists:
     ```bash
     ls -d TARGET_PATH 2>/dev/null
     ```
   - If exists, ask user: "Directory already exists. Should I use it or pick a different name?"

4. **Ensure `.worktrees/` is ignored by git**
   - Check whether it is already ignored (covers both `.gitignore` and `info/exclude`). Use `git -C MAIN_ROOT` with a relative path — an absolute path makes `check-ignore` fail with "outside repository" when run from inside a worktree:
     ```bash
     git -C MAIN_ROOT check-ignore -q .worktrees && echo ignored
     ```
   - If NOT ignored (exit code 1), append it to the local exclude file (local-only — never creates a diff in the repository, safe for repos you don't own):
     ```bash
     echo '.worktrees/' >> COMMON_GIT_DIR/info/exclude
     ```

5. **Check for uncommitted changes**
   ```bash
   git status --porcelain
   ```
   - If there are uncommitted changes, inform the user:
     - "You have uncommitted changes in the current worktree. They won't affect the new worktree but you may want to commit or stash them first."
   - Continue regardless (worktrees are independent)

6. **Create the worktree with new branch**
   - `git worktree add` creates the `.worktrees/` parent directory automatically — no `mkdir` needed
   - If the branch does NOT exist yet:
     ```bash
     git worktree add -b BRANCH_NAME TARGET_PATH
     ```
   - If the branch already exists:
     ```bash
     git worktree add TARGET_PATH BRANCH_NAME
     ```

7. **Verify worktree creation**
   ```bash
   git worktree list
   ```
   - Confirm the new worktree appears in the list

8. **Switch to the new worktree directory**
   ```bash
   cd TARGET_PATH
   ```

9. **Show result**
   - Print the new worktree path
   - Print the branch name
   - Show `git status` in the new worktree
   - Inform the user that they are now in the new worktree directory and can start working

## Notes

- Worktrees share the same `.git` objects — no extra clone needed
- Changes in one worktree don't affect other worktrees
- `.worktrees/` lives inside the repo but is kept out of `git status` via `.git/info/exclude` (local-only, never committed)
- `git clean -fdx` with a single `-f` skips worktree checkouts (git treats them as nested repositories); only a double-force `git clean -ffdx` would remove them
- If IDE search shows duplicate results from `.worktrees/`, exclude it once at user level: VS Code — add `**/.worktrees` to `search.exclude` and `**/.worktrees/**` to `files.watcherExclude` in user settings; JetBrains — right-click the folder → Mark Directory as → Excluded
- To remove a worktree later: `git worktree remove TARGET_PATH`
- To list all worktrees: `git worktree list`
- The user's shell working directory outside of Claude Code won't change — remind them to `cd` manually if needed
