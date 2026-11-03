import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared'

export function baseOptions(): BaseLayoutProps {
  return {
    githubUrl: 'https://github.com/visualbravo/zenstack-live',

    nav: {
      title: <span>ZenStack <span className='text-red-500'>LIVE</span></span>,
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
