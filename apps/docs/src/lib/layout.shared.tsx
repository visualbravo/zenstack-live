import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: 'https://github.com/visualbravo/zenstack-live',

    nav: {
      title: 'ZenStack LIVE',
    },

    links: [
      {
        text: 'Documentation',
        url: '/docs',
        secondary: false,
        on: 'nav',
      },
    ],
  }
}
