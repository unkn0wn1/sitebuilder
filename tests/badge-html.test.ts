import { describe, expect, it } from 'vitest'
import { isAllowedBadgeHost, sanitizeBadgeHtml } from '../shared/badge-html'

describe('badge HTML sanitiser', () => {
  it('keeps a Candid or Charity Navigator image link and drops unknown hosts', () => {
    const kept = sanitizeBadgeHtml(
      '<a href="https://app.candid.org/profile/8069592/animal-aid-unlimited-71-0884843" target="_blank"><img src="https://www.guidestar.org/seals/platinum.png" alt="Candid Platinum"></a>',
    )
    expect(kept.html).toContain('https://app.candid.org/profile/8069592/animal-aid-unlimited-71-0884843')
    expect(kept.html).toContain('rel="noopener noreferrer"')
    expect(kept.imgSrcs).toContain('https://www.guidestar.org/seals/platinum.png')

    const dropped = sanitizeBadgeHtml('<img src="https://evil.example/badge.png" alt="x"><script>alert(1)</script>')
    expect(dropped.html).toBe('')
    expect(dropped.scriptSrcs).toEqual([])
  })

  it('keeps a TripAdvisor rated widget shell and its script, and drops inline script bodies', () => {
    const snippet = `
      <div id="TA_rated696" class="TA_rated">
        <ul id="test" class="TA_links">
          <li><a target="_blank" href="https://www.tripadvisor.in/Attraction_Review-g297672-d12501287-Reviews-Animal_Aid_Unlimited-Udaipur_Udaipur_District_Rajasthan.html"><img src="https://static.tacdn.com/img2/brand_refresh/Tripadvisor_lockup_horizontal_registered.png" alt="TripAdvisor"></a></li>
        </ul>
      </div>
      <script async src="https://www.jscache.com/wejs?wtype=rated&uniq=696&locationId=12501287&lang=en_IN"></script>
      <script>document.cookie</script>
    `
    const kept = sanitizeBadgeHtml(snippet)
    expect(kept.html).toContain('id="TA_rated696"')
    expect(kept.html).toContain('https://www.jscache.com/wejs?wtype=rated&amp;uniq=696&amp;locationId=12501287&amp;lang=en_IN')
    expect(kept.html).toContain('<script src="https://www.jscache.com/wejs?wtype=rated&amp;uniq=696&amp;locationId=12501287&amp;lang=en_IN" async></script>')
    expect(kept.html).not.toContain('document.cookie')
    expect(kept.scriptSrcs[0]).toContain('www.jscache.com/wejs')
    expect(kept.imgSrcs[0]).toContain('static.tacdn.com')
    expect(isAllowedBadgeHost('www.tripadvisor.in')).toBe(true)
    expect(isAllowedBadgeHost('www.kayak.co.uk')).toBe(true)
    expect(isAllowedBadgeHost('static.tacdn.com')).toBe(true)
    expect(isAllowedBadgeHost('evil.example')).toBe(false)
  })

  it('rejects javascript URLs and event handlers', () => {
    const kept = sanitizeBadgeHtml('<img src="javascript:alert(1)" alt="x" onerror="alert(1)"><a href="javascript:alert(1)">x</a>')
    expect(kept.html).toBe('x')
    expect(kept.html).not.toContain('javascript:')
    expect(kept.html).not.toContain('onerror')
    expect(kept.html).not.toContain('<img')
    expect(kept.html).not.toContain('<a')
  })
})
