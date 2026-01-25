# API Reference

This document provides a comprehensive reference for the Flugins API and plugin development interfaces.

## Marketplace API

### Marketplace Configuration

The marketplace configuration is defined in `.claude-plugin/marketplace.json`:

```json
{
  "name": "string",              // Marketplace name (required)
  "owner": {
    "name": "string"             // Owner name (required)
  },
  "metadata": {
    "description": "string",     // Description (required)
    "version": "string"          // Semantic version (required)
  },
  "plugins": []                  // Array of plugin definitions
}
```

### Plugin Definition

Each plugin in the marketplace must be defined:

```json
{
  "name": "string",              // Plugin name (required)
  "path": "string",              // Relative path to plugin (required)
  "version": "string"            // Plugin version (required)
}
```

## Plugin API

### Plugin Metadata (.claude-plugin/plugin.json)

```json
{
  "name": "string",              // Plugin identifier (required)
  "description": "string",       // Brief description (required)
  "author": {                    // Author information (required)
    "name": "string",            // Author name (required)
    "email": "string"            // Author email (required)
  },
  "keywords": ["string"]         // Search keywords (required)
}
```

### Plugin Structure

Plugins consist of:
1. `.claude-plugin/plugin.json` - Metadata file
2. `commands/*.md` - Command definition files

### Command File Format

Each command is defined in a markdown file with YAML frontmatter:

```markdown
---
allowed-tools: Tool1, Tool2, Bash(pattern)
description: Brief command description
disable-model-invocation: false
---

# Command Title

Usage: `/plugin-name:command-name [arguments]`

Step-by-step instructions for Claude Code...
```

### Frontmatter Schema

#### allowed-tools

Comma-separated list of tools Claude Code can use:

```yaml
# Specific tools only
allowed-tools: Read, Write, Glob, Grep

# Bash commands with patterns
allowed-tools: Bash(git *), Bash(npm *)

# Mixed permissions
allowed-tools: Read, Write, Edit, Bash(git log:*), Bash(git diff:*)
```

**Available Tools:**
- `Read` - Read files from filesystem
- `Write` - Create or overwrite files
- `Edit` - Edit existing files with string replacement
- `Glob` - Find files by glob patterns
- `Grep` - Search file contents with regex
- `Bash` - Execute bash commands (use patterns to restrict)
- `Task` - Launch specialized agents
- `WebFetch` - Fetch web content
- `AskUserQuestion` - Ask user for input

**Bash Patterns:**

Restrict bash commands using patterns:
- `Bash(git *)` - Allow any git command
- `Bash(git log:*)` - Allow only git log commands
- `Bash(npm install*)` - Allow npm install variations
- `Bash` - Allow all bash commands (not recommended)

#### description

Short description shown in help text:

```yaml
description: Generate initial documentation for undocumented parts of project
```

**Requirements:**
- Single line
- Clear and concise
- Describes what the command does
- Used in command listings

#### disable-model-invocation

Whether to disable AI model invocation (default: false):

```yaml
disable-model-invocation: false  # Allow AI processing (default)
disable-model-invocation: true   # Disable AI processing
```

### Command Content

The markdown body contains instructions for Claude Code:

**Format:**
```markdown
# Command Title

Usage: `/plugin:command [args]`

Brief description of what this command does.

Execution steps:

1. First major step:
   - Detailed sub-step
   - Another sub-step

2. Second major step:
   - What to do
   - How to handle errors

3. Final step:
   - Report results
   - Show summary
```

**Best Practices:**
- Use numbered lists for sequential steps
- Use bullet points for details within steps
- Be explicit about when to ask user for input
- Specify error handling behavior
- Define output format
- Include examples where helpful

## Command Interface

### Plugin Commands

Users interact with plugins through these commands:

#### Marketplace Management

```bash
# Add marketplace
/plugin marketplace add <owner>/<repo>

# Remove marketplace
/plugin marketplace remove <name>

# List marketplaces
/plugin marketplace list
```

#### Plugin Management

```bash
# Install plugin
/plugin install <plugin-name>[@marketplace]

# Uninstall plugin
/plugin uninstall <plugin-name>

# Update plugins
/plugin update [plugin-name]

# List plugins
/plugin list [--installed]
```

## Command Examples

### Simple Command

```markdown
---
allowed-tools: Read
description: Display project information
disable-model-invocation: false
---

# Project Info

Usage: `/myplugin:info`

Display information about the current project:

1. Read package.json or equivalent project file
2. Extract project name, version, and description
3. Display the information to the user in a formatted way
```

### Command with Arguments

```markdown
---
allowed-tools: Read, Write, Edit
description: Add a new feature file with boilerplate code
disable-model-invocation: false
---

# Add Feature

Usage: `/myplugin:add-feature <feature-name>`

Create a new feature with boilerplate:

1. Parse the feature name from arguments:
   - If not provided, ask user for feature name
   - Validate name format (lowercase, hyphen-separated)

2. Create feature directory:
   - Create features/<feature-name>/
   - Add index file
   - Add test file

3. Generate boilerplate code:
   - Use project conventions
   - Add necessary imports
   - Include basic structure

4. Report success:
   - Show created files
   - Provide next steps
```

### Command with Git Operations

```markdown
---
allowed-tools: Bash(git log:*), Bash(git diff:*), Read
description: Analyze recent code changes
disable-model-invocation: false
---

# Analyze Changes

Usage: `/myplugin:analyze [commits]`

Analyze recent code changes:

1. Get number of commits (default: 5)

2. Fetch commit history:
   - Use git log to get commits
   - Use git diff to see changes

3. Analyze the changes:
   - Categorize by type (features, fixes, refactors)
   - Identify affected files
   - Extract key changes

4. Generate summary report
```

## Testing Plugins

### Local Testing

Test your plugin locally before submitting:

```bash
# From your plugin development directory
cd /path/to/flugins

# Add local marketplace
/plugin marketplace add .

# Install your plugin
/plugin install your-plugin-name@flugins

# Test commands
/your-plugin-name:command-name

# Remove when done testing
/plugin uninstall your-plugin-name
/plugin marketplace remove flugins
```

### Testing Checklist

- [ ] Plugin metadata is valid JSON
- [ ] All required fields are present
- [ ] Command files have valid YAML frontmatter
- [ ] Commands execute successfully
- [ ] Error handling works as expected
- [ ] User prompts are clear
- [ ] Tool permissions are minimal and appropriate
- [ ] Output is formatted properly

## Version Management

Flugins uses git tags for versioning:

```bash
# Tag a new version
git tag v1.0.0
git push origin v1.0.0

# Users can install specific versions
/plugin install myplugin@flugins/v1.0.0
```

### Versioning Best Practices

- Use semantic versioning (MAJOR.MINOR.PATCH)
- Tag releases in git
- Document changes in marketplace updates
- Maintain backwards compatibility when possible

## Best Practices

### Command Instructions

- **Be Specific**: Write clear, unambiguous instructions
- **Sequential Steps**: Use numbered lists for ordered operations
- **Error Handling**: Include validation and error handling in steps
- **User Interaction**: Explicitly state when to ask for user input
- **Output Format**: Specify how results should be presented

### Tool Permissions

- **Minimal Permissions**: Only request tools you actually need
- **Restricted Bash**: Use patterns to limit bash command scope
  - ✅ `Bash(git log:*)` - Specific git commands only
  - ❌ `Bash` - Unrestricted access
- **Safety First**: Avoid tools that could cause data loss
- **Document Why**: Comment why specific permissions are needed

### Command Design

- **Single Responsibility**: One command should do one thing well
- **Clear Naming**: Use descriptive command names
- **Arguments**: Accept arguments for flexibility
- **Defaults**: Provide sensible defaults when arguments are optional
- **Feedback**: Give users progress updates for long operations

### Security

- **Validate Input**: Check user input before processing
- **No Secrets**: Never include credentials in commands
- **Safe Defaults**: Choose safe options by default
- **Confirm Destructive Actions**: Ask before deleting or overwriting

### Documentation

- **Usage Examples**: Show how to use the command
- **Argument Descriptions**: Explain what each argument does
- **Expected Behavior**: Document what the command will do
- **Error Messages**: Help users understand what went wrong

## Complete Plugin Example

Here's a full example of the "docs" plugin structure:

```
plugins/docs/
├── .claude-plugin/
│   └── plugin.json
└── commands/
    ├── generate-docs.md
    └── sync-docs.md
```

**.claude-plugin/plugin.json:**
```json
{
  "name": "docs",
  "description": "Generate and keep documentation in sync with your codebase",
  "author": {
    "name": "Flop",
    "email": "flop@hackerspace.by"
  },
  "keywords": ["documentation", "sync", "git", "automation"]
}
```

**commands/generate-docs.md:**
```markdown
---
allowed-tools: Read, Write, Glob
description: Generate initial documentation for undocumented parts of project
disable-model-invocation: false
---

# Generate Documentation

Usage: `/docs:generate-docs`

Generate initial documentation for undocumented parts of the codebase:

1. Ask for documentation folder
2. Scan existing documentation
3. Analyze the project structure
4. Identify undocumented areas
5. Propose 3-5 documents
6. Generate approved documents
7. Report results
```

## Resources

- [Docs Plugin Source](https://github.com/Flopsstuff/flugins/tree/main/plugins/docs)
- [Creating Plugins Guide](creating-plugins.md)
- [Plugin Catalog](../plugin-catalog/index.md)
- [Contributing Guidelines](contributing.md)

## Support

For API questions or issues:

1. Review this reference
2. Check the [docs plugin](https://github.com/Flopsstuff/flugins/tree/main/plugins/docs) as an example
3. Search existing [issues](https://github.com/Flopsstuff/flugins/issues)
4. Ask in [Discussions](https://github.com/Flopsstuff/flugins/discussions)
5. Open a new issue with details
