# Contributing

Bug reports and pull requests are welcome. Open an issue before starting a large
change, so we can agree on the approach first. Report security problems as
[`SECURITY.md`](SECURITY.md) describes.

## Setup and checks

[`docs/development.md`](docs/development.md) lists the requirements, setup steps, and
test commands. The repo has no CI, so run these checks before opening a pull
request. If your change touches the backend or the driver, also run the
integration tests against the Docker server.

## Commits and pull requests

Use [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) for
commit messages and pull request titles:

```text
fix(parser): handle empty input
```

Keep each pull request to one change, and say in its description how you tested
it. New logic with a branch, a parser, or a security impact needs a test.

## The vendored driver

`vendor/klickhouse/` is a patched copy of the `klickhouse` crate. When you change
it:

1. Add a `// chgui patch:` comment on the change.
2. Add or update its bullet in the "Vendored `klickhouse`" section of
   [`docs/architecture.md`](docs/architecture.md).
3. Add a test in the fork, and a live test in `src-tauri/tests/` if the change
   depends on server behavior.

## IPC types

`src/types/index.ts` mirrors the Rust types in `src-tauri/src` by hand. Nothing
checks that they match, so change both sides together.
