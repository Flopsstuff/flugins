# Contributing to Flugins

Thank you for your interest in contributing to Flugins! This document provides guidelines for contributing to the project.

## Code of Conduct

By participating in this project, you agree to maintain a respectful and inclusive environment for all contributors.

## How to Contribute

There are many ways to contribute to Flugins:

1. **Report Bugs**: Submit detailed bug reports
2. **Suggest Features**: Propose new plugin ideas
3. **Submit Plugins**: Create and share new plugins
4. **Improve Documentation**: Enhance or clarify documentation
5. **Review Pull Requests**: Help review code submissions
6. **Answer Questions**: Help others in discussions

## Getting Started

### 1. Fork the Repository

Click the "Fork" button on the [GitHub repository](https://github.com/Flopsstuff/flugins) to create your own copy.

### 2. Clone Your Fork

```bash
git clone https://github.com/YOUR-USERNAME/flugins.git
cd flugins
```

### 3. Create a Branch

```bash
git checkout -b feature/your-feature-name
```

Use descriptive branch names:
- `feature/new-plugin-name` for new features
- `fix/bug-description` for bug fixes
- `docs/improvement-description` for documentation

### 4. Make Your Changes

- Write clear, maintainable code
- Follow existing code style
- Add tests for new functionality
- Update documentation as needed

### 5. Test Your Changes

```bash
# Run tests
npm test

# Test locally
/plugin install ./plugins/your-plugin
```

### 6. Commit Your Changes

Write clear, descriptive commit messages:

```bash
git add .
git commit -m "feat: add new plugin for task management"
```

Follow [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` for new features
- `fix:` for bug fixes
- `docs:` for documentation
- `test:` for tests
- `refactor:` for code refactoring

### 7. Push to Your Fork

```bash
git push origin feature/your-feature-name
```

### 8. Open a Pull Request

1. Go to the original repository
2. Click "New Pull Request"
3. Select your fork and branch
4. Fill out the PR template
5. Submit for review

## Pull Request Guidelines

### Title

Use clear, descriptive titles:
- ✅ "Add weather plugin with API integration"
- ❌ "Update stuff"

### Description

Include:
- What changes were made
- Why the changes are needed
- How to test the changes
- Any breaking changes
- Related issues (if applicable)

### Checklist

Before submitting, ensure:
- [ ] Code follows project style guidelines
- [ ] Tests pass locally
- [ ] Documentation is updated
- [ ] Commit messages are clear
- [ ] No sensitive information is included
- [ ] Changes are backwards compatible (or documented)

## Coding Standards

### JavaScript/TypeScript

- Use ES6+ features
- Follow [Airbnb JavaScript Style Guide](https://github.com/airbnb/javascript)
- Use meaningful variable names
- Add JSDoc comments for public APIs

### File Organization

```
plugins/
└── plugin-name/
    ├── plugin.json
    ├── README.md
    ├── src/
    │   └── main.js
    └── tests/
        └── main.test.js
```

### Documentation

- Use Markdown for documentation
- Include code examples
- Add screenshots when relevant
- Keep language clear and concise

## Testing

### Writing Tests

- Test core functionality
- Test error conditions
- Test edge cases
- Maintain high coverage

### Running Tests

```bash
# Run all tests
npm test

# Run specific test
npm test -- plugin-name

# Run with coverage
npm test -- --coverage
```

## Reporting Issues

When reporting bugs, include:

1. **Clear Title**: Describe the issue briefly
2. **Description**: Explain what happened
3. **Steps to Reproduce**: Numbered steps to reproduce
4. **Expected Behavior**: What should happen
5. **Actual Behavior**: What actually happened
6. **Environment**: OS, Claude Code version, etc.
7. **Screenshots**: If applicable
8. **Additional Context**: Any other relevant information

### Issue Template

```markdown
## Description
Brief description of the issue

## Steps to Reproduce
1. Step one
2. Step two
3. Step three

## Expected Behavior
What should happen

## Actual Behavior
What actually happened

## Environment
- OS: [e.g., macOS 13.0]
- Claude Code Version: [e.g., 1.0.0]
- Plugin Version: [e.g., 1.0.0]

## Additional Context
Any other relevant information
```

## Feature Requests

When suggesting features:

1. **Use Case**: Explain why it's needed
2. **Proposed Solution**: Describe your idea
3. **Alternatives**: Other solutions considered
4. **Additional Context**: Screenshots, examples, etc.

## Review Process

### For Contributors

- Be patient during review
- Respond to feedback promptly
- Make requested changes
- Keep discussions professional

### For Reviewers

- Be constructive and respectful
- Provide specific feedback
- Test the changes
- Approve when ready

## Communication

### Channels

- **GitHub Issues**: Bug reports, feature requests
- **GitHub Discussions**: Questions, ideas
- **Pull Requests**: Code review, implementation discussion

### Response Times

We aim to:
- Acknowledge issues within 48 hours
- Review PRs within 1 week
- Release new versions monthly

## Recognition

Contributors are recognized:
- In the project README
- In release notes
- Through GitHub contributor stats

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Questions?

If you have questions about contributing:

1. Check this guide
2. Search existing issues
3. Ask in GitHub Discussions
4. Open a new issue

Thank you for contributing to Flugins! 🎉
