# Security model

## Parameterized queries

ch-gui substitutes `{name}` placeholders into the query text on the
client, before it sends the query. The server binds no parameters.

- `{name}` is text. The value goes in as a quoted, escaped string: `US`
  becomes `'US'`. A value that starts with `'` goes in as typed, for
  lists such as `'US','CA'`. Inside quotes, as in `'{name}'`, the value
  is escaped but not quoted again.
- `{#name}` is a number and `{!name}` is raw SQL, such as a column name
  or an expression. Both go in as typed. `{@name}` is a date, quoted
  unless it starts with a quote, a letter, or `(`.
- Braces inside comments are not placeholders, and neither are names
  that start with a digit, as in `\d{3}`.

Raw and number values reach the server as typed, so a raw value can
change what the query does.

This is deliberate. ch-gui is a single-user desktop app that runs with
the user's own ClickHouse credentials. A value that changes the query
runs with the same permissions as SQL the user types, so it grants no
access the user lacks.

Names read from the server are different, because other users on the
cluster choose them. ch-gui escapes every database, table, and view name
and every query id before putting it in SQL.

Before using ch-gui in a shared or managed setting, such as a web
frontend, a kiosk build, or a service account, move substitution to
server-side parameter binding or validate every value strictly.

## What ch-gui stores and sends

- Passwords stay in the macOS Keychain.
- Query history stays unencrypted in the app's SQLite file for 90 days,
  and longer when pinned. Open tabs and their parameter values stay
  unencrypted in the app's local storage. A statement that contains a
  secret, such as `CREATE USER ... IDENTIFIED BY '...'`, is saved as
  typed.
- ClickHouse servers receive your OS username and hostname, which appear
  in `system.query_log`.
- Update checks contact `downloads.matiasdominguez.dev`. ch-gui sends no
  telemetry.
- Exports hold the exact values from the server. A spreadsheet treats a
  value that starts with `=`, `+`, `-`, or `@` as a formula, so be careful
  opening exports of data that other people can write.
- With **Secure** off, your password and query results cross the network
  unencrypted.

Report security problems as described in [SECURITY.md](../SECURITY.md).
