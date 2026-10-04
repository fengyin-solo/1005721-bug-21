import type { EntryRow } from './types'

// 既有《继电保护定值整定办法》的口径：列表与明细面板共用这一份，谁也不许各写一版。
// 条款号、可靠系数、取值范围都按现行办法录入；办法换版只改这里。

export type SettingUnit = 'A' | 's' | 'In'

export type SettingRule = {
  item: string
  clause: string
  basis: string
  min: number
  max: number
  unit: SettingUnit
}

export type ValueRange = { min: number; max: number; unit: string }

export type SettingIssue = {
  field: string
  kind: 'missing' | 'invalid' | 'out-of-range'
  message: string
}

export type SettingValidation = {
  issues: SettingIssue[]
  missing: SettingIssue[]
  abnormal: SettingIssue[]
  range: ValueRange | null
  valueNumber: number | null
}

export type BasisResult = {
  text: string
  // recorded=行内已登记；rule=行内空，按整定办法口径补；missing=无办法可依，属缺项
  source: 'recorded' | 'rule' | 'missing'
}

export const SETTING_RULES: SettingRule[] = [
  {
    item: '过流Ⅰ段',
    clause: '3.2.1',
    basis: '躲过线路末端最大三相短路电流，可靠系数 Kk=1.3',
    min: 0.1,
    max: 999.9,
    unit: 'A',
  },
  {
    item: '过流Ⅱ段',
    clause: '3.2.2',
    basis: '与相邻线路过流Ⅰ段配合，可靠系数 Kk=1.1',
    min: 0.1,
    max: 999.9,
    unit: 'A',
  },
  {
    item: '过流Ⅲ段',
    clause: '3.2.3',
    basis: '躲过最大负荷电流并与相邻线路过流Ⅱ段配合，可靠系数 Kk=1.15，返回系数 Kh=0.85',
    min: 0.1,
    max: 999.9,
    unit: 'A',
  },
  {
    item: '零序Ⅰ段',
    clause: '3.3.1',
    basis: '躲过本线路末端接地故障最大零序电流，可靠系数 Kk=1.3',
    min: 0.1,
    max: 999.9,
    unit: 'A',
  },
  {
    item: '零序Ⅱ段',
    clause: '3.3.2',
    basis: '与相邻线路零序Ⅰ段配合，可靠系数 Kk=1.1',
    min: 0.1,
    max: 999.9,
    unit: 'A',
  },
  {
    item: '重合闸',
    clause: '4.1.2',
    basis: '单相重合闸整定时间按规程取 0.5～3.0s，并与对侧保护配合',
    min: 0.1,
    max: 9.0,
    unit: 's',
  },
  {
    item: '过负荷告警',
    clause: '3.4.1',
    basis: '躲过额定负荷电流，可靠系数 Kk=1.05',
    min: 0.1,
    max: 999.9,
    unit: 'A',
  },
]

// 装置整定范围：按「所属装置」里出现的型号关键字匹配，比办法通用范围更严时以装置为准。
const DEVICE_LIMITS: Record<string, Partial<Record<'current' | 'time', ValueRange>>> = {
  PCS: {
    current: { min: 0.1, max: 999.9, unit: 'A' },
    time: { min: 0.1, max: 9.0, unit: 's' },
  },
  CSC: {
    current: { min: 0.1, max: 99.9, unit: 'A' },
    time: { min: 0.1, max: 9.0, unit: 's' },
  },
  NSR: {
    current: { min: 0.1, max: 99.9, unit: 'A' },
    time: { min: 0.1, max: 9.0, unit: 's' },
  },
}

const GENERIC_LIMITS = {
  current: { min: 0.1, max: 999.9, unit: 'A' },
  time: { min: 0.1, max: 9.0, unit: 's' },
}

export function findRule(item: string): SettingRule | undefined {
  const name = item.trim()
  if (!name) {
    return undefined
  }
  return SETTING_RULES.find((rule) => name === rule.item || name.includes(rule.item))
}

// 列表与明细面板唯一允许取「计算依据」的入口：行内已登记用行内的；空着就按整定办法补口径；
// 办法里也查不到才算缺项。两处看到的永远是同一份结果。
export function resolveCalculationBasis(row: EntryRow): BasisResult {
  const recorded = String(row['计算依据'] ?? '').trim()
  if (recorded) {
    return { text: recorded, source: 'recorded' }
  }
  const rule = findRule(String(row['定值项目'] ?? ''))
  if (rule) {
    return {
      text: `按整定办法${rule.clause}条：${rule.basis}`,
      source: 'rule',
    }
  }
  return { text: '', source: 'missing' }
}

type ParsedValue = { value: number; unit: string }

// 兼容「600A」「1.2In」「0.5s」「1.2kA」这类带单位写法；无法解析返回 null，交校验判异常值。
export function parseSettingValue(raw: unknown): ParsedValue | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return { value: raw, unit: '' }
  }
  const text = String(raw ?? '').trim()
  if (!text) {
    return null
  }
  const matched = text.match(/-?\d+(?:\.\d+)?/)
  if (!matched) {
    return null
  }
  let value = Number(matched[0])
  const unit = text.replace(matched[0], '').trim()
  if (/kA/i.test(unit)) {
    value *= 1000
  }
  if (unit === 'ms') {
    value /= 1000
  }
  if (!Number.isFinite(value)) {
    return null
  }
  return { value, unit }
}

function resolveRange(row: EntryRow, rule: SettingRule | undefined): ValueRange | null {
  const device = String(row['所属装置'] ?? '')
  const matchedKey = Object.keys(DEVICE_LIMITS).find((key) => device.includes(key))
  const kind = rule && rule.unit === 's' ? 'time' : 'current'
  const deviceRange = matchedKey ? DEVICE_LIMITS[matchedKey][kind] : undefined
  const generic = GENERIC_LIMITS[kind]
  if (!rule) {
    return deviceRange ?? generic
  }
  const base = { min: rule.min, max: rule.max, unit: rule.unit }
  if (!deviceRange) {
    return base
  }
  // 办法范围与装置范围取交集，谁严按谁来。
  return {
    min: Math.max(base.min, deviceRange.min),
    max: Math.min(base.max, deviceRange.max),
    unit: rule.unit,
  }
}

function isBlank(value: unknown): boolean {
  return String(value ?? '').trim() === ''
}

// 对一行定值单做完整体检：缺项、异常值、超范围都在这判，列表/明细/保存共用。
export function validateSettingRow(row: EntryRow): SettingValidation {
  const issues: SettingIssue[] = []
  const missing: SettingIssue[] = []
  const abnormal: SettingIssue[] = []

  const pushMissing = (field: string, message: string) => {
    const issue: SettingIssue = { field, kind: 'missing', message }
    issues.push(issue)
    missing.push(issue)
  }

  if (isBlank(row['定值单号'])) {
    pushMissing('定值单号', '缺定值单号')
  }
  if (isBlank(row['定值项目'])) {
    pushMissing('定值项目', '缺定值项目')
  }

  const rule = findRule(String(row['定值项目'] ?? ''))
  const basis = resolveCalculationBasis(row)
  if (basis.source === 'missing') {
    pushMissing('计算依据', '缺计算依据（整定办法中无对应口径）')
  }

  const range = resolveRange(row, rule)
  let valueNumber: number | null = null
  if (isBlank(row['整定值'])) {
    pushMissing('整定值', '缺整定值')
  } else {
    const parsed = parseSettingValue(row['整定值'])
    if (!parsed || parsed.value < 0) {
      const issue: SettingIssue = {
        field: '整定值',
        kind: 'invalid',
        message: `整定值「${String(row['整定值'])}」无法核定，按异常值处理`,
      }
      issues.push(issue)
      abnormal.push(issue)
    } else {
      valueNumber = parsed.value
      if (range && (parsed.value < range.min || parsed.value > range.max)) {
        const issue: SettingIssue = {
          field: '整定值',
          kind: 'out-of-range',
          message: `整定值 ${parsed.value}${range.unit} 超出装置允许范围 ${range.min}～${range.max}${range.unit}`,
        }
        issues.push(issue)
        abnormal.push(issue)
      }
    }
  }

  return { issues, missing, abnormal, range, valueNumber }
}

export function issueSummary(row: EntryRow): string {
  return validateSettingRow(row)
    .issues.map((issue) => issue.message)
    .join('；')
}
