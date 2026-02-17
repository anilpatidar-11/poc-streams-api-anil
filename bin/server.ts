import 'reflect-metadata'
import { readFileSync } from 'node:fs'
import { createServer } from 'node:https'
import { Ignitor, prettyPrintError } from '@adonisjs/core'

const APP_ROOT = new URL('../', import.meta.url)

const IMPORTER = (filePath: string) => {
  if (filePath.startsWith('./') || filePath.startsWith('../')) {
    return import(new URL(filePath, APP_ROOT).href)
  }
  return import(filePath)
}

const httpsServer = createServer({
  key: readFileSync(new URL('../192.168.0.186+2-key.pem', import.meta.url)),
  cert: readFileSync(new URL('../192.168.0.186+2.pem', import.meta.url)),
})

new Ignitor(APP_ROOT, { importer: IMPORTER })
  .tap((app) => {
    app.booting(async () => {
      await import('#start/env')
    })
    app.listen('SIGTERM', () => app.terminate())
    app.listenIf(app.managedByPm2, 'SIGINT', () => app.terminate())
  })
  .httpServer()
  .start((handler) => {
    httpsServer.on('request', handler)
    httpsServer.listen(3333, '0.0.0.0', () => {
      console.log('🔒 HTTPS Server running on https://192.168.0.186:3333')
    })
    return httpsServer
  })
  .catch((error) => {
    process.exitCode = 1
    prettyPrintError(error)
  })