import { expect, test } from '@playwright/test'

// Existing suites model a returning visitor: seeding the tour's seen flag keeps
// the first-run guided tour from auto-starting (and blocking the page) mid-test.
// Only e2e/onboarding.spec.ts exercises the auto-start path.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pokehousing_tour_seen', '1'))
})

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

  test('AC.2: intro hero renders as a full-width card above the config cards', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/')

    const appShell = page.locator('.app-shell')
    const hero = page.locator('.page-hero')
    const housesCard = page.getByTestId('houses-card')
    await expect(hero).toBeVisible({ timeout: 10_000 })
    await expect(housesCard).toBeVisible({ timeout: 10_000 })

    const shellBox = await appShell.boundingBox()
    const heroBox = await hero.boundingBox()
    const housesBox = await housesCard.boundingBox()
    expect(shellBox).not.toBeNull()
    expect(heroBox).not.toBeNull()
    expect(housesBox).not.toBeNull()
    if (!shellBox || !heroBox || !housesBox) return

    // Full-width within the shell: inset only by the container padding (px-md-4)
    // and the col gutters (~36px per side at desktop).
    expect(heroBox.width).toBeGreaterThanOrEqual(shellBox.width - 80)
    expect(heroBox.x).toBeGreaterThanOrEqual(shellBox.x)
    // The sample-island alert sits between the hero and the houses card.
    const alert = page.getByTestId('sample-island-alert')
    await expect(alert).toBeVisible()
    const alertBox = await alert.boundingBox()
    expect(alertBox).not.toBeNull()
    if (alertBox) {
      expect(heroBox.y).toBeLessThan(alertBox.y)
      expect(alertBox.y).toBeLessThan(housesBox.y)
      expect(alertBox.width).toBeGreaterThanOrEqual(shellBox.width - 80)
    }
    // Above the houses card in document order.
    expect(heroBox.y).toBeLessThan(housesBox.y)
  })

  test('AC.3: houses, pokemon, and islands cards sit side by side at equal height (xl)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/')

    const housesCard = page.getByTestId('houses-card')
    const pokemonCard = page.getByTestId('pokemon-search-card')
    const islandsCard = page.getByTestId('islands-card')
    await expect(housesCard).toBeVisible({ timeout: 10_000 })
    await expect(pokemonCard).toBeVisible({ timeout: 10_000 })
    await expect(islandsCard).toBeVisible({ timeout: 10_000 })

    const boxes = {
      houses: await housesCard.boundingBox(),
      pokemon: await pokemonCard.boundingBox(),
      islands: await islandsCard.boundingBox(),
    }
    expect(boxes.houses).not.toBeNull()
    expect(boxes.pokemon).not.toBeNull()
    expect(boxes.islands).not.toBeNull()
    if (!boxes.houses || !boxes.pokemon || !boxes.islands) return

    const { houses, pokemon, islands } = boxes
    // Side by side: overlapping y-ranges, ordered left to right.
    expect(houses.y).toBeLessThan(islands.y + islands.height)
    expect(islands.y).toBeLessThan(houses.y + houses.height)
    expect(houses.x + houses.width).toBeLessThanOrEqual(pokemon.x)
    expect(pokemon.x + pokemon.width).toBeLessThanOrEqual(islands.x)
    // Equal heights (h-100 on all cards).
    expect(Math.abs(houses.height - pokemon.height)).toBeLessThanOrEqual(2)
    expect(Math.abs(pokemon.height - islands.height)).toBeLessThanOrEqual(2)
  })

  test('AC.4: cards stack vertically below the xl breakpoint', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await page.goto('/')

    const housesCard = page.getByTestId('houses-card')
    const pokemonCard = page.getByTestId('pokemon-search-card')
    const islandsCard = page.getByTestId('islands-card')
    await expect(housesCard).toBeVisible({ timeout: 10_000 })
    await expect(pokemonCard).toBeVisible({ timeout: 10_000 })
    await expect(islandsCard).toBeVisible({ timeout: 10_000 })

    const boxes = {
      houses: await housesCard.boundingBox(),
      pokemon: await pokemonCard.boundingBox(),
      islands: await islandsCard.boundingBox(),
    }
    expect(boxes.houses).not.toBeNull()
    expect(boxes.pokemon).not.toBeNull()
    expect(boxes.islands).not.toBeNull()
    if (!boxes.houses || !boxes.pokemon || !boxes.islands) return

    const { houses, pokemon, islands } = boxes
    // Stacked: houses above pokemon above islands.
    expect(houses.y + houses.height).toBeLessThanOrEqual(pokemon.y)
    expect(pokemon.y + pokemon.height).toBeLessThanOrEqual(islands.y)
  })
})
