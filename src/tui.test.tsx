import { expect, test } from "bun:test"
import { testRender } from "@opentui/solid"
import { createSignal } from "solid-js"
import { displayClock } from "../test/clock"
import { contextFixture, form, permission, session } from "../test/context"
import { Sidebar } from "./tui"

type Screen = Awaited<ReturnType<typeof testRender>>
const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/
const ICON = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✗]/

function iconLines(frame: string) {
  return frame.split("\n").filter((line) => ICON.test(line))
}

async function clickText(screen: Screen, text: string) {
  const frame = await screen.waitForFrame((frame) => frame.includes(text))
  const lines = frame.split("\n")
  const y = lines.findIndex((line) => line.includes(text))
  await screen.mockMouse.click((lines[y]?.indexOf(text) ?? 0) + 1, y)
}

async function expandedReady(screen: Screen) {
  return screen.waitForFrame(
    (frame) => frame.includes("▼ Task") && !frame.includes("Loading"),
  )
}

test("tree connectors, clicks and collapsed running count without filter or empty text", async () => {
  const parent = {
    ...session("parent", "root"),
    title: "Research",
    outcome: "succeeded" as const,
  }
  const api = { ...session("api", "parent"), title: "API" }
  const tests = { ...session("tests", "api"), title: "Tests" }
  const docs = {
    ...session("docs", "parent"),
    title: "Docs",
    outcome: "succeeded" as const,
  }
  const f = contextFixture([
    session("root"),
    parent,
    api,
    tests,
    docs,
    session("other", "root"),
  ])
  f.sessionAPI.active = async () => ({ api: { type: "running" } })
  f.forms.push(form("tests"))
  const [id, setId] = createSignal("root")
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID={id()} />,
    { width: 28, height: 14 },
  )
  const all = await expandedReady(screen)
  expect(all).toContain("├─ API")
  expect(all).toContain("│  └─ Tests")
  expect(all).toContain("└─ Docs")
  expect(all.indexOf("Research")).toBeLessThan(all.indexOf("API"))
  expect(all).not.toContain("All (")
  expect(all).not.toContain("Active (")
  expect(all).not.toContain("No subagents")
  expect(all).not.toContain("remaining")
  expect(iconLines(all).filter((line) => SPINNER.test(line))).toHaveLength(2)
  await clickText(screen, "Research")
  await clickText(screen, "│  └─ Tests")
  expect(f.routes).toEqual([
    { type: "session", sessionID: "parent" },
    { type: "session", sessionID: "tests" },
  ])
  const gate = Promise.withResolvers<void>()
  const get = f.sessionAPI.get
  f.sessionAPI.get = async (input) => {
    if (input.sessionID === "tests") await gate.promise
    return get(input)
  }
  setId("tests")
  await screen.waitForFrame((frame) => frame.includes("· Loading…"))
  gate.resolve()
  const navigated = await screen.waitForFrame(
    (frame) => frame.includes("▼ Task") && !frame.includes("Research"),
  )
  expect(navigated).toContain("▼ Task")
  expect(navigated).not.toContain("Research")
  setId("root")
  await screen.waitForFrame((frame) => frame.includes("Research"))
  f.sessionAPI.active = async () => ({})
  f.emit({ id: "finished", type: "server.connected", data: {} })
  const waiting = await screen.waitForFrame((frame) =>
    iconLines(frame).some(
      (line) => SPINNER.test(line) && line.includes("Tests"),
    ),
  )
  expect(waiting).toContain("Tests")
  f.forms.length = 0
  f.emit({ id: "resolved", type: "server.connected", data: {} })
  expect(
    await screen.waitForFrame(
      (frame) =>
        !iconLines(frame).some((line) => SPINNER.test(line)) &&
        frame.includes("Docs"),
    ),
  ).toContain("Docs")
  await clickText(screen, "▼ Task")
  const collapsed = await screen.waitForFrame((frame) =>
    frame.includes("▶ Task (0 running)"),
  )
  expect(collapsed).not.toContain("Research")
  expect(collapsed).not.toContain("waiting")
  expect(collapsed).not.toContain("error")
})

test("deep Unicode trees bind the connector width and keep rows clickable", async () => {
  using clock = displayClock(10_000_000)
  const records = [session("root")]
  for (let i = 0; i < 6; i++)
    records.push({
      ...session(`n${i}`, i ? `n${i - 1}` : "root"),
      title: "Исследование 界界 👩‍💻".repeat(8),
      ...(i === 1
        ? {
            outcome: "interrupted" as const,
            time: { created: 1, updated: 1, busy: 1, idle: 3_600_001 },
          }
        : {}),
      ...(i === 5 ? { time: { created: 1, updated: 1, busy: 9_400_000 } } : {}),
    })
  const f = contextFixture(records)
  f.sessionAPI.active = async () => ({ n5: { type: "running" } })
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 14 },
  )
  const frame = await screen.waitForFrame((frame) => SPINNER.test(frame))
  expect(frame).toContain("…  └─ ")
  expect(frame).toContain("10m 0s")
  expect(frame).toContain("1h 0m")
  const lines = iconLines(frame)
  expect(lines).toHaveLength(6)
  expect(new Set(lines.map((line) => line.search(ICON))).size).toBe(1)
  expect(lines.every((line) => Bun.stringWidth(line.trimEnd()) <= 28)).toBe(
    true,
  )
  expect(clock.active).toBe(2)
  expect(screen.renderer.root.getChildren()[0]?.width).toBeLessThanOrEqual(28)
  const y = frame.split("\n").findIndex((line) => SPINNER.test(line))
  await screen.mockMouse.click(1, y)
  expect(f.routes).toEqual([{ type: "session", sessionID: "n5" }])
})

test.each([28, 40])(
  "icon column aligns and long titles truncate at width %d",
  async (width) => {
    using clock = displayClock(1_000_000)
    const records = [
      {
        ...session("short", "root"),
        outcome: "succeeded" as const,
        time: { created: 1, updated: 1, busy: 1, idle: 25_001 },
      },
      {
        ...session("long", "root"),
        outcome: "succeeded" as const,
        time: { created: 2, updated: 2, busy: 1, idle: 217_001 },
      },
      {
        ...session("stopped", "root"),
        outcome: "interrupted" as const,
        time: { created: 3, updated: 3, busy: 1, idle: 60_001 },
      },
      {
        ...session("live", "root"),
        time: { created: 4, updated: 4, busy: 941_000 },
      },
      session("pending", "root"),
    ]
    const f = contextFixture([session("root"), ...records])
    f.sessionAPI.active = async () => ({ live: { type: "running" } })
    f.forms.push(form("pending"))
    await using screen = await testRender(
      () => <Sidebar context={f.context} sessionID="root" />,
      { width, height: 12 },
    )
    const frame = await screen.waitForFrame((frame) => SPINNER.test(frame))
    const lines = iconLines(frame)
    expect(lines).toHaveLength(5)
    expect(new Set(lines.map((line) => line.search(ICON))).size).toBe(1)
    for (const line of lines)
      expect(Bun.stringWidth(line.trimEnd())).toBeLessThanOrEqual(width)
    expect(lines.filter((line) => SPINNER.test(line))).toHaveLength(2)
    expect(lines.filter((line) => line.includes("✓"))).toHaveLength(2)
    expect(lines.filter((line) => line.includes("✗"))).toHaveLength(1)
    for (const duration of ["25s", "3m 37s", "1m 0s", "—"])
      expect(lines.some((line) => line.trimEnd().endsWith(duration))).toBe(true)
    expect(
      new Set(lines.map((line) => Bun.stringWidth(line.trimEnd()))).size,
    ).toBe(1)
    clock.advance(100)
    const spinnerFrame = await screen.waitForFrame((frame) =>
      frame.includes("⠙"),
    )
    expect(iconLines(spinnerFrame)).toHaveLength(5)
    clock.advance(1_000)
    const next = await screen.waitForFrame((frame) => frame.includes("1m 0s"))
    expect(iconLines(next)).toHaveLength(5)
    const y = next.split("\n").findIndex((line) => line.includes("stopped"))
    await screen.mockMouse.click(2, y)
    expect(f.routes).toEqual([{ type: "session", sessionID: "stopped" }])
  },
)

test("spinner ticks only while visible, stops on terminal states and restarts on rerun", async () => {
  using clock = displayClock(10_000)
  const child = {
    ...session("child", "root"),
    title: "Исследование 界界 👩‍💻".repeat(8),
    time: { created: 1, updated: 1, busy: 10_000, idle: 9_000 },
    outcome: "failed" as const,
  }
  const f = contextFixture([session("root"), child])
  f.sessionAPI.active = async () => ({ child: { type: "running" } })
  const screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  try {
    await screen.waitForFrame((frame) => SPINNER.test(frame))
    expect(clock.active).toBe(2)
    clock.advance(100)
    const frame = await screen.waitForFrame((frame) => frame.includes("⠙"))
    expect(screen.renderer.root.getChildren()[0]?.width).toBeLessThanOrEqual(28)
    const y = frame.split("\n").findIndex((line) => SPINNER.test(line))
    await screen.mockMouse.click(2, y)
    expect(f.routes).toEqual([{ type: "session", sessionID: "child" }])
    await clickText(screen, "▼ Task")
    await screen.waitForFrame((frame) => frame.includes("▶ Task"))
    expect(clock.active).toBe(0)
    child.time.idle = 145_000
    f.sessionAPI.active = async () => ({})
    f.emit({ id: "end", type: "server.connected", data: {} })
    await clickText(screen, "▶ Task")
    await screen.waitForFrame((frame) => frame.includes("✗"))
    expect(clock.active).toBe(0)
    child.time.busy = 155_000
    f.sessionAPI.active = async () => ({ child: { type: "running" } })
    f.emit({ id: "rerun", type: "server.connected", data: {} })
    await screen.waitForFrame((frame) => SPINNER.test(frame))
    expect(clock.active).toBe(2)
    f.forms.push(form("child"))
    f.emit({
      id: "form",
      created: 155_000,
      type: "form.created",
      data: { form: form("child") },
    })
    await screen.flush()
    expect(SPINNER.test(screen.captureCharFrame())).toBe(true)
    const list = f.formAPI.list
    f.formAPI.list = async () => {
      throw new Error("offline")
    }
    f.emit({ id: "offline", type: "server.connected", data: {} })
    await screen.waitForFrame((frame) =>
      frame.includes("Unable to load subagents"),
    )
    expect(clock.active).toBe(0)
    f.formAPI.list = list
    await clickText(screen, "Retry")
    await screen.waitForFrame((frame) => SPINNER.test(frame))
    expect(clock.active).toBe(2)
  } finally {
    await screen.dispose()
  }
  expect(clock.active).toBe(0)
  expect(f.listeners.size).toBe(0)
})

test("status icons restore after navigation/reconnect and idle shows a cross", async () => {
  using clock = displayClock(200_000)
  const child = {
    ...session("child", "root"),
    time: { created: 1, updated: 1, busy: 10_000, idle: 100_000 },
    outcome: "succeeded" as const,
  }
  const f = contextFixture([
    session("root"),
    child,
    session("other"),
    session("unknown", "other"),
  ])
  const [selected, select] = createSignal("root")
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID={selected()} />,
    { width: 28, height: 10 },
  )
  expect(
    await screen.waitForFrame((frame) =>
      iconLines(frame).some(
        (line) => line.includes("✓") && line.includes("child"),
      ),
    ),
  ).toContain("1m 30s")
  f.forms.push(form("child"))
  f.emit({ id: "pending", type: "server.connected", data: {} })
  await screen.waitForFrame((frame) =>
    iconLines(frame).some(
      (line) => SPINNER.test(line) && line.includes("child"),
    ),
  )
  f.forms.length = 0
  select("other")
  expect(
    await screen.waitForFrame((frame) =>
      iconLines(frame).some((line) => line.includes("✗")),
    ),
  ).toContain("—")
  select("child")
  await screen.waitForFrame((frame) =>
    iconLines(frame).some(
      (line) => line.includes("✓") && line.includes("child"),
    ),
  )
  child.time.busy = 205_000
  clock.advance(10_000)
  f.sessionAPI.active = async () => ({ child: { type: "running" } })
  f.emit({ id: "reconnect", type: "server.connected", data: {} })
  await screen.waitForFrame((frame) =>
    iconLines(frame).some(
      (line) => SPINNER.test(line) && line.includes("child"),
    ),
  )
  expect(screen.captureCharFrame()).toContain("5s")
})

test("terminal titles are muted while running titles stay bright", async () => {
  const f = contextFixture([
    session("root"),
    { ...session("running-child", "root"), outcome: "failed" },
    { ...session("done-child", "root"), outcome: "succeeded" },
    { ...session("error-child", "root"), outcome: "failed" },
    { ...session("interrupted-child", "root"), outcome: "interrupted" },
  ])
  f.sessionAPI.active = async () => ({ "running-child": { type: "running" } })
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 40, height: 10 },
  )
  await expandedReady(screen)
  const spans = screen.captureSpans().lines.flatMap((line) => line.spans)
  const titleFg = (name: string) =>
    spans.find((span) => span.text.includes(name))?.fg
  expect(titleFg("running-child")?.equals(f.context.theme.text.base)).toBe(true)
  expect(titleFg("done-child")?.equals(f.context.theme.text.muted)).toBe(true)
  expect(titleFg("error-child")?.equals(f.context.theme.text.muted)).toBe(true)
  expect(titleFg("interrupted-child")?.equals(f.context.theme.text.muted)).toBe(
    true,
  )
})

test("complete history stays visible with narrow Unicode navigation", async () => {
  const running = {
    ...session("running", "root"),
    title: "Исследование 界界 👩‍💻".repeat(8),
  }
  const f = contextFixture([
    session("root"),
    running,
    { ...session("finished", "root"), title: "History", outcome: "succeeded" },
  ])
  f.sessionAPI.active = async () => {
    return { running: { type: "running" } }
  }
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  const all = await expandedReady(screen)
  expect(all).toContain("History")
  expect(SPINNER.test(all)).toBe(true)
  expect(all).not.toContain("All (")
  expect(all).not.toContain("Active (")
  expect(screen.renderer.root.getChildren()[0]?.width).toBeLessThanOrEqual(28)
  await screen.mockMouse.click(
    2,
    all.split("\n").findIndex((line) => SPINNER.test(line)),
  )
  expect(f.routes).toEqual([{ type: "session", sessionID: "running" }])
})

test("collapsed header shows only running count; expanded shows every status icon", async () => {
  const f = contextFixture([
    session("root"),
    {
      ...session("waiting", "root"),
      title: "Ожидание 界界 👩‍💻".repeat(8),
      outcome: "failed",
    },
    { ...session("running", "root"), title: "Working", outcome: "failed" },
    { ...session("failed", "root"), title: "Failure", outcome: "failed" },
  ])
  f.sessionAPI.active = async () => ({
    waiting: { type: "running" },
    running: { type: "running" },
  })
  f.permissions.push(permission("waiting", "p1"), permission("waiting", "p2"))
  f.forms.push(form("waiting"))
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 12 },
  )
  await clickText(screen, "▼ Task")
  const collapsed = await screen.waitForFrame((frame) =>
    frame.includes("▶ Task (1 running)"),
  )
  expect(collapsed).not.toContain("waiting")
  expect(collapsed).not.toContain("error")
  expect(collapsed).not.toContain("Failure")
  await clickText(screen, "▶ Task")
  const expanded = await screen.waitForFrame(
    (frame) =>
      iconLines(frame).filter((line) => SPINNER.test(line)).length === 2,
  )
  expect(iconLines(expanded).filter((line) => line.includes("✗"))).toHaveLength(
    1,
  )
  expect(screen.renderer.root.getChildren()[0]?.width).toBeLessThanOrEqual(28)
  await screen.mockMouse.click(
    2,
    expanded.split("\n").findIndex((line) => line.includes("Ожидание")),
  )
  expect(f.routes).toEqual([{ type: "session", sessionID: "waiting" }])
  await clickText(screen, "▼ Task")
  f.permissions.length = 0
  f.forms.length = 0
  f.emit({
    id: "reply",
    created: 1,
    type: "form.replied",
    data: { sessionID: "waiting", id: "form", answer: {} },
  })
  const resolved = await screen.waitForFrame((frame) =>
    frame.includes("▶ Task (2 running)"),
  )
  expect(resolved).not.toContain("waiting")
  expect(resolved).not.toContain("error")
})

test("multi-digit running count fits the collapsed header at 28 columns", async () => {
  const running = Array.from({ length: 10 }, (_, i) =>
    session(`running-${i}`, "root"),
  )
  const f = contextFixture([session("root"), ...running])
  f.sessionAPI.active = async () =>
    Object.fromEntries(
      running.map(({ id }) => [id, { type: "running" as const }]),
    )
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 8 },
  )
  await clickText(screen, "▼ Task")
  const frame = await screen.waitForFrame((frame) =>
    frame.includes("▶ Task (10 running)"),
  )
  expect(frame).toContain("▶ Task (10 running)")
  expect(screen.renderer.root.getChildren()[0]?.width).toBeLessThanOrEqual(28)
})

test("attention read failure replaces stale rows and Retry recovers", async () => {
  const f = contextFixture()
  f.forms.push(form("child"))
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 12 },
  )
  await screen.waitForFrame((frame) => SPINNER.test(frame))
  const list = f.formAPI.list
  f.formAPI.list = async () => {
    throw new Error("private response")
  }
  f.emit({ id: "reconnect", type: "server.connected", data: {} })
  const failed = await screen.waitForFrame((frame) => frame.includes("Retry"))
  expect(failed).toContain("Unable to load subagents")
  expect(failed).not.toContain("⠋")
  expect(failed).not.toContain("No active")
  expect(failed).not.toContain("private")
  f.formAPI.list = list
  await clickText(screen, "Retry")
  expect(
    await screen.waitForFrame((frame) =>
      iconLines(frame).some(
        (line) => SPINNER.test(line) && line.includes("child"),
      ),
    ),
  ).toContain("Task")
})

test("collapsed running count stays synchronized and completed rows remain visible", async () => {
  const child = { ...session("child", "root"), title: "Work" }
  const f = contextFixture([session("root"), child])
  f.sessionAPI.active = async () => ({ child: { type: "running" } })
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  await clickText(screen, "▼ Task")
  f.records[1] = { ...child, outcome: "succeeded" }
  f.sessionAPI.active = async () => ({})
  f.emit({
    id: "completed",
    created: 1,
    type: "session.execution.succeeded",
    durable: { aggregateID: "child", seq: 1, version: 1 },
    data: { sessionID: "child" },
  })
  const collapsed = await screen.waitForFrame((frame) =>
    frame.includes("▶ Task (0 running)"),
  )
  expect(collapsed).not.toContain("Work")
  await clickText(screen, "▶ Task")
  const restored = await screen.waitForFrame((frame) => frame.includes("Work"))
  expect(restored).toContain("✓")
  expect(restored).not.toContain("No subagents")
})

test("collapsed choice survives root changes and remounts, isolated by context", async () => {
  const f = contextFixture([
    session("root"),
    session("child", "root"),
    session("empty"),
  ])
  const [id, setId] = createSignal("root")
  const screen = await testRender(
    () => <Sidebar context={f.context} sessionID={id()} />,
    { width: 28, height: 10 },
  )
  try {
    expect(await expandedReady(screen)).toContain("child")
    await clickText(screen, "▼ Task")
    await screen.waitForFrame(
      (frame) => frame.includes("▶ Task") && !frame.includes("child"),
    )
    setId("empty")
    const empty = await screen.waitForFrame((frame) => frame.includes("▶ Task"))
    expect(empty).not.toContain("child")
    expect(empty).not.toContain("No subagents")
  } finally {
    await screen.dispose()
  }
  await using remount = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  expect(
    await remount.waitForFrame((frame) => frame.includes("▶ Task")),
  ).not.toContain("child")
  const fresh = contextFixture()
  await using reset = await testRender(
    () => <Sidebar context={fresh.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  expect(
    await reset.waitForFrame((frame) => frame.includes("child")),
  ).toContain("▼ Task")
})

test("renders restored rows, keeps Unicode titles inside 28 columns, navigates on click", async () => {
  const f = contextFixture()
  const child = f.records[1]
  if (child) {
    child.title = "Исследование 界界界 👩‍💻 ".repeat(8)
    child.outcome = "succeeded"
  }
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  const frame = await screen.waitForFrame((frame) => frame.includes("✓"))
  expect(frame).toContain("Task")
  expect(frame).toContain("✓")
  expect(screen.renderer.root.getChildren()[0]?.width).toBeLessThanOrEqual(28)
  const rowY = frame.split("\n").findIndex((line) => line.includes("✓"))
  await screen.mockMouse.click(2, rowY)
  expect(f.routes).toEqual([{ type: "session", sessionID: "child" }])
})

test("loading, empty, prop change, and cleanup use the real Solid lifecycle", async () => {
  const f = contextFixture([
    session("root"),
    session("other"),
    session("child", "other"),
  ])
  const pending = Promise.withResolvers<ReturnType<typeof session>>()
  const get = f.sessionAPI.get
  f.sessionAPI.get = (input) =>
    input.sessionID === "root" ? pending.promise : get(input)
  const [id, setId] = createSignal("root")
  const screen = await testRender(
    () => <Sidebar context={f.context} sessionID={id()} />,
    { width: 28, height: 10 },
  )
  try {
    await screen.waitForFrame((frame) => frame.includes("Loading"))
    pending.resolve(session("root"))
    const empty = await expandedReady(screen)
    expect(empty).toContain("▼ Task")
    expect(empty).not.toContain("child")
    expect(empty).not.toContain("No subagents")
    setId("other")
    expect(
      await screen.waitForFrame((frame) => frame.includes("child")),
    ).toContain("✗")
  } finally {
    await screen.dispose()
  }
  expect(f.listeners.size).toBe(0)
})

test("failed load offers working retry", async () => {
  const f = contextFixture()
  const get = f.sessionAPI.get
  f.sessionAPI.get = async () => {
    throw new Error("sensitive raw details")
  }
  await using screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  const frame = await screen.waitForFrame((frame) => frame.includes("Retry"))
  expect(frame).toContain("Unable to load subagents")
  expect(frame).not.toContain("sensitive")
  f.sessionAPI.get = get
  await screen.mockMouse.click(
    2,
    frame.split("\n").findIndex((line) => line.includes("Retry")),
  )
  expect(
    await screen.waitForFrame((frame) => frame.includes("child")),
  ).toContain("✗")
})

test("starts expanded, updates running count while hidden and preserves choice on remount", async () => {
  const f = contextFixture()
  const screen = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  try {
    expect(await expandedReady(screen)).toContain("child")
    await clickText(screen, "▼ Task")
    const collapsed = await screen.waitForFrame((frame) =>
      frame.includes("▶ Task"),
    )
    expect(collapsed).toContain("▶ Task (0 running)")
    expect(collapsed).not.toContain("child")
    f.sessionAPI.active = async () => ({ child: { type: "running" } })
    f.emit({ id: "connected", type: "server.connected", data: {} })
    const live = await screen.waitForFrame((frame) =>
      frame.includes("▶ Task (1 running)"),
    )
    expect(live).not.toContain("child")
    await screen.mockMouse.click(2, 1)
    expect(
      await screen.waitForFrame((frame) => frame.includes("child")),
    ).toContain("▼ Task")
    await screen.mockMouse.click(2, 1)
    expect(
      await screen.waitForFrame((frame) => frame.includes("▶ Task")),
    ).not.toContain("child")
    await screen.mockMouse.click(2, 1)
    await screen.waitForFrame((frame) => frame.includes("child"))
  } finally {
    await screen.dispose()
  }
  await using remount = await testRender(
    () => <Sidebar context={f.context} sessionID="root" />,
    { width: 28, height: 10 },
  )
  expect(
    await remount.waitForFrame((frame) => frame.includes("child")),
  ).toContain("▼ Task")
})
