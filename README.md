# OpenCode Subagents Sidebar

[![CI](https://github.com/1217007627/opencode-subagent-monitor/actions/workflows/ci.yml/badge.svg)](https://github.com/1217007627/opencode-subagent-monitor/actions/workflows/ci.yml)
[![GitHub release](https://img.shields.io/github/v/release/1217007627/opencode-subagent-monitor)](https://github.com/1217007627/opencode-subagent-monitor/releases/latest)
[![MIT license](https://img.shields.io/github/license/1217007627/opencode-subagent-monitor)](LICENSE)
[![OpenCode V2](https://img.shields.io/badge/OpenCode-V2%202.2.5-18181b)](docs/compatibility.md)

**A live subagent monitor for the OpenCode terminal UI.** Track parallel AI agents
in a compact `Task` sidebar with one-cell status icons, stable creation-time
ordering and automatic clearing of old work. Click any task to open its session
without losing sight of the rest of the session tree.

[Installation](#installation) · [Features](#features) ·
[Compatibility](docs/compatibility.md) · [Contributing](CONTRIBUTING.md) ·
[Report a bug](https://github.com/1217007627/opencode-subagent-monitor/issues/new?template=bug_report.yml)

**Available on [npm](https://www.npmjs.com/package/opencode-subagent-monitor/v/0.2.1) and as a [GitHub release](https://github.com/1217007627/opencode-subagent-monitor/releases/tag/v0.2.1).**

## Quick start

Tested with **OpenCode V2 2.2.5**. Back up `~/.config/opencode/cli.json`
(or `$XDG_CONFIG_HOME/opencode/cli.json`) and append
`"opencode-subagent-monitor@0.2.1"` to its existing `plugins` array:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["opencode-subagent-monitor@0.2.1"],
  "session": { "sidebar": "auto" }
}
```

Merge these values with your settings; preserve other plugins. If you already
use a local copy of this plugin, replace that entry rather than enabling both.
This is a **TUI-only plugin**: configure it in `cli.json`, not `opencode.json`.

Use `/reload` if the section does not appear after saving. Open a session and
expand **Task**, or run `/subagents` to search tasks even with the sidebar
hidden. An empty tree shows only the header. See [installation](#installation)
for archive and source-checkout alternatives.

## Features

Expanded by default; click the arrow or header to collapse the list. The header
uses the `Task` label and shows no total count:

```text
▶ Task (2 running)
```

The parenthesized number is the count of **Running** tasks, and it keeps
updating while collapsed. Expanded, the header drops the count and the complete
history is shown directly:

```text
▼ Task
✓ Research API            3m 37s
⠋ Review changes            42s
```

Each row starts with a one-cell status icon instead of status text. The elapsed
time of the latest execution appears right-aligned and muted:

| State                                        | Icon                                                      | Color |
| -------------------------------------------- | --------------------------------------------------------- | ----- |
| `Running` / `Waiting`                        | Braille spinner (`⠋ ⠙ ⠹ ⠸ ⠼ ⠴ ⠦ ⠧ ⠇ ⠏`), 100 ms per frame | green |
| `Done`                                       | `✓`                                                       | muted |
| `Error` / `Interrupted` / `Idle` / `Unknown` | `✗`                                                       | red   |

The spinner is the same one OpenCode's built-in subagent list uses. It advances
only while the list is expanded and a Running/Waiting task exists, and stops on
collapse, load error or unmount. Idle does not imply success.

Running and Waiting titles are green to show active work; titles of `Done`,
`Error` and `Interrupted` tasks are muted so finished work recedes. Everything
that is neither running nor successfully finished uses the same red `✗`, so it
is easy to spot at a glance.

- The expanded/collapsed choice survives navigation for this plugin context;
  restarting OpenCode or reloading the plugin resets it.
- Siblings are ordered newest-created first; the order never changes after creation.
- Navigating into a child keeps the same tree. Switching roots changes the list.
- Restores existing tasks, follows lifecycle events, and uses your current theme.

### Nested task tree

Parents precede their children, with connectors like the `tree` utility:

```text
✓ Research               3m 37s
⠋ ├─ API                  42s
⠋ │  └─ Tests           1m 5s
✓ └─ Docs                 25s
```

Among siblings, the most recently created task comes first (session ID breaks
ties). The order is fixed at creation time: later updates never reshuffle the
list. Each subtree stays together: a parent always precedes its children, so an
older parent can appear above newer children. Direct children of the current
root have no connector, and the current root itself is not a row.

Old work is cleared automatically based on the last update time. `Done` tasks
are kept only if last updated within the last 3 hours. Every other status
(`Error`, `Interrupted`, `Running`, `Waiting`, `Idle`, `Unknown`) is dropped once
its last update is more than 96 hours old, so tasks from a weekend do not
linger. A hidden task is still shown as an ancestor when a visible descendant
needs it to keep the tree connected.

Connectors occupy at most six columns. At depths beyond two nested levels, `…`
replaces the earlier path (`…  └─`); it does not mean nodes were omitted. The
status icon is a fixed one-cell column before the connector and durations share
a right-aligned column; long task names truncate. Navigating into a child retains
the same root tree.

### Attention and errors

`Waiting` means the server confirms an unanswered permission request or form for
that subagent. It takes precedence over Running and previous terminal outcomes;
Running also overrides a previous error. Idle alone never means waiting or stuck.

The collapsed header shows only running tasks as `(N running)`. Once expanded,
Waiting spins and Error shows `✗` in the icon column. Each subagent contributes
to at most one status, even with several pending requests. Click a row to open
the host session and respond there. The plugin never answers forms or grants
permissions.

Replies/cancellations refresh the state; Waiting clears when no request remains.
Reconnect restores pending requests from the server. A new execution clears a
previous Error, but a currently pending request still takes priority. A failed or
unsupported pending-request read shows the load error and Retry rather than
claiming there is nothing to attend to.

### Execution duration

The sidebar shows the elapsed time of the **latest execution** as a muted,
right-aligned column after the title. Status remains a single leading icon.
The `/subagents` chooser displays the same duration as `status · duration`, for
example `Running · 42s` or `Done · 1h 5m`. Waiting inside an execution counts
toward elapsed time; this is not CPU time or a separate waiting-time counter.
A completed execution freezes its duration, including when a pending request
keeps the row in Waiting.

The server's `time.busy` supplies the start and `time.idle` the completed end.
Session creation/update times are never substituted. Missing, inconsistent or
future timestamps show `—`; duration alone never means a task is stuck.
Formatting uses whole seconds below an hour, whole minutes below a day, then
whole hours (`2d 3h`), with a space after each unit and no zero padding
(`11m 4s`); durations of 1,000 days or more display `999d+`. The
local clock updates once per second only while the sidebar or chooser is open
and an execution is ongoing; it makes no server requests.

### Keyboard navigation

Run `/subagents`, or choose **Open subagent** in OpenCode's command palette.
No default keyboard shortcut is installed. The command is available in a
session, including when the sidebar is hidden or collapsed.

- Type to search task titles (case-insensitive substring matching).
- Use **↑/↓** to select, **Enter** to open, and **Esc** to cancel.
- The chooser includes the entire current root's descendant tree, regardless
  of whether the sidebar is expanded. It shows bounded tree connectors, live
  statuses, and execution durations; searching may hide a matching task's parent.
- Loading, empty trees, no matches, and request failures have distinct messages.
  Press Enter to retry a load failure. Sessions are rechecked before navigation;
  a failed check keeps the chooser open. If a selected task disappears, use the
  arrows or search to choose another task rather than opening its replacement.
- Events refresh the open chooser. If the list changes during the final read,
  select again. Changing the originating session or replacing/closing the dialog
  cancels pending navigation and releases its subscriptions and local clock.

## Installation

Tested with **OpenCode V2 2.2.5**. CI runs on Linux and macOS; see the
[compatibility record](docs/compatibility.md) for host verification and limits.

### GitHub release

Download `opencode-subagent-monitor-0.2.1.tgz` from the GitHub release,
extract it to a permanent directory, and add the absolute path of the extracted
`package` directory to `cli.json` as shown below. OpenCode supplies the runtime;
the release archive does not need a separate dependency installation.

### Source checkout

Clone this repository and install development dependencies with Bun 1.3.13:

```sh
git clone --branch v0.2.1 https://github.com/1217007627/opencode-subagent-monitor.git
cd opencode-subagent-monitor
bun install --frozen-lockfile
bun run check
bun run package:check
pwd
```

### Enable the plugin

Back up `~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`).
Append the **absolute path to the extracted `package` directory or source checkout**
to its existing `plugins` array. Replace the example path with your own:

```json
{
  "$schema": "https://opencode.ai/v2/cli.json",
  "plugins": ["/absolute/path/to/opencode-subagent-monitor"],
  "session": { "sidebar": "auto" }
}
```

Preserve your other plugins and settings. OpenCode watches this file; use
`/reload` if needed. Open a session and widen the terminal enough for OpenCode's
sidebar to appear. Expand `Task` to see the list; an empty tree shows only
the header.

### npm installation

Version **0.2.1 is published and verified by npm-name loading in OpenCode 2.2.5
on macOS arm64**. Follow [Quick start](#quick-start) to add the pinned package
name to `cli.json`. OpenCode resolves the package; a separate `npm install` in
your project is not needed. Do not enable both the npm package and a local copy.

> **Note:** the compact `Task` header, status icons, creation-time ordering and
> automatic clearing described above are **not yet published to npm**. To use
> them, install from a local build or source checkout as described below.

Version 0.2.0's raw TSX fails when installed by npm name in OpenCode 2.2.5
(`Cannot find package 'react'`). Use 0.2.1's precompiled package; installing React
is not a workaround. The same host-owned Solid/OpenTUI runtime is used.

## Update or disable

For a local checkout, update its branch, run `bun install --frozen-lockfile`, then
`bun run check` (which rebuilds `dist/tui.js`) and `/reload`. For npm, change the pinned version in `cli.json`
after reading its release notes. Remove this plugin's array entry to disable it;
session history is retained by OpenCode.

For a release archive, extract the new version into a new permanent directory,
update the plugin path in `cli.json`, and use `/reload`. For a tagged checkout,
fetch tags and switch to the desired release tag before running the checks.

## Troubleshooting

- No sidebar: check `session.sidebar`, terminal width, and that a session is open.
- `Error` in the header: expand it and click `Retry`; check your connected server is reachable.
- No section: verify the package path and inspect
  `~/.local/share/opencode/log/opencode.log` for plugin loading errors.
- Include OpenCode version, OS, installation method and reproduction steps in an
  [issue](https://github.com/1217007627/opencode-subagent-monitor/issues).
  Remove private task names, paths and credentials from logs.

The plugin reads session metadata and pending-request lists through OpenCode's authenticated client; it
does not read messages, modify sessions, poll the server on a timer, or send telemetry.

## Development

```sh
bun install --frozen-lockfile
bun run build          # compile plugin code; runtime packages remain external
bun run check          # types, lint, formatting, tests
bun run package:check  # inspect actual npm archive and internal imports
bun run format        # apply formatting
```

See [CONTRIBUTING](CONTRIBUTING.md), [architecture](docs/architecture.md),
[release process](docs/releases.md), [changelog](CHANGELOG.md) and
[security policy](SECURITY.md). MIT licensed.
