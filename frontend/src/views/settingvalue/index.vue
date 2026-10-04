<template>
  <section class="page" data-module="settingvalue">
    <header class="page-head">
      <div>
        <h2>定值整定管理</h2>
        <p class="page-desc">维护定值单，围绕定值单号、所属装置、定值项目、整定值做登记、筛选与状态流转；缺项行照样列出并在行内注明。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记定值项</button>
        <button class="btn" type="button" @click="exportRows(false)">导出定值整定清单</button>
        <button v-if="canResume" class="btn warn" type="button" @click="exportRows(true)">
          从断点行续导
        </button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong :class="item.tone">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table setting-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>校核提示</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)" :class="{ 'row-abnormal': row.abnormal }">
          <td>
            <button class="link" type="button" @click="openDetail(String(row['定值单号']))">
              {{ row['定值单号'] || '—' }}
            </button>
            <span v-if="isMissing(row, '定值单号')" class="tag miss">缺定值单号</span>
          </td>
          <td>
            {{ row['所属装置'] || '—' }}
            <span v-if="isMissing(row, '所属装置')" class="tag miss">缺所属装置</span>
          </td>
          <td>
            {{ row['定值项目'] || '—' }}
            <span v-if="isMissing(row, '定值项目')" class="tag miss">缺定值项目</span>
          </td>
          <td>
            <span v-if="row.displayValue" :class="{ 'value-abnormal': isAbnormal(row, '整定值') }">
              {{ row.displayValue }}
            </span>
            <span v-else class="cell-missing">缺整定值</span>
            <span v-if="isAbnormal(row, '整定值')" class="tag bad">异常值</span>
          </td>
          <td class="basis-cell">
            <span>{{ row.basisText }}</span>
            <span v-if="isMissing(row, '计算依据')" class="tag miss">缺计算依据（已按整定办法补口径）</span>
          </td>
          <td>{{ row['整定人'] || '—' }}</td>
          <td>{{ row['审核人'] || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="issue-cell">
            <template v-if="row.diagnosis.issues.length">
              <p
                v-for="issue in row.diagnosis.issues"
                :key="issue.field + issue.kind"
                :class="issue.kind === 'missing' ? 'tag miss' : 'tag bad'"
              >
                {{ issue.message }}
              </p>
            </template>
            <span v-else class="tag ok">完整</span>
            <button
              v-if="canFill(row)"
              class="link inline-link"
              type="button"
              @click="openFill(row.id)"
            >
              补录整定值
            </button>
          </td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action.name"
              :class="['link', { danger: action.danger }]"
              type="button"
              @click="runAction(action.name, String(row['定值单号']))"
            >
              {{ action.name }}
            </button>
            <button class="link" type="button" @click="openDetail(String(row['定值单号']))">明细</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">
            {{ emptyText }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条定值整定记录（缺项行照常列出）</span>
      <span v-if="message" :class="messageTone">{{ message }}</span>
    </footer>

    <SettingSheetDetail
      v-if="detailSheet"
      :sheet="detailSheet"
      @close="detailSheet = undefined"
      @action="handleSheetAction"
    />
    <SettingFormModal
      v-if="formMode"
      :mode="formMode"
      :entry-id="fillEntryId"
      :operator="operator"
      @close="formMode = null"
      @saved="onSaved"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadContent,
  exportSettingEntries,
  getSettingSheet,
  hasExportResume,
  listSettingEntries,
  runSheetAction,
  type DiagnosedRow,
} from '@/api/setting-service'
import { useSessionStore } from '@/stores/session'
import type { SettingSheet } from '@/api/setting-service'
import SettingFormModal from './components/SettingFormModal.vue'
import SettingSheetDetail from './components/SettingSheetDetail.vue'

const session = useSessionStore()
const operator = session.operator

const columns = ['定值单号', '所属装置', '定值项目', '整定值', '计算依据', '整定人', '审核人']
const actions = [
  { name: '提交整定', danger: false },
  { name: '审核定值', danger: false },
  { name: '作废定值', danger: true },
]
const statuses = ['待整定', '整定中', '已审核', '已作废']

const rows = ref<DiagnosedRow[]>([])
const total = ref(0)
const filters = ref<Record<string, string>>({})
const filterFields = ['定值单号', '所属装置', '定值项目']
const message = ref('')
const messageError = ref(false)

const detailSheet = ref<SettingSheet | undefined>(undefined)
const formMode = ref<'create' | 'fill' | null>(null)
const fillEntryId = ref<number | undefined>(undefined)
const canResume = ref(false)

const hasFilter = computed(() =>
  Object.values(filters.value).some((value) => value.trim() !== ''),
)

const emptyText = computed(() =>
  hasFilter.value
    ? '当前筛选条件下没有定值记录：缺项行也会照常列出，请放宽或重置查询条件'
    : '暂无定值整定数据：可先登记定值项；整定值或计算依据留空的缺项行也会在这里列出',
)

const stats = computed(() => {
  const all = listSettingEntries({}).items
  const missingRows = all.filter((row) => row.diagnosis.missingFields.length > 0).length
  const abnormalRows = all.filter((row) =>
    row.diagnosis.issues.some((issue) => issue.kind === 'abnormal'),
  ).length
  const voidCount = all.filter((row) => String(row.status) === '已作废').length
  return [
    { label: '登记定值项', value: all.length, tone: 'stat-value' },
    { label: '缺项待补', value: missingRows, tone: missingRows ? 'stat-warn' : 'stat-value' },
    { label: '异常值（含超出装置范围）', value: abnormalRows, tone: abnormalRows ? 'stat-bad' : 'stat-value' },
    { label: '已作废定值单', value: voidCount, tone: 'stat-value' },
  ]
})

const statusSummary = computed(() =>
  statuses.map((status: string) => {
    const sheetNos = new Set(
      rows.value.filter((row) => String(row.status) === status).map((row) => row['定值单号']),
    )
    return { status, count: sheetNos.size }
  }),
)

const messageTone = computed(() => (messageError.value ? 'error-text' : 'ok-text'))

function isMissing(row: DiagnosedRow, field: string): boolean {
  return row.diagnosis.missingFields.includes(field)
}

function isAbnormal(row: DiagnosedRow, field: string): boolean {
  return row.diagnosis.issues.some((issue) => issue.field === field && issue.kind === 'abnormal')
}

function canFill(row: DiagnosedRow): boolean {
  return isMissing(row, '整定值') && String(row.status) !== '已作废'
}

function setNotice(text: string, isError = false): void {
  message.value = text
  messageError.value = isError
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  message.value = ''
  // 每次查询重取持久层，杜绝「再查变回上一次结果、和列表对不上」。
  const payload = listSettingEntries(filters.value)
  rows.value = payload.items
  total.value = payload.total
  canResume.value = hasExportResume()
}

function exportRows(resume: boolean) {
  const result = exportSettingEntries(filters.value, resume)
  if (result.exportedRows > 0) {
    downloadContent(result.filename, result.content)
  }
  canResume.value = hasExportResume()
  setNotice(result.message, !result.ok)
}

function openCreate() {
  formMode.value = 'create'
  fillEntryId.value = undefined
}

function openFill(id: number) {
  formMode.value = 'fill'
  fillEntryId.value = id
}

function openDetail(sheetNo: string) {
  detailSheet.value = getSettingSheet(sheetNo)
}

function runAction(action: string, sheetNo: string) {
  if (!sheetNo) {
    setNotice('该行缺定值单号，无法按单流转，请先补全定值单号', true)
    return
  }
  const result = runSheetAction(sheetNo, action)
  setNotice(result.message, !result.ok)
  reload()
  if (detailSheet.value && detailSheet.value.sheetNo === sheetNo) {
    detailSheet.value = result.ok ? undefined : getSettingSheet(sheetNo)
  }
}

function handleSheetAction(action: string, sheetNo: string) {
  runAction(action, sheetNo)
}

function onSaved(text: string) {
  formMode.value = null
  fillEntryId.value = undefined
  setNotice(text, false)
  reload()
}

onMounted(reload)
</script>
