// Sample home page for the render spike: video hero, story, quote, Virtuous donate form.
export const BUNDLE_ID = 'bundle-spike-001'

export const samplePage = {
  id: 'pg_spike_home',
  path: '/',
  title: 'Keep them warm this winter',
  description: 'Your gift pays for blankets, food and treatment for injured street animals.',
  template: 'home',
  versionId: 'ver_spike_home_1',
  blocks: [
    {
      type: 'VideoHero',
      props: {
        heading: 'Keep them warm this winter',
        subheading: 'Your gift pays for blankets, food and treatment.',
        video: '/media/hero.mp4',
        poster: '/media/hero-poster-1280.webp',
        poster640: '/media/hero-poster-640.avif',
        poster640Webp: '/media/hero-poster-640.webp',
        cta: { label: 'Donate now', href: '#donate' },
      },
    },
    {
      type: 'RichText',
      props: {
        heading: 'How your gift helps',
        paragraphs: [
          'Every night this winter, injured street animals need a warm, safe place to recover. A single gift pays for a blanket, a meal and the treatment that gets them back on their feet.',
          'This page is a spike sample, not a live appeal, but the shape is the one we want for the first pilot: a near full-screen video, a short story, and a donation form.',
        ],
      },
    },
    {
      type: 'Quote',
      props: { text: 'They gave him a second chance.', attribution: 'A volunteer' },
    },
    {
      type: 'DonationEmbed',
      props: {
        heading: 'Give a warm place tonight',
        anchor: 'donate',
        // Placeholder ids, clearly not a real organisation form.
        vform: '00000000-0000-0000-0000-000000000001',
        orgId: '0',
        scriptSrc: 'https://cdn.virtuoussoftware.com/virtuous.embed.min.js',
        fallbackHref: 'https://example.org/donate',
      },
    },
  ],
} as const

export const siteShell = {
  name: 'Sample rescue',
  headerLinks: [
    { label: 'Our work', href: '/work' },
    { label: 'Donate', href: '#donate' },
  ],
  footer: 'Spike sample. Not a live site.',
}
