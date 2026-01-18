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

### Plugin Metadata (plugin.json)

```json
{
  "name": "string",              // Plugin identifier (required)
  "version": "string",           // Semantic version (required)
  "description": "string",       // Brief description (required)
  "author": "string",            // Author name (required)
  "license": "string",           // License type (required)
  "main": "string",              // Entry point file (required)
  "keywords": ["string"],        // Search keywords (optional)
  "dependencies": {              // npm dependencies (optional)
    "package": "version"
  },
  "claudeCode": {                // Claude Code specific config
    "minVersion": "string"       // Minimum required version (optional)
  }
}
```

### Plugin Class Interface

#### Constructor

```javascript
constructor()
```

Initialize your plugin. Set up any initial state or configuration.

**Example:**
```javascript
constructor() {
  this.name = 'my-plugin';
  this.config = {};
}
```

#### initialize()

```javascript
async initialize(context)
```

Called when the plugin is loaded.

**Parameters:**
- `context` (Object): Plugin execution context
  - `context.workingDirectory` (string): Current working directory
  - `context.config` (Object): Plugin configuration
  - `context.logger` (Object): Logger instance

**Returns:** Promise<void>

**Example:**
```javascript
async initialize(context) {
  this.logger = context.logger;
  this.workingDir = context.workingDirectory;
  this.logger.info('Plugin initialized');
}
```

#### execute()

```javascript
async execute(args)
```

Main plugin execution logic.

**Parameters:**
- `args` (Object): Execution arguments
  - `args.input` (any): User input
  - `args.options` (Object): Command options
  - `args.context` (Object): Execution context

**Returns:** Promise<PluginResult>

```typescript
interface PluginResult {
  success: boolean;        // Whether execution succeeded
  message?: string;        // Status or error message
  data?: any;             // Result data
  error?: Error;          // Error object if failed
}
```

**Example:**
```javascript
async execute(args) {
  try {
    const result = await this.processInput(args.input);
    return {
      success: true,
      message: 'Executed successfully',
      data: result
    };
  } catch (error) {
    return {
      success: false,
      message: 'Execution failed',
      error: error
    };
  }
}
```

#### cleanup()

```javascript
async cleanup()
```

Called when the plugin is unloaded. Clean up resources, close connections, etc.

**Returns:** Promise<void>

**Example:**
```javascript
async cleanup() {
  if (this.connection) {
    await this.connection.close();
  }
  this.logger.info('Plugin cleaned up');
}
```

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

## Utility Functions

### Logger

The logger provides standard logging methods:

```javascript
logger.info(message)     // Info level
logger.warn(message)     // Warning level
logger.error(message)    // Error level
logger.debug(message)    // Debug level
```

### File System

Common file system operations:

```javascript
// Read file
const content = await fs.readFile(path, 'utf8');

// Write file
await fs.writeFile(path, content, 'utf8');

// Check if file exists
const exists = await fs.pathExists(path);

// Create directory
await fs.ensureDir(path);
```

### Path Utilities

```javascript
const path = require('path');

// Join paths
const fullPath = path.join(dir, file);

// Get directory name
const dir = path.dirname(fullPath);

// Get file name
const file = path.basename(fullPath);

// Get extension
const ext = path.extname(fullPath);
```

## Error Handling

### Custom Errors

Define custom error types:

```javascript
class PluginError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'PluginError';
    this.code = code;
  }
}

// Usage
throw new PluginError('Invalid input', 'INVALID_INPUT');
```

### Error Codes

Standard error codes:

- `INVALID_INPUT`: User input validation failed
- `NOT_FOUND`: Required resource not found
- `PERMISSION_DENIED`: Insufficient permissions
- `NETWORK_ERROR`: Network request failed
- `INTERNAL_ERROR`: Internal plugin error

## Events

### Plugin Events

Plugins can emit and listen to events:

```javascript
// Emit event
this.emit('event-name', data);

// Listen to event
this.on('event-name', (data) => {
  // Handle event
});

// Remove listener
this.off('event-name', handler);
```

## Configuration

### Plugin Configuration

Access plugin configuration:

```javascript
// Get config value
const value = this.config.get('key');

// Set config value
this.config.set('key', value);

// Check if key exists
const has = this.config.has('key');

// Get all config
const all = this.config.getAll();
```

## Testing

### Test Utilities

```javascript
const { createMockContext } = require('@flugins/test-utils');

// Create mock context
const context = createMockContext({
  workingDirectory: '/path/to/dir',
  config: { key: 'value' }
});

// Test plugin
const plugin = new MyPlugin();
await plugin.initialize(context);
const result = await plugin.execute({ input: 'test' });
```

## Version Compatibility

### Semantic Versioning

Flugins follows [Semantic Versioning](https://semver.org/):

- **MAJOR**: Breaking changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

### Version Constraints

Specify version requirements:

```json
{
  "claudeCode": {
    "minVersion": "1.0.0"      // Minimum version
  }
}
```

## Best Practices

### Performance

- Use async/await for I/O operations
- Cache results when appropriate
- Clean up resources in cleanup()
- Avoid blocking operations

### Security

- Validate all inputs
- Sanitize user data
- Avoid eval() and similar functions
- Use secure dependencies
- Never expose secrets

### Reliability

- Handle errors gracefully
- Provide meaningful error messages
- Test edge cases
- Log important events
- Version your plugin properly

## Resources

- [Plugin Template](https://github.com/Flopsstuff/flugins-template)
- [Example Plugins](https://github.com/Flopsstuff/flugins/tree/main/examples)
- [Claude Code Documentation](https://code.claude.com/docs)
- [Node.js API](https://nodejs.org/api/)

## Support

For API questions or issues:

1. Check this reference
2. Review example plugins
3. Search existing issues
4. Ask in [Discussions](https://github.com/Flopsstuff/flugins/discussions)
5. Open an issue
