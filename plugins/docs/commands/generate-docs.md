---
allowed-tools: Read, Write, Glob, LS
description: Generate initial documentation for undocumented parts of project
disable-model-invocation: false
---

# Generate Documentation

Usage: `/docs:generate-docs`

Generate initial documentation for undocumented parts of the codebase:

1. Ask for documentation folder:
   - Ask user: "Which folder should I use for documentation? (e.g., docs/, documentation/)"
   - Wait for user response before proceeding

2. Scan existing documentation:
   - List all markdown files (*.md) in the specified folder
   - For each found document, read first 10 lines to understand its topic
   - Build a summary of what's already documented

3. Analyze the project structure:
   - Scan project root for key files: package.json, pyproject.toml, Cargo.toml, go.mod, etc.
   - Identify main source directories (src/, lib/, app/, etc.)
   - Find entry points, configuration files, and main modules
   - Look for README.md in root and subdirectories

4. Identify undocumented areas:
   - Compare existing docs against codebase structure
   - Look for gaps in documentation:
     - Missing API documentation
     - Undocumented configuration options
     - Missing architecture overview
     - No getting started guide
     - Missing contribution guidelines
     - Undocumented CLI commands or scripts
     - Missing examples or tutorials

5. Propose 3-5 documents:
   - Based on analysis, suggest 3-5 most needed documents
   - For each proposed document provide:
     - File name (e.g., `getting-started.md`)
     - Brief description of contents
     - Why this document is needed
   - Present proposals to user and ask for confirmation:
     "I suggest creating the following documents:
      1. [name] - [description]
      2. ...
      Confirm creation (yes/no) or specify which document numbers to create"

6. Generate approved documents:
   - Wait for user confirmation
   - Create each approved document following the structure rules below
   - Each document should include:
     - Clear title and purpose
     - Table of contents (for longer docs)
     - Well-structured sections
     - Code examples where relevant
     - Links to related documentation

7. Maintain documentation structure:
   - **Root index.md**: Always ensure there's an `index.md` in the docs root folder
     - Contains links to ALL files and folders at that level
     - Each link has a short description of content
     - Acts as a table of contents for the entire documentation
   - **Topic folders**: Group related documents into topic folders
     - Each folder MUST have its own `index.md` with links and descriptions
     - Move existing scattered docs on same topic into appropriate folders
   - **Hierarchy rules**:
     - Maximum 3 levels of nesting (prefer 2 levels)
     - Structure: `docs/` → `topic-folder/` → `subtopic-folder/` (max)
     - Keep structure flat when possible for better navigation
   - **Update index files**: When creating new docs, always update relevant `index.md` files

8. Report results:
   - List all created documents
   - Suggest next steps for documentation improvement
