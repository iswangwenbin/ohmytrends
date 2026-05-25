# Security

## Supported Versions

Security fixes target the latest released version.

## Reporting

Please report security issues privately to the project maintainers instead of opening a public issue.

## Sensitive Local Data

`ohmytrends` uses persistent browser profiles. Those profiles can contain cookies,
sessions, local storage, and account data.

Never publish:

- `profiles/`
- `data/`
- `exports/`
- logs
- `.env` files
- custom browser profile directories

JSON output omits raw third-party API responses by default. Use `--raw true`
only for local debugging, and review the output before sharing it.
