## Project Architecture Documentation

docs/Architecture/

- Internal documentation about project architecture.
- Keep up to date with significant architecture changes. Keep documentation concise, avoid repeating information.

Architecture overview: docs/Architecture/Overview.md

## Guidelines

- Read AGENTS.md and docs before editing code
- Stop being agreeable: be direct and honest; no flattery, no validation, no sugar-coating.
- Challenge weak reasoning; point out missing assumptions and trade-offs.
- If something is underspecified/contradictory/risky — say so and list what must be clarified.

## Rules

- Never guess or invent. If unsure, say "I don't know" and propose how to verify.
- Never commit secrets, keys, connection strings
- Never force push to main
- Never approve or merge (human decision)

## Key Entry Points

Start here when exploring the codebase:

| File                                                     | Purpose                                    |
| -------------------------------------------------------- | ------------------------------------------ |
| `src/contentScript/tableWidget/tableWidgetExtension.ts`  | Main wiring; connects all plugins/styles.  |
| `src/contentScript/tableWidget/nestedEditorLifecycle.ts` | Nested editor state, sync triggers.        |
| `src/contentScript/tableWidget/TableWidget.ts`           | Widget rendering, cell coordinate mapping. |
| `src/contentScript/nestedEditor/nestedCellEditor.ts`     | Nested editor implementation.              |

## Common Pitfalls

- **Sync transactions**: Always use `syncAnnotation` when forwarding changes between main and nested editors. Without it, changes trigger infinite re-render loops.
- **Block decorations**: Must be provided via `StateField`, not `ViewPlugin`. CodeMirror requires decorations affecting layout to come from state.
- **Build command**: Use `npm run dist`, not `npm run build` or `npx tsc`.

## Build, Test, and Development Commands

- `npm test` Run Jest test suite with coverage.
- `npm run test:watch` Run tests in watch mode during development.
- `npm run dist` Build plugin and create archive at `publish/*.jpl`.
- `npm run lint` Lint TypeScript with ESLint.
- `npm run lint:fix` Auto-fix lint issues.
- `npm run format` Format code with Prettier.
- `npm run updateVersion` Sync plugin version metadata.

## Design Principles

- **Simple over complex:** Prefer focused, single-responsibility modules.
- **One clear way**: Avoid multiple competing approaches.
- **Separation of concerns**: Each module handles one aspect.
- **Fail fast**: Validate inputs early; provide clear error messages to users.

## Coding Style & Naming Conventions

- **Language**: TypeScript with strict settings; 4-space indentation; semicolons required.
- **Filenames**: `camelCase.ts` for modules; tests mirror names: `module.test.ts`.
- **Exports**: Prefer explicit types and narrow public exports.
- **Style enforcement**: Run `npm run format` before commits or if you encounter formatting errors from prettier.
- **Documentation**: Use JSDoc for complex functions; document regex patterns with examples.
- **Constants and configuration**: No magic literals — extract to constants, enums, config objects, or dedicated types.
- **Structure and Testability**: Pure logic lives in small, focused units when internal behaviour is non-trivial. Global state and hidden side effects are avoided in favour of explicit dependencies.

## Tests

- Focus on Behavior, not Implementation details.
- If something is difficult to test, do NOT create a separate implementation "just for tests". Propose solutions to make testing easier.

## Log messages

- Use `src/logger.ts` wrapper
