# Creating Plugins

This guide explains how to create your own plugins for the Flugins collection.

## Plugin Structure

A typical Claude Code plugin has the following structure:

```
plugin-name/
├── plugin.json          # Plugin metadata
├── README.md            # Plugin documentation
├── src/                 # Source code
│   └── main.js          # Main plugin file
└── tests/               # Test files
    └── main.test.js
```

## Plugin Metadata

Every plugin must have a `plugin.json` file that describes the plugin:

```json
{
  "name": "plugin-name",
  "version": "1.0.0",
  "description": "Brief description of what the plugin does",
  "author": "Your Name",
  "license": "MIT",
  "main": "src/main.js",
  "keywords": ["keyword1", "keyword2"],
  "dependencies": {},
  "claudeCode": {
    "minVersion": "1.0.0"
  }
}
```

### Required Fields

- `name`: Unique identifier for your plugin (lowercase, no spaces)
- `version`: Semantic version number (e.g., "1.0.0")
- `description`: Brief description of functionality
- `author`: Your name or organization
- `license`: License type (e.g., "MIT")
- `main`: Entry point file path

### Optional Fields

- `keywords`: Array of keywords for discoverability
- `dependencies`: Required npm packages
- `claudeCode.minVersion`: Minimum Claude Code version required

## Plugin Implementation

### Basic Plugin Example

Here's a simple plugin template:

```javascript
// src/main.js
class MyPlugin {
  constructor() {
    this.name = 'my-plugin';
  }

  async initialize(context) {
    // Setup code here
    console.log('Plugin initialized');
  }

  async execute(args) {
    // Main plugin logic
    return {
      success: true,
      message: 'Plugin executed successfully'
    };
  }

  async cleanup() {
    // Cleanup code here
    console.log('Plugin cleaned up');
  }
}

module.exports = MyPlugin;
```

### Plugin Lifecycle

1. **initialization**: Called when the plugin is loaded
2. **execute**: Called when the plugin is invoked
3. **cleanup**: Called when the plugin is unloaded

## Best Practices

### Code Quality

- Write clean, readable code
- Follow JavaScript/TypeScript best practices
- Use meaningful variable and function names
- Add comments for complex logic

### Error Handling

- Always validate input
- Provide clear error messages
- Handle edge cases gracefully
- Return meaningful error codes

### Documentation

- Write comprehensive README
- Document all public APIs
- Include usage examples
- List dependencies and requirements

### Testing

- Write unit tests for core functionality
- Test error conditions
- Verify edge cases
- Maintain high code coverage

## Adding to Flugins

To add your plugin to the Flugins collection:

### 1. Fork the Repository

```bash
git clone https://github.com/Flopsstuff/flugins.git
cd flugins
```

### 2. Create Plugin Directory

```bash
mkdir plugins/your-plugin-name
cd plugins/your-plugin-name
```

### 3. Implement Your Plugin

Create the necessary files following the structure above.

### 4. Update Marketplace

Add your plugin to `.claude-plugin/marketplace.json`:

```json
{
  "plugins": [
    {
      "name": "your-plugin-name",
      "path": "plugins/your-plugin-name",
      "version": "1.0.0"
    }
  ]
}
```

### 5. Test Your Plugin

```bash
# Install dependencies
npm install

# Run tests
npm test

# Test locally
/plugin install ./plugins/your-plugin-name
```

### 6. Submit Pull Request

1. Commit your changes
2. Push to your fork
3. Open a pull request
4. Wait for review

## Plugin Guidelines

### Security

- Never expose sensitive information
- Validate all user input
- Avoid executing arbitrary code
- Follow security best practices

### Performance

- Optimize for speed
- Minimize resource usage
- Use async operations when appropriate
- Clean up resources properly

### Compatibility

- Test on multiple platforms
- Support different environments
- Document system requirements
- Handle missing dependencies gracefully

## Resources

- [Claude Code Documentation](https://code.claude.com/docs)
- [JavaScript Best Practices](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide)
- [Semantic Versioning](https://semver.org/)
- [MIT License](https://opensource.org/licenses/MIT)

## Getting Help

If you need help creating a plugin:

- Review existing plugins for examples
- Ask questions in the [Discussions](https://github.com/Flopsstuff/flugins/discussions)
- Open an issue for technical problems
