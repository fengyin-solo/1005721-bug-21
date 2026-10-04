<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <section class="modal-panel wide" role="dialog" aria-modal="true">
      <header class="modal-head">
        <h3>定值单明细 {{ sheet ? `· ${sheet.sheetNo}` : '' }}</h3>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>

      <div v-if="sheet" class="modal-body">
        <dl class="sheet-meta">
          <div><dt>定值单号</dt><dd>{{ sheet.sheetNo }}</dd></div>
          <div><dt>所属装置</dt><dd>{{ sheet.device || '—' }}</dd></div>
          <div><dt>单据状态</dt><dd>{{ sheet.status }}</dd></div>
          <div>
            <dt>整单校核</dt>
            <dd>
              <span v-if="sheet.complete" class="tag ok">缺项/异常已清零</span>
              <span v-else class="tag bad">缺项 {{ sheet.missingCount }} · 异常 {{ sheet.abnormalCount }}</span>
            </dd>
          </div>
        </dl>

        <table class="data-table detail-table">
          <thead>
            <tr>
              <th>定值项目</th>
              <th>整定值</th>
              <th>装置允许范围</th>
              <th>计算依据</th>
              <th>整定人/审核人</th>
              <th>校核提示</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in sheet.rows" :key="String(row.id)">
              <td>{{ row['定值项目'] || '—' }}</td>
              <td>
                <span v-if="row.displayValue">{{ row.displayValue }}</span>
                <span v-else class="cell-missing">缺整定值</span>
                <span v-if="isAbnormal(row, '整定值')" class="tag bad">异常值</span>
              </td>
              <td>
                <template v-if="row.diagnosis.rule">
                  {{ row.diagnosis.rule.min }}~{{ row.diagnosis.rule.max }} {{ row.diagnosis.rule.unit }}
                </template>
                <span v-else class="cell-missing">无办法目录</span>
              </td>
              <td>
                <p class="basis-line">{{ row.basisText || '' }}</p>
                <span v-if="isMissing(row, '计算依据')" class="tag miss">缺计算依据</span>
              </td>
              <td>{{ row['整定人'] || '—' }} / {{ row['审核人'] || '—' }}</td>
              <td>
                <p v-for="issue in row.diagnosis.issues" :key="issue.field + issue.kind" :class="issue.kind === 'missing' ? 'tag miss' : 'tag bad'">
                  {{ issue.message }}
                </p>
                <span v-if="row.diagnosis.complete" class="tag ok">完整</span>
              </td>
            </tr>
          </tbody>
        </table>

        <p class="basis-foot">
          计算依据与列表共用同一份整定办法口径，更新办法后本面板同步变化。
        </p>

        <footer class="modal-foot">
          <button class="btn" type="button" @click="$emit('close')">关 闭</button>
          <button
            v-for="action in sheetActions"
            :key="action.name"
            :class="['btn', action.danger ? 'danger' : 'primary']"
            type="button"
            @click="$emit('action', action.name, sheet.sheetNo)"
          >
            {{ action.name }}
          </button>
        </footer>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { DiagnosedRow, SettingSheet } from '@/api/setting-service'

defineProps<{ sheet: SettingSheet | undefined }>()
defineEmits<{
  (e: 'close'): void
  (e: 'action', action: string, sheetNo: string): void
}>()

const sheetActions = [
  { name: '提交整定', danger: false },
  { name: '审核定值', danger: false },
  { name: '作废定值', danger: true },
]

function isMissing(row: DiagnosedRow, field: string): boolean {
  return row.diagnosis.missingFields.includes(field)
}

function isAbnormal(row: DiagnosedRow, field: string): boolean {
  return row.diagnosis.issues.some((issue) => issue.field === field && issue.kind === 'abnormal')
}
</script>
