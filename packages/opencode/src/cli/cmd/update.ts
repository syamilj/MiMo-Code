import { createSignal } from "solid-js"
import type { Accessor } from "solid-js"
import { create as createLog } from "../../util/log"

const log = createLog({ service: "update-check" })

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date"; behindBy: 0 }
  | { state: "behind"; behindBy: number; log: string; remoteUrl: string }
  | { state: "error"; message: string }

// Signal + setter are lazily created on first access. Module-top-level
// initialization is unreliable in Bun's bundler runtime when this module is
// imported from outside (e.g. another package's entry), so we defer to first
// call instead.
let _statusSignal: Accessor<UpdateStatus> | null = null
let _statusSetter: ((v: UpdateStatus) => void) | null = null
function getStatusSignal(): Accessor<UpdateStatus> {
  if (!_statusSignal) {
    const [get, set] = createSignal<UpdateStatus>({ state: "idle" })
    _statusSignal = get
    _statusSetter = set as (v: UpdateStatus) => void
  }
  return _statusSignal
}
function setStatusSignal(v: UpdateStatus): void {
  if (!_statusSetter) getStatusSignal()
  _statusSetter!(v)
}

export function getUpdateStatus(): UpdateStatus {
  return getStatusSignal()()
}

export const updateStatusAccessor = (() => {
  // Wrap so callers can pass a stable reference to <Provider value={{ status }}>
  return () => getStatusSignal()()
})()

function exec(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string; code: number }> {
  // Bun.spawn-style child_process.spawnSync is reliable inside the TUI render
  // loop — async spawn() with pipe stdio can hang on close in Bun's bundler
  // runtime. Sync is fine here: the longest call is a `git fetch` (sub-second
  // for our repos) and the TUI is already in `onMount`, not on the critical
  // render path.
  const cp = require("node:child_process")
  const result = cp.spawnSync(cmd, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
  if (result.error) {
    return Promise.resolve({ stdout: "", stderr: result.error.message, code: -1 })
  }
  return Promise.resolve({
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    code: result.status ?? -1,
  })
}

/**
 * Walk up from process.cwd() until we find a git toplevel. Global.Path.home
 * is $HOME, not the repo root, and git operations need to run inside the
 * repo. The 16-level cap stops a broken filesystem from looping forever.
 *
 * When the user launches mimo from a directory that isn't a descendant of
 * the MiMoCode source tree, the upward walk returns null. We then probe a
 * list of well-known checkout locations (~/CODE/MiMo-Code, the dev dir under
 * $HOME) so the indicator still works for day-to-day usage.
 */
function findRepoRoot(): string | null {
  const cp = require("node:child_process")
  const p = require("node:path")
  const os = require("node:os")

  // Upward walk from cwd
  let dir = process.cwd()
  for (let i = 0; i < 16; i++) {
    const r = cp.spawnSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: dir,
      encoding: "utf8",
    })
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
    const parent = p.dirname(dir)
    if (parent === dir) break
    dir = parent
  }

  // Fallback: probe known checkout locations.
  const home = os.homedir()
  const known = [
    p.join(home, "CODE", "MiMo-Code"),
    p.join(home, "code", "MiMo-Code"),
    p.join(home, "src", "MiMo-Code"),
    p.join(home, "projects", "MiMo-Code"),
  ]
  for (const candidate of known) {
    try {
      const r = cp.spawnSync("git", ["rev-parse", "--show-toplevel"], {
        cwd: candidate,
        encoding: "utf8",
      })
      if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
    } catch {
      // ignore
    }
  }

  return null
}

/**
 * Non-blocking update check. Compares HEAD against configured upstream
 * remotes (`upstream/main` first, then `origin/main` as fallback) and
 * reports the first one that has any behind commits. If all are at
 * parity, status is `up-to-date`.
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (getStatusSignal()().state === "checking") return getStatusSignal()()
  setStatusSignal({ state: "checking" })

  try {
    const repoRoot = findRepoRoot()
    if (!repoRoot) {
      const next: UpdateStatus = { state: "error", message: "not inside a git repository" }
      setStatusSignal(next)
      return next
    }

    const candidates: Array<{ remote: string; branch: string }> = [
      // The XiaomiMiMo fork is the source of truth for MiMoCode; if the
      // user has renamed it locally (the common "upstream" convention),
      // we use that. Otherwise origin is a fine fallback.
      { remote: "upstream", branch: "main" },
      { remote: "origin", branch: "main" },
    ]

    // Check which remotes are configured.
    const available: typeof candidates = []
    for (const cand of candidates) {
      const cfg = await exec("git", ["remote", "get-url", cand.remote], repoRoot)
      if (cfg.code === 0 && cfg.stdout.trim()) available.push(cand)
    }
    if (available.length === 0) {
      const next: UpdateStatus = { state: "error", message: "no upstream remote configured" }
      setStatusSignal(next)
      return next
    }

    // Try each candidate. Fetch + rev-list against each; if any has behind
    // commits, report that. Fall through to up-to-date only when every
    // configured upstream is at parity with HEAD.
    for (const cand of available) {
      const fetch = await exec("git", ["fetch", cand.remote, cand.branch, "--quiet"], repoRoot)
      if (fetch.code !== 0) {
        log.warn("git fetch failed", { remote: cand.remote, stderr: fetch.stderr })
        continue
      }
      const rev = await exec(
        "git",
        ["rev-list", "--count", `HEAD..${cand.remote}/${cand.branch}`],
        repoRoot,
      )
      if (rev.code !== 0) continue
      const behindBy = Number(rev.stdout.trim()) || 0
      if (behindBy === 0) continue

      const logRes = await exec(
        "git",
        ["log", "--oneline", "-10", `HEAD..${cand.remote}/${cand.branch}`],
        repoRoot,
      )
      const next: UpdateStatus = {
        state: "behind",
        behindBy,
        log: logRes.stdout.trim() || "(no log available)",
        remoteUrl: cand.remote as string,
      }
      setStatusSignal(next)
      return next
    }

    const next: UpdateStatus = { state: "up-to-date", behindBy: 0 }
    setStatusSignal(next)
    return next
  } catch (err) {
    log.warn("update check threw", { error: err })
    const next: UpdateStatus = { state: "error", message: String(err) }
    setStatusSignal(next)
    return next
  }
}
