<script setup lang="ts">
import { emptyRule, RESULT_OPTIONS, SITE_PART_OPTIONS, type ActionInfo, type RuleDraft, type RuleResult } from '../../../utils/agents'

const rules = defineModel<RuleDraft[]>({ required: true })
defineProps<{ actions: ActionInfo[] }>()

function add() {
  rules.value = [...rules.value, emptyRule()]
}
function remove(index: number) {
  rules.value = rules.value.filter((_, i) => i !== index)
}
function toggle(list: string[], key: string, on: boolean) {
  const at = list.indexOf(key)
  if (on && at < 0) list.push(key)
  if (!on && at >= 0) list.splice(at, 1)
}
</script>

<template>
  <div>
    <p v-if="!rules.length" class="mb-3 text-sm text-gray-600 dark:text-gray-400">No rules. Everything this token does waits for a person to approve it.</p>
    <ol class="m-0 mb-3 list-none space-y-3 p-0">
      <li v-for="(rule, index) in rules" :key="index" class="rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900 p-3" :data-testid="`rule-${index}`">
        <div class="mb-3 flex flex-wrap items-end gap-3">
          <div class="min-w-[12rem] flex-1"><FwbInput v-model="rule.label" label="What this rule is for" placeholder="Take links down" /></div>
          <div class="w-52">
            <FwbSelect :model-value="rule.result" label="Then the token may" :options="RESULT_OPTIONS" @update:model-value="rule.result = String($event) as RuleResult" />
          </div>
          <FwbButton color="light" size="sm" type="button" @click="remove(index)">Remove rule</FwbButton>
        </div>
        <fieldset class="mb-3 min-w-0 border-0 p-0">
          <legend class="mb-1 text-sm font-medium text-gray-900 dark:text-gray-100">Kinds of change</legend>
          <label class="mb-1 flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200"><input v-model="rule.allActions" type="checkbox" class="rounded border-gray-300 dark:border-gray-600" /> Every kind of change</label>
          <div v-if="!rule.allActions" class="grid gap-1 sm:grid-cols-2">
            <label v-for="a in actions" :key="a.key" class="flex items-start gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input type="checkbox" class="mt-0.5 rounded border-gray-300 dark:border-gray-600" :checked="rule.actions.includes(a.key)" @change="toggle(rule.actions, a.key, ($event.target as HTMLInputElement).checked)" />
              <span>{{ a.label }}</span>
            </label>
          </div>
        </fieldset>
        <div class="mb-3 grid gap-3 sm:grid-cols-2">
          <FwbInput v-model="rule.pagePaths" label="Only these pages" placeholder="/privacy, /legal/*  (blank = any page)" />
          <FwbInput v-model="rule.pageTemplates" label="Only these page types" placeholder="legal  (blank = any type)" />
        </div>
        <fieldset class="mb-3 min-w-0 border-0 p-0">
          <legend class="mb-1 text-sm font-medium text-gray-900 dark:text-gray-100">Or these site-wide parts</legend>
          <div class="flex flex-wrap gap-4">
            <label v-for="p in SITE_PART_OPTIONS" :key="p.key" class="flex items-center gap-2 text-sm text-gray-800 dark:text-gray-200">
              <input type="checkbox" class="rounded border-gray-300 dark:border-gray-600" :checked="rule.siteParts.includes(p.key)" @change="toggle(rule.siteParts, p.key, ($event.target as HTMLInputElement).checked)" />
              {{ p.label }}
            </label>
          </div>
        </fieldset>
        <details v-if="rule.result !== 'deny'" class="text-sm">
          <summary class="cursor-pointer text-gray-700 dark:text-gray-300">Limits (optional)</summary>
          <div class="mt-3 grid gap-3 sm:grid-cols-3">
            <FwbInput v-model="rule.maxSections" type="number" label="Most sections" />
            <FwbInput v-model="rule.maxWords" type="number" label="Most words" />
            <FwbInput v-model="rule.maxNewPages" type="number" label="Most new pages (default 1)" />
            <FwbInput v-model="rule.maxPerHour" type="number" label="Most per hour" />
            <FwbInput v-model="rule.withinHours" type="number" label="Undo only within hours" />
            <FwbInput v-model="rule.allowedLinkDomains" label="New links only to" placeholder="example.org" />
          </div>
          <div class="mt-3 flex flex-wrap gap-4">
            <label class="flex items-center gap-2 text-gray-800 dark:text-gray-200"><input v-model="rule.allowNewLinks" type="checkbox" class="rounded border-gray-300 dark:border-gray-600" /> May add new links</label>
            <label class="flex items-center gap-2 text-gray-800 dark:text-gray-200"><input v-model="rule.allowMoneyPages" type="checkbox" class="rounded border-gray-300 dark:border-gray-600" /> May publish on pages that hold money sections (a person is still needed for the money sections themselves)</label>
          </div>
        </details>
      </li>
    </ol>
    <FwbButton color="light" size="sm" type="button" @click="add">Add a rule</FwbButton>
  </div>
</template>
