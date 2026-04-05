```markdown
# prunerr Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `prunerr` TypeScript codebase. You'll learn about file organization, import/export styles, commit conventions, and how to write and run tests. This guide is designed to help contributors maintain consistency and efficiency when working on `prunerr`.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myUtility.ts`, `dataProcessor.ts`

### Import Style
- Use **relative imports** for modules within the project.
  - Example:
    ```typescript
    import { processData } from './dataProcessor';
    ```

### Export Style
- Use **named exports** rather than default exports.
  - Example:
    ```typescript
    // In dataProcessor.ts
    export function processData(input: string): string {
      // ...
    }
    ```

### Commit Messages
- Use the `feat` prefix for new features.
- Commit messages are mixed in type, with an average length of 87 characters.
  - Example:
    ```
    feat: add support for batch processing in dataProcessor
    ```

## Workflows

### Feature Development
**Trigger:** When adding a new feature or functionality  
**Command:** `/feature-development`

1. Create a new branch for your feature.
2. Write code using camelCase file names and relative imports.
3. Use named exports for all modules.
4. Write or update tests in `*.test.*` files.
5. Commit changes with a `feat` prefix and a descriptive message.
6. Open a pull request for review.

### Testing
**Trigger:** When verifying code correctness  
**Command:** `/run-tests`

1. Identify or create test files matching the `*.test.*` pattern.
2. Use the project's (unknown) test runner to execute tests.
3. Ensure all tests pass before merging changes.

## Testing Patterns

- Test files follow the `*.test.*` naming convention (e.g., `dataProcessor.test.ts`).
- The testing framework is not explicitly specified.
- Place test files alongside the modules they test or in a dedicated test directory.
- Example test file:
  ```typescript
  import { processData } from './dataProcessor';

  describe('processData', () => {
    it('should process input correctly', () => {
      const result = processData('input');
      expect(result).toBe('expectedOutput');
    });
  });
  ```

## Commands
| Command               | Purpose                                   |
|-----------------------|-------------------------------------------|
| /feature-development  | Start a new feature development workflow  |
| /run-tests            | Run all tests in the codebase             |
```
