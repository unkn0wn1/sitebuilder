// Register Flowbite Vue from its published build, with typings from dist .d.ts files.
// The official `flowbite-vue/nuxt` module points declarationPath at src/*.vue, which
// vue-tsc typechecks and fails (internal `@/` aliases). Same auto-import names.
import { existsSync } from 'node:fs'
import { addComponent, createResolver, defineNuxtModule } from '@nuxt/kit'

const COMPONENTS = [
  'FwbA', 'FwbAccordion', 'FwbAccordionContent', 'FwbAccordionHeader', 'FwbAccordionPanel',
  'FwbAlert', 'FwbAutocomplete', 'FwbAvatar', 'FwbAvatarStack', 'FwbAvatarStackCounter',
  'FwbBadge', 'FwbBlockquote', 'FwbBreadcrumb', 'FwbBreadcrumbItem', 'FwbButton', 'FwbButtonGroup',
  'FwbCard', 'FwbCarousel', 'FwbCheckbox', 'FwbDropdown', 'FwbFileInput', 'FwbFooter', 'FwbFooterBrand',
  'FwbFooterCopyright', 'FwbFooterIcon', 'FwbFooterLink', 'FwbFooterLinkGroup', 'FwbHeading', 'FwbImg',
  'FwbInput', 'FwbJumbotron', 'FwbKbd', 'FwbListGroup', 'FwbListGroupItem', 'FwbModal', 'FwbNavbar',
  'FwbNavbarCollapse', 'FwbNavbarLink', 'FwbNavbarLogo', 'FwbP', 'FwbPagination', 'FwbProgress',
  'FwbRadio', 'FwbRadioGroup', 'FwbRange', 'FwbRating', 'FwbSelect', 'FwbSidebar', 'FwbSidebarCta',
  'FwbSidebarDropdownItem', 'FwbSidebarItem', 'FwbSidebarItemGroup', 'FwbSidebarLogo', 'FwbSpinner',
  'FwbTab', 'FwbTable', 'FwbTableBody', 'FwbTableCell', 'FwbTableHead', 'FwbTableHeadCell', 'FwbTableRow',
  'FwbTabs', 'FwbTextarea', 'FwbTimeline', 'FwbTimelineBody', 'FwbTimelineContent', 'FwbTimelineItem',
  'FwbTimelinePoint', 'FwbTimelineTime', 'FwbTimelineTitle', 'FwbToast', 'FwbToastProvider', 'FwbToggle',
  'FwbTooltip',
] as const

export default defineNuxtModule({
  meta: { name: 'flowbite-vue-dist', configKey: 'flowbiteVue' },
  setup() {
    const resolver = createResolver(import.meta.url)
    const dist = resolver.resolve('../node_modules/flowbite-vue/dist')
    for (const name of COMPONENTS) {
      const filePath = `${dist}/components/${name}.js`
      const nested = `${dist}/components/${name}/${name}.vue.d.ts`
      const typography = `${dist}/components/Typography/${name}.vue.d.ts`
      const declarationPath = existsSync(nested) ? nested : existsSync(typography) ? typography : undefined
      addComponent({ name, filePath, ...(declarationPath ? { declarationPath } : {}) })
    }
  },
})
