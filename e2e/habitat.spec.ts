// End-to-end coverage for the habitat thumbnails + habitat-detail modal
// (real baked-data path). BModal teleports its content to document.body, so
// modal assertions use document-scoped role=dialog locators; with one
// HabitatModal per HouseRecord (typically ≤7 instances, all closed), we also
// assert exactly one dialog is visible after a thumbnail click.

import { expect, test, type Page } from '@playwright/test'

async function selectPokemon(page: Page, name: string) {
  const input = page.getByPlaceholder('Add pokemon to your island...')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(name)
  const option = page.locator('.tropical-dropdown').getByRole('option', { name, exact: true })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await input.press('Enter')
  await expect(
    page.locator('.pokemon-select .favorite-pill', { hasText: name }).first(),
  ).toBeVisible({ timeout: 5_000 })
}

async function setSpinbutton(page: Page, id: string, value: number) {
  const spinbutton = page.locator(`#${id}`)
  await expect(spinbutton).toBeVisible({ timeout: 10_000 })
  await spinbutton.click()
  for (let i = 0; i < value; i++) {
    await spinbutton.press('ArrowUp')
  }
}

test.describe('Habitat thumbnails and detail modal', () => {
  test('opens the habitat detail modal from a card thumbnail with the full roster', async ({
    page,
  }) => {
    test.setTimeout(60_000)

    // Bulbasaur: a small house so the card renders with both habitat thumbs.
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Bulbasaur')
    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    // Bulbasaur spawns in 2 habitats → 2 thumbnails with habitat-name labels.
    const thumbs = page.getByTestId('habitat-thumb')
    await expect(thumbs).toHaveCount(2, { timeout: 10_000 })

    // Open the modal from the first thumbnail (Tall Grass).
    await thumbs.first().click()

    // The cart's BOffcanvas also carries role=dialog, so scope the "exactly
    // one open modal" assertion to habitat-modal instances (hidden BModal
    // shells are display:none and filtered out).
    const visibleHabitatModals = page.getByTestId('habitat-modal').filter({ visible: true })
    await expect(visibleHabitatModals).toHaveCount(1, { timeout: 5_000 })
    const modal = page.getByRole('dialog', { name: 'Tall Grass' })
    await expect(modal).toBeVisible()

    // The large habitat image actually loads.
    const image = modal.getByTestId('habitat-modal-image')
    await expect(image).toBeVisible()
    await expect
      .poll(async () => await image.evaluate((img) => (img as HTMLImageElement).naturalWidth), {
        timeout: 10_000,
      })
      .toBeGreaterThan(0)

    // Flavor text and the roster's Bulbasaur row with a Common badge and all
    // 4 time chips + 3 weather chips.
    await expect(modal).toContainText('tall grass')
    const spawn = modal.getByTestId('habitat-modal-spawn').filter({ hasText: 'Bulbasaur' })
    await expect(spawn).toBeVisible()
    await expect(spawn.getByTestId('habitat-modal-rarity')).toHaveText('Common')
    await expect(spawn.getByTestId('habitat-modal-time')).toHaveCount(4)
    await expect(spawn.getByTestId('habitat-modal-weather')).toHaveCount(3)
    await expect(spawn.getByTestId('habitat-modal-locations')).toContainText('Bleak Beach')

    // Close via the modal's Close button; the dialog disappears.
    await modal.locator('.modal-footer').getByRole('button', { name: 'Close' }).click()
    await expect(modal).toBeHidden({ timeout: 5_000 })
    await expect(visibleHabitatModals).toHaveCount(0)

    // Reopen (cached habitat graph) and close via the second thumbnail to
    // prove any house's card can open the modal.
    await thumbs.nth(1).click()
    const secondModal = page.getByRole('dialog', { name: 'Bench with greenery' })
    await expect(secondModal).toBeVisible()
    await expect(visibleHabitatModals).toHaveCount(1)
    await secondModal.locator('.modal-footer').getByRole('button', { name: 'Close' }).click()
    await expect(secondModal).toBeHidden({ timeout: 5_000 })
  })

  test('habitat thumbnails meet the 24px tap target at desktop and 390px', async ({ page }) => {
    test.setTimeout(60_000)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Bulbasaur')
    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    for (const label of ['habitat-thumb', 'habitat-thumbs']) {
      await expect(page.getByTestId(label).first()).toBeVisible()
    }

    const assertThumbs = async () => {
      const count = await page.getByTestId('habitat-thumb').count()
      expect(count).toBeGreaterThan(0)
      for (const thumb of await page.getByTestId('habitat-thumb').all()) {
        const box = await thumb.boundingBox()
        expect(box, 'habitat-thumb must render').not.toBeNull()
        expect(box!.width, 'habitat-thumb width must be ≥ 24px').toBeGreaterThanOrEqual(24)
        expect(box!.height, 'habitat-thumb height must be ≥ 24px').toBeGreaterThanOrEqual(24)
      }
    }

    await assertThumbs()

    await page.setViewportSize({ width: 390, height: 844 })
    await assertThumbs()
  })

  test('no horizontal overflow at 390px while the habitat modal is open', async ({ page }) => {
    test.setTimeout(60_000)

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Bulbasaur')
    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    await page.getByTestId('habitat-thumb').first().click()
    const modal = page.getByRole('dialog', { name: 'Tall Grass' })
    await expect(modal).toBeVisible()

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      390,
    )

    await modal.locator('.modal-footer').getByRole('button', { name: 'Close' }).click()
    await expect(modal).toBeHidden({ timeout: 5_000 })
  })

  test('a no-spawn pokemon renders no thumbnails', async ({ page }) => {
    test.setTimeout(60_000)

    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Articuno')
    await expect(page.getByTestId('results')).toContainText('Articuno', { timeout: 30_000 })

    await expect(page.getByTestId('house-card').first()).toBeVisible()
    await expect(page.getByTestId('habitat-thumbs')).toHaveCount(0)
    await expect(page.getByTestId('habitat-thumb')).toHaveCount(0)
  })
})
