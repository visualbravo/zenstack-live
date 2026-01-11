import type { GlobalConfig } from 'payload'

export const HomePage: GlobalConfig = {
  slug: 'home-page',

  fields: [
    {
      type: 'date',
      name: 'updatedAt',
      required: true,
    },
  ],
}
