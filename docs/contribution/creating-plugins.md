# Creating Plugins

This guide explains how to create your own plugins for the Flugins collection.

> **Official Documentation**: For complete technical specifications, see [Claude Code Plugins Documentation](https://code.claude.com/docs/en/plugins).

## Plugin Structure

A Claude Code plugin uses a markdown-based command system. The typical structure is:

```
plugin-name/
├── .claude-plugin/
│   └── plugin.json      # Plugin metadata (required)
├── commands/
│   ├── command-one.md   # First command
│   └── command-two.md   # Second command
├── skills/              # Agent Skills (optional)
│   └── skill-name/
│       └── SKILL.md
├── agents/              # Custom agents (optional)
├── hooks/               # Event handlers (optional)
│   └── hooks.json
├── .mcp.json            # MCP server configs (optional)
└── .lsp.json            # LSP server configs (optional)
```

> **Important**: Don't put `commands/`, `agents/`, `skills/`, or `hooks/` inside the `.claude-plugin/` directory. Only `plugin.json` goes inside `.claude-plugin/`.

## Plugin Metadata

Every plugin must have a `.claude-plugin/plugin.json` file that describes the plugin:

```json
{
  "name": "plugin-name",
  "description": "Brief description of what the plugin does",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "your.email@example.com"
  },
  "keywords": ["keyword1", "keyword2"]
}
```

### Required Fields

- `name`: Unique identifier for your plugin (lowercase, hyphen-separated). Also used as skill namespace (e.g., `/plugin-name:command`)
- `description`: Brief description of functionality
- `version`: Version using [semantic versioning](https://semver.org/) (e.g., "1.0.0")
- `author`: Author information object
  - `name`: Your name
  - `email`: Your email address (optional)
- `keywords`: Array of keywords for discoverability (optional)

## Command Files

Commands are defined as markdown files in the `commands/` directory. Each command file has:

1. **YAML frontmatter** with configuration
2. **Markdown content** with instructions for Claude Code

### Command File Format

```markdown
---
allowed-tools: Read, Write, Glob
description: Brief description of what this command does
disable-model-invocation: false
---

# Command Title

Usage: `/plugin-name:command-name [arguments]`

Detailed instructions for Claude Code on how to execute this command:

1. First step description
2. Second step description
3. etc.
```

### Frontmatter Options

#### allowed-tools (optional)

Specifies which tools Claude Code can use when executing this command:

```yaml
# Allow specific tools
allowed-tools: Read, Write, Glob, Grep

# Allow Bash commands with patterns
allowed-tools: Bash(git log:*), Bash(git diff:*), Read, Write

# Mix of tools and patterns
allowed-tools: Read, Write, Bash(npm *), Bash(git *)
```

Common tools:
- `Read` - Read files
- `Write` - Create/overwrite files
- `Edit` - Edit existing files
- `Glob` - Find files by pattern
- `Grep` - Search file contents
- `Bash` - Execute bash commands
- `Task` - Launch specialized agents

#### description (required)

Short description of what the command does (used in help text):

```yaml
description: Generate initial documentation for undocumented parts of project
```

#### disable-model-invocation (optional)

Whether to disable AI model invocation (default: false):

```yaml
disable-model-invocation: false
```

### Command Content

The markdown content provides detailed instructions that Claude Code follows when executing the command. Write clear, step-by-step instructions:

```markdown
# Example Command

Usage: `/myplugin:process [input]`

Process the user's input with the following steps:

1. Parse the input argument:
   - If input is provided, use it
   - If not provided, ask the user for input

2. Validate the input:
   - Check that input is not empty
   - Verify format is correct

3. Process the data:
   - Apply transformations
   - Generate output

4. Report results:
   - Show summary of changes
   - List any errors or warnings
```

### Using Arguments

Use the `$ARGUMENTS` placeholder to capture user input after the command name:

```markdown
---
description: Greet the user with a personalized message
---

Greet the user named "$ARGUMENTS" warmly and ask how you can help them today.
```

## Agent Skills

Skills are model-invoked: Claude automatically uses them based on the task context. Add a `skills/` directory with skill folders containing `SKILL.md` files:

```
my-plugin/
├── .claude-plugin/
│   └── plugin.json
└── skills/
    └── code-review/
        └── SKILL.md
```

Each `SKILL.md` needs frontmatter with `name` and `description` fields:

```markdown
---
name: code-review
description: Reviews code for best practices and potential issues. Use when reviewing code, checking PRs, or analyzing code quality.
---

When reviewing code, check for:
1. Code organization and structure
2. Error handling
3. Security concerns
4. Test coverage
```

## Basic Plugin Example

Here's a simple "hello" plugin:

### Directory Structure

```
hello/
├── .claude-plugin/
│   └── plugin.json
└── commands/
    └── greet.md
```

### .claude-plugin/plugin.json

```json
{
  "name": "hello",
  "description": "A simple greeting plugin",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "keywords": ["greeting", "hello", "example"]
}
```

### commands/greet.md

```markdown
---
allowed-tools: Read, Write
description: Greet the user with a personalized message
disable-model-invocation: false
---

# Greet Command

Usage: `/hello:greet [name]`

Generate a greeting message:

1. Get the name:
   - If name is provided as argument, use it
   - If not provided, ask user for their name

2. Create greeting:
   - Generate a friendly greeting message
   - Include the user's name

3. Display the greeting:
   - Show the greeting message to the user
```

## Testing Your Plugin

### Local Testing with --plugin-dir

Use the `--plugin-dir` flag to test plugins during development. This loads your plugin directly without requiring installation:

```bash
claude --plugin-dir ./my-plugin
```

You can load multiple plugins at once:

```bash
claude --plugin-dir ./plugin-one --plugin-dir ./plugin-two
```

> **Note**: After making changes to your plugin, restart Claude Code to pick up the updates.

### Testing with Local Path

You can also test a plugin by specifying a local path when adding to a marketplace. This is useful for testing plugins before publishing:

```bash
# Add a local directory as a marketplace source
/plugin marketplace add /path/to/your/plugin-directory

# Or use relative path from your current directory
/plugin marketplace add ./my-plugin
```

### What to Test

Test your plugin components:

- Try your commands with `/plugin-name:command-name`
- Check that agents appear in `/agents`
- Verify hooks trigger correctly
- Run `/help` to see your commands listed under the plugin namespace

## Best Practices

### Command Design

- One command per file
- Use clear, descriptive command names
- Provide usage examples in command documentation
- Write detailed step-by-step instructions

### Instructions

- Be specific about what Claude Code should do
- Include error handling and edge cases
- Specify when to ask user for input
- Define output format

### Tool Permissions

- Only request tools the command actually needs
- Use Bash patterns to restrict command scope
- Be specific with allowed operations

### Documentation

- Include usage examples for each command
- Explain arguments and their formats
- Document expected behavior
- Provide examples of output

## Adding to Flugins

To add your plugin to the Flugins collection:

### 1. Fork the Repository

```bash
git clone https://github.com/Flopsstuff/flugins.git
cd flugins
```

### 2. Create Plugin Directory

```bash
mkdir -p plugins/your-plugin-name/.claude-plugin
mkdir plugins/your-plugin-name/commands
```

### 3. Create Plugin Metadata

Create `.claude-plugin/plugin.json`:

```bash
cat > plugins/your-plugin-name/.claude-plugin/plugin.json << 'EOF'
{
  "name": "your-plugin-name",
  "description": "What your plugin does",
  "version": "1.0.0",
  "author": {
    "name": "Your Name",
    "email": "you@example.com"
  },
  "keywords": ["keyword1", "keyword2"]
}
EOF
```

### 4. Create Commands

Create command files in `commands/` directory:

```bash
cat > plugins/your-plugin-name/commands/my-command.md << 'EOF'
---
allowed-tools: Read, Write
description: Brief command description
disable-model-invocation: false
---

# Command Title

Usage: `/your-plugin-name:my-command`

Instructions for Claude Code...
EOF
```

### 5. Update Marketplace

Add your plugin to `.claude-plugin/marketplace.json`:

```json
{
  "plugins": [
    {
      "name": "your-plugin-name",
      "source": "./plugins/your-plugin-name",
      "description": "What your plugin does",
      "author": {
        "name": "Your Name",
        "email": "you@example.com"
      },
      "keywords": ["keyword1", "keyword2"]
    }
  ]
}
```

### 6. Test Your Plugin

Test locally by adding the marketplace:

```bash
# From your local flugins directory
/plugin marketplace add .

# Install your plugin
/plugin install your-plugin-name@flugins

# Test your commands
/your-plugin-name:my-command
```

### 7. Submit Pull Request

1. Commit your changes
2. Push to your fork
3. Open a pull request
4. Wait for review

## Plugin Guidelines

### Command Design

- Keep commands focused on a single task
- Use clear, self-explanatory command names
- Provide helpful usage instructions
- Handle edge cases and errors gracefully

### Instructions Quality

- Write clear, unambiguous instructions
- Break complex tasks into simple steps
- Specify exact tool usage and parameters
- Include validation and error handling steps

### Tool Permissions

- Request only necessary tools
- Use restrictive Bash patterns when possible
- Avoid broad permissions unless required
- Document why specific tools are needed

### User Experience

- Provide clear feedback at each step
- Ask for user input when needed
- Show progress for long-running operations
- Report results in a structured format

## Resources

- [Official Claude Code Plugins Documentation](https://code.claude.com/docs/en/plugins)
- [Existing Plugins](https://github.com/Flopsstuff/flugins/tree/main/plugins)
- [Plugin Catalog](../plugin-catalog/index.md)
- [API Reference](api-reference.md)
- [Contributing Guidelines](contributing.md)

## Getting Help

If you need help creating a plugin:

- Review the [docs plugin](https://github.com/Flopsstuff/flugins/tree/main/plugins/docs) as a reference
- Ask questions in the [Discussions](https://github.com/Flopsstuff/flugins/discussions)
- Open an issue for technical problems
- Check the [API Reference](api-reference.md) for detailed specifications
