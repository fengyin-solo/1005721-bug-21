<template>
  <section class="page" data-module="settingvalue">
    <header class="page-head">
      <div>
        <h2>定值整定管理</h2>
        <p class="page-desc">维护定值单，围绕定值单号、所属装置、定值项目、整定值做登记、筛选与状态流转；缺项行照样列出并逐行标注。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记定值单</button>
        <button class="btn" type="button" @click="exportRows">导出定值整定清单</button>
        <button v-if="checkpoint" class="btn" type="button" @click="resumeExport">
          从断点续导（第 {{ checkpoint.at }} 行）
        </button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="{ 'stat-warn': item.warn }">{{ item.value }}</strong>
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

    <p v-if="checkpoint" class="checkpoint-tip">
      上次导出在第 {{ checkpoint.at }} 行中断（共 {{ checkpoint.total }} 行），可点「从断点续导」从该行重来；
      <button class="link" type="button" @click="discardCheckpoint">放弃断点</button>
    </p>

    <table class="data-table setting-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>缺项/异常标注</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="view in views"
          :key="String(view.row.id)"
          :class="{
            'row-missing': view.validation.missing.length > 0,
            'row-abnormal': view.validation.abnormal.length > 0,
          }"
        >
          <td>
            <button class="link" type="button" @click="openDetail(view.row)">{{ view.row['定值单号'] || '【缺定值单号】' }}</button>
          </td>
          <td>{{ view.row['所属装置'] || '—' }}</td>
          <td>{{ view.row['定值项目'] || '【缺定值项目】' }}</td>
          <td>
            <span v-if="view.row['整定值'] === '' || view.row['整定值'] === undefined" class="tag tag-missing">【缺整定值】</span>
            <span v-else :class="{ 'tag-abnormal': view.validation.abnormal.some((i) => i.field === '整定值') }">
              {{ view.row['整定值'] }}
              <span v-if="view.validation.abnormal.some((i) => i.field === '整定值')" class="tag tag-abnormal-inline">异常值</span>
            </span>
          </td>
          <td>
            {{ view.basis.text || '' }}
            <span v-if="view.basis.source === 'recorded'" class="basis-source">（行内登记）</span>
            <span v-else-if="view.basis.source === 'rule'" class="basis-source rule">（按整定办法补）</span>
            <span v-else class="tag tag-missing">【缺计算依据】</span>
          </td>
          <td>{{ view.row['整定人'] || '—' }}</td>
          <td>{{ view.row['审核人'] || '—' }}</td>
          <td>{{ view.row['定值状态'] || view.row.status }}</td>
          <td class="issue-cell">
            <template v-if="view.validation.issues.length">
              <p v-for="issue in view.validation.issues" :key="issue.field + issue.kind" class="issue-line"
                :class="issue.kind === 'missing' ? 'issue-missing' : 'issue-abnormal'">
                {{ issue.message }}
              </p>
            </template>
            <span v-else class="issue-ok">完整</span>
          </td>
          <td>{{ view.row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openDetail(view.row)">明细</button>
            <button class="link" type="button" @click="runAction('提交整定', view.row)">提交整定</button>
            <button class="link" type="button" @click="runAction('审核定值', view.row)">审核定值</button>
            <button class="link danger" type="button" @click="runAction('作废定值', view.row)">作废定值</button>
          </td>
        </tr>
        <tr v-if="!views.length">
          <td :colspan="columns.length + 3" class="empty-state">{{ emptyText }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条定值整定记录（缺项 {{ missingCount }} 条、异常值 {{ abnormalCount }} 条均已列出）</span>
      <span v-if="message" :class="messageOk ? 'ok-text' : 'error-text'">{{ message }}</span>
    </footer>

    <!-- 明细面板：与列表共用 decorate 出来的同一份计算依据与校验口径 -->
    <div v-if="detailView" class="modal-mask" @click.self="closeDetail">
      <div class="modal drawer">
        <header class="modal-head">
          <h3>定值单明细{{ detailView.row['定值单号'] ? `：${detailView.row['定值单号']}` : '' }}</h3>
          <button class="btn ghost" type="button" @click="closeDetail">关闭</button>
        </header>
        <div class="modal-body">
          <dl class="detail-list">
            <div v-for="field in columns" :key="field" class="detail-row">
              <dt>{{ field }}</dt>
              <dd>
                <template v-if="field === '整定值'">
                  <span v-if="detailView.row[field] === '' || detailView.row[field] === undefined" class="tag tag-missing">【缺整定值】</span>
                  <span v-else :class="{ 'tag-abnormal': detailView.validation.abnormal.some((i) => i.field === '整定值') }">
                    {{ detailView.row[field] }}
                  </span>
                  <span v-if="detailView.validation.range" class="range-hint">
                    装置允许范围 {{ detailView.validation.range.min }}～{{ detailView.validation.range.max }}{{ detailView.validation.range.unit }}
                  </span>
                </template>
                <template v-else-if="field === '计算依据'">
                  {{ detailView.basis.text }}
                  <span v-if="detailView.basis.source === 'recorded'" class="basis-source">（行内登记）</span>
                  <span v-else-if="detailView.basis.source === 'rule'" class="basis-source rule">（按整定办法补，与列表同一份口径）</span>
                  <span v-else class="tag tag-missing">【缺计算依据】</span>
                </template>
                <template v-else>
                  {{ detailView.row[field] || '—' }}
                  <span v-if="field === '定值单号' && !detailView.row[field]" class="tag tag-missing">缺</span>
                  <span v-if="field === '定值项目' && !detailView.row[field]" class="tag tag-missing">缺</span>
                </template>
              </dd>
            </div>
            <div class="detail-row">
              <dt>当前状态</dt>
              <dd>{{ detailView.row.status }}</dd>
            </div>
          </dl>

          <section class="issue-panel">
            <h4>缺项/异常核对</h4>
            <ul v-if="detailView.validation.issues.length" class="issue-list">
              <li v-for="issue in detailView.validation.issues" :key="issue.field + issue.kind"
                :class="issue.kind === 'missing' ? 'issue-missing' : 'issue-abnormal'">
                {{ issue.message }}
              </li>
            </ul>
            <p v-else class="issue-ok">各必填项齐全，整定值在装置允许范围内。</p>
          </section>
        </div>
        <footer class="modal-foot">
          <button class="btn primary" type="button" @click="openEdit(detailView.row)">编辑该单</button>
          <button class="btn" type="button" @click="closeDetail">关闭</button>
        </footer>
      </div>
    </div>

    <!-- 登记/编辑表单：单号、项目必填；整定值超装置范围在这里挡回保存 -->
    <div v-if="formOpen" class="modal-mask" @click.self="closeForm">
      <div class="modal">
        <header class="modal-head">
          <h3>{{ formId === undefined ? '登记定值单' : `编辑定值单 ${formDraft.定值单号 || ''}` }}</h3>
          <button class="btn ghost" type="button" @click="closeForm">关闭</button>
        </header>
        <form class="modal-body form-grid" @submit.prevent="submitForm">
          <label class="form-item required">
            <span>定值单号</span>
            <input v-model="formDraft.定值单号" placeholder="如 DZ-2026-0901，必填" />
          </label>
          <label class="form-item required">
            <span>定值项目</span>
            <input v-model="formDraft.定值项目" placeholder="如 过流Ⅰ段，必填" list="setting-items" />
            <datalist id="setting-items">
              <option v-for="rule in ruleItems" :key="rule" :value="rule" />
            </datalist>
          </label>
          <label class="form-item">
            <span>所属装置</span>
            <input v-model="formDraft.所属装置" placeholder="如 10kV东郊I线CSC-211" />
          </label>
          <label class="form-item">
            <span>整定值</span>
            <input v-model="formDraft.整定值" placeholder="如 600A / 1.2s；可暂空，但超装置范围会挡回" />
          </label>
          <label class="form-item wide">
            <span>计算依据（留空时按整定办法口径自动补）</span>
            <textarea v-model="formDraft.计算依据" rows="2" placeholder="留空则列表与明细按既有整定办法显示同一口径" />
          </label>
          <label class="form-item">
            <span>整定人</span>
            <input v-model="formDraft.整定人" />
          </label>
          <label class="form-item">
            <span>审核人</span>
            <input v-model="formDraft.审核人" />
          </label>
          <p v-if="formRangeHint" class="range-hint wide">{{ formRangeHint }}</p>
          <p v-if="formError" class="error-text wide">{{ formError }}</p>
        </form>
        <footer class="modal-foot">
          <button class="btn primary" type="button" @click="submitForm">保存</button>
          <button class="btn" type="button" @click="closeForm">取消</button>
        </footer>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  auditSetting,
  clearExportCheckpoint,
  decorate,
  emptyReason,
  exportAllSettings,
  exportCheckpoint,
  listSettingEntries,
  resumeExportSettings,
  saveSettingDraft,
  submitSetting,
  voidSetting,
  type SettingDraft,
  type SettingRowView,
} from '@/api/setting-service'
import { SETTING_RULES, validateSettingRow } from '@/data/setting-rules'
import type { EntryRow } from '@/data/types'
import { useSessionStore } from '@/stores/session'

const columns = ['定值单号', '所属装置', '定值项目', '整定值', '计算依据', '整定人', '审核人', '定值状态']
const filterFields = ['定值单号', '所属装置', '定值项目']
const statuses = ['待整定', '整定中', '已审核', '已作废']
const ruleItems = SETTING_RULES.map((rule) => rule.item)
const session = useSessionStore()

const rows = ref<EntryRow[]>([])
const views = ref<SettingRowView[]>([])
const total = ref(0)
const message = ref('')
const messageOk = ref(false)
const filters = ref<Record<string, string>>({})
const checkpoint = ref(exportCheckpoint())

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const missingCount = computed(() => views.value.filter((view) => view.validation.missing.length > 0).length)
const abnormalCount = computed(() => views.value.filter((view) => view.validation.abnormal.length > 0).length)
const stats = computed(() => [
  { label: '待整定定值单', value: statusSummary.value[0].count, warn: false },
  { label: '整定中定值单', value: statusSummary.value[1].count, warn: false },
  { label: '缺项待补', value: missingCount.value, warn: missingCount.value > 0 },
  { label: '异常值/超范围', value: abnormalCount.value, warn: abnormalCount.value > 0 },
  { label: '已作废定值单', value: statusSummary.value[3].count, warn: false },
])
const emptyText = computed(() => emptyReason(filters.value))

// 明细面板
const detailView = ref<SettingRowView | null>(null)

// 登记/编辑表单
const formOpen = ref(false)
const formId = ref<number | undefined>(undefined)
const formError = ref('')
const formDraft = ref<SettingDraft>({
  定值单号: '',
  所属装置: '',
  定值项目: '',
  整定值: '',
  计算依据: '',
  整定人: '',
  审核人: '',
})

const formRangeHint = computed(() => {
  if (!formOpen.value) {
    return ''
  }
  const probe: EntryRow = {
    id: -1,
    status: '待整定',
    pending: true,
    abnormal: false,
    定值单号: formDraft.value.定值单号,
    所属装置: formDraft.value.所属装置,
    定值项目: formDraft.value.定值项目,
    整定值: formDraft.value.整定值,
    计算依据: formDraft.value.计算依据,
  }
  const validation = validateSettingRow(probe)
  if (validation.range) {
    return `该项目在本装置上允许范围：${validation.range.min}～${validation.range.max}${validation.range.unit}；超出范围保存将被挡回。`
  }
  return ''
})

function notify(text: string, ok = false) {
  message.value = text
  messageOk.value = ok
}

function resetFilters() {
  filters.value = {}
  reload()
}

function reload() {
  message.value = ''
  const payload = listSettingEntries(filters.value)
  rows.value = payload.items
  views.value = payload.items.map(decorate)
  total.value = payload.total
  checkpoint.value = exportCheckpoint()
  if (detailView.value) {
    const fresh = rows.value.find((row) => Number(row.id) === Number(detailView.value?.row.id))
    detailView.value = fresh ? decorate(fresh) : null
  }
}

function runAction(action: string, row: EntryRow) {
  let result
  if (action === '提交整定') {
    result = submitSetting(Number(row.id))
  } else if (action === '审核定值') {
    result = auditSetting(Number(row.id))
  } else {
    result = voidSetting(Number(row.id))
  }
  notify(result.message, result.ok)
  reload()
}

function exportRows() {
  const report = exportAllSettings()
  notify(report.message, report.ok)
  checkpoint.value = exportCheckpoint()
}

function resumeExport() {
  const report = resumeExportSettings()
  notify(report.message, report.ok)
  checkpoint.value = exportCheckpoint()
}

function discardCheckpoint() {
  clearExportCheckpoint()
  checkpoint.value = null
}

function openCreate() {
  formId.value = undefined
  formError.value = ''
  formDraft.value = {
    定值单号: '',
    所属装置: '',
    定值项目: '',
    整定值: '',
    计算依据: '',
    整定人: session.operator,
    审核人: '',
  }
  formOpen.value = true
}

function openDetail(row: EntryRow) {
  detailView.value = decorate(row)
}

function closeDetail() {
  detailView.value = null
}

function openEdit(row: EntryRow) {
  formId.value = Number(row.id)
  formError.value = ''
  formDraft.value = {
    定值单号: String(row['定值单号'] ?? ''),
    所属装置: String(row['所属装置'] ?? ''),
    定值项目: String(row['定值项目'] ?? ''),
    整定值: String(row['整定值'] ?? ''),
    计算依据: String(row['计算依据'] ?? ''),
    整定人: String(row['整定人'] ?? ''),
    审核人: String(row['审核人'] ?? ''),
  }
  detailView.value = null
  formOpen.value = true
}

function closeForm() {
  formOpen.value = false
  formId.value = undefined
  formError.value = ''
}

function submitForm() {
  formError.value = ''
  if (!formDraft.value.定值单号.trim() || !formDraft.value.定值项目.trim()) {
    formError.value = '定值单号与定值项目必须写全，缺项已挡回保存'
    return
  }
  const result = saveSettingDraft(formDraft.value, formId.value)
  if (!result.ok) {
    formError.value = result.message
    return
  }
  closeForm()
  notify(result.message, true)
  reload()
}

onMounted(reload)
</script>

<style scoped>
.setting-table .row-missing { background: #fff8eb; }
.setting-table .row-abnormal { background: #fef3f2; }
.setting-table .row-missing.row-abnormal { background: #fdf1e4; }
.tag { display: inline-block; border-radius: 4px; padding: 0 6px; font-size: 12px; line-height: 18px; }
.tag-missing { background: #fef0c7; color: #ad6800; border: 1px solid #ffd591; }
.tag-abnormal-inline { background: #fee4e2; color: #b42318; border: 1px solid #fda29b; margin-left: 4px; }
.tag-abnormal { color: #b42318; font-weight: 600; }
.basis-source { color: var(--muted); font-size: 12px; }
.basis-source.rule { color: #175cd3; }
.issue-cell { min-width: 220px; }
.issue-line { margin: 0 0 2px; font-size: 12px; line-height: 1.5; }
.issue-missing { color: #ad6800; }
.issue-abnormal { color: #b42318; }
.issue-ok { color: #027a48; font-size: 12px; margin: 0; }
.stat-warn { color: #b42318; }
.ok-text { color: #027a48; }
.checkpoint-tip { margin: 0 0 10px; font-size: 12px; color: #b42318; }
.modal-mask { position: fixed; inset: 0; background: rgba(16, 24, 40, 0.45); display: flex; justify-content: flex-end; z-index: 50; }
.modal { background: #fff; width: 560px; max-width: 100vw; height: 100%; overflow-y: auto; display: flex; flex-direction: column; }
.drawer { box-shadow: -8px 0 24px rgba(16, 24, 40, 0.18); }
.modal-head { display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; border-bottom: 1px solid var(--border); }
.modal-head h3 { margin: 0; font-size: 15px; }
.modal-body { padding: 14px 18px; flex: 1; }
.modal-foot { padding: 12px 18px; border-top: 1px solid var(--border); display: flex; gap: 8px; justify-content: flex-end; }
.detail-list { margin: 0; }
.detail-row { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px dashed var(--border); font-size: 13px; }
.detail-row dt { width: 96px; color: var(--muted); flex-shrink: 0; }
.detail-row dd { margin: 0; flex: 1; }
.range-hint { display: block; color: var(--muted); font-size: 12px; margin-top: 4px; }
.issue-panel { margin-top: 14px; border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; }
.issue-panel h4 { margin: 0 0 8px; font-size: 13px; }
.issue-list { margin: 0; padding-left: 18px; font-size: 13px; }
.issue-list li { margin-bottom: 4px; }
.form-grid { display: flex; flex-wrap: wrap; gap: 12px; align-content: flex-start; }
.form-item { flex: 1 1 calc(50% - 6px); display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.form-item.wide { flex-basis: 100%; }
.form-item input, .form-item textarea { font-size: 13px; color: #1f2937; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; width: 100%; }
.form-item.required span::after { content: ' *'; color: #b42318; }
.btn.danger, .link.danger { color: #b42318; }
</style>
