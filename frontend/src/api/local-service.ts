import { MODULE_BY_KEY } from '@/data/modules'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { issueSummary } from '@/data/setting-rules'
import type { ActionResult, EntryRow, ModuleMeta, OverviewResult, PageResult } from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 单元格里可能带逗号、引号、换行，统一转义；缺项导出成【缺】而不是让整份文件报错。
export function csvCell(value: unknown): string {
  const text =
    value === null || value === undefined || String(value).trim() === ''
      ? '【缺】'
      : String(value)
  if (/[",\n\r]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

export type ExportOptions = {
  rows?: EntryRow[]
  from?: number
  extraColumns?: string[]
}

export type ExportPayload = {
  filename: string
  content: string
  // 在 rows 中的 0 基失败下标；null 表示全部成功
  failedAt: number | null
}

export function exportEntries(key: string, options: ExportOptions = {}): ExportPayload {
  const meta = moduleMeta(key)
  const source = options.rows ?? listRows(key)
  const from = options.from ?? 0
  const extras = options.extraColumns ?? []
  const rows = source.slice(from)
  const header = ['编号', ...meta.fields, '当前状态', ...extras]
  const lines = [header.map(csvCell).join(',')]
  let failedAt: number | null = null
  rows.forEach((row, offset) => {
    if (failedAt !== null) {
      return
    }
    try {
      const base = [row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status]
      if (key === 'settingvalue' && extras.includes('缺项/异常标注')) {
        base.push(settingIssueNote(row))
      }
      lines.push(base.map(csvCell).join(','))
    } catch {
      failedAt = from + offset
    }
  })
  return {
    filename: `${meta.name}-清单.csv`,
    content: `\uFEFF${lines.join('\n')}`,
    failedAt,
  }
}

// 定值单导出逐行带缺项/异常标注：缺了什么看文件就知道，不用再回页面猜。
function settingIssueNote(row: EntryRow): string {
  return issueSummary(row) || '完整'
}

export function downloadBlob(
  filename: string,
  content: string,
  type = 'text/csv;charset=utf-8',
): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  downloadBlob(filename, content)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
