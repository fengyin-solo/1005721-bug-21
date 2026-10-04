import { SEED_ROWS, SEED_VERSION, FORCE_RESEED_MODULES } from './seed'
import type { EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'substation-protection:entries'
const VERSION_KEY = 'substation-protection:entries-version'

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// 旧缓存不能覆盖新口径：版本升级后，强制重建的模块用新种子，其余模块尽量保留用户改动，
// 新增编号补齐。避免「再查又变回上一次结果、跟列表对不上」。
function migrate(parsed: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const next: Record<string, EntryRow[]> = {}
  for (const key of Object.keys(SEED_ROWS)) {
    if (FORCE_RESEED_MODULES.includes(key) || !parsed[key]) {
      next[key] = clone(SEED_ROWS[key])
      continue
    }
    const seeded = SEED_ROWS[key]
    const keptIds = new Set(parsed[key].map((row) => Number(row.id)))
    const appended = seeded.filter((row) => !keptIds.has(Number(row.id)))
    next[key] = [...parsed[key], ...appended]
  }
  return next
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, SEED_VERSION)
    return fallback
  }
  const version = window.localStorage.getItem(VERSION_KEY)
  if (version !== SEED_VERSION) {
    try {
      const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
      const migrated = migrate(parsed)
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(migrated))
      window.localStorage.setItem(VERSION_KEY, SEED_VERSION)
      return migrated
    } catch {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
      window.localStorage.setItem(VERSION_KEY, SEED_VERSION)
      return fallback
    }
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...parsed }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    window.localStorage.setItem(VERSION_KEY, SEED_VERSION)
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
