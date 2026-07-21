---
description: Sync documentation with recent codebase changes
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(git show:*), Bash(git rev-parse:*)
disable-model-invocation: false
---

# Sync Documentation with Recent Changes

Usage: `/docs:sync-docs [number]` or `/docs:sync-docs [number]commits`

Analyze recent changes and update documentation to match current codebase:

1. Parse the argument from `$ARGUMENTS`:
   - If no argument is provided → default to **1 day** (look back 1 day)
   - If the argument is a plain number (e.g., `/docs:sync-docs 3`) → treat it as **days** (look back 3 days)
   - If the argument ends with `commits` or `commit` (e.g., `/docs:sync-docs 10commits`) → treat it as a **commit count** (analyze 10 commits)
   - Examples:
     - `/docs:sync-docs` → 1 day
     - `/docs:sync-docs 7` → 7 days
     - `/docs:sync-docs 10commits` → 10 commits
     - `/docs:sync-docs 1commit` → 1 commit

2. Build the git log command based on the parsed argument:
   - **Days mode**: `git log --since="N days ago" -p` to get all commits in the time window
   - **Commits mode**: `git log -N -p` to get exactly N commits

3. Analyze recent commits to understand changes:
   - Run the appropriate `git log` command from step 2
   - Review commit messages and full diffs to understand the context of changes
   - Use the `--name-only` variant of the same range to list all files changed
   - **IMPORTANT**: Read the CURRENT state of all changed files from the repository to understand the actual implementation

4. Read all modified files from recent commits:
   - For each file changed in the analyzed commits, read its CURRENT content
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
