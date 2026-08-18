---
description: Sync documentation with recent codebase changes
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(git show:*), Bash(git rev-parse:*)
disable-model-invocation: false
---

# Sync Documentation with Recent Changes

Usage: `/docs:sync-docs [days | N commits]`

Analyze recent changes and update documentation to match current codebase:

1. Parse `$ARGUMENTS` to determine the lookback window. The window is measured in **days by default**:
   - **No argument** (e.g., `/docs:sync-docs`) → **days mode**, default **1 day** (look back 1 day).
   - **A bare number** (e.g., `/docs:sync-docs 3`) → **days mode**, look back that many days (3 days).
   - **A number followed by the `commits` keyword** (e.g., `/docs:sync-docs 10 commits`) → **commits mode**, analyze exactly that many commits (10 commits). Commits mode is selected ONLY when the explicit `commits` (or `commit`) keyword follows the number.
   - Examples:
     - `/docs:sync-docs` → last 1 day (days mode)
     - `/docs:sync-docs 7` → last 7 days (days mode)
     - `/docs:sync-docs 10 commits` → last 10 commits (commits mode)
     - `/docs:sync-docs 1 commit` → last 1 commit (commits mode)

2. Build the git commands based on the parsed window:
   - **Days mode** (N days): use `git log --since="N days ago" -p` to get full diffs and `git log --since="N days ago" --name-only` to list changed files.
   - **Commits mode** (N commits): use `git log -N -p` to get full diffs and `git log -N --name-only` to list changed files.

3. Analyze the commits in the window to understand changes:
   - Run the `-p` command from step 2 to get full commit history with diffs.
   - Review commit messages and full diffs to understand the context of changes.
   - Run the `--name-only` command from step 2 to list all files changed in the window.
   - **Empty-window guard**: If the git log returns no commits (e.g., an empty time window in days mode, or an invalid/zero window), stop here. Report `"no commits in the last N days, nothing to sync"` (substituting the resolved window) and do nothing destructive — make no documentation edits.
   - **IMPORTANT**: Read the CURRENT state of all changed files from the repository to understand the actual implementation.

4. Read all modified files from the analyzed commits:
   - For each file changed in the window, read its CURRENT content
   - Pay special attention to:
     - New files added (understand their purpose and functionality)
     - Modified files (understand what changed and why)
     - Deleted files (ensure they're not referenced in docs)
   - Analyze code to understand features, APIs, configuration, and architecture

5. Find and scan the documentation folder:
   - Search for common documentation folder names in the project root: `docs/`, `doc/`, `documentation/`
   - Check for documentation indicators in README.md or project config files
   - Once the documentation folder is identified, scan it to identify all documentation files

6. Compare the documentation content with actual codebase state:
   - Match documentation against CURRENT file contents (not just diffs)
   - Understand the full context of changes by reading actual code
   - Identify inconsistencies between docs and code:
     - New features not documented
     - Removed features still in docs
     - Changed APIs not reflected in docs
     - Outdated examples or code snippets
     - Broken links to non-existent files
     - Configuration changes not reflected

7. Update all affected documentation files to match current state:
   - Base updates on ACTUAL current file contents
   - Ensure code examples reflect real implementation
   - Update API signatures, parameters, and return values
   - Fix broken references and links

8. Maintain documentation structure:
   - **Root index.md**: Ensure there's an `index.md` in the docs root folder
     - Contains links to ALL files and folders at that level
     - Each link has a short description of content
     - Acts as a table of contents for the entire documentation
   - **Topic folders**: Group related documents into topic folders
     - Each folder MUST have its own `index.md` with links and descriptions
     - If new docs create a topic cluster, organize them into a folder
   - **Hierarchy rules**:
     - Maximum 3 levels of nesting (prefer 2 levels)
     - Structure: `docs/` → `topic-folder/` → `subtopic-folder/` (max)
     - Keep structure flat when possible for better navigation
   - **Update index files**: When adding/modifying docs, always update relevant `index.md` files

9. Provide short summary of all changes made

Be thorough and check:

- Architecture documentation
- Project structure and file listings
- Environment variables and configuration
- API endpoint documentation
- README files and navigation links
- Code examples and API usage
- Installation and setup instructions
- Dependencies and requirements
