import { expect, test } from "bun:test"
import {
  buildRows,
  formatDuration,
  treeRows,
  type LiveStatus,
  type SessionRecord,
} from "./model"

function record(
  id: string,
  parentID?: string,
  created = 1,
  outcome?: SessionRecord["outcome"],
): SessionRecord {
  return {
    id,
    time: { created, updated: created },
    ...(parentID ? { parentID } : {}),
    ...(outcome ? { outcome } : {}),
  }
}

test("subtrees stay grouped below parents, ordered by newest sibling first and id", () => {
  const rows = buildRows(
    "root",
    [
      record("root"),
      record("finished", "root", 0),
      record("parent", "root", 1, "succeeded"),
      record("direct", "root", 2),
      record("done-child", "parent", 0),
      record("runner", "parent", 2),
      record("nested", "runner", 1),
      record("other"),
      record("foreign", "other"),
    ],
    new Map<string, LiveStatus>([
      ["runner", "running"],
      ["direct", "running"],
      ["nested", { type: "waiting", execution: "idle" }],
    ]),
  )
  expect(rows.map((r) => r.id)).toEqual([
    "direct",
    "parent",
    "runner",
    "nested",
    "done-child",
    "finished",
  ])
  expect(rows.find((r) => r.id === "parent")?.active).toBe(false)
  expect(
    treeRows(rows, false).map(({ id, prefix, context }) => [
      id,
      prefix,
      context,
    ]),
  ).toEqual([
    ["direct", "", false],
    ["parent", "", false],
    ["runner", "├─ ", false],
    ["nested", "│  └─ ", false],
    ["done-child", "└─ ", false],
    ["finished", "", false],
  ])
  expect(
    treeRows(rows, true).map(({ id, prefix, context }) => [
      id,
      prefix,
      context,
    ]),
  ).toEqual([
    ["direct", "", false],
    ["parent", "", true],
    ["runner", "└─ ", false],
    ["nested", "   └─ ", false],
  ])
})

test("sibling order follows creation time and stays fixed when tasks update", () => {
  const older = {
    id: "older",
    parentID: "root",
    time: { created: 100, updated: 9_000 },
  }
  const newer = {
    id: "newer",
    parentID: "root",
    time: { created: 200, updated: 100 },
  }
  const records = [
    { id: "root", time: { created: 1, updated: 1 } },
    older,
    newer,
  ]
  const ids = () =>
    buildRows("root", records, new Map<string, LiveStatus>()).map((r) => r.id)
  expect(ids()).toEqual(["newer", "older"])
  older.time.updated = 10_000
  newer.time.updated = 20_000
  expect(ids()).toEqual(["newer", "older"])
})

test("keeps Done for 3 hours and other statuses for 96 hours", () => {
  const hour = 60 * 60 * 1_000
  const now = new Date(2030, 5, 15, 12, 0, 0).getTime()
  const at = (id: string, created: number, updated: number, extra = {}) => ({
    id,
    ...extra,
    time: { created, updated },
  })
  const rows = buildRows(
    "root",
    [
      at("root", now - 100 * 24 * hour, now - 100 * 24 * hour),
      at("done-2h", now - 48 * hour, now - 2 * hour, {
        parentID: "root",
        outcome: "succeeded" as const,
      }),
      at("done-4h", now - 48 * hour, now - 4 * hour, {
        parentID: "root",
        outcome: "succeeded" as const,
      }),
      at("error-95h", now - 95 * hour, now - 95 * hour, {
        parentID: "root",
        outcome: "failed" as const,
      }),
      at("error-97h", now - 97 * hour, now - 97 * hour, {
        parentID: "root",
        outcome: "failed" as const,
      }),
      at("running-95h", now - 95 * hour, now - 95 * hour, {
        parentID: "root",
      }),
      at("running-97h", now - 97 * hour, now - 97 * hour, {
        parentID: "root",
      }),
      at("old-parent", now - 72 * hour, now - 72 * hour, {
        parentID: "root",
        outcome: "succeeded" as const,
      }),
      at("fresh-child", now - 30 * 60 * 1_000, now - 30 * 60 * 1_000, {
        parentID: "old-parent",
      }),
    ],
    new Map<string, LiveStatus>([
      ["done-2h", "idle"],
      ["done-4h", "idle"],
      ["error-95h", "idle"],
      ["error-97h", "idle"],
      ["running-95h", "running"],
      ["running-97h", "running"],
      ["old-parent", "idle"],
      ["fresh-child", "idle"],
    ]),
    now,
  )
  expect(rows.map((r) => r.id)).toEqual([
    "done-2h",
    "old-parent",
    "fresh-child",
    "error-95h",
    "running-95h",
  ])
  expect(rows.find((r) => r.id === "old-parent")?.active).toBe(false)
})

test("Active keeps shared ancestors once and removes unused branches after completion/deletion", () => {
  const records = [
    record("root"),
    record("parent", "root"),
    record("middle", "parent"),
    record("a", "middle"),
    record("b", "middle"),
    record("empty", "root"),
  ]
  const statuses = new Map<string, LiveStatus>([
    ["a", "running"],
    ["b", { type: "waiting", execution: "idle" }],
  ])
  expect(
    treeRows(buildRows("root", records, statuses), true).map((r) => [
      r.id,
      r.context,
    ]),
  ).toEqual([
    ["parent", true],
    ["middle", true],
    ["a", false],
    ["b", false],
  ])
  statuses.set("a", "idle")
  expect(
    treeRows(buildRows("root", records, statuses), true).map((r) => r.id),
  ).toEqual(["parent", "middle", "b"])
  expect(
    treeRows(
      buildRows(
        "root",
        records.filter((r) => r.id !== "middle"),
        statuses,
      ),
      true,
    ),
  ).toEqual([])
  statuses.set("b", "idle")
  expect(treeRows(buildRows("root", records, statuses), true)).toEqual([])
})

test("deep trees stay iterative with bounded prefixes and cyclic/deduplicated data stays safe", () => {
  const records = [record("root")]
  for (let i = 0; i < 10_000; i++)
    records.push(record(`n${i}`, i ? `n${i - 1}` : "root"))
  records.push(record("n0", "root"), record("x", "y"), record("y", "x"))
  const rows = treeRows(
    buildRows("root", records, new Map([["n9999", "running"]])),
    true,
  )
  expect(rows).toHaveLength(10_000)
  expect(rows.filter((r) => r.context)).toHaveLength(9_999)
  expect(rows[1]?.prefix).toBe("└─ ")
  expect(rows[2]?.prefix).toBe("   └─ ")
  expect(rows[3]?.prefix).toBe("…  └─ ")
  expect(rows.every((r) => r.prefix.length <= 6)).toBe(true)
  expect(
    treeRows(buildRows("x", records, new Map()), false).map((r) => r.id),
  ).toEqual(["y"])
})

test("only descendants, nested children included, running first", () => {
  const sessions = [
    record("root"),
    record("idle", "root"),
    record("running", "root", 2),
    record("nested", "idle", 3),
    record("other"),
    record("foreign", "other"),
  ]
  expect(
    buildRows("root", sessions, new Map([["running", "running"]])).map(
      (r) => r.id,
    ),
  ).toEqual(["running", "idle", "nested"])
  expect(buildRows("other", sessions, new Map()).map((r) => r.id)).toEqual([
    "foreign",
  ])
})

test("equal creation times sort by id; duplicates and disconnected cycles are safe", () => {
  const sessions = [
    record("b", "root"),
    record("a", "root"),
    record("a", "root"),
    record("x", "y"),
    record("y", "x"),
  ]
  expect(buildRows("root", sessions, new Map()).map((r) => r.id)).toEqual([
    "a",
    "b",
  ])
  expect(buildRows("x", sessions, new Map()).map((r) => r.id)).toEqual(["y"])
})

test("missing and blank titles use the session id", () => {
  expect(
    buildRows(
      "root",
      [{ ...record("a", "root"), title: "  " }, record("b", "root")],
      new Map(),
    ).map((r) => r.title),
  ).toEqual(["a", "b"])
})

test.each([
  ["running", "succeeded", "Running"],
  ["running", "failed", "Running"],
  [{ type: "waiting", execution: "running" }, "failed", "Waiting"],
  [{ type: "waiting", execution: "idle" }, "succeeded", "Waiting"],
  [{ type: "waiting", execution: "idle" }, undefined, "Waiting"],
  ["idle", "succeeded", "Done"],
  ["idle", "failed", "Error"],
  ["idle", "interrupted", "Interrupted"],
  ["idle", undefined, "Idle"],
  ["unknown", undefined, "Unknown"],
  ["unknown", "succeeded", "Unknown"],
] as const)("%s / %s → %s", (live, outcome, expected) => {
  expect(
    buildRows(
      "root",
      [record("child", "root", 1, outcome)],
      new Map([["child", live]]),
    )[0]?.status,
  ).toBe(expected)
})

test("waiting is active and sorts with the newest sibling first", () => {
  const rows = buildRows(
    "root",
    [
      record("failed", "root", 0, "failed"),
      record("waiting", "root", 1),
      record("running", "root", 2),
    ],
    new Map<string, LiveStatus>([
      ["failed", "idle"],
      ["waiting", { type: "waiting", execution: "idle" }],
      ["running", "running"],
    ]),
  )
  expect(rows.map(({ id, active }) => ({ id, active }))).toEqual([
    { id: "running", active: true },
    { id: "waiting", active: true },
    { id: "failed", active: false },
  ])
})

test.each([
  [0, "0s"],
  [999, "0s"],
  [1_000, "1s"],
  [59_999, "59s"],
  [60_000, "1m 0s"],
  [192_000, "3m 12s"],
  [664_000, "11m 4s"],
  [3_599_999, "59m 59s"],
  [3_600_000, "1h 0m"],
  [3_900_000, "1h 5m"],
  [86_399_999, "23h 59m"],
  [86_400_000, "1d 0h"],
  [183_600_000, "2d 3h"],
  [86_400_000_000, "999d+"],
] as const)("duration formatting %dms → %s", (elapsed, expected) => {
  expect(formatDuration({ start: 10_000 }, 10_000 + elapsed)).toBe(expected)
  expect(
    formatDuration({ start: 10_000, end: 10_000 + elapsed }, 99_999_999_999),
  ).toBe(expected)
})

test("unknown, inconsistent or future timing never renders a misleading duration", () => {
  expect(formatDuration(undefined, 20_000)).toBe("—")
  expect(formatDuration({ start: 21_000 }, 20_000)).toBe("—")
  expect(formatDuration({ start: 10_000, end: 21_000 }, 20_000)).toBe("—")
  expect(formatDuration({ start: 10_000, end: 9_000 }, 20_000)).toBe("—")
  expect(formatDuration({ start: NaN }, 20_000)).toBe("—")
  expect(formatDuration({ start: 10_000 }, Infinity)).toBe("—")
})

test.each([
  ["running", 10_000, undefined, undefined, { start: 10_000 }],
  ["running", 10_000, 9_000, "failed", { start: 10_000 }],
  [
    { type: "waiting", execution: "running" },
    10_000,
    9_000,
    "failed",
    { start: 10_000 },
  ],
  [
    { type: "waiting", execution: "idle" },
    10_000,
    15_000,
    "succeeded",
    { start: 10_000, end: 15_000 },
  ],
  ["idle", 10_000, 15_000, "succeeded", { start: 10_000, end: 15_000 }],
  ["idle", 10_000, 15_000, "failed", { start: 10_000, end: 15_000 }],
  ["idle", 10_000, 10_000, "interrupted", { start: 10_000, end: 10_000 }],
  ["idle", 10_000, 9_000, "succeeded", undefined],
  ["idle", 10_000, 15_000, undefined, undefined],
  ["idle", 10_000, undefined, "failed", undefined],
  ["running", 10_000, 15_000, "succeeded", undefined],
  ["unknown", 10_000, 15_000, "succeeded", undefined],
  ["running", undefined, undefined, undefined, undefined],
  ["running", NaN, undefined, undefined, undefined],
  ["running", -1, undefined, undefined, undefined],
  [
    { type: "waiting", execution: "running" },
    10_000,
    Infinity,
    undefined,
    undefined,
  ],
  [{ type: "waiting", execution: "running" }, 10_000, -1, undefined, undefined],
  [
    { type: "waiting", execution: "idle" },
    10_000,
    15_000,
    undefined,
    undefined,
  ],
] as const)(
  "execution timing %s / busy %s / idle %s / outcome %s",
  (live, busy, idle, outcome, expected) => {
    const child = {
      ...record("child", "root", 1, outcome),
      time: {
        created: 1,
        updated: 999_999,
        ...(busy !== undefined ? { busy } : {}),
        ...(idle !== undefined ? { idle } : {}),
      },
    }
    expect(
      buildRows(
        "root",
        [child],
        new Map<string, LiveStatus>([["child", live]]),
      )[0]?.duration,
    ).toEqual(expected)
  },
)
