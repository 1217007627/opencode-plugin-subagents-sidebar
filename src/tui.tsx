import { Plugin } from "@opencode/plugin/tui"
import type { KeyEvent } from "@opentui/core"
import type { JSX } from "@opentui/solid"
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  Match,
  onCleanup,
  type Signal,
  Show,
  Switch,
} from "solid-js"
import { createController, type View } from "./controller"
import { formatDuration, type Row, treeRows } from "./model"
import { createOpenCodeSource } from "./opencode-source"

// Preferences survive sidebar unmounts and navigation within a plugin context.
// Weak keys release the state when OpenCode unloads the plugin context.
type Filter = "all" | "active"
const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const
const preferences = new WeakMap<
  Plugin.Context,
  {
    expanded: Signal<boolean>
    filter: Signal<Filter>
  }
>()
export function Sidebar(props: {
  context: Plugin.Context
  sessionID: string
}): JSX.Element {
  let preference = preferences.get(props.context)
  if (!preference) {
    preference = {
      expanded: createSignal(true),
      filter: createSignal<Filter>("all"),
    }
    preferences.set(props.context, preference)
  }
  const [expanded, setExpanded] = preference.expanded
  const [filter] = preference.filter
  const [view, setView] = createSignal<View>({ phase: "loading", rows: [] })
  const runningCount = createMemo(
    () => view().rows.filter((row) => row.status === "Running").length,
  )
  const visibleRows = createMemo(() =>
    treeRows(view().rows, filter() === "active"),
  )
  const contextCount = createMemo(
    () => visibleRows().filter((row) => row.context).length,
  )
  const [now, setNow] = createSignal(Date.now())
  const durationWidth = createMemo(() => {
    let width = 0
    for (const row of visibleRows())
      width = Math.max(width, formatDuration(row.duration, now()).length)
    return width
  })
  const [frame, setFrame] = createSignal(0)
  const animating = createMemo(
    () =>
      view().phase === "ready" &&
      visibleRows().some(
        (row) => row.status === "Running" || row.status === "Waiting",
      ),
  )
  createEffect(() => {
    if (!expanded() || !animating()) return
    const timer = setInterval(
      () => setFrame((value) => (value + 1) % SPINNER_FRAMES.length),
      100,
    )
    onCleanup(() => clearInterval(timer))
  })
  createEffect(() => {
    if (!expanded() || view().phase !== "ready") return
    setNow(Date.now())
    if (
      !visibleRows().some(
        (row) => row.duration && row.duration.end === undefined,
      )
    )
      return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => clearInterval(timer))
  })
  const controller = createController(
    createOpenCodeSource(props.context),
    setView,
  )
  createEffect(() => {
    void controller.select(props.sessionID)
  })
  onCleanup(() => controller.dispose())
  const icon = (row: Row) => {
    switch (row.status) {
      case "Running":
      case "Waiting":
        return SPINNER_FRAMES[frame() % SPINNER_FRAMES.length] ?? ""
      case "Done":
        return "✓"
      default:
        return "✗"
    }
  }
  const iconColor = (row: Row) => {
    const text = props.context.theme.text
    switch (row.status) {
      case "Running":
      case "Waiting":
        return text.feedback.success.base
      case "Done":
        return text.muted
      default:
        return text.feedback.error.base
    }
  }
  return (
    <box width="100%" flexDirection="column" marginTop={1} flexShrink={0}>
      <text
        fg={props.context.theme.text.base}
        truncate
        wrapMode="none"
        onMouseUp={(event) => {
          if (event.button === 0) setExpanded((value) => !value)
        }}
      >
        <b>{expanded() ? "▼" : "▶"} Task</b>
        {view().phase === "ready"
          ? expanded()
            ? ""
            : ` (${runningCount()} running)`
          : view().phase === "loading"
            ? " · Loading…"
            : " · Error"}
      </text>
      <Show when={expanded()}>
        <Switch>
          <Match when={view().phase === "loading"}>
            <text fg={props.context.theme.text.muted}>Loading…</text>
          </Match>
          <Match when={view().phase === "error"}>
            <text fg={props.context.theme.text.muted}>
              Unable to load subagents
            </text>
            <text
              fg={props.context.theme.text.base}
              onMouseUp={(event) => {
                if (event.button === 0) void controller.refresh()
              }}
            >
              Retry
            </text>
          </Match>
          <Match when={view().phase === "ready"}>
            <Show when={contextCount() > 0}>
              <text fg={props.context.theme.text.muted}>
                {`+ ${contextCount()} context (·)`}
              </text>
            </Show>
            <For each={visibleRows()}>
              {(row) => (
                <box
                  height={1}
                  width="100%"
                  flexDirection="row"
                  gap={1}
                  onMouseUp={(event) => {
                    if (event.button === 0)
                      props.context.ui.router.navigate({
                        type: "session",
                        sessionID: row.id,
                      })
                  }}
                >
                  <text
                    width={1}
                    flexShrink={0}
                    wrapMode="none"
                    fg={iconColor(row)}
                  >
                    {icon(row)}
                  </text>
                  <box
                    flexGrow={1}
                    flexShrink={1}
                    minWidth={0}
                    flexDirection="row"
                  >
                    <Show when={row.prefix}>
                      <text
                        flexShrink={0}
                        width={row.prefix.length}
                        wrapMode="none"
                        fg={props.context.theme.text.muted}
                      >
                        {row.prefix}
                      </text>
                    </Show>
                    <Show when={row.context}>
                      <text
                        flexShrink={0}
                        width={2}
                        wrapMode="none"
                        fg={props.context.theme.text.muted}
                      >
                        ·{" "}
                      </text>
                    </Show>
                    <text
                      flexGrow={1}
                      flexShrink={1}
                      minWidth={0}
                      truncate
                      wrapMode="none"
                      fg={
                        row.context ||
                        row.status === "Done" ||
                        row.status === "Error" ||
                        row.status === "Interrupted"
                          ? props.context.theme.text.muted
                          : row.status === "Running" || row.status === "Waiting"
                            ? props.context.theme.text.feedback.success.base
                            : props.context.theme.text.base
                      }
                    >
                      {row.title.replace(/[\r\n\t]/g, " ")}
                    </text>
                  </box>
                  <text
                    width={durationWidth()}
                    flexShrink={0}
                    textAlign="right"
                    wrapMode="none"
                    fg={props.context.theme.text.muted}
                  >
                    {formatDuration(row.duration, now())}
                  </text>
                </box>
              )}
            </For>
          </Match>
        </Switch>
      </Show>
    </box>
  )
}

function SubagentPicker(props: {
  context: Plugin.Context
  sessionID: string
  isOpen: () => boolean
  close: () => void
}): JSX.Element {
  const [view, setView] = createSignal<View>({ phase: "loading", rows: [] })
  const [query, setQuery] = createSignal("")
  const [selected, setSelected] = createSignal<string>()
  const [opening, setOpening] = createSignal(false)
  const [message, setMessage] = createSignal("")
  const source = createOpenCodeSource(props.context)
  let revision = 0
  let selectionRevision = 0
  let disposed = false
  const controller = createController(
    {
      ...source,
      subscribe(listener) {
        return source.subscribe((change) => {
          revision++
          listener(change)
        })
      },
    },
    setView,
  )
  const rows = createMemo(() =>
    treeRows(view().rows, false).filter((row) =>
      row.title.toLowerCase().includes(query().trim().toLowerCase()),
    ),
  )
  const index = () =>
    Math.max(
      0,
      rows().findIndex((row) => row.id === selected()),
    )
  const [now, setNow] = createSignal(Date.now())
  createEffect(() => {
    if (view().phase !== "ready") return
    const visible = rows()
    setNow(Date.now())
    if (!visible.some((row) => row.duration && row.duration.end === undefined))
      return
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    onCleanup(() => clearInterval(timer))
  })
  createEffect(() => {
    if (selected() === undefined && rows().length) setSelected(rows()[0]?.id)
  })
  const current = () => {
    const route = props.context.ui.router.current()
    return (
      !disposed &&
      props.isOpen() &&
      route.type === "session" &&
      route.sessionID === props.sessionID
    )
  }
  createEffect(() => {
    if (!current()) props.close()
  })
  void controller.select(props.sessionID)
  onCleanup(() => {
    disposed = true
    controller.dispose()
  })
  function select(id: string | undefined) {
    selectionRevision++
    setSelected(id)
  }
  function handleKeyDown(event: KeyEvent) {
    if (event.name === "escape") {
      event.preventDefault()
      props.close()
    }
    if (event.name === "return" || event.name === "linefeed") {
      event.preventDefault()
      void choose()
    }
    if (event.name === "up" || event.name === "down") {
      event.preventDefault()
      const next = Math.max(
        0,
        Math.min(rows().length - 1, index() + (event.name === "up" ? -1 : 1)),
      )
      select(rows()[next]?.id)
    }
  }
  async function choose() {
    const id = selected()
    if (!current() || opening()) return
    if (view().phase === "error") {
      setMessage("")
      await controller.refresh()
      return
    }
    if (view().phase !== "ready" || !id) return
    if (!rows().some((row) => row.id === id)) {
      setMessage("Selection changed. Use arrows to select a task.")
      return
    }
    const version = revision
    const selectionVersion = selectionRevision
    setOpening(true)
    setMessage("")
    try {
      const record = await source.get(id)
      if (!current()) return
      if (
        record.id !== id ||
        version !== revision ||
        selectionVersion !== selectionRevision ||
        !view().rows.some((row) => row.id === id)
      ) {
        setMessage("List changed. Select again.")
        return
      }
      props.close()
      props.context.ui.router.navigate({ type: "session", sessionID: id })
    } catch {
      if (current()) {
        setMessage("Unable to open subagent. Select again to retry.")
        void controller.refresh()
      }
    } finally {
      if (current()) setOpening(false)
    }
  }
  return (
    <box
      width="100%"
      flexDirection="column"
      padding={1}
      gap={1}
      backgroundColor={props.context.theme.background.raised.base}
    >
      <text fg={props.context.theme.text.base}>
        <b>Open subagent</b>
      </text>
      <input
        focused
        placeholder="Search task titles…"
        textColor={props.context.theme.text.base}
        focusedTextColor={props.context.theme.text.base}
        backgroundColor={props.context.theme.background.raised.high}
        focusedBackgroundColor={props.context.theme.background.raised.high}
        onInput={(value) => {
          setQuery(value)
          select(undefined)
        }}
        onSubmit={() => {
          void choose()
        }}
        onKeyDown={handleKeyDown}
      />
      <Switch>
        <Match when={view().phase === "loading"}>
          <text>Loading subagents…</text>
        </Match>
        <Match when={view().phase === "error"}>
          <text>Unable to load subagents. Enter to retry.</text>
        </Match>
        <Match when={view().phase === "ready" && !rows().length}>
          <text>
            {view().rows.length ? "No matching subagents" : "No subagents"}
          </text>
        </Match>
        <Match when={view().phase === "ready" && rows().length}>
          <select
            height={Math.min(10, rows().length * 2)}
            width="100%"
            options={rows().map((row) => ({
              name: `${row.prefix}${row.title.replace(/[\r\n\t]/g, " ")}`,
              description: `${row.status} · ${formatDuration(row.duration, now())}`,
              value: row.id,
            }))}
            selectedIndex={index()}
            onKeyDown={(event) => {
              // Keep both focus targets on the same ID-based selection path.
              // Native select bindings otherwise maintain a separate index.
              event.preventDefault()
              handleKeyDown(event)
            }}
            textColor={props.context.theme.text.base}
            descriptionColor={props.context.theme.text.muted}
            selectedTextColor={props.context.theme.text.base}
            selectedDescriptionColor={props.context.theme.text.base}
            backgroundColor={props.context.theme.background.raised.base}
            selectedBackgroundColor={props.context.theme.background.raised.max}
            onSelect={() => void choose()}
          />
        </Match>
      </Switch>
      <Show when={message()}>
        <text fg={props.context.theme.text.feedback.warning.base}>
          {message()}
        </text>
      </Show>
      <text fg={props.context.theme.text.muted}>
        {opening() ? "Opening…" : "↑/↓ select · Enter open/retry · Esc cancel"}
      </text>
    </box>
  )
}

export default Plugin.define({
  id: "opencode.task-sidebar",
  setup(context) {
    let disposed = false
    let closePicker: (() => void) | undefined
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "opencode.task-sidebar.open",
          title: "Open subagent",
          group: "Task",
          palette: true,
          slash: { name: "subagents" },
          enabled: () =>
            !disposed && context.ui.router.current().type === "session",
          run() {
            const route = context.ui.router.current()
            if (disposed || route.type !== "session") return
            closePicker?.()
            let open = true
            const close = () => {
              if (open) {
                open = false
                context.ui.dialog.clear()
              }
            }
            closePicker = close
            context.ui.dialog.show(
              () => (
                <SubagentPicker
                  context={context}
                  sessionID={route.sessionID}
                  isOpen={() => open}
                  close={close}
                />
              ),
              () => {
                open = false
              },
            )
            context.ui.dialog.set({ size: "large" })
          },
        },
      ],
    }))
    const removeSlot = context.ui.slot({
      append: "sidebar.content",
      render: (props) => (
        <Sidebar context={context} sessionID={props.sessionID} />
      ),
    })
    return () => {
      disposed = true
      closePicker?.()
      removeSlot()
    }
  },
})
