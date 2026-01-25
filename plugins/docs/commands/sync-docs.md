---
allowed-tools: Bash(git log:*), Bash(git diff:*), Bash(git show:*), Bash(git rev-parse:*)
description: Sync documentation with recent codebase changes
disable-model-invocation: false
---

# Sync Documentation with Recent Changes

Usage: `/docs:sync-docs [number_of_commits]`

Analyze recent {number_of_commits} and update documentation to match current codebase:

1. Extract the {number_of_commits} from the command arguments:
   - If a {number_of_commits} is provided, use that value (e.g., `/docs:sync-docs 10` → analyze 10 commits)
   - If no {number_of_commits} is provided, use 5 as default (e.g., `/docs:sync-docs` → analyze 5 commits)

2. Analyze recent commits to understand changes:
   - Use `git log -N -p` to get full commit history with diffs (where N is the number of commits)
   - Review commit messages and full diff to understand the context of changes
   - Use `git log -N --name-only` to list all files changed in these commits
   - **IMPORTANT**: Read the CURRENT state of all changed files from the repository to understand the actual implementation

3. Read all modified files from recent commits:
   - For each file changed in the analyzed commits, read its CURRENT content
   - Pay special attention to:
     - New files added (understand their purpose and functionality)
     - Modified files (understand what changed and why)
     - Deleted files (ensure they're not referenced in docs)
   - Analyze code to understand features, APIs, configuration, and architecture

4. Find and scan the documentation folder:
   - Search for common documentation folder names in the project root: `docs/`, `doc/`, `documentation/`
   - Check for documentation indicators in README.md or project config files
   - Once the documentation folder is identified, scan it to identify all documentation files

5. Compare the documentation content with actual codebase state:
   - Match documentation against CURRENT file contents (not just diffs)
   - Understand the full context of changes by reading actual code
   - Identify inconsistencies between docs and code:
     - New features not documented
     - Removed features still in docs
     - Changed APIs not reflected in docs
     - Outdated examples or code snippets
     - Broken links to non-existent files
     - Configuration changes not reflected

6. Update all affected documentation files to match current state:
   - Base updates on ACTUAL current file contents
   - Ensure code examples reflect real implementation
   - Update API signatures, parameters, and return values
   - Fix broken references and links

7. Maintain documentation structure:
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

8. Provide short summary of all changes made

Be thorough and check:

- Architecture documentation
- Project structure and file listings
- Environment variables and configuration
- API endpoint documentation
- README files and navigation links
- Code examples and API usage
- Installation and setup instructions
- Dependencies and requirements
