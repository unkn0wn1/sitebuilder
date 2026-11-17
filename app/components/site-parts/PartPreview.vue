<script setup lang="ts">
import { CANVAS_SCOPE, SCOPED_THEME_CSS } from '../../utils/theme-css'
import { SOCIAL_LABELS } from '../../utils/site-parts'
import { richTextToPlain } from '#shared/richtext'
import type { BannerDoc, FooterDoc, HeaderDoc, LinkTarget, MenuDoc, SitePartDoc, SitePartKind } from '#shared/site-parts'
import type { PageOption } from '../../utils/site-parts'

const props = defineProps<{
  kind: SitePartKind
  doc: SitePartDoc
  siteName: string
  menus: Record<string, MenuDoc>
  pages: PageOption[]
  device: 'computer' | 'phone'
}>()

function hrefOf(target: LinkTarget): string {
  if (target.type === 'url') return target.url
  const page = props.pages.find((p) => p.id === target.pageId)
  return page?.path ?? '#'
}

const header = computed(() => (props.kind === 'header' ? (props.doc as HeaderDoc) : null))
const footer = computed(() => (props.kind === 'footer' ? (props.doc as FooterDoc) : null))
const menu = computed(() => (props.kind === 'menu' ? (props.doc as MenuDoc) : null))
const banner = computed(() => (props.kind === 'banner' ? (props.doc as BannerDoc) : null))

const previewMenu = computed(() => {
  if (menu.value) return menu.value
  if (header.value) return props.menus[header.value.menuKey] ?? { schemaVersion: 1 as const, items: [] }
  return null
})

const legalMenu = computed(() => {
  if (!footer.value?.legalMenuKey) return null
  return props.menus[footer.value.legalMenuKey] ?? null
})

function headerClass(style: HeaderDoc['style'] | undefined): string {
  if (style === 'centred') return 'site-header site-header-centred'
  if (style === 'mega') return 'site-header site-header-mega'
  if (style === 'hamburger') return 'site-header site-header-hamburger'
  return 'site-header'
}

const headerStyle = computed(() => header.value?.style ?? (props.kind === 'menu' ? 'simple' : undefined))

const width = computed(() => (props.device === 'phone' ? '390px' : '100%'))
</script>

<template>
  <div class="overflow-auto rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
    <component :is="'style'">{{ SCOPED_THEME_CSS }}</component>
    <div class="mx-auto bg-white dark:bg-gray-800" :class="CANVAS_SCOPE" :style="{ width, maxWidth: '100%' }">
      <!-- Menu preview sits inside a header so it looks like the live site. -->
      <template v-if="kind === 'menu' || kind === 'header'">
        <header :class="headerClass(headerStyle)">
          <div class="site-header-inner">
            <a class="site-title" href="#">{{ siteName }}</a>
            <details v-if="previewMenu && headerStyle === 'hamburger'" class="nav nav-hamburger" aria-label="Site">
              <summary>Menu</summary>
              <div class="nav-panel">
                <template v-for="item in previewMenu.items" :key="item.id">
                  <a v-if="!item.children.length" :href="hrefOf(item.target)">{{ item.label }}</a>
                  <details v-else>
                    <summary>{{ item.label }}</summary>
                    <ul>
                      <li v-for="child in item.children" :key="child.id">
                        <a :href="hrefOf(child.target)">{{ child.label }}</a>
                      </li>
                    </ul>
                  </details>
                </template>
              </div>
            </details>
            <nav v-else-if="previewMenu" :class="headerStyle === 'mega' ? 'nav nav-mega' : 'nav'" aria-label="Site">
              <template v-for="item in previewMenu.items" :key="item.id">
                <a v-if="!item.children.length" :href="hrefOf(item.target)">{{ item.label }}</a>
                <details v-else>
                  <summary>{{ item.label }}</summary>
                  <ul :class="headerStyle === 'mega' ? 'nav-mega-panel' : undefined">
                    <li v-for="child in item.children" :key="child.id">
                      <a :href="hrefOf(child.target)">{{ child.label }}</a>
                    </li>
                  </ul>
                </details>
              </template>
            </nav>
            <a v-if="header?.cta" class="cta-btn" :href="hrefOf(header.cta.target)">{{ header.cta.label }}</a>
          </div>
        </header>
        <main id="main" class="px-6 py-10 text-sm text-gray-500 dark:text-gray-400">Page content will appear here.</main>
      </template>

      <template v-else-if="kind === 'footer' && footer">
        <main class="px-6 py-8 text-sm text-gray-500 dark:text-gray-400">Page content will appear here.</main>
        <footer class="site-footer">
          <div class="site-footer-inner">
            <div v-if="footer.text" class="prose">{{ richTextToPlain(footer.text) }}</div>
            <address v-if="footer.contact.email || footer.contact.phone || footer.contact.address">
              <div v-if="footer.contact.email"><a :href="`mailto:${footer.contact.email}`">{{ footer.contact.email }}</a></div>
              <div v-if="footer.contact.phone">{{ footer.contact.phone }}</div>
              <div v-if="footer.contact.address">{{ footer.contact.address }}</div>
            </address>
            <div v-if="footer.social.length" class="footer-social">
              <a v-for="s in footer.social" :key="s.network" :href="s.url">{{ SOCIAL_LABELS[s.network] ?? s.network }}</a>
            </div>
            <nav v-if="legalMenu" aria-label="Legal">
              <a v-for="item in legalMenu.items" :key="item.id" :href="hrefOf(item.target)" class="mr-3">{{ item.label }}</a>
            </nav>
            <p v-if="footer.charityNumber">Charity number {{ footer.charityNumber }}</p>
          </div>
        </footer>
      </template>

      <template v-else-if="kind === 'banner' && banner">
        <div v-if="banner.enabled && banner.message" :class="`banner banner-${banner.tone}`" :role="banner.tone === 'urgent' ? 'alert' : 'status'">
          {{ banner.message }}
          <a v-if="banner.link" :href="hrefOf(banner.link.target)">{{ banner.link.label }}</a>
        </div>
        <div v-else class="px-6 py-8 text-sm text-gray-500 dark:text-gray-400">The banner is off, so it won’t show on the site.</div>
        <header class="site-header">
          <div class="site-header-inner">
            <a class="site-title" href="#">{{ siteName }}</a>
          </div>
        </header>
      </template>
    </div>
  </div>
</template>
