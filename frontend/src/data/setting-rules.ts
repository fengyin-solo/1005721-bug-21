import type { SettingRule } from './types'

// 整定办法（口径的唯一来源）：
// 定值单列表与明细面板共用这一份计算依据；新增定值项时也按它校验装置可整定范围。
// min/max 为装置允许整定范围（二次侧实际可输入值）。
export const SETTING_RULES: SettingRule[] = [
  {
    key: 'i段电流',
    item: '电流速断保护定值（I段）',
    basis: '躲过本线路末端最大三相短路电流，Kk=1.2~1.3；I 段一次定值=Kk·Ik3.max，按 TA 变比折算二次值',
    min: 0.5,
    max: 100,
    unit: 'A',
  },
  {
    key: 'ii段电流',
    item: '限时电流速断定值（II段）',
    basis: '与相邻线路 I 段配合，Kk=1.1~1.2、Kfz 取 1.0；II 段一次定值=Kk·Kfz·I′dz.邻，按 TA 变比折算二次值',
    min: 0.5,
    max: 100,
    unit: 'A',
  },
  {
    key: 'iii段电流',
    item: '定时限过电流定值（III段）',
    basis: '躲过线路最大负荷电流，Kk=1.2、Kf=0.85；I 段一次定值=Kk·Ifh.max/Kf，按 TA 变比折算二次值',
    min: 0.5,
    max: 100,
    unit: 'A',
  },
  {
    key: 'i段时间',
    item: '电流速断动作时间（I段）',
    basis: '按固有动作时间整定，取装置固有时间 0s',
    min: 0,
    max: 10,
    unit: 's',
  },
  {
    key: 'ii段时间',
    item: '限时电流速断动作时间（II段）',
    basis: '与相邻线路 I 段配合，tII=t′I.邻+Δt，级差 Δt=0.5s',
    min: 0,
    max: 10,
    unit: 's',
  },
  {
    key: 'iii段时间',
    item: '定时限过电流动作时间（III段）',
    basis: '阶梯型时限特性，与相邻元件后备保护配合，tIII=tIII.邻+Δt，级差 Δt=0.5s',
    min: 0,
    max: 10,
    unit: 's',
  },
  {
    key: '零序i段',
    item: '零序电流速断定值（零序I段）',
    basis: '躲过本线路末端接地故障最大 3I0，Kk=1.25~1.3；3I0Ⅰ=Kk·3I0.max',
    min: 0.1,
    max: 30,
    unit: 'A',
  },
  {
    key: '零序过流',
    item: '零序过电流定值',
    basis: '躲过正常运行最大不平衡电流，Kk=1.2~1.3；3I0=Kk·3I0.bp.max',
    min: 0.1,
    max: 30,
    unit: 'A',
  },
  {
    key: '过负荷',
    item: '过负荷告警定值',
    basis: '躲过线路额定负荷电流，Kk=1.05~1.1；Ifh=Kk·Ie',
    min: 0.5,
    max: 100,
    unit: 'A',
  },
  {
    key: '重合闸',
    item: '三相一次重合闸时间',
    basis: '按对侧电源解列及故障点去游离时间整定，架空线路取 0.7~1.0s',
    min: 0.2,
    max: 10,
    unit: 's',
  },
  {
    key: '低电压',
    item: '低电压闭锁定值',
    basis: '躲过电动机自启动最低工作电压，按额定线电压百分数整定，一般 0.65~0.70Ue',
    min: 30,
    max: 120,
    unit: 'V',
  },
  {
    key: '过电压',
    item: '过电压保护定值',
    basis: '躲过系统最高运行电压，按额定线电压百分数整定，一般 1.10~1.15Ue',
    min: 80,
    max: 150,
    unit: 'V',
  },
]

export const SETTING_RULE_BY_KEY: Map<string, SettingRule> = new Map(
  SETTING_RULES.map((rule) => [rule.key, rule]),
)

export function findRule(itemName: string): SettingRule | undefined {
  const trimmed = itemName.trim()
  return SETTING_RULES.find((rule) => rule.item === trimmed)
}

// 定值项展示名（含单位）：列表与明细面板都从这里取，保证口径一致。
export function formatSettingValue(value: string, rule?: SettingRule): string {
  if (!value.trim() || !rule) {
    return value
  }
  return rule.unit ? `${value} ${rule.unit}` : value
}
