```markdown
# prunerr Development Patterns

> Auto-generated skill from repository analysis

## Overview
This skill teaches the core development patterns and conventions used in the `prunerr` TypeScript repository. You'll learn how to structure files, write code, manage imports/exports, follow commit message standards, and write and run tests using Vitest. This guide ensures consistency and efficiency when contributing to or maintaining the codebase.

## Coding Conventions

### File Naming
- Use **camelCase** for file names.
  - Example: `myUtility.ts`, `dataProcessor.ts`

### Import Style
- Use **relative imports** for referencing other modules within the project.
  - Example:
    ```typescript
    import { processData } from './dataProcessor'
    ```

### Export Style
- Use **named exports** for all modules.
  - Example:
    ```typescript
    // In dataProcessor.ts
    export function processData(data: string) { /* ... */ }
    ```

### Commit Messages
- Follow the **Conventional Commits** style.
- Use the `feat` prefix for new features.
  - Example:
    ```
    feat: add support for batch processing in dataProcessor
    ```

## Workflows

### Writing a New Feature
**Trigger:** When adding new functionality to the codebase  
**Command:** `/new-feature`

1. Create a new file using camelCase naming.
2. Write your feature using TypeScript, following relative import and named export conventions.
3. Write or update tests in a corresponding `.test.ts` file.
4. Commit your changes using the conventional commit format with a `feat` prefix.
   - Example: `feat: implement advanced pruning algorithm`
5. Push your branch and open a pull request.

### Running Tests
**Trigger:** To verify code correctness before committing or merging  
**Command:** `/run-tests`

1. Ensure all test files follow the `*.test.ts` pattern.
2. Run tests using Vitest:
   ```bash
   npx vitest
   ```
3. Review test output and fix any failing tests before proceeding.

## Testing Patterns

- All tests are written using **Vitest**.
- Test files are named with the `.test.ts` suffix and placed alongside the code they test.
  - Example: `dataProcessor.test.ts`
- Example test:
  ```typescript
  import { processData } from './dataProcessor'

  test('processData returns correct result', () => {
    expect(processData('input')).toBe('expectedOutput')
  })
  ```

## Commands
| Command       | Purpose                                      |
|---------------|----------------------------------------------|
| /new-feature  | Guide for adding a new feature               |
| /run-tests    | Instructions for running the test suite      |
```
