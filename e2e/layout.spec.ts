import { expect, test } from '@playwright/test'

test.describe('Page layout', () => {
  test('AC.1: main content column extends to meet the inline cart sidebar', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/')

    const appShell = page.locator('.app-shell')
    const cart = page.getByTestId('shopping-cart')
    await expect(cart).toBeVisible({ timeout: 10_000 })

    const shellBox = await appShell.boundingBox()
    const cartBox = await cart.boundingBox()
    expect(shellBox).not.toBeNull()
    expect(cartBox).not.toBeNull()
    if (!shellBox || !cartBox) return

    // Well above the old 980px cap; the fluid shell fills ~1100px beside the
    // 300px sidebar at a 1400px viewport.
    expect(shellBox.width).toBeGreaterThan(1000)
    // Adjacent, no overlap: the shell's right edge meets the sidebar's left edge.
    expect(shellBox.x + shellBox.width).toBeLessThanOrEqual(cartBox.x + 1)
  })

  test('AC.2: intro hero renders as a full-width card above the config card', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/')

    const appShell = page.locator('.app-shell')
    const hero = page.locator('.page-hero')
    const configCard = page.getByTestId('config-card')
    await expect(hero).toBeVisible({ timeout: 10_000 })
    await expect(configCard).toBeVisible({ timeout: 10_000 })

    const shellBox = await appShell.boundingBox()
    const heroBox = await hero.boundingBox()
    const configBox = await configCard.boundingBox()
    expect(shellBox).not.toBeNull()
    expect(heroBox).not.toBeNull()
    expect(configBox).not.toBeNull()
    if (!shellBox || !heroBox || !configBox) return

    // Full-width within the shell: inset only by the container padding (px-md-4)
    // and the col gutters (~36px per side at desktop).
    expect(heroBox.width).toBeGreaterThanOrEqual(shellBox.width - 80)
    expect(heroBox.x).toBeGreaterThanOrEqual(shellBox.x)
    // Above the config card in document order.
    expect(heroBox.y).toBeLessThan(configBox.y)
  })

  test('AC.3: config and islands cards sit side by side at equal height (xl)', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/')

    const configCard = page.getByTestId('config-card')
    const islandsCard = page.getByTestId('islands-card')
    await expect(configCard).toBeVisible({ timeout: 10_000 })
    await expect(islandsCard).toBeVisible({ timeout: 10_000 })

    const configBox = await configCard.boundingBox()
    const islandsBox = await islandsCard.boundingBox()
    expect(configBox).not.toBeNull()
    expect(islandsBox).not.toBeNull()
    if (!configBox || !islandsBox) return

    // Side by side: overlapping y-ranges, config left of islands.
    expect(configBox.y).toBeLessThan(islandsBox.y + islandsBox.height)
    expect(islandsBox.y).toBeLessThan(configBox.y + configBox.height)
    expect(configBox.x + configBox.width).toBeLessThanOrEqual(islandsBox.x)
    // Equal heights (h-100 on both cards).
    expect(Math.abs(configBox.height - islandsBox.height)).toBeLessThanOrEqual(2)
  })

  test('AC.4: cards stack vertically below the xl breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await page.goto('/')

    const configCard = page.getByTestId('config-card')
    const islandsCard = page.getByTestId('islands-card')
    await expect(configCard).toBeVisible({ timeout: 10_000 })
    await expect(islandsCard).toBeVisible({ timeout: 10_000 })

    const configBox = await configCard.boundingBox()
    const islandsBox = await islandsCard.boundingBox()
    expect(configBox).not.toBeNull()
    expect(islandsBox).not.toBeNull()
    if (!configBox || !islandsBox) return

    // Stacked: config card entirely above the islands card.
    expect(configBox.y + configBox.height).toBeLessThanOrEqual(islandsBox.y)
  })
})
