# TODO — Known Issues (fork-specific)

> Fork customizations applied on top of `XiaomiMiMo/MiMo-Code`. Anything
> here documents behavior that diverges from upstream, was patched at the
> fork layer, and should be re-checked when syncing with upstream again.

## [HIGH] Worktree session: thinking-mode models hang silently after switch

### Symptom
After switching to a git worktree (via `/wt` → create or select) and submitting
a message, the TUI shows status `Build · ... · thinking` with `0 tokens`
indefinitely. No model response, no error toast.

If the user quits the TUI and re-launches, the **session is persisted**
(visible in the session list) but the assistant turn was never written — so
the model effectively never produced a reply for that turn.

### Reproducer
1. `mimo` (TUI) → `/wt` → create a new worktree (or pick an existing one)
2. Submit any message (e.g. `haloo`)
3. Observe: status stays `thinking`, no response, no error in the prompt
   area. Right-panel Context stays at `0 tokens`.

### Root cause
Reasoning models (e.g. `opencode-go/minimax-m3`, `opencode/deepseek-v4-flash-free`)
are configured with `reasoning: true`. The MiMo `Build` agent also enables
tools by default (read, write, edit, bash, ...). The provider API rejects
the combination with:

```
Error from provider (DeepSeek): Thinking mode does not support this tool_choice
stack=AI_APICallError: ...
```

`mimo`'s `session.processor` catches the error but the TUI status stays
`thinking` (no UI surface for the failure). The session is committed
upstream, but no assistant message is ever stored for the turn.

Confirmed via direct API (`curl`): both the OpenAI-compatible endpoint
(`/v1/chat/completions`) and the Anthropic endpoint (`/v1/messages`) respond
correctly. The bug is in the TUI's error-surfacing layer, not in the API.

### Workarounds
1. **Pick a non-reasoning model** via `/models`:
   - `opencode-go/mimo-v2-pro`, `opencode-go/mimo-v2.5-pro`,
     `opencode-go/mimo-v2.5`, `opencode-go/qwen3.7-plus` (verify in catalog)
2. **Toggle the reasoning variant off** for reasoning models that expose a
   variant — the catalog already defines a `none` variant for
   `minimax-m3` (see `transform.ts:509-518`). The TUI does not currently
   expose variant selection in the standard model picker; either pick a
   non-reasoning model or patch the picker.
3. **Pre-existing fix candidates** (not yet implemented):
   - `mimo.ts` (or a new plugin) — strip `tool_choice` from the request when
     the active model is in thinking mode, OR
   - `session.processor` — surface the `AI_APICallError` to the TUI so the
     status reflects failure instead of hanging

### Files involved
- `packages/opencode/src/provider/transform.ts:509-518` — variant definitions
  for `minimax-m3`
- `packages/opencode/src/session/processor` (TBD) — error handler that
  silently swallows the AI provider error
- `packages/opencode/src/cli/cmd/tui/component/prompt/index.tsx:1063` —
  prompt submit path that calls `session.create`

### Status
**Open.** Documented 2026-06-15. Re-test after upstream `XiaomiMiMo/MiMo-Code`
sync. May be resolved by upstream fix or by new mimo variant picker.

---

## Fork patches already applied (reference)

These are the edits currently on the `combo` branch on top of the pr-508
merge. They are **upstream-overwritable** — re-apply after a sync to
`upstream/main`.

| File | Edit | Reason |
|---|---|---|
| `packages/opencode/src/plugin/mimo.ts` | Removed `input.disabled_providers` block for `opencode` / `opencode-go` | Re-enable `OpenCode Go` provider that the upstream `MimoAuthPlugin` auto-disables |
| `packages/opencode/src/cli/cmd/tui/component/dialog-worktree.tsx` | `switchTo` now calls `project.workspace.sync()` + `workspace.set(newWorkspaceID)` after `sdk.switchDirectory()` | Without it, `project.workspace.current()` stays bound to the old workspace and `session.create({ workspace })` fails silently in the new worktree |
| `packages/opencode/src/cli/cmd/tui/context/sdk.tsx` | `switchDirectory` now clears the event queue and calls `startSSE()` | The SDK's SSE event stream is bound to the original instance and is never re-established on directory switch — real-time UI updates (new sessions, new messages) silently drop after a worktree switch |

Re-applying pattern after upstream sync:

```bash
# 1. Sync main to upstream
git checkout main
git fetch upstream
git reset --hard upstream/main

# 2. Re-apply the three patches above (same content, see git log on `combo`)
# 3. Rebuild
cd packages/opencode && bun run build
```
