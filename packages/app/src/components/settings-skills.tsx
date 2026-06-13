import { Switch } from "@mimo-ai/ui/switch"
import { Button } from "@mimo-ai/ui/button"
import { Icon } from "@mimo-ai/ui/icon"
import { showToast } from "@mimo-ai/ui/toast"
import { createMemo, createSignal, type Component, For, onMount, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { useGlobalSDK } from "@/context/global-sdk"
import { useGlobalSync } from "@/context/global-sync"
import { SettingsList } from "./settings-list"

type SkillInfo = {
  name: string
  description: string
  location: string
  hidden?: boolean
}

function groupLabel(path: string): string {
  if (path.includes(".claude")) return "Claude Code"
  if (path.includes(".mimocode") || path.includes(".mimo")) return "MiMoCode"
  if (path.includes(".codex")) return "Codex"
  if (path.includes(".opencode")) return "MiMoCode"
  if (path.includes(".agents")) return "Agents"
  return "Project"
}

export const SettingsSkills: Component = () => {
  const language = useLanguage()
  const globalSDK = useGlobalSDK()
  const globalSync = useGlobalSync()

  const [skills, setSkills] = createSignal<SkillInfo[]>([])
  const [search, setSearch] = createSignal("")
  const [collapsed, setCollapsed] = createSignal<Set<string>>(new Set())

  onMount(async () => {
    const result = await globalSDK.client.app.skills().catch(() => undefined)
    if (result?.data) setSkills(result.data)
  })

  const toggleCollapsed = (label: string) => {
    const next = new Set(collapsed())
    if (next.has(label)) next.delete(label)
    else next.add(label)
    setCollapsed(next)
  }

  const filtered = createMemo(() => {
    const q = search().toLowerCase()
    if (!q) return skills()
    return skills().filter((s) => s.name.toLowerCase().includes(q))
  })

  const groups = createMemo(() => {
    const grouped = new Map<string, SkillInfo[]>()
    for (const skill of filtered()) {
      const key = groupLabel(skill.location)
      const arr = grouped.get(key)
      if (arr) arr.push(skill)
      else grouped.set(key, [skill])
    }

    return Array.from(grouped.entries())
      .map(([label, groupSkills]) => ({
        label,
        skills: groupSkills.toSorted((a, b) => a.name.localeCompare(b.name)),
      }))
      .toSorted((a, b) => a.label.localeCompare(b.label))
  })

  const disabledSet = createMemo(() => {
    return new Set(globalSync.data.config.skills?.disabled ?? [])
  })

  const toggle = async (name: string, current: boolean) => {
    const before = globalSync.data.config.skills?.disabled ?? []
    const next = current ? before.filter((s: string) => s !== name) : [...before, name]
    const skillsCfg = { ...(globalSync.data.config.skills ?? {}), disabled: next }
    globalSync.set("config", "skills", skillsCfg)
    try {
      await globalSync.updateConfig({ skills: skillsCfg })
    } catch {
      globalSync.set("config", "skills", { ...(globalSync.data.config.skills ?? {}), disabled: before })
      showToast({ title: language.t("common.requestFailed") })
    }
  }

  const toggleGroup = async (groupSkills: SkillInfo[], enable: boolean) => {
    const before = new Set(globalSync.data.config.skills?.disabled ?? [])
    for (const skill of groupSkills) {
      if (enable) before.delete(skill.name)
      else before.add(skill.name)
    }
    const next = Array.from(before)
    const skillsCfg = { ...(globalSync.data.config.skills ?? {}), disabled: next }
    globalSync.set("config", "skills", skillsCfg)
    try {
      await globalSync.updateConfig({ skills: skillsCfg })
    } catch {
      globalSync.set("config", "skills", { ...(globalSync.data.config.skills ?? {}), disabled: Array.from(before) })
      showToast({ title: language.t("common.requestFailed") })
    }
  }

  return (
    <div class="flex flex-col h-full overflow-y-auto no-scrollbar px-4 pb-10 sm:px-10 sm:pb-10">
      <div class="sticky top-0 z-10 bg-[linear-gradient(to_bottom,var(--surface-stronger-non-alpha)_calc(100%_-_24px),transparent)]">
        <div class="flex flex-col gap-1 pt-6 pb-8 max-w-[720px]">
          <h2 class="text-16-medium text-text-strong">{language.t("settings.skills.title")}</h2>
          <div class="relative mt-2">
            <input
              type="text"
              placeholder="Search skills..."
              value={search()}
              onInput={(e) => setSearch(e.currentTarget.value)}
              class="w-full h-9 pl-9 pr-3 text-14-regular bg-surface-base border border-border-base rounded-lg outline-none focus:border-border-interactive-base transition-colors"
            />
            <svg class="absolute left-3 inset-y-0 my-auto size-4 text-text-weak pointer-events-none" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-linecap="square">
              <path d="M13 13L10.6418 10.6418M11.9552 7.47761C11.9552 9.95053 9.95053 11.9552 7.47761 11.9552C5.0047 11.9552 3 9.95053 3 7.47761C3 5.0047 5.0047 3 7.47761 3C9.95053 3 11.9552 5.0047 11.9552 7.47761Z" stroke="currentColor" vector-effect="non-scaling-stroke"/>
            </svg>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-8 max-w-[720px] transition-opacity duration-300" style={{ "min-height": "600px" }} classList={{ "opacity-0": skills().length === 0 }}>
        <For each={groups()}>
          {(group) => {
            const isCollapsed = () => collapsed().has(group.label)
            const anyDisabled = () => group.skills.some((s) => disabledSet().has(s.name))
            const anyEnabled = () => group.skills.some((s) => !disabledSet().has(s.name))
            return (
              <div class="flex flex-col gap-1">
                <div class="flex items-center justify-between py-2 cursor-pointer" onClick={() => toggleCollapsed(group.label)}>
                  <div class="flex items-center gap-2">
                    <svg class="size-4 text-text-weak transition-transform duration-200" classList={{ "rotate-180": !isCollapsed() }} viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-linecap="square">
                      <path d="M6.6665 8.33325L9.99984 11.6666L13.3332 8.33325" />
                    </svg>
                    <h3 class="text-14-medium text-text-strong">{group.label} ({group.skills.length})</h3>
                  </div>
                  <div class="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <Show when={anyDisabled()}>
                      <Button variant="ghost" size="small" icon="check-small" onClick={() => void toggleGroup(group.skills, true)}>
                        Enable all
                      </Button>
                    </Show>
                    <Show when={anyEnabled()}>
                      <Button variant="ghost" size="small" icon="circle-x" onClick={() => void toggleGroup(group.skills, false)}>
                        Disable all
                      </Button>
                    </Show>
                  </div>
                </div>
                <Show when={!isCollapsed()}>
                  <SettingsList>
                    <For each={group.skills}>
                      {(skill) => {
                        const enabled = () => !disabledSet().has(skill.name)
                        return (
                          <div class="flex items-center justify-between gap-4 min-h-14 py-2.5 border-b border-border-weak-base last:border-none">
                            <div class="flex flex-col min-w-0">
                              <span class="text-14-medium text-text-strong truncate">{skill.name}</span>
                              <Show when={skill.description}>
                                <span class="text-12-regular text-text-weak truncate">{skill.description}</span>
                              </Show>
                            </div>
                            <Switch
                              checked={enabled()}
                              onChange={(checked) => void toggle(skill.name, checked)}
                            />
                          </div>
                        )
                      }}
                    </For>
                  </SettingsList>
                </Show>
              </div>
            )
          }}
        </For>
      </div>
    </div>
  )
}
