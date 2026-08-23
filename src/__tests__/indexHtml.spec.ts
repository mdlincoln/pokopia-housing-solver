import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// The static splash in index.html is the only loading feedback available before
// the JS bundle downloads and Vue mounts. jsdom never parses index.html, so this
// is a static file-content check — the existing e2e suite covers that Vue
// replaces the splash on mount.
describe('index.html static splash', () => {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf-8')

  it('declares a document language', () => {
    expect(html).toContain('lang="en"')
  })

  it('contains a splash spinner inside #app with a pure-CSS keyframe animation', () => {
    const appIndex = html.indexOf('id="app"')
    const splashIndex = html.indexOf('class="app-splash"')
    expect(appIndex).toBeGreaterThan(-1)
    expect(splashIndex).toBeGreaterThan(appIndex)
    expect(html).toContain('@keyframes app-spin')
    expect(html).toContain('app-splash-spinner')
  })

  it('splash is accessible and shows a loading message', () => {
    const start = html.indexOf('class="app-splash"')
    const end = html.indexOf('<script', start)
    const splash = html.slice(start, end)
    expect(splash).toContain('role="status"')
    expect(splash).toContain('aria-live')
    expect(splash).toContain('Loading Pokopia Housing Solver')
  })
})
