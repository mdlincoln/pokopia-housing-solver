import { expect, test } from '@playwright/test'

async function selectPokemon(page: import('@playwright/test').Page, name: string) {
  const input = page.getByPlaceholder('Search pokemon...')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(name)
  const option = page.locator('.tropical-dropdown').getByRole('option', { name, exact: true })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await input.press('Enter')
  await expect(page.locator('.pokemon-select .favorite-pill', { hasText: name }).first()).toBeVisible({ timeout: 5_000 })
}

/**
 * Set a BFormSpinbutton to a specific value using ArrowUp keypresses.
 * Spinbuttons start at 0; each ArrowUp increments by 1.
 */
async function setSpinbutton(page: import('@playwright/test').Page, id: string, value: number) {
  // BFormSpinbutton places the id on the inner <output role="spinbutton"> element
  const spinbutton = page.locator(`#${id}`)
  await expect(spinbutton).toBeVisible({ timeout: 10_000 })
  await spinbutton.click()
  for (let i = 0; i < value; i++) {
    await spinbutton.press('ArrowUp')
  }
}

test.describe('Homepage', () => {
  test('solves and displays results', async ({ page }) => {
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)
    await setSpinbutton(page, 'house-medium', 1)

    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await selectPokemon(page, 'Charmander')

    // Wait for the solve that includes all selected pokemon to complete
    const results = page.getByTestId('results')
    await expect(results).toContainText('Bulbasaur', { timeout: 30_000 })
    await expect(results).toContainText('Ivysaur')
    await expect(results).toContainText('Charmander')

    const cards = page.getByTestId('house-card')
    await expect(cards).toHaveCount(2)
  })

  test('displays unhoused pokemon when capacity is exceeded', async ({ page }) => {
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)

    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await selectPokemon(page, 'Venusaur')

    // Wait for the solve that includes all selected pokemon; 1 small house can only hold 1
    const unhoused = page.getByTestId('unhoused')
    await expect(unhoused).toBeVisible({ timeout: 30_000 })
    const unhousedItems = unhoused.locator('li')
    await expect(unhousedItems).toHaveCount(2)
  })

  test('solves with no pokemon selected', async ({ page }) => {
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)
    await setSpinbutton(page, 'house-medium', 1)

    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    const cards = page.getByTestId('house-card')
    await expect(cards).toHaveCount(2)
    await expect(page.getByTestId('empty')).toHaveCount(2)
  })

  test('displays habitat badge on pokemon card', async ({ page }) => {
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Bulbasaur')

    // Wait for the solve with Bulbasaur to complete before checking badges
    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    const habitatBadge = page.getByTestId('habitat-badge')
    await expect(habitatBadge).toBeVisible()
  })

  // @lat: [[ui#HomeView#Saved Queries#Shows success alert after save]]
  test('shows success alert after saving a query', async ({ page }) => {
    test.setTimeout(8000)
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)

    await page.getByRole('button', { name: 'Save query' }).click()
    const modal = page.getByRole('dialog', { name: 'Save query' })
    await expect(modal).toBeVisible({ timeout: 2000 })

    const saveBtn = modal.getByRole('button', { name: 'Save' })
    await expect(saveBtn).toBeEnabled({ timeout: 2000 })
    await saveBtn.click()
    await expect(modal).toBeHidden({ timeout: 2000 })

    await expect(page.getByText('Query saved successfully.')).toBeVisible({ timeout: 2000 })
    await expect(page.getByText('Query saved successfully.')).toBeHidden({ timeout: 5000 })
  })

  test('displays shared habitat badge on house card', async ({ page }) => {
    await page.goto('/')

    await setSpinbutton(page, 'house-medium', 1)

    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Charmander')
    await selectPokemon(page, 'Squirtle')

    // Wait for the solve including all 3 pokemon to complete
    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    const habitatBadges = page.getByTestId('habitat-badge')
    await expect(habitatBadges).toHaveCount(2)
  })

  test('keeps bright and dark pokemon of the same medium house', async ({ page }) => {
    test.setTimeout(15_000)
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)
    await setSpinbutton(page, 'house-medium', 1)

    await selectPokemon(page, 'Venonat')
    await selectPokemon(page, 'Weezing')

    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    const mediumHouse = page.getByTestId('house-card').filter({
      has: page.locator('h5', { hasText: /medium house M\d/ }),
    })
    await expect(mediumHouse).toHaveCount(1)

    const weezingInMedium = (await mediumHouse.getByText('Weezing', { exact: true }).count()) > 0
    const venonatInMedium = (await mediumHouse.getByText('Venonat', { exact: true }).count()) > 0
    expect(weezingInMedium && venonatInMedium).toBe(false)
  })

  // @lat: [[ui#House#Item Metadata Display#Shows craftability text on recommended items]]
  test('shows craftable and buy text on recommended items', async ({ page }) => {
    await page.goto('/')

    await setSpinbutton(page, 'house-medium', 1)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')

    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    const details = page.getByTestId('recommended-items')
    await expect(details).toBeVisible()
    await details.locator('summary').click()

    // At least one item must have a craftability cell with "Craftable" or "Buy"
    const craftCell = page.getByTestId('item-craftability').first()
    await expect(craftCell).toBeVisible({ timeout: 5000 })
    const text = await craftCell.textContent()
    expect(text?.trim()).toMatch(/^(Craftable|Buy)/)
  })

  // @lat: [[ui#House#Item Metadata Display#Shows craftability includes category for craftable items]]
  test('shows category inside craftability cell on recommended items', async ({ page }) => {
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Bulbasaur')

    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    const details = page.getByTestId('recommended-items')
    await expect(details).toBeVisible()
    await details.locator('summary').click()

    // A craftable item's craftability cell should include "Craftable - {category}"
    const craftableCells = page.getByTestId('item-craftability').filter({ hasText: /^Craftable/ })
    await expect(craftableCells.first()).toBeVisible({ timeout: 5000 })
    const text = await craftableCells.first().textContent()
    expect(text?.trim()).toMatch(/^Craftable - \S/)
  })
})

test.describe('Progress Tracking', () => {
  // @lat: [[ui#HomeView#Pinning#Sample island clears progress]]
  test('sample island clears checked houses and pokemon', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/')

    // Load the first sample — waits for solver results
    await page.getByRole('button', { name: 'Show a sample island' }).click()
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    // Pin the first house — after pinning, the house card animates to the bottom,
    // so .first() would resolve to a different card. Use .click() and then verify
    // by attribute selector rather than position.
    // Note: pinning a house also auto-pins all its pokemon occupants.
    await page.getByTestId('progress-checkbox-house').first().click()
    await expect(page.locator('[data-testid="progress-checkbox-house"][aria-checked="true"]')).not.toHaveCount(0)
    await expect(page.locator('[data-testid="progress-checkbox-pokemon"][aria-checked="true"]')).not.toHaveCount(0)

    // Load a new sample — progress should be cleared
    await page.getByRole('button', { name: 'Show a sample island' }).click()
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    // All house and pokemon checkboxes must be unchecked
    const houseCheckboxes = page.getByTestId('progress-checkbox-house')
    const pokemonCheckboxes = page.getByTestId('progress-checkbox-pokemon')
    await expect(houseCheckboxes.first()).not.toBeChecked()
    for (const cb of await houseCheckboxes.all()) {
      await expect(cb).not.toBeChecked()
    }
    for (const cb of await pokemonCheckboxes.all()) {
      await expect(cb).not.toBeChecked()
    }
  })
})

test.describe('Shopping Cart', () => {
  /**
   * Set up a medium house with Bulbasaur + Ivysaur so the solver produces
   * recommended items, then expand the details panel so the add-to-cart
   * buttons are actionable.
   */
  async function setupWithRecommendedItems(page: import('@playwright/test').Page) {
    await page.goto('/')
    await setSpinbutton(page, 'house-medium', 1)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })
    const details = page.getByTestId('recommended-items')
    await expect(details).toBeVisible()
    await details.locator('summary').click()
    await expect(page.getByTestId('recommended-items-list')).toBeVisible()
  }

  // @lat: [[ui#ShoppingCart#Opens and closes the panel]]
  test('cart sidebar is always visible at desktop and shows empty state', async ({ page }) => {
    await page.goto('/')

    // Sidebar renders inline at lg+ without any toggling required
    await expect(page.getByTestId('cart-empty')).toBeVisible()
    // Cart items list only appears once items have been added
    await expect(page.getByTestId('cart-items')).toBeHidden()
    // No toggle button
    await expect(page.getByTestId('cart-toggle')).toHaveCount(0)
  })

  // @lat: [[ui#ShoppingCart#Adds item from recommended items]]
  test('adds item from recommended items', async ({ page }) => {
    test.setTimeout(40_000)
    await setupWithRecommendedItems(page)

    // Add the first recommended item — sidebar is always visible, item appears immediately
    await page.getByTestId('add-to-cart').first().click()

    await expect(page.getByTestId('cart-items')).toBeVisible({ timeout: 2000 })
    await expect(page.getByTestId('cart-item')).toHaveCount(1)
    await expect(page.getByTestId('cart-quantity')).toHaveText('1')
  })

  test('incrementing quantity updates the displayed count', async ({ page }) => {
    test.setTimeout(40_000)
    await setupWithRecommendedItems(page)

    await page.getByTestId('add-to-cart').first().click()
    await expect(page.getByTestId('cart-quantity')).toHaveText('1')

    await page.getByTestId('cart-increment').click()
    await expect(page.getByTestId('cart-quantity')).toHaveText('2')
  })

  // @lat: [[ui#ShoppingCart#Remove clears item from cart]]
  test('removing an item clears it from the sidebar', async ({ page }) => {
    test.setTimeout(40_000)
    await setupWithRecommendedItems(page)

    // Add one item and verify it appears in the always-visible sidebar
    await page.getByTestId('add-to-cart').first().click()
    await expect(page.getByTestId('cart-item')).toHaveCount(1, { timeout: 2000 })

    // Remove it — empty state should return
    await page.getByTestId('cart-remove').first().click()
    await expect(page.getByTestId('cart-empty')).toBeVisible({ timeout: 2000 })
  })

  // @lat: [[ui#ShoppingCart#Clear all empties the cart]]
  test('clear all button removes all items and shows empty state', async ({ page }) => {
    test.setTimeout(40_000)
    await setupWithRecommendedItems(page)

    // Add two different items
    const addButtons = page.getByTestId('add-to-cart')
    await addButtons.nth(0).click()
    await addButtons.nth(1).click()
    await expect(page.getByTestId('cart-item')).toHaveCount(2, { timeout: 2000 })

    // Click "Clear all" — empty state should return
    await page.getByTestId('cart-clear').click()
    await expect(page.getByTestId('cart-empty')).toBeVisible({ timeout: 2000 })
    await expect(page.getByTestId('cart-items')).toBeHidden()
  })
})

test.describe('URL Hash Sharing', () => {
  // @lat: [[ui#HomeView#Saved Queries#URL Sharing#Hash updates reactively]]
  test('URL hash updates when scenario state changes', async ({ page }) => {
    test.setTimeout(40_000)
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Bulbasaur')

    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    const url = page.url()
    expect(url).toContain('#')
    const hash = new URL(url).hash.slice(1)
    expect(hash.length).toBeGreaterThan(0)

    // Decoded payload should contain the configured state
    const decoded = JSON.parse(atob(hash))
    expect(decoded.small).toBe(1)
    expect(decoded.pokemon).toContain('Bulbasaur')
  })

  // @lat: [[ui#HomeView#Saved Queries#URL Sharing#Restores houses and pokemon from hash]]
  test('loading a shared URL restores house counts and pokemon', async ({ page }) => {
    test.setTimeout(40_000)

    // Build a minimal shared state and encode it
    const state = { small: 1, medium: 0, large: 0, pokemon: ['Bulbasaur', 'Ivysaur'] }
    const hash = btoa(JSON.stringify(state))

    await page.goto(`/#${hash}`)

    // Houses and pokemon should be restored automatically
    await expect(page.locator('#house-small')).toHaveText('1', { timeout: 30_000 })
    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })
    await expect(page.getByTestId('results')).toContainText('Ivysaur', { timeout: 30_000 })
  })

  // @lat: [[ui#HomeView#Saved Queries#URL Sharing#Restores cart items from hash]]
  test('loading a shared URL restores cart items', async ({ page }) => {
    test.setTimeout(40_000)

    const state = {
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['Bulbasaur'],
      cart: [{ houseId: 'S1', name: 'Berry Pots', quantity: 2 }],
    }
    const hash = btoa(JSON.stringify(state))

    await page.goto(`/#${hash}`)

    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })
    await expect(page.getByTestId('cart-items')).toBeVisible({ timeout: 5000 })
    await expect(page.getByTestId('cart-quantity')).toHaveText('2')
  })

  // @lat: [[ui#HomeView#Saved Queries#URL Sharing#Restores pins from hash]]
  test('loading a shared URL restores pinned houses and pokemon', async ({ page }) => {
    test.setTimeout(40_000)

    const state = {
      version: 2,
      small: 1,
      medium: 0,
      large: 0,
      pokemon: ['Bulbasaur'],
      pinnedHouses: ['S1'],
      pinnedPokemon: ['S1:Bulbasaur'],
      houseRegistry: [{ id: 'S1', size: 'small' }],
      houseCounters: { small: 1, medium: 0, large: 0 },
    }
    const hash = btoa(JSON.stringify(state))

    await page.goto(`/#${hash}`)

    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    await expect(page.getByTestId('progress-checkbox-house').first()).toBeChecked()
    await expect(page.getByTestId('progress-checkbox-pokemon').first()).toBeChecked()
  })
})

test.describe('Pinning', () => {
  test('pinned pokemon stays in same house after adding new pokemon', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)
    await setSpinbutton(page, 'house-medium', 1)

    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')

    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    // Find the house that contains Bulbasaur and pin it
    const bulbasaurCard = page.getByTestId('house-card').filter({ hasText: 'Bulbasaur' })
    const houseHeading = await bulbasaurCard.locator('h5').first().textContent()
    await bulbasaurCard.getByTestId('progress-checkbox-pokemon').first().check()

    // Add a third pokemon — should trigger re-solve
    await selectPokemon(page, 'Charmander')
    await expect(page.getByTestId('results')).toContainText('Charmander', { timeout: 30_000 })

    // Bulbasaur should still be in the same house
    const bulbasaurHouseAfter = page.getByTestId('house-card').filter({ hasText: 'Bulbasaur' })
    const headingAfter = bulbasaurHouseAfter.locator('h5').first()
    await expect(headingAfter).toHaveText(houseHeading)
  })

  test('pinned pokemon cannot be removed from PokemonSelect', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Bulbasaur')

    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    // Pin Bulbasaur
    await page.getByTestId('progress-checkbox-pokemon').first().check()

    // The close button on Bulbasaur's badge should be disabled
    const badge = page.locator('.pokemon-select .favorite-pill', { hasText: 'Bulbasaur' })
    const closeBtn = badge.locator('.btn-close')
    await expect(closeBtn).toBeDisabled()
  })

  test('locked house cannot be removed by reducing count', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 2)
    await selectPokemon(page, 'Bulbasaur')

    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    // Pin the house that has Bulbasaur
    const bulbasaurHouse = page.getByTestId('house-card').filter({ hasText: 'Bulbasaur' })
    await bulbasaurHouse.getByTestId('progress-checkbox-house').check()

    // The small house input should have min=1 now
    const smallInput = page.locator('#house-small')
    await expect(smallInput).toHaveAttribute('aria-valuemin', '1')
  })
})
