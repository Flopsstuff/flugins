import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'Flugins',
  description: 'A curated collection of Claude Code plugins by Flopsstuff',
  base: '/flugins/',
  lang: 'en-US',
  cleanUrls: true,
  lastUpdated: true,

  head: [
    ['meta', { name: 'theme-color', content: '#7c3aed' }]
  ],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Getting Started', link: '/getting-started' },
      { text: 'Plugin Catalog', link: '/plugin-catalog/' },
      { text: 'Contribution', link: '/contribution/' },
      { text: 'GitHub', link: 'https://github.com/Flopsstuff/flugins' }
    ],

    sidebar: {
      '/plugin-catalog/': [
        {
          text: 'Plugin Catalog',
          items: [
            { text: 'Overview', link: '/plugin-catalog/' },
            { text: 'Docs Plugin', link: '/plugin-catalog/docs-plugin' },
            { text: 'Git Plugin', link: '/plugin-catalog/git-plugin' },
            { text: 'Resolve CodeRabbit Plugin', link: '/plugin-catalog/resolve-coderabbit-plugin' }
          ]
        }
      ],
      '/contribution/': [
        {
          text: 'Contribution',
          items: [
            { text: 'Overview', link: '/contribution/' },
            { text: 'Creating Plugins', link: '/contribution/creating-plugins' },
            { text: 'API Reference', link: '/contribution/api-reference' },
            { text: 'Contributing', link: '/contribution/contributing' }
          ]
        }
      ]
    },

    search: {
      provider: 'local'
    },

    socialLinks: [
      { icon: 'github', link: 'https://github.com/Flopsstuff/flugins' }
    ],

    editLink: {
      pattern: 'https://github.com/Flopsstuff/flugins/edit/main/docs/:path'
    },

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025-present Flopsstuff'
    }
  }
})
