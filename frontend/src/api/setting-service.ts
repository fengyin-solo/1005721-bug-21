import { listRows, saveRows } from '@/data/local-store'
import { findRule, formatSettingValue } from '@/data/setting-rules'
import type {
  ActionResult,
  EntryRow,
  ExportResult,
  SettingIssue,
  SettingRowDiagnosis,
} from '@/data/types'

const MODULE_KEY = 'settingvalue'
const APPROVE_KEY = 'settingapprove'

// 定值单号与定值项目是登记必填项；整定值、计算依据允许留空，但要在行列里注明缺项。
const REQUIRED_FIELDS = ['定值单号', '所属装置', '定值项目'] as const
// 允许留空但必须在页面上点名的项。
const ITEM_FIELDS = ['整定值', '计算依据'] as const

const NEGATIVE_PREFIXES = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

const SUBMIT_LOG_KEY = 'substation-protection:setting-submits'
const EXPORT_CURSOR_KEY = 'substation-protection:setting-export-cursor'

// 动作流转：同一张定值单的所有定值项随单据一起流转。
const SHEET_STATUSES = ['待整定', '整定中', '已审核', '已作废']

function readJSON<T>(key: string, fallback: T): T {
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

function writeJSON(key: string, value: unknown): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(value))
  }
}

function text(row: EntryRow, field: string): string {
  return String(row[field] ?? '').trim()
}

function parseNumeric(raw: string): number | undefined {
  if (raw === '') {
    return undefined
  }
  // 允许 "5.2 A"、"0.5s" 这类带单位写法，取首个数值。
  const matched = raw.match(/-?\d+(?:\.\d+)?/)
  if (!matched) {
    return undefined
  }
  const value = Number(matched[0])
  return Number.isFinite(value) ? value : undefined
}

// 缺什么、异常什么都在这里算：列表与明细面板共用同一份诊断，口径不漂移。
export function diagnoseRow(row: EntryRow): SettingRowDiagnosis {
  const issues: SettingIssue[] = []
  const missingFields: string[] = []
  const itemName = text(row, '定值项目')

  for (const field of [...REQUIRED_FIELDS, ...ITEM_FIELDS]) {
    if (text(row, field) === '') {
      missingFields.push(field)
      issues.push({
        field,
        kind: 'missing',
        message:
          field === '定值单号' || field === '所属装置' || field === '定值项目'
            ? `缺少${field}，登记时必须写全`
            : `缺少${field}，待整定补充`,
      })
    }
  }

  const rule = itemName ? findRule(itemName) : undefined
  if (itemName && !rule) {
    issues.push({
      field: '定值项目',
      kind: 'abnormal',
      message: `「${itemName}」不在既有整定办法目录内，无法核对计算依据与装置范围`,
    })
  }

  const rawValue = text(row, '整定值')
  const numericValue = parseNumeric(rawValue)
  let outOfRange = false
  if (rawValue !== '') {
    if (numericValue === undefined) {
      issues.push({
        field: '整定值',
        kind: 'abnormal',
        message: `整定值「${rawValue}」不是数值，无法核对装置范围`,
      })
    } else if (rule) {
      if (numericValue < rule.min || numericValue > rule.max) {
        outOfRange = true
        issues.push({
          field: '整定值',
          kind: 'abnormal',
          message: `整定值 ${numericValue}${rule.unit} 超出装置允许整定范围 ${rule.min}~${rule.max}${rule.unit}`,
        })
      }
    }
  }

  return {
    missingFields,
    issues,
    outOfRange,
    complete: issues.length === 0,
    rule,
    numericValue,
  }
}

export interface DiagnosedRow {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  diagnosis: SettingRowDiagnosis
  displayValue: string
  basisText: string
  定值单号: string
  所属装置: string
  定值项目: string
  整定值: string
  计算依据: string
  整定人: string
  审核人: string
  定值状态: string
}

function withDiagnosis(row: EntryRow): DiagnosedRow {
  const diagnosis = diagnoseRow(row)
  const rawBasis = text(row, '计算依据')
  // 计算依据一处维护：行内为空时沿用整定办法目录里的口径，展示「办法口径（自动带出）」。
  const basisText = rawBasis || diagnosis.rule?.basis || ''
  const get = (field: string): string => String(row[field] ?? '')
  return {
    id: Number(row.id),
    status: String(row.status),
    pending: Boolean(row.pending),
    abnormal: Boolean(row.abnormal),
    diagnosis,
    displayValue: formatSettingValue(text(row, '整定值'), diagnosis.rule),
    basisText,
    定值单号: get('定值单号'),
    所属装置: get('所属装置'),
    定值项目: get('定值项目'),
    整定值: get('整定值'),
    计算依据: get('计算依据'),
    整定人: get('整定人'),
    审核人: get('审核人'),
    定值状态: get('定值状态'),
  }
}

function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

// 每次查询都直接从持久层重取，避免「再查又变回上一次结果」。
export function listSettingEntries(filters: Record<string, string> = {}): {
  items: DiagnosedRow[]
  total: number
  page: number
  size: number
} {
  const rows = [...listRows(MODULE_KEY)].sort((a, b) => Number(a.id) - Number(b.id))
  const matched = filterRows(rows, filters).map(withDiagnosis)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getSettingEntry(id: number): DiagnosedRow | undefined {
  const row = listRows(MODULE_KEY).find((item) => Number(item.id) === id)
  return row ? withDiagnosis(row) : undefined
}

// 明细面板：一张定值单含若干定值项，计算依据与列表共用同一份诊断结果。
export type SettingSheet = {
  sheetNo: string
  device: string
  status: string
  rows: DiagnosedRow[]
  missingCount: number
  abnormalCount: number
  complete: boolean
}

export function getSettingSheet(sheetNo: string): SettingSheet | undefined {
  const sourceRows = listRows(MODULE_KEY)
    .filter((row) => text(row, '定值单号') === sheetNo)
    .sort((a, b) => Number(a.id) - Number(b.id))
  const rows = sourceRows.map(withDiagnosis)
  if (rows.length === 0) {
    return undefined
  }
  const missingCount = rows.reduce((sum, row) => sum + row.diagnosis.missingFields.length, 0)
  const abnormalCount = rows.reduce(
    (sum, row) => sum + row.diagnosis.issues.filter((issue) => issue.kind === 'abnormal').length,
    0,
  )
  return {
    sheetNo,
    device: rows[0] ? String(rows[0]['所属装置'] ?? '') : '',
    status: rows[0] ? String(rows[0].status) : '',
    rows,
    missingCount,
    abnormalCount,
    complete: missingCount === 0 && abnormalCount === 0,
  }
}

export function nextSettingId(): number {
  const ids = listRows(MODULE_KEY).map((row) => Number(row.id))
  return ids.reduce((max, id) => Math.max(max, id), 0) + 1
}

export type SettingDraft = {
  定值单号: string
  所属装置: string
  定值项目: string
  整定值: string
  整定人: string
  审核人: string
}

// 保存前校验：必填写不全、定值项不在办法目录、整定值超出装置范围，一律挡回。
// 整定值 / 计算依据可以先空着（缺项行），计算依据按整定办法自动带出。
export function saveSettingEntry(draft: SettingDraft): ActionResult & { id?: number } {
  const normalized = {
    定值单号: draft.定值单号.trim(),
    所属装置: draft.所属装置.trim(),
    定值项目: draft.定值项目.trim(),
    整定值: draft.整定值.trim(),
    整定人: draft.整定人.trim(),
    审核人: draft.审核人.trim(),
  }

  for (const field of REQUIRED_FIELDS) {
    if (!normalized[field]) {
      return { ok: false, message: `${field}必须写全后才能保存` }
    }
  }

  const rule = findRule(normalized.定值项目)
  if (!rule) {
    return {
      ok: false,
      message: `定值项目「${normalized.定值项目}」不在既有整定办法目录内，请先在整定办法中登记`,
    }
  }

  if (normalized.整定值 !== '') {
    const numeric = parseNumeric(normalized.整定值)
    if (numeric === undefined) {
      return { ok: false, message: '整定值必须是数值，已挡回保存' }
    }
    if (numeric < rule.min || numeric > rule.max) {
      return {
        ok: false,
        message: `整定值 ${numeric}${rule.unit} 超出装置允许整定范围 ${rule.min}~${rule.max}${rule.unit}，已挡回保存`,
      }
    }
  }

  const rows = [...listRows(MODULE_KEY)]
  const id = nextSettingId()
  const entry: EntryRow = {
    id,
    status: '待整定',
    pending: true,
    abnormal: false,
    ...normalized,
    // 计算依据沿用既有整定办法，列表与明细面板读到的始终是这一份。
    计算依据: rule.basis,
    定值状态: '待整定',
  }
  rows.push(entry)
  persist(rows)
  return { ok: true, message: `定值项已登记（编号 ${id}），单号 ${normalized.定值单号}`, id }
}

// 补录整定值：校验口径与登记一致，超出装置范围同样挡回。
export function updateSettingValue(id: number, value: string, operator: string): ActionResult {
  const trimmed = value.trim()
  const rows = [...listRows(MODULE_KEY)]
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的定值项` }
  }
  const current = rows[index]
  if (String(current.status) === '已作废') {
    return { ok: false, message: '该定值项所在定值单已作废，不能补录' }
  }
  const rule = findRule(text(current, '定值项目'))
  if (!rule) {
    return { ok: false, message: '定值项目不在既有整定办法目录内，无法核对装置范围' }
  }
  if (trimmed === '') {
    return { ok: false, message: '补录整定值不能为空；仍未确定的缺项请保留在列表中' }
  }
  const numeric = parseNumeric(trimmed)
  if (numeric === undefined) {
    return { ok: false, message: '整定值必须是数值，已挡回保存' }
  }
  if (numeric < rule.min || numeric > rule.max) {
    return {
      ok: false,
      message: `整定值 ${numeric}${rule.unit} 超出装置允许整定范围 ${rule.min}~${rule.max}${rule.unit}，已挡回保存`,
    }
  }

  rows[index] = { ...current, 整定值: String(numeric), 整定人: operator.trim() || text(current, '整定人') }
  persist(rows)
  return { ok: true, message: `编号 ${id} 的整定值已补录为 ${numeric}${rule.unit}` }
}

function persist(rows: EntryRow[]): void {
  // 落库前同步异常标记，看板异常量与页面行内标注保持一致。
  const synced = rows.map((row) => {
    const diagnosis = diagnoseRow(row)
    return { ...row, abnormal: diagnosis.issues.some((issue) => issue.kind === 'abnormal') }
  })
  saveRows(MODULE_KEY, synced)
}

type SubmitLog = Record<string, { at: string; fromStatus: string }>

function readSubmitLog(): SubmitLog {
  return readJSON<SubmitLog>(SUBMIT_LOG_KEY, {})
}

function findSheetRows(rows: EntryRow[], sheetNo: string): number[] {
  return rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => text(row, '定值单号') === sheetNo)
    .map(({ index }) => index)
}

function isNegative(action: string): boolean {
  return NEGATIVE_PREFIXES.some((verb) => action.startsWith(verb))
}

// 整单流转：同一定值单下全部定值项一起改状态。
// 「提交整定」对同一张单只记一次；缺项/异常未清的单据不能提交整定与审核；
// 「作废定值」同步在定值审批的待送审清单落一条待送审记录。
export function runSheetAction(sheetNo: string, action: string): ActionResult {
  const rows = [...listRows(MODULE_KEY)]
  const indexes = findSheetRows(rows, sheetNo)
  if (indexes.length === 0) {
    return { ok: false, message: `没有找到定值单 ${sheetNo}` }
  }

  const current = String(rows[indexes[0]].status)
  const negative = isNegative(action)

  let target: string
  if (action === '提交整定') {
    target = '整定中'
  } else if (action === '审核定值') {
    target = '已审核'
  } else if (action === '作废定值') {
    target = '已作废'
  } else {
    return { ok: false, message: `定值单没有登记「${action}」这个动作` }
  }

  if (action === '提交整定') {
    // 同一张定值单重复提交整定只记一次：无论重复点按多少次都不再产生新的提交。
    const log = readSubmitLog()
    if (log[sheetNo]) {
      return {
        ok: false,
        message: `定值单 ${sheetNo} 已于 ${log[sheetNo].at} 提交整定，重复提交只记一次`,
      }
    }
  }

  if (current === target) {
    return { ok: false, message: `定值单 ${sheetNo} 已经是「${target}」，不用重复操作` }
  }
  if (current === '已作废' && !negative) {
    return { ok: false, message: `定值单 ${sheetNo} 已作废，不能再执行「${action}」` }
  }

  if (!negative) {
    // 提交整定 / 审核定值前，缺项与异常必须清零。
    const diagnoses = indexes.map((index) => diagnoseRow(rows[index]))
    const missing = diagnoses.reduce((sum, item) => sum + item.missingFields.length, 0)
    const abnormal = diagnoses.reduce(
      (sum, item) => sum + item.issues.filter((issue) => issue.kind === 'abnormal').length,
      0,
    )
    if (missing > 0 || abnormal > 0) {
      return {
        ok: false,
        message: `定值单 ${sheetNo} 还有 ${missing} 项缺项、${abnormal} 项异常，${action}已挡回`,
      }
    }
  }

  if (action === '提交整定') {
    const now = new Date().toISOString().slice(0, 10)
    writeJSON(SUBMIT_LOG_KEY, { ...readSubmitLog(), [sheetNo]: { at: now, fromStatus: current } })
  }

  for (const index of indexes) {
    rows[index] = {
      ...rows[index],
      status: target,
      pending: target !== SHEET_STATUSES[SHEET_STATUSES.length - 1],
      abnormal: negative ? true : diagnoseRow(rows[index]).issues.some((i) => i.kind === 'abnormal'),
      定值状态: target,
    }
  }
  persist(rows)

  if (action === '作废定值') {
    const approveResult = createVoidApproval(sheetNo, indexes.map((index) => rows[index]))
    if (!approveResult.ok) {
      return { ok: true, message: `定值单 ${sheetNo} 已作废；${approveResult.message}` }
    }
  }

  return { ok: true, message: `定值单 ${sheetNo} 已${action}，当前状态「${target}」` }
}

// 作废结论落到定值审批的待送审清单：同单只保留一条，重复作废不新增。
function createVoidApproval(sheetNo: string, sheetRows: EntryRow[]): ActionResult {
  const approvals = [...listRows(APPROVE_KEY)]
  const existing = approvals.find(
    (row) =>
      String(row['关联定值单'] ?? '') === sheetNo && String(row['审批意见'] ?? '').includes('作废'),
  )
  if (existing) {
    return { ok: true, message: '待送审清单已有该作废单' }
  }

  const nextId = approvals.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const device = sheetRows[0] ? String(sheetRows[0]['所属装置'] ?? '') : ''
  approvals.push({
    id: nextId,
    status: '待送审',
    pending: true,
    abnormal: true,
    审批单号: `APV-${String(nextId).padStart(4, '0')}`,
    关联定值单: sheetNo,
    审批层级: '作废复审',
    送审人: '系统自动',
    审批人: '',
    送审日期: new Date().toISOString().slice(0, 10),
    审批意见: `定值单作废结论，所属装置 ${device}，待送审确认`,
    审批状态: '待送审',
  })
  saveRows(APPROVE_KEY, approvals)
  return { ok: true, message: '作废结论已进入定值审批待送审清单' }
}

const EXPORT_COLUMNS = [
  '定值单号',
  '所属装置',
  '定值项目',
  '整定值',
  '计算依据',
  '整定人',
  '审核人',
]

function csvCell(value: unknown): string {
  const textValue = String(value ?? '')
  if (/[",\n\r]/.test(textValue)) {
    return `"${textValue.replace(/"/g, '""')}"`
  }
  return textValue
}

type ExportCursor = { ids: number[]; stoppedId: number }

function readCursor(): ExportCursor | null {
  return readJSON<ExportCursor | null>(EXPORT_CURSOR_KEY, null)
}

function writeCursor(cursor: ExportCursor | null): void {
  writeJSON(EXPORT_CURSOR_KEY, cursor)
}

export function hasExportResume(): boolean {
  return readCursor() !== null
}

// 导出：缺项行照常导出并在「校验提示」列注明；异常行（非数值/超出装置范围/项目无办法）
// 会在该行断开并记下断点，下一次「从断点续导」跳过断点行继续，最终整份文件都能拿到。
export function exportSettingEntries(
  filters: Record<string, string> = {},
  resume = false,
): ExportResult {
  const { items } = listSettingEntries(filters)
  if (items.length === 0) {
    return {
      ok: false,
      filename: '定值整定-清单.csv',
      content: '',
      exportedRows: 0,
      totalRows: 0,
      message: '当前筛选条件下没有可导出的定值记录',
    }
  }

  const ids = items.map((row) => Number(row.id))
  const saved = readCursor()
  let skippedId: number | undefined
  if (resume) {
    if (!saved || saved.ids.join('|') !== ids.join('|')) {
      return {
        ok: false,
        filename: '定值整定-清单.csv',
        content: '',
        exportedRows: 0,
        totalRows: items.length,
        message: '列表已变化，断点失效，请重新导出',
      }
    }
    skippedId = saved.stoppedId
  } else {
    writeCursor(null)
  }

  const header = ['编号', ...EXPORT_COLUMNS, '当前状态', '校验提示']
  const lines = [header.map(csvCell).join(',')]
  let stoppedAt: number | undefined
  let stopMessage = ''

  for (let index = 0; index < items.length; index += 1) {
    const row = items[index]
    const rowNo = index + 1
    const fieldValue = (field: string): string =>
      field === '整定值'
        ? row.displayValue
        : field === '计算依据'
          ? row.basisText
          : String((row as unknown as Record<string, string | number | boolean>)[field] ?? '')

    if (skippedId === Number(row.id)) {
      // 续导：断过的行保留原始整定值并标注隔离原因，不再二次中断。
      lines.push(
        [
          row.id,
          ...EXPORT_COLUMNS.map(fieldValue),
          row.status,
          `断点行已隔离：${row.diagnosis.issues.map((issue) => issue.message).join('；') || '异常值'}`,
        ]
          .map(csvCell)
          .join(','),
      )
      continue
    }

    const abnormalIssue: SettingIssue | undefined = row.diagnosis.issues.find(
      (issue) => issue.kind === 'abnormal',
    )
    if (abnormalIssue && !resume) {
      stoppedAt = rowNo
      stopMessage = abnormalIssue.message
      writeCursor({ ids, stoppedId: Number(row.id) })
      break
    }

    const tips = row.diagnosis.issues.map((issue) => issue.message).join('；')
    lines.push(
      [row.id, ...EXPORT_COLUMNS.map(fieldValue), row.status, tips].map(csvCell).join(','),
    )
  }

  const exportedRows = lines.length - 1
  const filename = '定值整定-清单.csv'

  if (stoppedAt) {
    return {
      ok: false,
      filename,
      content: `﻿${lines.join('\n')}`,
      exportedRows,
      totalRows: items.length,
      stoppedAt,
      message: `导出在第 ${stoppedAt} 行中断（${stopMessage}）。已保留前 ${exportedRows} 行，可从断点续导`,
    }
  }

  writeCursor(null)
  return {
    ok: true,
    filename,
    content: `﻿${lines.join('\n')}`,
    exportedRows,
    totalRows: items.length,
    message:
      resume && skippedId !== undefined
        ? `已从第 ${ids.indexOf(skippedId) + 1} 行续导完成，共 ${exportedRows} 行（断点行已在文件中标注隔离）`
        : `导出完成，共 ${exportedRows} 行`,
  }
}

export function downloadContent(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}
