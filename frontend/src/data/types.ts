/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

// 整定办法：计算依据口径 + 装置允许整定范围，列表与明细面板共用。
export type SettingRule = {
  key: string
  item: string
  basis: string
  min: number
  max: number
  unit: string
}

// 一行定值缺在哪 / 异常在哪：缺项照样列出，在行内直接注明。
export type SettingIssue = {
  field: string
  kind: 'missing' | 'abnormal'
  message: string
}

export type SettingRowDiagnosis = {
  missingFields: string[]
  issues: SettingIssue[]
  outOfRange: boolean
  complete: boolean
  rule?: SettingRule
  numericValue?: number
}

// 导出可在断掉的那行续导：stoppedAt 给出断点行（列表序号，从 1 开始）。
export type ExportResult = {
  ok: boolean
  filename: string
  content: string
  exportedRows: number
  totalRows: number
  stoppedAt?: number
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
