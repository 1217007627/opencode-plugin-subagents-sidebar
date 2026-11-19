export type SessionRecord = {
  id: string
  parentID?: string
  title?: string
  time: { created: number; updated: number; busy?: number; idle?: number }
  outcome?: "succeeded" | "failed" | "interrupted"
}

export type LiveStatus =
  | "running"
  | "idle"
  | "unknown"
  | { type: "waiting"; execution: "running" | "idle" }
export type ExecutionDuration = { start: number; end?: number }
export type Row = {
  id: string
  parentID?: string
  title: string
  status:
    | "Running"
    | "Waiting"
    | "Done"
    | "Error"
    | "Interrupted"
    | "Idle"
    | "Unknown"
  active: boolean
  duration?: ExecutionDuration
}

export type TreeRow = Row & { prefix: string; context: boolean }

export function treeRows(rows: readonly Row[], activeOnly: boolean): TreeRow[] {
  // buildRows supplies a cycle-free preorder, so one reverse pass keeps ancestors.
  const keep = new Set<string>()
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i]
    if (!row || (activeOnly && !row.active && !keep.has(row.id))) continue
    keep.add(row.id)
    if (row.parentID) keep.add(row.parentID)
  }
  const children = new Map<string | undefined, Row[]>()
  for (const row of rows) {
    if (!keep.has(row.id)) continue
    const siblings = children.get(row.parentID) ?? []
    siblings.push(row)
    children.set(row.parentID, siblings)
  }
  type Entry = { row: Row; depth: number; last: boolean; prefix: string }
  const stack: Entry[] = []
  const pushChildren = (parent?: Entry) => {
    const siblings = children.get(parent?.row.id) ?? []
    const depth = parent ? parent.depth + 1 : 0
    for (let i = siblings.length - 1; i >= 0; i--) {
      const row = siblings[i]
      if (!row) continue
      const last = i === siblings.length - 1
      const connector = last ? "└─ " : "├─ "
      const prefix =
        depth === 0
          ? ""
          : depth === 1
            ? connector
            : depth === 2
              ? `${parent?.last ? "   " : "│  "}${connector}`
              : `…  ${connector}`
      stack.push({ row, depth, last, prefix })
    }
  }
  pushChildren()
  const result: TreeRow[] = []
  while (stack.length) {
    const entry = stack.pop()
    if (!entry) break
    result.push({
      ...entry.row,
      prefix: entry.prefix,
      context: activeOnly && !entry.row.active,
    })
    pushChildren(entry)
  }
  return result
}

function executionDuration(
  session: SessionRecord,
  live: LiveStatus,
): ExecutionDuration | undefined {
  const execution = typeof live === "object" ? live.execution : live
  const { busy, idle } = session.time
  if (
    execution === "unknown" ||
    busy === undefined ||
    !Number.isFinite(busy) ||
    busy < 0 ||
    (idle !== undefined && (!Number.isFinite(idle) || idle < 0))
  )
    return undefined

  // busy starts the latest execution; idle can still belong to the previous one.
  if (idle !== undefined && idle >= busy) {
    if (execution === "running" || !session.outcome) return undefined
    return { start: busy, end: idle }
  }
  if (execution === "running") return { start: busy }
  return undefined
}

export function formatDuration(
  duration: ExecutionDuration | undefined,
  now: number,
): string {
  if (!duration) return "—"
  const { start, end = now } = duration
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    !Number.isFinite(now) ||
    start < 0 ||
    end < start ||
    end > now
  )
    return "—"
  const seconds = Math.floor((end - start) / 1_000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const days = Math.floor(hours / 24)
  if (days >= 1_000) return "999d+"
  if (days) return `${days}d ${hours % 24}h`
  if (hours) return `${hours}h ${minutes % 60}m`
  if (minutes) return `${minutes}m ${seconds % 60}s`
  return `${seconds}s`
}

export function buildRows(
  rootID: string,
  sessions: readonly SessionRecord[],
  statuses: ReadonlyMap<string, LiveStatus>,
  now?: number,
): Row[] {
  const records = new Map(sessions.map((session) => [session.id, session]))
  const children = new Map<string, SessionRecord[]>()
  for (const session of records.values()) {
    if (!session.parentID) continue
    const siblings = children.get(session.parentID) ?? []
    siblings.push(session)
    children.set(session.parentID, siblings)
  }
  const visited = new Set([rootID])
  const queue = [rootID]
  const descendants: SessionRecord[] = []
  for (let i = 0; i < queue.length; i++) {
    for (const child of children.get(queue[i] ?? "") ?? []) {
      if (visited.has(child.id)) continue
      visited.add(child.id)
      queue.push(child.id)
      descendants.push(child)
    }
  }
  const active = (id: string) => {
    const live = statuses.get(id)
    return live === "running" || typeof live === "object"
  }
  const statusFor = (session: SessionRecord): Row["status"] => {
    const live = statuses.get(session.id) ?? "unknown"
    const outcome = {
      succeeded: "Done",
      failed: "Error",
      interrupted: "Interrupted",
    } as const
    if (typeof live === "object") return "Waiting"
    if (live === "running") return "Running"
    if (live === "unknown") return "Unknown"
    return session.outcome ? outcome[session.outcome] : "Idle"
  }
  const timeOf = (session: SessionRecord) =>
    session.time.updated || session.time.created
  const hidden = new Set<string>()
  const MIN_PLAUSIBLE_TIME = 1_000_000_000_000
  if (now !== undefined && now >= MIN_PLAUSIBLE_TIME) {
    for (const session of descendants) {
      const stamp = timeOf(session)
      if (stamp < MIN_PLAUSIBLE_TIME) continue
      const status = statusFor(session)
      const threshold =
        status === "Done" ? 2 * 60 * 60 * 1000 : 96 * 60 * 60 * 1000
      if (now - stamp > threshold) hidden.add(session.id)
    }
  }
  // Cap the visible tasks: hide the oldest non-active ones until at most 15 remain.
  const visible = descendants.filter((session) => !hidden.has(session.id))
  if (visible.length > 15) {
    const oldestFirst = [...visible].sort(
      (a, b) =>
        a.time.created - b.time.created ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    let hiddenCount = 0
    for (const session of oldestFirst) {
      if (visible.length - hiddenCount <= 15) break
      if (active(session.id)) continue
      hidden.add(session.id)
      hiddenCount++
    }
  }
  const keep = new Set(
    descendants.filter((session) => !hidden.has(session.id)).map((s) => s.id),
  )
  for (let i = descendants.length - 1; i >= 0; i--) {
    const row = descendants[i]
    if (!row || !keep.has(row.id)) continue
    if (row.parentID) keep.add(row.parentID)
  }
  const shownTree = new Map<string, SessionRecord[]>()
  for (const session of descendants) {
    if (!keep.has(session.id)) continue
    const parent = session.parentID ?? ""
    const siblings = shownTree.get(parent) ?? []
    siblings.push(session)
    shownTree.set(parent, siblings)
  }
  for (const siblings of shownTree.values())
    siblings.sort(
      (a, b) =>
        b.time.created - a.time.created ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
  const ordered: SessionRecord[] = []
  const stack = [...(shownTree.get(rootID) ?? [])].reverse()
  while (stack.length) {
    const row = stack.pop()
    if (!row) break
    ordered.push(row)
    const nested = shownTree.get(row.id) ?? []
    for (let i = nested.length - 1; i >= 0; i--) {
      const child = nested[i]
      if (child) stack.push(child)
    }
  }
  return ordered.map((session) => {
    const live = statuses.get(session.id) ?? "unknown"
    const duration = executionDuration(session, live)
    return {
      id: session.id,
      ...(session.parentID && session.parentID !== rootID
        ? { parentID: session.parentID }
        : {}),
      title: session.title?.trim() || session.id,
      active: active(session.id),
      ...(duration ? { duration } : {}),
      status: statusFor(session),
    }
  })
}
