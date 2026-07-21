import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// All API endpoints live in scanner/api.mjs, shared with the production
// entry point (server.mjs). The dev server runs in local mode: no auth,
// machine-local features enabled.
function dotchartApi(): Plugin {
  return {
    name: 'dotchart-api',
    configureServer(server) {
      const handlerPromise = import('./scanner/api.mjs').then(({ createApiHandler }) =>
        createApiHandler({ log: (s: string) => server.config.logger.info(`[dotchart] ${s}`), hosted: false, password: '' }),
      )
      server.middlewares.use((req, res, next) => {
        handlerPromise
          .then((handle) => handle(req, res))
          .then((handled) => {
            if (!handled) next()
          })
          .catch(next)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), dotchartApi()],
})
