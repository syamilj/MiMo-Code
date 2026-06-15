import { spawn } from "child_process"
import { createSignal } from "solid-js"
import { Global } from "../../global"
import { create as createLog } from "../../util/log"

const log = createLog({ service: "update-check" })

export type UpdateStatus =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "up-to-date"; behindBy: 0 }
  | { state: "behind"; behindBy: number; log: string; remoteUrl: string }
  | { state: "error"; message: string }

// Module-level reactive signal — solid-js allows createSignal at module scope
// as long as consumers read it inside a tracking scope. The TUI's Show/Match
// components track this automatically, so the indicator updates without
// needing an extra force-render hack in app.tsx.
const [statusSignal, setStatusSignal] = createSignal<UpdateStatus>({ state: "idle" })

export function getUpdateStatus(): UpdateStatus {
  return statusSignal()
}

export const updateStatusAccessor = statusSignal

function exec(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] })
    let stdout = ""
    let stderr = ""
    child.stdout?.on("data", (d) => (stdout += d.toString()))
    child.stderr?.on("data", (d) => (stderr += d.toString()))
    child.on("close", (code) => resolve({ stdout, stderr, code: code ?? -1 }))
    child.on("error", (err) => {
      log.warn("update-check exec failed", { cmd, error: err })
      resolve({ stdout, stderr: err.message, code: -1 })
    })
  })
}

async function resolveUpstream(): Promise<{ remote: string; branch: string } | null> {
  // Try the conventional "upstream" first, then fall back to "origin" — many
  // setups (including the default MiMoCode clone) never rename their remote.
  for (const remote of ["upstream", "origin"]) {
    const cfg = await exec("git", ["remote", "get-url", remote], Global.Path.home)
    if (cfg.code === 0 && cfg.stdout.trim()) {
      return { remote, branch: "main" }
    }
  }
  return null
}

/**
 * Non-blocking update check. Compares HEAD against `upstream/main` and
 * publishes the result through the module-level signal so the sidebar
 * indicator reacts automatically.
 */
export async function checkForUpdates(): Promise<UpdateStatus> {
  if (statusSignal().state === "checking") return statusSignal()
  setStatusSignal({ state: "checking" })

  try {
    const upstream = await resolveUpstream()
    if (!upstream) {
      const next: UpdateStatus = { state: "error", message: "no upstream remote configured" }
      setStatusSignal(next)
      return next
    }

    const fetch = await exec("git", ["fetch", upstream.remote, upstream.branch, "--quiet"], Global.Path.home)
    if (fetch.code !== 0) {
      log.warn("git fetch upstream failed", { stderr: fetch.stderr })
      const next: UpdateStatus = { state: "up-to-date", behindBy: 0 }
      setStatusSignal(next)
      return next
    }

    const rev = await exec(
      "git",
      ["rev-list", "--count", `HEAD..${upstream.remote}/${upstream.branch}`],
      Global.Path.home,
    )
    if (rev.code !== 0) {
      const next: UpdateStatus = { state: "error", message: rev.stderr.trim() || "rev-list failed" }
      setStatusSignal(next)
      return next
    }
    const behindBy = Number(rev.stdout.trim()) || 0

    if (behindBy === 0) {
      const next: UpdateStatus = { state: "up-to-date", behindBy: 0 }
      setStatusSignal(next)
      return next
    }

    const logRes = await exec(
      "git",
      ["log", "--oneline", "-10", `HEAD..${upstream.remote}/${upstream.branch}`],
      Global.Path.home,
    )
    const next: UpdateStatus = {
      state: "behind",
      behindBy,
      log: logRes.stdout.trim() || "(no log available)",
      remoteUrl: upstream.remote as string,
    }
    setStatusSignal(next)
    return next
  } catch (err) {
    log.warn("update check threw", { error: err })
    const next: UpdateStatus = { state: "error", message: String(err) }
    setStatusSignal(next)
    return next
  }
}
