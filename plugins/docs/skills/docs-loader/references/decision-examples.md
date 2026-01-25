# Documentation Loading Decision Examples

This reference provides concrete examples of when and what documentation to load for different task types.

## Feature Addition Examples

### Example 1: Adding a REST API endpoint

**User request:** "Add a POST /api/users endpoint to create new users"

**Decision:**
- ✓ Code task: Yes
- ✓ Needs docs: Yes (architecture patterns needed)

**Documentation to load:**
1. `docs/architecture/api-patterns.md` - How APIs are structured
2. `docs/database/schema.md` - User table structure
3. `docs/development/validation.md` - Input validation patterns

**Reasoning:** Need to understand existing API patterns, database schema, and validation approach.

### Example 2: Adding a UI component

**User request:** "Add a dropdown menu to the navigation bar"

**Decision:**
- ✓ Code task: Yes
- ✓ Needs docs: Yes (component patterns)

**Documentation to load:**
1. `docs/frontend/component-library.md` - Existing components
2. `docs/frontend/styling.md` - CSS/styling conventions
3. `docs/architecture/state-management.md` - How state is handled

### Example 3: Simple typo fix

**User request:** "Fix the typo in the error message"

**Decision:**
- ✓ Code task: Yes
- ✗ Needs docs: No (trivial change)

**Documentation to load:** None

## Refactoring Examples

### Example 4: Extracting a utility function

**User request:** "Refactor the date formatting code into a utility function"

**Decision:**
- ✓ Code task: Yes
- ✓ Needs docs: Yes (need to know where utilities go)

**Documentation to load:**
1. `docs/architecture/project-structure.md` - Where to put utilities
2. `docs/development/patterns.md` - Function naming conventions

### Example 5: Converting class to hooks

**User request:** "Convert this class component to use React hooks"

**Decision:**
- ✓ Code task: Yes
- ✓ Needs docs: Maybe (depends on project patterns)

**Documentation to load:**
1. `docs/frontend/react-patterns.md` - If exists, load for hook conventions
2. Skip if no React-specific docs

## Bug Fix Examples

### Example 6: Authentication bug

**User request:** "Fix the bug where users can't log in after password reset"

**Decision:**
- ✓ Code task: Yes
- ✓ Needs docs: Yes (need auth flow understanding)

**Documentation to load:**
1. `docs/architecture/authentication.md` - Auth flow
2. `docs/security/password-reset.md` - Password reset process
3. `docs/database/sessions.md` - Session management

### Example 7: Simple null pointer fix

**User request:** "Fix the null pointer exception on line 42"

**Decision:**
- ✓ Code task: Yes
- ✗ Needs docs: No (simple fix with stack trace)

**Documentation to load:** None

## Explanation/Understanding Examples

### Example 8: Architecture question

**User request:** "Explain how the authentication system works"

**Decision:**
- ✗ Code task: No (explanation only)
- ✓ Needs docs: Yes

**Documentation to load:**
1. `docs/architecture/overview.md` - System overview
2. `docs/architecture/authentication.md` - Detailed auth docs
3. `docs/security/oauth.md` - OAuth implementation if used

### Example 9: How to run tests

**User request:** "How do I run the test suite?"

**Decision:**
- ✗ Code task: No
- ✓ Needs docs: Yes (but different docs)

**Documentation to load:**
1. `docs/development/testing.md` - Test instructions
2. `README.md` - Quick start section

## Multi-file Change Examples

### Example 10: Renaming a core module

**User request:** "Rename the 'auth' module to 'authentication'"

**Decision:**
- ✓ Code task: Yes
- ✓ Needs docs: Yes (need to understand dependencies)

**Documentation to load:**
1. `docs/architecture/overview.md` - Module dependencies
2. `docs/architecture/modules.md` - Module structure

### Example 11: Adding a new feature flag

**User request:** "Add a feature flag for the new dashboard"

**Decision:**
- ✓ Code task: Yes
- ✓ Needs docs: Yes (feature flag system)

**Documentation to load:**
1. `docs/architecture/feature-flags.md` - How feature flags work
2. `docs/deployment/configuration.md` - Config management

## Complex Scenarios

### Example 12: Performance optimization

**User request:** "Optimize the slow database queries on the dashboard"

**Decision:**
- ✓ Code task: Yes
- ✓ Needs docs: Yes (need architecture understanding)

**Documentation to load:**
1. `docs/architecture/database.md` - DB architecture
2. `docs/architecture/caching.md` - Caching strategy
3. `docs/performance/optimization.md` - Optimization guidelines

### Example 13: Adding third-party integration

**User request:** "Integrate Stripe payment processing"

**Decision:**
- ✓ Code task: Yes
- ✓ Needs docs: Yes (integration patterns)

**Documentation to load:**
1. `docs/architecture/integrations.md` - How integrations work
2. `docs/security/api-keys.md` - How to handle API keys
3. `docs/development/environment.md` - Environment variables

## Decision Shortcuts

**Quick rules for common scenarios:**

| Task Type | Needs Docs? | Which Docs? |
|-----------|-------------|-------------|
| Add new feature | Usually yes | Architecture + patterns |
| Fix typo | No | None |
| Refactor | Usually yes | Architecture + patterns |
| Simple bug fix | Usually no | None |
| Complex bug fix | Yes | Relevant module docs |
| Add tests | Maybe | Testing guidelines |
| Update dependencies | Maybe | Dependency management |
| Change config | Maybe | Configuration docs |
| Explain code | Yes | Architecture + module docs |
| Add documentation | Maybe | Documentation style guide |

## Loading Strategy by Task Size

### Small tasks (< 10 lines changed)
- Load 0-1 docs
- Only if architectural decision needed

### Medium tasks (10-100 lines changed)
- Load 1-3 docs
- Focus on relevant patterns and architecture

### Large tasks (100+ lines changed)
- Load 3-5 docs
- Start with overview, then specifics
- Load more as needed during work

## Progressive Loading Example

**User request:** "Implement user profile editing with image upload"

**Initial load (before starting):**
1. `docs/architecture/overview.md` - Understand system
2. `docs/api/patterns.md` - API conventions

**During work (as needed):**
3. `docs/storage/file-upload.md` - When implementing upload
4. `docs/security/validation.md` - When adding validation
5. `docs/frontend/forms.md` - When building the form

**Reasoning:** Load broad context first, then specific details as you encounter them.
