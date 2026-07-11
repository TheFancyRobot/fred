import { describe, expect, it } from 'bun:test'
import * as httpPkg from '../../../packages/fred-http/src/index'

describe('fred-http package surface', () => {
  it('exports simple-mode server APIs', () => {
    expect(typeof httpPkg.startServer).toBe('function')
    expect(typeof httpPkg.ServerApp).toBe('function')
  })

  it('exports security config and composable app APIs', () => {
    expect(httpPkg.DEFAULT_SECURITY_CONFIG).toBeDefined()
    expect(httpPkg.ServerSecurityConfigSchema).toBeDefined()
    expect(httpPkg.FredHttpRuntimeConfigSchema).toBeDefined()
    expect(typeof httpPkg.createFredHttpApp).toBe('function')
    expect(typeof httpPkg.withHttp).toBe('function')
    expect(typeof httpPkg.FredHttpServerLive).toBe('function')
  })

  it('exports the schema-first HttpApi and docs surface', () => {
    expect(httpPkg.FredHttpApi).toBeDefined()
    expect(httpPkg.FredOpenApiSpec).toBeDefined()
    expect(httpPkg.FredOpenApiLayer).toBeDefined()
    expect(httpPkg.FredDocsLayer).toBeDefined()
    expect(httpPkg.FredHttpHandlersLive).toBeDefined()
  })
})
