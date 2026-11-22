import { expect, test, type Page } from 'playwright/test'
import { mkdirSync } from 'node:fs'
import sharp from 'sharp'

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.org'
const password = process.env.SEED_ADMIN_PASSWORD ?? 'sb-demo-pass-17'
const screenshotDir = process.env.EDITOR_SCREENSHOT_DIR ?? '/workspace'

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible({ timeout: 20_000 })
}

function shot(name: string) {
  mkdirSync(screenshotDir, { recursive: true })
  return `${screenshotDir}/${name}`
}

async function docsShot(page: Page, name: string, fullPage = true) {
  if (process.env.SB_SCREENSHOTS !== '1') return
  mkdirSync('docs/screenshots', { recursive: true })
  await page.screenshot({ path: `docs/screenshots/${name}`, fullPage })
}

test('settings, media library and inspector crop', async ({ page }) => {
  test.setTimeout(90_000)
  await signIn(page)

  await page.goto('/settings/ai')
  await expect(page.getByRole('heading', { name: 'AI', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('API key')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Test connection' })).toBeVisible()
  await page.screenshot({ path: shot('settings-ai.png'), fullPage: true })

  await expect(page.getByRole('combobox', { name: 'Model' })).toHaveValue('grok-4.7')
  await expect(page.getByRole('option', { name: 'grok-4.6' })).toBeAttached()
  await docsShot(page, 'model-select.png')

  await page.getByRole('link', { name: 'AI personality' }).click()
  await expect(page.getByRole('heading', { name: 'AI personality' })).toBeVisible({ timeout: 20_000 })
  const personality = page.getByRole('textbox', { name: 'Personality' })
  await expect(personality).toHaveValue(/Write in plain English, with British spelling\./, { timeout: 20_000 })
  await expect(page.getByText('of 48,000 characters the AI sees')).toBeVisible()
  await docsShot(page, 'ai-personality.png')

  await page.getByRole('button', { name: 'Full screen' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Exit full screen' })).toBeVisible()
  const cm = page.locator('.cm-content')
  await cm.click()
  await page.keyboard.press('Control+End')
  const sentence = 'The helpline answers in a warm voice.'
  await cm.pressSequentially(sentence)
  await docsShot(page, 'fullscreen-editor.png', false)
  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(personality).toHaveValue(/Write in plain English, with British spelling\./)
  await expect(personality).toHaveValue(new RegExp(sentence.replace(/[.]/g, '\\.')))
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByText('Saved.')).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'AI personality' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('textbox', { name: 'Personality' })).toHaveValue(new RegExp(sentence.replace(/[.]/g, '\\.')), { timeout: 20_000 })

  await page.getByRole('link', { name: 'Media' }).click()
  await expect(page.getByRole('heading', { name: 'Media' })).toBeVisible({ timeout: 20_000 })
  const png = await sharp({ create: { width: 800, height: 500, channels: 3, background: '#3a7' } }).png().toBuffer()
  await page.locator('input[type="file"]').setInputFiles({ name: 'field.png', mimeType: 'image/png', buffer: png })
  await expect(page.getByText('field.png').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('800 × 500')).toBeVisible({ timeout: 20_000 })
  await page.screenshot({ path: shot('media-library.png'), fullPage: true })

  await page.getByRole('link', { name: 'Pages' }).click()
  await page.getByRole('link', { name: 'Winter appeal' }).click()
  await expect(page.getByRole('heading', { name: 'Winter appeal' })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Assistant' }).click()
  await expect(page.getByText(/The assistant isn't switched on yet/)).toBeVisible()
  await page.screenshot({ path: shot('editor-assistant.png'), fullPage: true })
  await page.screenshot({ path: shot('editor-desktop.png'), fullPage: true })

  await page.getByRole('button', { name: 'Outline' }).click()
  await page.getByRole('button', { name: /Hero/ }).first().click()
  await expect(page.getByRole('button', { name: 'Change' })).toBeVisible()
  await page.getByRole('button', { name: 'Change' }).click()
  await expect(page.getByRole('heading', { name: 'Choose a photo' })).toBeVisible()
  await expect(page.getByText('field.png').first()).toBeVisible()
  await page.screenshot({ path: shot('editor-photo-change.png'), fullPage: true })
})


test('site parts list, menu, header and footer', async ({ page }) => {
  await signIn(page)

  await page.goto('/site-parts')
  await expect(page.getByRole('heading', { name: 'Site parts' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Main menu', level: 3 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Header and top strip', level: 3 })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Footer', level: 3 })).toBeVisible()
  await page.screenshot({ path: shot('menus.png'), fullPage: true })

  await page.getByRole('heading', { name: 'Main menu', level: 3 }).click()
  await expect(page.getByRole('heading', { name: 'Main menu', level: 1 })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /Add (a menu item|the first link)/ })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Preview' })).toBeVisible()
  await page.screenshot({ path: shot('menu-editor.png'), fullPage: true })

  await page.goto('/site-parts')
  await page.getByRole('heading', { name: 'Header and top strip', level: 3 }).click()
  await expect(page.getByRole('heading', { name: 'Header and top strip', level: 1 })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('combobox', { name: 'Menu', exact: true })).toBeVisible()
  await expect(page.getByTestId('menu-look')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Top strip', level: 3 }).first()).toBeVisible()
  await page.screenshot({ path: shot('header-editor.png'), fullPage: true })

  await page.goto('/site-parts')
  await page.getByRole('heading', { name: 'Footer', level: 3 }).click()
  await expect(page.getByRole('heading', { name: 'Footer', level: 1 })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('Email')).toBeVisible()
  await page.screenshot({ path: shot('footer-editor.png'), fullPage: true })
})


test('approvals list and review', async ({ page }) => {
  await signIn(page)

  const origin = new URL(page.url()).origin
  const created = await page.request.post('/api/v1/pages', {
    headers: { Origin: origin },
    data: { title: 'Winter appeal review', template: 'standard' },
  })
  expect(created.ok(), await created.text()).toBeTruthy()
  const createdBody = (await created.json()) as { page: { id: string; draftRevision: number }; revision: number }
  const ops = await page.request.post(`/api/v1/pages/${createdBody.page.id}/ops`, {
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: {
      baseRevision: createdBody.revision ?? createdBody.page.draftRevision,
      ops: [{ op: 'add_block', block: { type: 'Quote', props: { text: 'A review sample', attribution: 'A volunteer' } } }],
    },
  })
  expect(ops.ok(), await ops.text()).toBeTruthy()
  const submitted = await page.evaluate(async (pageId) => {
    const res = await fetch(`/api/v1/pages/${pageId}/submit`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ note: 'Ready for the winter campaign.', overrideReason: 'The demo page has no donation form yet.' }),
    })
    return { ok: res.ok, status: res.status, body: await res.json() }
  }, createdBody.page.id)
  expect(submitted.ok, JSON.stringify(submitted.body)).toBeTruthy()

  await page.goto('/approvals')
  await expect(page.getByRole('heading', { name: 'Approvals' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Winter appeal review' })).toBeVisible()
  await page.screenshot({ path: shot('approvals.png'), fullPage: true })

  await page.getByRole('link', { name: 'Winter appeal review' }).click()
  await expect(page.getByRole('heading', { name: /Review: Winter appeal review/ })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Approve and publish' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send back' })).toBeVisible()
  await expect(page.getByText("Ready for the winter campaign.")).toBeVisible()
  await page.screenshot({ path: shot('review.png'), fullPage: true })
})


test('brand and design', async ({ page }) => {
  await signIn(page)
  await page.goto('/brand')
  await expect(page.getByRole('heading', { name: 'Brand and Design' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Colours' })).toBeVisible()
  // The menu look is chosen only on the Header screen; Brand just points there.
  await expect(page.getByRole('radio', { name: /Hamburger/ })).toHaveCount(0)
  await expect(page.getByText(/menu look is now chosen in one place/)).toBeVisible()
  await page.screenshot({ path: shot('brand.png'), fullPage: true })
})


test('page types and the rest of settings', async ({ page }) => {
  // The agent steps at the end poll until two new pages are live. That sits on top of the screenshots above.
  test.setTimeout(180_000)
  await signIn(page)

  await page.goto('/templates')
  await expect(page.getByRole('heading', { name: 'Page types' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'Campaign' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Standard' })).toBeVisible()
  await page.screenshot({ path: shot('page-types.png'), fullPage: true })

  await page.getByRole('link', { name: 'Campaign' }).click()
  await expect(page.getByRole('heading', { name: 'Campaign' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Allowed and required sections')).toBeVisible()
  await page.screenshot({ path: shot('page-type-editor.png'), fullPage: true })

  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('link', { name: 'General' })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Workflow' })).toBeVisible()
  await page.screenshot({ path: shot('settings.png'), fullPage: true })

  await page.goto('/settings/general')
  await expect(page.getByRole('heading', { name: 'General', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByLabel('Site name')).toBeVisible()
  await page.screenshot({ path: shot('settings-general.png'), fullPage: true })

  await page.goto('/settings/workflow')
  await expect(page.getByRole('heading', { name: 'Workflow', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Allow people to approve their own changes')).toBeVisible()
  await page.screenshot({ path: shot('settings-workflow.png'), fullPage: true })

  await page.goto('/settings/integrations')
  await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('heading', { name: 'Cloudflare' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Google Workspace email' })).toBeVisible()
  await page.screenshot({ path: shot('settings-integrations.png'), fullPage: true })

  await page.goto('/settings/users')
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Send invite' })).toBeVisible()
  await page.screenshot({ path: shot('settings-users.png'), fullPage: true })

  // Same sign-in as the screenshots above. This is the last test in the file, so nothing later in it
  // reads the workflow switch. The workflow screenshot already happened. Leave self-approval on:
  // brand-publish sets it too, and no spec asserts that the switch is off.
  await page.goto('/settings')
  await expect(page.getByRole('heading', { name: 'Agents', level: 2 })).toBeVisible()
  await page.goto('/settings/agents')
  await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Settings' }).getByRole('link', { name: 'Agents' })).toHaveAttribute('aria-current', 'page')

  const origin = new URL(page.url()).origin
  const stamp = `${Date.now().toString(36)}${test.info().parallelIndex}`
  const titleA = `Agent page ${stamp} a`
  const titleB = `Agent page ${stamp} b`
  const call = async (method: string, path: string, data?: unknown, authorization?: string) => {
    const res = await page.request.fetch(path, {
      method,
      headers: { Origin: origin, Accept: 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
      data,
    })
    const text = await res.text()
    expect(res.ok(), `${method} ${path} ${res.status()}: ${text}`).toBeTruthy()
    return text ? (JSON.parse(text) as Record<string, unknown>) : {}
  }

  const minted = await call('POST', '/api/v1/agent/tokens', { name: `e2e ${stamp}`, access: 'draft', rules: [] })
  const secret = String(minted.secret ?? '')
  expect(secret.startsWith('sbt_'), JSON.stringify(minted)).toBeTruthy()
  // The token acts as this admin, so approving its change needs self-approval. Do not turn it back off.
  await call('PATCH', '/api/v1/settings', { workflow: { selfApproval: true } })

  const created = await call(
    'POST',
    '/agent/v1/edits/create-pages',
    {
      pages: [
        { title: titleA, page_type: 'standard', slug: `e2e-agent-${stamp}-a` },
        { title: titleB, page_type: 'standard', slug: `e2e-agent-${stamp}-b` },
      ],
      reason: 'The owner asked for two empty standard pages so the Agents screen can be checked.',
    },
    `Bearer ${secret}`,
  )
  const change = created.change as { id?: string; title?: string } | undefined
  const pagesCreated = (created.result as { pages_created?: unknown[] } | undefined)?.pages_created
  expect(change?.id, JSON.stringify(created)).toBeTruthy()
  expect(pagesCreated, JSON.stringify(created)).toHaveLength(2)
  const changeId = change!.id!
  const changeTitle = change!.title!

  const sent = await call('POST', `/agent/v1/changes/${changeId}/request-publish`, {}, `Bearer ${secret}`)
  expect((sent.result as { sent_for_review?: boolean } | undefined)?.sent_for_review, JSON.stringify(sent)).toBe(true)

  await page.goto(`/settings/agents/changes/${changeId}`)
  await expect(page.getByRole('heading', { name: changeTitle, exact: true })).toBeVisible({ timeout: 20_000 })
  page.once('dialog', (dialog) => dialog.accept())
  await page.getByRole('button', { name: 'Approve whole change (2)' }).click()

  // The button stays while the change is still "review". It goes live only after the worker publishes both reviews.
  await expect.poll(async () => {
    const res = await page.request.get(`/api/v1/agent/changes/${changeId}/preview`, { headers: { Origin: origin } })
    const text = await res.text()
    if (!res.ok()) return `http ${res.status()} ${text.slice(0, 300)}`
    return ((JSON.parse(text) as { change?: { status?: string } }).change?.status) ?? 'missing'
  }, { timeout: 45_000, intervals: [500, 1000, 2000] }).toBe('published')

  await page.reload()
  await expect(page.getByRole('heading', { name: changeTitle, exact: true })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: /Approve whole change/ })).toHaveCount(0)
  await expect(page.locator('p').filter({ hasText: /^Live\./ })).toBeVisible()
  await expect(page.getByRole('heading', { name: titleA, level: 2 })).toBeVisible()
  await expect(page.getByRole('heading', { name: titleB, level: 2 })).toBeVisible()
})
