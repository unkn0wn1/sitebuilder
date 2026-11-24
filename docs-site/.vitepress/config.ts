import { defineConfig } from 'vitepress'

export default defineConfig({
  title: 'Skewstone',
  description: 'Docs for Skewstone, the site builder.',
  lang: 'en-GB',
  cleanUrls: false,
  sitemap: { hostname: 'https://docs.skewstone.com' },
  themeConfig: {
    search: { provider: 'local' },
    siteTitle: 'Skewstone docs',
    nav: [
      { text: 'Guide', link: '/guide/getting-started' },
      { text: 'Tools', link: '/reference/tools' },
      { text: 'Skewstone', link: 'https://skewstone.com/' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Get started', link: '/guide/getting-started' },
          { text: 'Editing overview', link: '/guide/editing' },
          { text: 'Review and publish', link: '/guide/review-and-publish' },
          { text: 'Plugins', link: '/guide/plugins' },
          { text: 'Hosting and install', link: '/guide/hosting' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Tools', link: '/reference/tools' },
          { text: 'API', link: '/reference/api' },
        ],
      },
    ],
    footer: {
      message: 'Released under the <a href="/licence.html">MIT licence</a>.',
      copyright: 'Copyright (c) 2026 Spencer Martin Hardy',
    },
    outline: { label: 'On this page' },
  },
})
