import {
  downloadBlob,
  exportEntries,
  filterRows,
} from '@/api/local-service'
import { listRows, saveRows } from '@/data/local-store'
import { resolveCalculationBasis, validateSettingRow } from '@/data/setting-rules'
import type { ActionResult, EntryRow, PageResult } from '@/data/types'

const MODULE_KEY = 'settingvalue'
const APPROVE_KEY = 'settingapprove'

// 提交整定的幂等台账：同一定值单号只记一次，重复提交直接挡回。
const SUBMIT_LEDGER_KEY = 'substation-protection:setting-submit-ledger'
// 导出断点：逐行导出时落到哪一行，断了下次从这行重来。
const EXPORT_CHECKPOINT_KEY = 'substation-protection:setting-export-checkpoint'

const FILTER_FIELDS = ['定值单号', '所属装置', '定值项目']

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return fallback
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

export type SettingRowView = {
  row: EntryRow
  basis: ReturnType<typeof resolveCalculationBasis>
  validation: ReturnType<typeof validateSettingRow>
}

export function decorate(row: EntryRow): SettingRowView {
  return {
    row,
    basis: resolveCalculationBasis(row),
    validation: validateSettingRow(row),
  }
}

// 列表口径：缺项、异常的行一条也不许丢，全部列出来，缺什么由行内徽标说明。
export function listSettingEntries(filters: Record<string, string> = {}): PageResult {
  const scoped: Record<string, string> = {}
  for (const field of FILTER_FIELDS) {
    if (filters[field]) {
      scoped[field] = filters[field]
    }
  }
  const matched = filterRows(listRows(MODULE_KEY), scoped)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export type SettingDraft = {
  定值单号: string
  所属装置: string
  定值项目: string
  整定值: string
  计算依据: string
  整定人: string
  审核人: string
}

export type SaveResult = ActionResult & { id?: number }

// 保存（登记/编辑）：单号、项目必须写全；整定值非空时超装置范围一律挡回；
// 空整定值允许先存下，但列表会挂「缺整定值」。
export function saveSettingDraft(draft: SettingDraft, id?: number): SaveResult {
  const normalized: EntryRow = {
    id: id ?? -1,
    status: '待整定',
    pending: true,
    abnormal: false,
    定值单号: draft.定值单号.trim(),
    所属装置: draft.所属装置.trim(),
    定值项目: draft.定值项目.trim(),
    整定值: draft.整定值.trim(),
    计算依据: draft.计算依据.trim(),
    整定人: draft.整定人.trim(),
    审核人: draft.审核人.trim(),
    定值状态: '待整定',
  }

  const validation = validateSettingRow(normalized)
  if (String(normalized.定值单号) === '' || String(normalized.定值项目) === '') {
    const fields = [
      String(normalized.定值单号) === '' ? '定值单号' : '',
      String(normalized.定值项目) === '' ? '定值项目' : '',
    ]
      .filter(Boolean)
      .join('、')
    return { ok: false, message: `定值单号与定值项目必须写全：${fields}为空，已挡回保存` }
  }

  const hardError = validation.abnormal.find(
    (issue) => issue.kind === 'out-of-range' || issue.kind === 'invalid',
  )
  if (hardError) {
    return { ok: false, message: `${hardError.message}，已挡回保存，请核对后重试` }
  }

  const rows = [...listRows(MODULE_KEY)]
  const nowAbnormal = validation.issues.length > 0
  if (id === undefined) {
    const nextId = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
    normalized.id = nextId
    normalized.abnormal = nowAbnormal
    rows.push(normalized)
    saveRows(MODULE_KEY, rows)
    return { ok: true, message: `定值单 ${normalized.定值单号} 已登记`, id: nextId }
  }

  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的定值单` }
  }
  const previous = rows[index]
  normalized.id = Number(previous.id)
  normalized.status = String(previous.status)
  normalized.pending = Boolean(previous.pending)
  normalized['定值状态'] = previous['定值状态'] ?? normalized.status
  normalized.abnormal = nowAbnormal
  rows[index] = normalized
  saveRows(MODULE_KEY, rows)
  return { ok: true, message: `定值单 ${normalized.定值单号} 已保存`, id: Number(normalized.id) }
}

function readLedger(): Record<string, string> {
  return readJson<Record<string, string>>(SUBMIT_LEDGER_KEY, {})
}

// 种子/迁移补进来的数据按「非作废且已离开待整定」视为历史提交，避免老单据一点就重复。
function seedLedgerFromRows(): Record<string, string> {
  const ledger = readLedger()
  for (const row of listRows(MODULE_KEY)) {
    const orderNo = String(row['定值单号'] ?? '').trim()
    const status = String(row.status)
    if (orderNo && status !== '待整定' && status !== '已作废' && !ledger[orderNo]) {
      ledger[orderNo] = '历史整定记录'
    }
  }
  writeJson(SUBMIT_LEDGER_KEY, ledger)
  return ledger
}

export function hasSubmitted(orderNo: string): boolean {
  return Boolean(readLedger()[orderNo.trim()])
}

// 提交整定：同一单号只记一次。
export function submitSetting(id: number): ActionResult {
  const ledger = seedLedgerFromRows()
  const rows = [...listRows(MODULE_KEY)]
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的定值单` }
  }
  const orderNo = String(rows[index]['定值单号'] ?? '').trim()
  if (!orderNo) {
    return { ok: false, message: '该记录缺定值单号，不能提交整定' }
  }
  if (ledger[orderNo]) {
    return { ok: false, message: `定值单 ${orderNo} 已提交过整定（${ledger[orderNo]}），不重复登记` }
  }
  const validation = validateSettingRow(rows[index])
  const blocker = validation.issues.find(
    (issue) => issue.kind === 'out-of-range' || issue.kind === 'invalid',
  )
  if (blocker) {
    return { ok: false, message: `${blocker.message}，请先整改再提交整定` }
  }
  rows[index] = {
    ...rows[index],
    status: '整定中',
    pending: true,
    '定值状态': '整定中',
  }
  saveRows(MODULE_KEY, rows)
  ledger[orderNo] = '整定中'
  writeJson(SUBMIT_LEDGER_KEY, ledger)
  return { ok: true, message: `定值单 ${orderNo} 已提交整定（本单只登记一次）` }
}

export function auditSetting(id: number): ActionResult {
  const rows = [...listRows(MODULE_KEY)]
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的定值单` }
  }
  const orderNo = String(rows[index]['定值单号'] ?? '').trim()
  rows[index] = {
    ...rows[index],
    status: '已审核',
    pending: false,
    '定值状态': '已审核',
  }
  saveRows(MODULE_KEY, rows)
  const ledger = readLedger()
  if (orderNo) {
    ledger[orderNo] = '已审核'
    writeJson(SUBMIT_LEDGER_KEY, ledger)
  }
  return { ok: true, message: `定值单 ${orderNo} 已审核` }
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

function nextApproveId(): number {
  const rows = listRows(APPROVE_KEY)
  return rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
}

// 作废定值：结论同步落到定值审批的「待送审」清单，同一定值单只落一条。
export function voidSetting(id: number): ActionResult {
  const rows = [...listRows(MODULE_KEY)]
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的定值单` }
  }
  const target = rows[index]
  if (String(target.status) === '已作废') {
    return { ok: false, message: '该定值单已作废，不重复处理' }
  }
  const orderNo = String(target['定值单号'] ?? '').trim()

  const approvals = [...listRows(APPROVE_KEY)]
  const exists = approvals.some(
    (row) =>
      String(row['关联定值单'] ?? '').trim() === orderNo &&
      String(row['审批层级'] ?? '') === '作废复核' &&
      String(row.status) === '待送审',
  )
  if (exists) {
    return { ok: false, message: `定值单 ${orderNo} 的作废结论已在待送审清单中，不重复登记` }
  }

  rows[index] = {
    ...target,
    status: '已作废',
    pending: true,
    abnormal: true,
    '定值状态': '已作废',
  }
  saveRows(MODULE_KEY, rows)

  const approval: EntryRow = {
    id: nextApproveId(),
    status: '待送审',
    pending: true,
    abnormal: true,
    审批单号: `SP-FX-${String(Date.now()).slice(-6)}`,
    关联定值单: orderNo,
    审批层级: '作废复核',
    送审人: String(target['整定人'] ?? '') || '值班管理员',
    审批人: '',
    送审日期: today(),
    审批意见: `定值单 ${orderNo} 已作废，待送审复核确认`,
    审批状态: '待送审',
  }
  saveRows(APPROVE_KEY, [...approvals, approval])
  return {
    ok: true,
    message: `定值单 ${orderNo} 已作废，作废结论已进入定值审批待送审清单（${approval.审批单号}）`,
  }
}

export type ExportReport = {
  ok: boolean
  filename: string
  exported: number
  total: number
  message: string
}

type Checkpoint = { at: number; total: number; time: string }

export function exportCheckpoint(): Checkpoint | null {
  return readJson<Checkpoint | null>(EXPORT_CHECKPOINT_KEY, null)
}

function clearCheckpoint(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.removeItem(EXPORT_CHECKPOINT_KEY)
  }
}

function saveCheckpoint(at: number, total: number): void {
  writeJson(EXPORT_CHECKPOINT_KEY, { at, total, time: new Date().toISOString() })
}

// 逐行导出：任何一行序列化报错都不断整份，记下断点并返回，从断掉的那行可以重来。
function runExport(rows: EntryRow[], filename: string, startAt: number): ExportReport {
  const { content, failedAt } = exportEntries(MODULE_KEY, {
    rows,
    from: startAt,
    extraColumns: ['缺项/异常标注'],
  })
  if (failedAt !== null) {
    // 断点对外统一用 1 基行号；续导时再换算回下标，正好从断掉的那行重来。
    const failedRowNo = failedAt + 1
    saveCheckpoint(failedRowNo, rows.length)
    return {
      ok: false,
      filename,
      exported: failedAt - startAt,
      total: rows.length,
      message: `导出在第 ${failedRowNo} 行中断（${String(rows[failedAt]?.['定值单号'] ?? '未知单号')}），断点已保留，可从该行续导`,
    }
  }
  try {
    downloadBlob(filename, content, 'text/csv;charset=utf-8')
  } catch {
    saveCheckpoint(startAt + 1, rows.length)
    return {
      ok: false,
      filename,
      exported: 0,
      total: rows.length,
      message: '浏览器拒绝下载，导出中断，可从断点重试',
    }
  }
  clearCheckpoint()
  return {
    ok: true,
    filename,
    exported: rows.length - startAt,
    total: rows.length,
    message:
      startAt > 0
        ? `已从第 ${startAt + 1} 行续导完成，本次导出 ${rows.length - startAt} 条`
        : `已导出全部 ${rows.length} 条定值单，缺项行在文件内逐行标注`,
  }
}

export function exportAllSettings(): ExportReport {
  const rows = listRows(MODULE_KEY)
  if (!rows.length) {
    return { ok: false, filename: '', exported: 0, total: 0, message: '当前没有可导出的定值单' }
  }
  return runExport(rows, '定值整定-清单.csv', 0)
}

export function resumeExportSettings(): ExportReport {
  const checkpoint = exportCheckpoint()
  const rows = listRows(MODULE_KEY)
  if (!rows.length) {
    clearCheckpoint()
    return { ok: false, filename: '', exported: 0, total: 0, message: '当前没有可导出的定值单，断点已清除' }
  }
  if (!checkpoint) {
    return exportAllSettings()
  }
  // 存的是 1 基行号，换成下标后正好从断掉的那行重新导出。
  const startAt = Math.min(Math.max(checkpoint.at - 1, 0), rows.length - 1)
  return runExport(rows, `定值整定-清单-续导第${startAt + 1}行起.csv`, startAt)
}

export function clearExportCheckpoint(): void {
  clearCheckpoint()
}

export function emptyReason(filters: Record<string, string>): string {
  const active = Object.entries(filters)
    .filter(([field, value]) => FILTER_FIELDS.includes(field) && value.trim() !== '')
    .map(([field, value]) => `${field}「${value.trim()}」`)
  if (active.length) {
    return `没有匹配 ${active.join('、')} 的定值单，可放宽条件后重新查询；缺项的行在无筛选时会照常列出`
  }
  return '暂无定值整定数据，可先登记定值单'
}
