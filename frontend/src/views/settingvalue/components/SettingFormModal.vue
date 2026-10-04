<template>
  <div class="modal-mask" @click.self="$emit('close')">
    <section class="modal-panel" role="dialog" aria-modal="true">
      <header class="modal-head">
        <h3>{{ mode === 'fill' ? '补录整定值' : '登记定值项' }}</h3>
        <button class="link" type="button" @click="$emit('close')">关闭</button>
      </header>

      <form class="modal-body" @submit.prevent="submit">
        <label class="form-item">
          <span>定值单号 <em>*</em></span>
          <input v-model="form.定值单号" :disabled="mode === 'fill'" placeholder="如 SETT-2026-007" />
        </label>
        <label class="form-item">
          <span>所属装置 <em>*</em></span>
          <input v-model="form.所属装置" :disabled="mode === 'fill'" placeholder="如 110kV 砚直线 PCS-941" />
        </label>
        <label class="form-item">
          <span>定值项目 <em>*</em></span>
          <select v-if="mode === 'create'" v-model="form.定值项目">
            <option value="" disabled>请选择整定办法中的定值项目</option>
            <option v-for="rule in rules" :key="rule.key" :value="rule.item">
              {{ rule.item }}
            </option>
          </select>
          <input v-else :value="form.定值项目" disabled />
        </label>
        <label class="form-item">
          <span>整定值<span v-if="mode === 'create'" class="form-hint">（可先留空，行内会注明缺项）</span></span>
          <input
            v-model="form.整定值"
            :placeholder="rule ? `允许范围 ${rule.min}~${rule.max} ${rule.unit}` : '输入数值'"
          />
        </label>
        <label class="form-item">
          <span>整定人</span>
          <input v-model="form.整定人" :placeholder="operator" />
        </label>
        <label v-if="mode === 'create'" class="form-item">
          <span>审核人</span>
          <input v-model="form.审核人" placeholder="审核通过后补齐" />
        </label>
        <div v-if="rule" class="form-basis">
          <p class="basis-title">计算依据（整定办法口径，保存时随单写入）</p>
          <p class="basis-text">{{ rule.basis }}</p>
          <p class="basis-range">
            装置允许整定范围：<strong>{{ rule.min }}~{{ rule.max }} {{ rule.unit }}</strong>
            ，超出范围将挡回保存
          </p>
        </div>
        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <footer class="modal-foot">
          <button class="btn" type="button" @click="$emit('close')">取消</button>
          <button class="btn primary" type="submit">{{ mode === 'fill' ? '保存补录' : '保存定值项' }}</button>
        </footer>
      </form>
    </section>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

import { SETTING_RULES, findRule } from '@/data/setting-rules'
import type { SettingDraft } from '@/api/setting-service'
import { getSettingEntry, saveSettingEntry, updateSettingValue } from '@/api/setting-service'

const props = defineProps<{
  mode: 'create' | 'fill'
  entryId?: number
  operator: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'saved', message: string): void
}>()

const rules = SETTING_RULES

const form = reactive<SettingDraft>({
  定值单号: '',
  所属装置: '',
  定值项目: '',
  整定值: '',
  整定人: '',
  审核人: '',
})

const errorMessage = ref('')

watch(
  () => props.entryId,
  (id) => {
    if (props.mode === 'fill' && id !== undefined) {
      const entry = getSettingEntry(id)
      if (entry) {
        form.定值单号 = String(entry['定值单号'] ?? '')
        form.所属装置 = String(entry['所属装置'] ?? '')
        form.定值项目 = String(entry['定值项目'] ?? '')
        form.整定值 = ''
        form.整定人 = String(entry['整定人'] ?? '')
        form.审核人 = String(entry['审核人'] ?? '')
      }
    }
  },
  { immediate: true },
)

const rule = ref(findRule(form.定值项目))
watch(
  () => form.定值项目,
  (name) => {
    rule.value = findRule(name)
  },
)

function submit() {
  errorMessage.value = ''
  if (!form.整定人.trim()) {
    form.整定人 = props.operator
  }
  if (props.mode === 'fill' && props.entryId !== undefined) {
    const result = updateSettingValue(props.entryId, form.整定值, form.整定人)
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    emit('saved', result.message)
    return
  }
  const result = saveSettingEntry({ ...form })
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  emit('saved', result.message)
}
</script>
