import { expect, test, type Page } from '@playwright/test'

// Existing suites model a returning visitor: seeding the tour's seen flag keeps
// the first-run guided tour from auto-starting (and blocking the page) mid-test.
// Only e2e/onboarding.spec.ts exercises the auto-start path.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pokehousing_tour_seen', '1'))
})

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

/**
 * Set a BFormSpinbutton to a specific value using ArrowUp keypresses.
 * Spinbuttons start at 0; each ArrowUp increments by 1.
 */
async function setSpinbutton(page: Page, id: string, value: number) {
  // BFormSpinbutton places the id on the inner <output role="spinbutton"> element
  const spinbutton = page.locator(`#${id}`)
  await expect(spinbutton).toBeVisible({ timeout: 10_000 })
  await spinbutton.click()
  for (let i = 0; i < value; i++) {
    await spinbutton.press('ArrowUp')
  }
}

/** Picks a pokemon in a totally-empty house's inline input. */
async function addViaHouseInput(page: Page, name: string) {
  const input = page.getByTestId('house-empty-input').locator('input.pokemon-search')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(name)
  const option = page.locator('.tropical-dropdown').getByRole('option', { name, exact: true })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await input.press('Enter')
}

test.describe('Auto-sort toggle', () => {
  // AC.1 — leftmost config card at xl, titled, checked by default.
  test('renders as the leftmost config card at xl and is on by default', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/')

    const autosort = page.getByTestId('autosort-card')
    await expect(autosort).toBeVisible({ timeout: 10_000 })
    await expect(autosort.locator('h2')).toHaveText('Automatically sort Pokemon')

    const autosortBox = await autosort.boundingBox()
    const housesBox = await page.getByTestId('houses-card').boundingBox()
    expect(autosortBox!.x).toBeLessThan(housesBox!.x)
    // Same row at xl (stacking starts below xl).
    expect(autosortBox!.y).toBe(housesBox!.y)

    await expect(page.getByTestId('autosort-switch')).toBeChecked()
  })

  // AC.4 + AC.5 + AC.6 + AC.7 — full flow with hash round-trip.
  test('off → add to a house (shows there) + island-only pokemon (warns) → reload → flip on', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.goto('/')

    const switchEl = page.getByTestId('autosort-switch')
    await expect(switchEl).toBeChecked({ timeout: 10_000 })
    await switchEl.click()
    await expect(switchEl).not.toBeChecked()

    // AC.5: a registry-derived empty house renders with no solve having run.
    await setSpinbutton(page, 'house-medium', 1)
    const house = page.getByTestId('house-card').filter({
      has: page.locator('.house-title', { hasText: /medium house M\d/ }),
    })
    await expect(house).toBeVisible({ timeout: 10_000 })
    await expect(house.getByTestId('house-empty-input')).toBeVisible()

    // AC.4: a pokemon added via the house's empty slot shows in THAT house
    // immediately (pinned overlay), not in the warning.
    await addViaHouseInput(page, 'Bulbasaur')
    await expect(house).toContainText('Bulbasaur', { timeout: 10_000 })
    // Auto-sort off → the alert stays visible (persistent drop target, empty).
    await expect(page.getByTestId('unhoused')).toBeVisible()
    await expect(page.getByTestId('unhoused-empty-hint')).toBeVisible()
    await expect(
      page.getByTestId('unhoused-pokemon-grid').getByTestId('pokemon-card'),
    ).toHaveCount(0)

    // A pokemon selected only in the island search (never pinned to a house)
    // stays in the OFF warning.
    await selectPokemon(page, 'Ivysaur')
    const unhoused = page.getByTestId('unhoused')
    await expect(unhoused).toContainText('Unhoused pokemon')
    await expect(unhoused).toContainText('Drag a Pokémon from a house')
    await expect(unhoused).toContainText('Ivysaur')
    await expect(unhoused).not.toContainText('Bulbasaur')

    // AC.7: the toggle state persists into the URL hash and survives reload.
    await expect
      .poll(() =>
        page.evaluate(() => {
          const hash = window.location.hash.slice(1)
          return hash ? (JSON.parse(atob(hash)) as { autoSort?: boolean }).autoSort : undefined
        }),
      )
      .toBe(false)
    await page.reload()

    const restoredSwitch = page.getByTestId('autosort-switch')
    await expect(restoredSwitch).toBeVisible({ timeout: 10_000 })
    await expect(restoredSwitch).not.toBeChecked()
    const restoredHouse = page.getByTestId('house-card').filter({
      has: page.locator('.house-title', { hasText: /medium house M\d/ }),
    })
    // Bulbasaur's pin survives the reload via the hash → still in its house.
    await expect(restoredHouse).toContainText('Bulbasaur', { timeout: 30_000 })
    const restoredUnhoused = page.getByTestId('unhoused')
    await expect(restoredUnhoused).toContainText('Unhoused pokemon')
    await expect(restoredUnhoused).toContainText('Ivysaur')

    // AC.6: flipping back on re-solves; both end up in the single medium house
    // and the warning clears.
    await restoredSwitch.click()
    const solvedHouse = page.getByTestId('house-card').filter({
      has: page.locator('.house-title', { hasText: /medium house M\d/ }),
    })
    await expect(solvedHouse).toContainText('Bulbasaur', { timeout: 30_000 })
    await expect(solvedHouse).toContainText('Ivysaur', { timeout: 30_000 })
    await expect(
      solvedHouse.locator('[data-testid="progress-checkbox-pokemon"][aria-checked="true"]'),
    ).toHaveCount(1)
    await expect(page.getByTestId('unhoused')).toHaveCount(0)
  })

  // AC.11 — with a prior solve on record, adding via the plus-card while off
  // shows the newcomer in its house (pinned overlay) without wiping the
  // previously-placed occupants.
  test('with a prior solve, adding via plus-card while off places it in the house', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-large', 1)
    await selectPokemon(page, 'Bulbasaur')

    const house = page.getByTestId('house-card').filter({
      has: page.locator('.house-title', { hasText: /large house L\d/ }),
    })
    await expect(house).toContainText('Bulbasaur', { timeout: 30_000 })

    // Flip off, then add via a plus-card's housemate modal.
    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()

    await house.getByTestId('house-empty-slot').first().click()
    const modal = page.getByTestId('housemate-modal')
    await expect(modal).toBeVisible()
    const options = modal.getByTestId('housemate-option')
    await expect(options.first()).toBeVisible({ timeout: 10_000 })
    const addedName = (await options.first().locator('.housemate-option-name').textContent())!
    await options.first().click()
    await expect(modal).toBeHidden()

    // The prior arrangement is untouched AND the newcomer shows in its house.
    await expect(house).toContainText('Bulbasaur')
    await expect(house).toContainText(addedName, { timeout: 10_000 })
    // Auto-sort off → the persistent drop target is still present, just empty.
    await expect(page.getByTestId('unhoused')).toBeVisible()
    await expect(page.getByTestId('unhoused-empty-hint')).toBeVisible()
    await expect(
      page.getByTestId('unhoused-pokemon-grid').getByTestId('pokemon-card'),
    ).toHaveCount(0)
  })

  // AC.10 — the four-card row keeps the no-horizontal-overflow contract at
  // 390px (complements e2e/compactness.spec.ts).
  test('no horizontal overflow at 390px with the four-card config row', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    await expect(page.getByTestId('autosort-card')).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('houses-card')).toBeVisible()
    // Below xl the cards stack: the toggle card is the topmost.
    const autosortBox = await page.getByTestId('autosort-card').boundingBox()
    const housesBox = await page.getByTestId('houses-card').boundingBox()
    expect(autosortBox!.y).toBeLessThan(housesBox!.y)

    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(390)
  })
})
