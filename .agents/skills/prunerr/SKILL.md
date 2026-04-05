```markdown
# prunerr Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches you the core development patterns and conventions used in the `prunerr` TypeScript codebase. You'll learn about file naming, import/export styles, commit message conventions, and how to write and run tests. While no automated workflows were detected, this guide provides suggested commands and step-by-step instructions for common development tasks.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myModule.ts`, `userService.ts`

### Import Style
- Use **relative imports** for referencing local modules.
  - Example:
    ```typescript
    import { helper } from './utils/helper';
    ```

### Export Style
- **Mixed export style**: Both named and default exports are used.
  - Named export:
    ```typescript
    export function doSomething() { ... }
    ```
  - Default export:
    ```typescript
    export default MyComponent;
    ```

### Commit Messages
- Use **Conventional Commits** with the `feat` prefix for new features.
  - Example:
    ```
    feat: add user pruning logic
    ```

## Workflows

### Feature Development
**Trigger:** When implementing a new feature  
**Command:** `/start-feature`

1. Create a new branch for your feature.
2. Write code using camelCase file names and relative imports.
3. Use named or default exports as appropriate.
4. Write commit messages using the `feat` prefix.
5. Add or update tests in `*.test.*` files.
6. Open a pull request for review.

### Testing
**Trigger:** When verifying code correctness  
**Command:** `/run-tests`

1. Identify test files matching the `*.test.*` pattern.
2. Run the test suite using the project's test runner (framework unknown; check project documentation or `package.json`).
3. Review test output and fix any failing tests.

## Testing Patterns

- Test files follow the `*.test.*` naming convention.
  - Example: `userService.test.ts`
- The specific testing framework is **unknown**; check for clues in the project setup.
- Place test files alongside the code they test or in a dedicated test directory.

**Example test file:**
```typescript
import { pruneUsers } from './pruneUsers';

test('removes inactive users', () => {
  // Arrange
  const users = [/* ... */];
  // Act
  const result = pruneUsers(users);
  // Assert
  expect(result).toEqual(/* ... */);
});
```

## Commands
| Command         | Purpose                                 |
|-----------------|-----------------------------------------|
| /start-feature  | Begin developing a new feature          |
| /run-tests      | Run the test suite                      |
```
