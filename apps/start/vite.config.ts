// import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
// import { nitroV2Plugin } from '@tanstack/nitro-v2-vite-plugin'
// import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'
import svgr from 'vite-plugin-svgr'
import viteTsConfigPaths from 'vite-tsconfig-paths'

const config = defineConfig({
  plugins: [
    svgr(),
    // cloudflare({ viteEnvironment: { name: 'ssr' } }),
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    tanstackStart(),
    // nitroV2Plugin({ preset: 'bun' }),
    // nitro(),
    viteReact(),
  ],
  // nitro: {
  //   preset: 'bun',
  // },
  envDir: '../../packages/env',
  envPrefix: 'NEXT_PUBLIC_',
  server: {
    allowedHosts: ['newproject'],
  },
})

export default config
