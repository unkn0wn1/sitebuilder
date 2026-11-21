<script setup lang="ts">
import { api, ApiError } from '../../utils/api'
import { timeAgo } from '../../utils/format'
import { ROLES, type Role } from '#shared/roles'
import SettingsNav from '../../components/settings/SettingsNav.vue'

definePageMeta({ layout: 'builder' })

interface UserItem {
  id: string
  email: string
  name: string
  role: Role
  isOperator: boolean
  status: 'active' | 'deactivated'
  lastLoginAt: string | null
}

const { user: me } = useSession()
const loading = ref(true)
const error = ref('')
const saved = ref('')
const items = ref<UserItem[]>([])
const inviting = ref(false)
const inviteName = ref('')
const inviteEmail = ref('')
const inviteRole = ref<Role>('editor')
const roleOptions = ROLES.map((role) => ({ name: role[0]!.toUpperCase() + role.slice(1), value: role }))

async function load() {
  loading.value = true
  error.value = ''
  try {
    const data = await api<{ items: UserItem[] }>('/users')
    items.value = data.items
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not load users.'
  } finally {
    loading.value = false
  }
}

async function invite() {
  if (!inviteName.value.trim() || !inviteEmail.value.trim()) return
  inviting.value = true
  error.value = ''
  saved.value = ''
  try {
    await api('/users', { method: 'POST', body: { name: inviteName.value.trim(), email: inviteEmail.value.trim(), role: inviteRole.value } })
    inviteName.value = ''
    inviteEmail.value = ''
    inviteRole.value = 'editor'
    saved.value = 'Invite sent. They will get an email with a link to set a password.'
    await load()
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not invite that person.'
  } finally {
    inviting.value = false
  }
}

async function changeRole(item: UserItem, role: string) {
  if (role === item.role) return
  error.value = ''
  saved.value = ''
  try {
    await api(`/users/${item.id}`, { method: 'PATCH', body: { role } })
    item.role = role as Role
    saved.value = `Updated ${item.name}'s role.`
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not change that role.'
    await load()
  }
}

async function setStatus(item: UserItem, status: 'active' | 'deactivated') {
  if (status === 'deactivated' && !confirm(`Deactivate ${item.name}? They will be signed out and won't be able to sign in.`)) return
  error.value = ''
  saved.value = ''
  try {
    await api(`/users/${item.id}`, { method: 'PATCH', body: { status } })
    item.status = status
    saved.value = status === 'deactivated' ? `${item.name} is deactivated.` : `${item.name} can sign in again.`
  } catch (err) {
    error.value = err instanceof ApiError ? err.message : 'Could not update that account.'
  }
}

onMounted(load)
</script>

<template>
  <div class="sb-page">
    <SettingsNav>
      <template #title>
        <h1 class="m-0 text-2xl font-semibold text-gray-900 dark:text-gray-100">Users</h1>
      </template>
    </SettingsNav>
    <p class="mb-6 max-w-2xl text-gray-600 dark:text-gray-400">Editors can work on pages. Approvers can publish. Admins can also change settings, brand and page types.</p>
    <FwbAlert v-if="error" type="danger" class="mb-4">{{ error }}</FwbAlert>
    <FwbAlert v-else-if="saved" type="success" class="mb-4">{{ saved }}</FwbAlert>

    <form class="mb-8 flex flex-wrap items-end gap-3" @submit.prevent="invite">
      <div class="w-40">
        <FwbInput v-model="inviteName" label="Name" />
      </div>
      <div class="w-56">
        <FwbInput v-model="inviteEmail" type="email" label="Email" />
      </div>
      <div class="w-40">
        <FwbSelect :model-value="inviteRole" label="Role" :options="roleOptions" @update:model-value="inviteRole = String($event) as Role" />
      </div>
      <FwbButton type="submit" :disabled="inviting">{{ inviting ? 'Sending…' : 'Send invite' }}</FwbButton>
    </form>

    <p v-if="loading" class="text-gray-500 dark:text-gray-400">Loading users…</p>
    <FwbTable v-else hoverable>
      <FwbTableHead>
        <FwbTableHeadCell>Name</FwbTableHeadCell>
        <FwbTableHeadCell>Email</FwbTableHeadCell>
        <FwbTableHeadCell>Role</FwbTableHeadCell>
        <FwbTableHeadCell>Last sign-in</FwbTableHeadCell>
        <FwbTableHeadCell><span class="sr-only">Actions</span></FwbTableHeadCell>
      </FwbTableHead>
      <FwbTableBody>
        <FwbTableRow v-for="item in items" :key="item.id">
          <FwbTableCell>
            {{ item.name }}
            <span v-if="item.status === 'deactivated'" class="ml-2 text-xs text-gray-500 dark:text-gray-400">Deactivated</span>
            <span v-if="item.isOperator" class="ml-2 text-xs text-gray-500 dark:text-gray-400">Operator</span>
          </FwbTableCell>
          <FwbTableCell>{{ item.email }}</FwbTableCell>
          <FwbTableCell>
            <select
              class="rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-sm"
              :value="item.role"
              :disabled="item.id === me?.id"
              @change="changeRole(item, ($event.target as HTMLSelectElement).value)"
            >
              <option v-for="role in ROLES" :key="role" :value="role">{{ role[0]!.toUpperCase() + role.slice(1) }}</option>
            </select>
          </FwbTableCell>
          <FwbTableCell>{{ item.lastLoginAt ? timeAgo(item.lastLoginAt) : 'Never' }}</FwbTableCell>
          <FwbTableCell>
            <FwbButton
              v-if="item.status === 'active' && item.id !== me?.id"
              color="light"
              size="sm"
              @click="setStatus(item, 'deactivated')"
            >
              Deactivate
            </FwbButton>
            <FwbButton v-else-if="item.status === 'deactivated'" color="light" size="sm" @click="setStatus(item, 'active')">Reactivate</FwbButton>
          </FwbTableCell>
        </FwbTableRow>
      </FwbTableBody>
    </FwbTable>
  </div>
</template>
