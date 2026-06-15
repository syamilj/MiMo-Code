# Skill Toggle in Settings

## Problem

Users have many skills from different sources (`.claude`, `.mimocode`, `.codex`, project configs, remote URLs). There is no UI to see all skills and individually enable/disable them. Skills are implicitly loaded from all sources with no user control.

## Solution

Add a "Skills" tab to the settings dialog that lists all discovered skills grouped by source, each with a toggle switch.

## Backend

### Config
Add `disabled: string[]` to the skills config schema in `packages/opencode/src/config/skills.ts`.

### API
- `POST /config/skills/disabled` — set the list of disabled skill names
- The existing `GET /skill` endpoint already returns all skills

### Filtering
In `Skill.Service`, filter out disabled skills from `all()` and `available()` so the agent cannot auto-invoke them.

## Frontend

### New component: `settings-skills.tsx`
- Fetches all skills from `GET /skill`
- Groups by source derived from the `location` path:
  - `.claude` → "Claude Code"
  - `.mimocode` / `.mimo` → "MiMoCode"
  - `.codex` → "Codex"
  - Project config paths → "Project"
  - Remote URLs → "Remote"
- Each group shows a header with count and a list of skills with Switch toggle
- Persists disabled state to config via API

### Changes to existing files
- `dialog-settings.tsx` — add "Skills" tab trigger
- `settings.tsx` — optionally add local caching of disabled list

## Grouping Logic

Source is inferred from the `location` path:
```
~/.claude/skills/foo/SKILL.md          → "Claude Code"
~/.mimocode/skills/bar/SKILL.md       → "MiMoCode"
~/.codex/skills/baz/SKILL.md          → "Codex"
/Users/me/myproject/.claude/skills/... → "Claude Code (项目)"
```
