import { describe, expect, it } from 'bun:test'
import * as httpPkg from '../../../packages/fred-http/src/index'

describe('fred-http package surface', () => {
  it('does not export removed compatibility server APIs', () => {
    expect('startServer' in httpPkg).toBe(false)
    expect('ServerApp' in httpPkg).toBe(false)
    expect('createFredHttpApp' in httpPkg).toBe(false)
  })

  it('exports security config and composable app APIs', () => {
    expect(httpPkg.DEFAULT_SECURITY_CONFIG).toBeDefined()
    expect(httpPkg.ServerSecurityConfigSchema).toBeDefined()
    expect(httpPkg.FredHttpRuntimeConfigSchema).toBeDefined()
    expect(typeof httpPkg.withHttp).toBe('function')
    expect(typeof httpPkg.FredHttpServerLive).toBe('function')
    expect(typeof httpPkg.resolveWorkflowEndpoints).toBe('function')
    expect(typeof httpPkg.buildWorkflowHttpApi).toBe('function')
    expect(httpPkg.WorkflowEndpointConfigurationError).toBeDefined()
  })

  it('exports the schema-first HttpApi and docs surface', () => {
    expect(httpPkg.FredHttpApi).toBeDefined()
    expect(httpPkg.FredOpenApiSpec).toBeDefined()
    expect(httpPkg.FredOpenApiLayer).toBeDefined()
    expect(httpPkg.FredDocsLayer).toBeDefined()
    expect(httpPkg.FredHttpHandlersLive).toBeDefined()
  })
})
