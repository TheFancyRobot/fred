import { describe, expect, it } from 'bun:test'
import * as httpPkg from '../../../packages/fred-http/src/index'

describe('fred-http package surface', () => {
  it('exports simple-mode server APIs', () => {
    expect(typeof httpPkg.startServer).toBe('function')
    expect(typeof httpPkg.ServerApp).toBe('function')
  })

  it('exports security config and composable app APIs', () => {
    expect(httpPkg.DEFAULT_SECURITY_CONFIG).toBeDefined()
    expect(typeof httpPkg.createFredHttpApp).toBe('function')
  })
})
