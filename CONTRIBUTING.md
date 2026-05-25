# Contributing

Thanks for helping improve `ohmytrends`.

## Development

This project is Bun-only.

```bash
bun install
bun run ci
```

Before opening a pull request, make sure type checking and tests pass:

```bash
bun run typecheck
bun test
```

## Guidelines

- Keep browser profile directories, exported data, logs, and `.env` files out of commits.
- Prefer small, focused changes with tests for option parsing, output shaping, and pure data transforms.
- Third-party pages and private APIs can change. When updating selectors or request parsing, include a short note about what changed and how you verified it.
- Do not add behavior that bypasses access controls or automates accounts you are not authorized to use.
