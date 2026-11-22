import { expect, test, type Page } from 'playwright/test'

const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@example.org'
const password = process.env.SEED_ADMIN_PASSWORD ?? 'sb-demo-pass-17'

// A library id that is not seeded. Preview draws a placeholder instead of publishing a photo.
const MISSING_PHOTO = 'med_00000000000000000000000009'

async function signIn(page: Page) {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('heading', { name: 'Pages' })).toBeVisible({ timeout: 20_000 })
}

async function apiJson(page: Page, method: string, path: string, body?: unknown) {
  const origin = new URL(page.url()).origin
  const res = await page.request.fetch(path, {
    method,
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    data: body,
  })
  const text = await res.text()
  expect(res.ok(), `${method} ${path} ${res.status()}: ${text}`).toBeTruthy()
  return text ? JSON.parse(text) : {}
}

test('see-through header and mega tiles use draft preview and leave site parts unchanged', async ({ page }) => {
  test.setTimeout(120_000)
  await signIn(page)

  const list = await apiJson(page, 'GET', '/api/v1/site-parts')
  const items = list.items as { id: string; kind: string; key: string }[]
  const header = items.find((item) => item.kind === 'header')
  const menu = items.find((item) => item.kind === 'menu' && item.key === 'main') ?? items.find((item) => item.kind === 'menu')
  expect(header, 'seed should include a header').toBeTruthy()
  expect(menu, 'seed should include a menu').toBeTruthy()

  const headerDetail = await apiJson(page, 'GET', `/api/v1/site-parts/${header!.id}`)
  const menuDetail = await apiJson(page, 'GET', `/api/v1/site-parts/${menu!.id}`)
  const before = JSON.stringify({ header: headerDetail.doc, menu: menuDetail.doc, headerRevision: headerDetail.revision, menuRevision: menuDetail.revision })

  try {
    const preview = await apiJson(page, 'POST', '/api/v1/preview/site-part', {
      parts: [
        {
          partId: header!.id,
          doc: { ...headerDetail.doc, style: 'mega', menuKey: menu!.key, overHero: true },
        },
        {
          partId: menu!.id,
          doc: {
            schemaVersion: 1,
            items: [
              {
                id: 'b_about001',
                label: 'About',
                target: { type: 'url', url: '/about' },
                children: [
                  { id: 'b_tile0001', label: 'Kennel', target: { type: 'url', url: '/kennel' }, featured: true, image: { media: MISSING_PHOTO, alt: 'Kennel' } },
                  { id: 'b_tile0002', label: 'Plain', target: { type: 'url', url: '/plain' }, featured: true },
                  { id: 'b_tile0003', label: 'Third', target: { type: 'url', url: '/t3' }, featured: true, image: { media: MISSING_PHOTO, alt: 'Third' } },
                  { id: 'b_tile0004', label: 'Fourth', target: { type: 'url', url: '/t4' }, featured: true, image: { media: MISSING_PHOTO, alt: 'Fourth' } },
                  { id: 'b_tile0005', label: 'Fifth', target: { type: 'url', url: '/t5' }, featured: true, image: { media: MISSING_PHOTO, alt: 'Fifth' } },
                  { id: 'b_tile0006', label: 'Sixth', target: { type: 'url', url: '/t6' }, featured: true, image: { media: MISSING_PHOTO, alt: 'Sixth' } },
                ],
              },
            ],
          },
        },
      ],
    })
    const html = preview.html as string
    expect(html).toContain('site-header-over')
    expect(html).not.toMatch(/<header class="[^"]*\bjs-over\b/)
    expect(html).toContain('src="/api/v1/preview/assets/header.js"')
    expect(html).toContain('linear-gradient(to bottom, rgba(20, 12, 8, 0.6)')
    expect(html).toContain('nav-mega-panel-tiles')
    expect(html).toContain('>Sixth</a>')
    expect(html).not.toContain('>Sixth</span>')
    expect(html).toContain('class="tile tile-text"')
    expect(html).toContain('data-sample-photo')
    expect(html).toContain('width="640"')
    expect(html).toContain('height="420"')
    expect(html).toContain('loading="lazy"')
    expect(html).toContain('decoding="async"')
    expect(html).toContain('.tile:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }')
    expect((html.match(/class="tile"/g) ?? []).length).toBe(4)

    const off = await apiJson(page, 'POST', '/api/v1/preview/site-part', {
      parts: [
        { partId: header!.id, doc: { ...headerDetail.doc, overHero: false } },
        { partId: menu!.id, doc: menuDetail.doc },
      ],
    })
    const offHtml = off.html as string
    expect(offHtml).not.toContain('src="/api/v1/preview/assets/header.js"')
    expect(offHtml).not.toContain('site-header-over')
    expect(offHtml).not.toContain('nav-mega-tiles')

    const asset = await page.request.get('/api/v1/preview/assets/header.js', {
      headers: { Origin: new URL(page.url()).origin },
    })
    expect(asset.ok()).toBeTruthy()
    const source = await asset.text()
    expect(source).toContain('hero')
    expect(source).not.toContain('vcar')

    // Same-origin document.write keeps the signed-in origin, so the preview script can run without saving a site part.
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;height:4000px">
      <div class="banner" style="height:28px">strip</div>
      <header class="site-header site-header-over"><details><summary>About</summary></details></header>
      <main><section class="hero">Photo</section></main>
      <script src="/api/v1/preview/assets/header.js" defer></script>
    </body></html>`, { waitUntil: 'load' })
    const headerEl = page.locator('header')
    await expect(headerEl).toHaveClass(/js-over/)
    await expect(headerEl).not.toHaveClass(/\bis-solid\b/)
    await expect.poll(() => page.evaluate(() => getComputedStyle(document.querySelector('header')!).getPropertyValue('--strip').trim())).toBe('28px')
    await page.evaluate(() => window.scrollTo(0, 80))
    await expect(headerEl).toHaveClass(/\bis-solid\b/)
    await page.evaluate(() => window.scrollTo(0, 0))
    await expect(headerEl).not.toHaveClass(/\bis-solid\b/)
    await page.locator('details').evaluate((el) => {
      const details = el as HTMLDetailsElement
      details.open = true
      details.dispatchEvent(new Event('toggle', { bubbles: true }))
    })
    await expect(headerEl).toHaveClass(/\bis-solid\b/)

    await page.setContent(`<!doctype html><html><body>
      <header class="site-header site-header-over"></header>
      <main><section class="vcar">Slides</section></main>
      <script src="/api/v1/preview/assets/header.js" defer></script>
    </body></html>`, { waitUntil: 'load' })
    await expect(page.locator('header')).not.toHaveClass(/js-over/)

    await page.goto(`/site-parts/${header!.id}`)
    await expect(page.getByRole('heading', { name: 'Header and top strip' })).toBeVisible({ timeout: 20_000 })
    const seeThrough = page.getByRole('checkbox', { name: /See-through over the top photo/ })
    await expect(seeThrough).toBeVisible()
    await expect(seeThrough).not.toBeChecked()
  } finally {
    const headerAfter = await apiJson(page, 'GET', `/api/v1/site-parts/${header!.id}`)
    const menuAfter = await apiJson(page, 'GET', `/api/v1/site-parts/${menu!.id}`)
    const after = JSON.stringify({ header: headerAfter.doc, menu: menuAfter.doc, headerRevision: headerAfter.revision, menuRevision: menuAfter.revision })
    expect(after).toBe(before)
  }
})
