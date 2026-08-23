import { expect, test } from '@playwright/test'

async function selectPokemon(page: import('@playwright/test').Page, name: string) {
  const input = page.getByPlaceholder('Add pokemon to your island...')
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
  test('boots with no WASM: no sql.js/sql-wasm network requests are made', async ({ page }) => {
    const wasmRequests: string[] = []
    page.on('request', (req) => {
      const url = req.url()
      if (url.includes('wasm') || url.includes('sql.js') || url.endsWith('.sqlite')) {
        wasmRequests.push(url)
      }
    })
    await page.goto('/')
    // Exercise the full initial load: catalog names + adjacency fetch + a solve.
    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Bulbasaur')
    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })
    expect(wasmRequests).toEqual([])
  })

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

  test('shows the build date in the hero card', async ({ page }) => {
    await page.goto('/')
    const updated = page.getByTestId('last-updated')
    // Static hero element — default 2s expect timeout is enough (30s is only
    // needed for async solver/WASM results like `results`).
    await expect(updated).toBeVisible()
    await expect(updated).toContainText('Last updated:')
    const text = (await updated.textContent()) ?? ''
    const rendered = text.match(/(\d{4}-\d{2}-\d{2})/)?.[1]
    expect(rendered).toBeTruthy()
    // Verify the date is actually current (not a stale literal): compare to
    // the browser's own clock. Build and e2e run in the same CI workflow on
    // the same UTC day in practice; ±1 day absorbs UTC-midnight crossings.
    const today = new Date().toISOString().slice(0, 10)
    const diffMs = Math.abs(Date.parse(rendered!) - Date.parse(today))
    expect(diffMs).toBeLessThanOrEqual(86_400_000)
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
  // @lat: [[ui#HomeView#Saved Queries#Save modal submits on Enter]]
  test('shows success alert after saving an island by pressing Enter', async ({ page }) => {
    test.setTimeout(8000)
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)

    await page.getByRole('button', { name: 'Save current island' }).click()
    const modal = page.getByRole('dialog', { name: 'Save island' })
    await expect(modal).toBeVisible({ timeout: 2000 })

    // Enter in the title field saves exactly once and closes the modal.
    await modal.locator('#query-title-input').press('Enter')
    await expect(modal).toBeHidden({ timeout: 2000 })

    await expect(page.getByText('Island saved.')).toBeVisible({ timeout: 2000 })
    await expect(page.getByText('Island saved.')).toBeHidden({ timeout: 5000 })

    // Exactly one entry was saved — no double fire from Enter + modal OK.
    const stored = await page.evaluate(() => localStorage.getItem('pokehousing_saved_queries'))
    expect(JSON.parse(stored!)).toHaveLength(1)
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

    // A craftable item's craftability cell should include "Craftable ({category})"
    const craftableCells = page.getByTestId('item-craftability').filter({ hasText: /^Craftable/ })
    await expect(craftableCells.first()).toBeVisible({ timeout: 5000 })
    const text = await craftableCells.first().textContent()
    expect(text?.trim()).toMatch(/^Craftable \(\S/)
  })

  test('page body does not have overflow:hidden on fresh load at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto('/')
    await expect(
      page.getByTestId('houses-card').getByRole('button', { name: 'Clear all' }),
    ).toBeVisible({ timeout: 10_000 })
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow)
    expect(bodyOverflow).not.toBe('hidden')
  })

  test('page is scrollable after loading a sample island at desktop width', async ({ page }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Show a sample island' }).click()
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    // The page must be tall enough to need scrolling
    const { scrollHeight, innerHeight } = await page.evaluate(() => ({
      scrollHeight: document.body.scrollHeight,
      innerHeight: window.innerHeight,
    }))
    expect(scrollHeight).toBeGreaterThan(innerHeight)

    // body must NOT have overflow:hidden
    const bodyOverflow = await page.evaluate(() => document.body.style.overflow)
    expect(bodyOverflow).not.toBe('hidden')

    // The page must actually scroll — use mouse.wheel which reliably
    // triggers native scrolling regardless of focus state
    await page.mouse.wheel(0, 100)
    await page.waitForTimeout(200)
    const scrollY = await page.evaluate(() => window.scrollY)
    expect(scrollY).toBeGreaterThan(0)
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

  // @lat: [[ui#House#House items#Paginates at 50 rows]]
  test('recommendations paginate at 50 rows and appends without recreating rows', async ({ page }) => {
    test.setTimeout(40_000)
    await page.goto('/')

    // Abra carries the 'metal stuff' favorite, so its recommendation list is
    // far larger than the 50-row page.
    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Abra')
    await expect(page.getByTestId('results')).toContainText('Abra', { timeout: 30_000 })

    const details = page.getByTestId('recommended-items')
    await expect(details).toBeVisible()
    await details.locator('summary').click()

    const list = page.getByTestId('recommended-items-list')
    await expect(list).toBeVisible()

    const tbodyRows = list.locator('tbody tr')
    const initialCount = await tbodyRows.count()
    expect(initialCount).toBeLessThanOrEqual(50)
    await expect(page.getByTestId('recommendations-more')).toBeVisible()

    // Stamp the first data row so we can prove it is reused, not recreated.
    const firstRow = tbodyRows.first()
    await firstRow.evaluate((el) => {
      ;(el as HTMLElement).dataset.sentinel = 'keep-me'
    })

    await page.getByTestId('recommendations-more').click()
    await expect(tbodyRows).toHaveCount(initialCount + 50)

    // The originally stamped node is still connected and keeps its sentinel:
    // rows are appended under primary-key, not recreated.
    const probe = await firstRow.evaluate((el) => ({
      connected: el.isConnected,
      sentinel: (el as HTMLElement).dataset.sentinel,
    }))
    expect(probe.connected).toBe(true)
    expect(probe.sentinel).toBe('keep-me')
  })

  // @lat: [[ui#ShoppingCart#Progress Store#Placed state clears on cart remove]]
  test('placed state is cleared when item is removed and re-added to cart', async ({ page }) => {
    test.setTimeout(40_000)
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Abra')

    await expect(page.getByTestId('results')).toContainText('Abra', { timeout: 30_000 })

    const details = page.getByTestId('recommended-items')
    await expect(details).toBeVisible()
    await details.locator('summary').click()

    const recommendedList = page.getByTestId('recommended-items-list')
    await expect(recommendedList).toBeVisible()

    // 1. Add the first recommended item (deterministically in the first window,
    //    unlike a hard-coded name that could sit beyond the 50-row page).
    const firstAdd = recommendedList.getByTestId('add-to-cart').first()
    await expect(firstAdd).toBeVisible()
    await firstAdd.click()

    const addedRow = recommendedList
      .locator('tr')
      .filter({ has: page.getByTestId('recommendation-added-badge') })
      .first()
    await expect(addedRow).toBeVisible({ timeout: 2_000 })

    // 2. Mark it as placed
    const placedCheckbox = addedRow.getByTestId('recommendation-placed')
    await placedCheckbox.check()
    await expect(placedCheckbox).toBeChecked()

    // 3. Remove it from the house
    await addedRow.getByTestId('recommendation-remove').click()
    await expect(page.getByTestId('recommendation-added-badge')).toHaveCount(0, { timeout: 2_000 })

    // 4. Add the item again (it reappears as an unadded recommendation)
    await expect(recommendedList.getByTestId('add-to-cart').first()).toBeVisible()
    await recommendedList.getByTestId('add-to-cart').first().click()

    // 5. Assert it is NOT placed
    const reAddedRow = recommendedList
      .locator('tr')
      .filter({ has: page.getByTestId('recommendation-added-badge') })
      .first()
    await expect(reAddedRow).toBeVisible({ timeout: 2_000 })
    await expect(reAddedRow.getByTestId('recommendation-placed')).not.toBeChecked()
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

  // @lat: [[ui#ShoppingCart#Mobile toggle opens the cart below lg]]
  test('shopping cart opens via floating toggle on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    const toggle = page.getByTestId('cart-mobile-toggle')
    await expect(toggle).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')

    // Cart content is unreachable without the toggle below the lg breakpoint
    await expect(page.getByTestId('cart-empty')).toBeHidden()

    await toggle.click()
    await expect(page.getByTestId('shopping-cart')).toBeVisible()
    await expect(page.getByTestId('cart-empty')).toBeVisible({ timeout: 2000 })
    // Toggle hides while the overlay is open
    await expect(toggle).toBeHidden()

    // Body scroll is locked while the overlay is open
    const overflowWhileOpen = await page.evaluate(() => document.body.style.overflow)
    expect(overflowWhileOpen).toBe('hidden')

    // Close via the offcanvas close button — the toggle returns and the page
    // stays usable
    await page.getByTestId('shopping-cart').getByRole('button', { name: 'Close' }).click()
    await expect(page.getByTestId('cart-empty')).toBeHidden()
    await expect(toggle).toBeVisible()
    await expect(page.getByRole('button', { name: 'Show a sample island' })).toBeEnabled()

    // Body scroll is restored after closing
    const overflowAfterClose = await page.evaluate(() => document.body.style.overflow)
    expect(overflowAfterClose).not.toBe('hidden')
  })

  // @lat: [[ui#ShoppingCart#Mobile toggle hidden at desktop]]
  test('mobile toggle is hidden and the sidebar stays inline at desktop width', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1200, height: 800 })
    await page.goto('/')

    await expect(page.getByTestId('cart-mobile-toggle')).toBeHidden()
    await expect(page.getByTestId('cart-empty')).toBeVisible()
  })

  // @lat: [[ui#House#Favorite badge click opens and sorts recommendations]]
  test('clicking a favorite badge opens and sorts recommendations', async ({ page }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    await page.getByRole('button', { name: 'Show a sample island' }).click()
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    // With an empty cart every favorite is unfulfilled. Click the second
    // unfulfilled favorite control (when available) so the assertion can't be
    // satisfied by the panel's default sort column.
    const houseCard = page.getByTestId('house-card').first()
    const favoriteButtons = houseCard
      .locator('tr', { hasNot: page.locator('span.bool-check') })
      .locator('[data-testid="fave-badge"]')
    const badgeCount = await favoriteButtons.count()
    expect(badgeCount).toBeGreaterThan(0)
    const favoriteButton = favoriteButtons.nth(Math.min(1, badgeCount - 1))
    const favorite = (await favoriteButton.textContent())!.trim()
    expect(favorite.length).toBeGreaterThan(0)

    const details = houseCard.getByTestId('recommended-items')
    await expect(details).toBeVisible()
    expect(await details.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false)

    await favoriteButton.click()

    // Panel opens, table mounts, and the favorite's column sorts descending
    expect(await details.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true)
    const header = houseCard.locator(
      `th:has([data-testid="fav-header-fav_${favorite}"])`,
    )
    await expect(header).toHaveAttribute('aria-sort', 'descending')
  })

  // @lat: [[ui#House#Favorite control keyboard activation opens recommendations]]
  test('pressing Enter on a focused favorite control opens recommendations', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    await page.getByRole('button', { name: 'Show a sample island' }).click()
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    // The favorite control is a native <button>, so keyboard activation is
    // browser behavior; this is a real-browser guard for the AC.6 contract.
    const houseCard = page.getByTestId('house-card').first()
    const favoriteControl = houseCard.getByTestId('fave-badge').first()
    const details = houseCard.getByTestId('recommended-items')
    await expect(details).toBeVisible()
    expect(await details.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false)

    await favoriteControl.focus()
    await page.keyboard.press('Enter')

    expect(await details.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true)
  })

  // @lat: [[ui#ShoppingCart#Annotates cart items whose house no longer exists]]
  test('cart keeps and annotates items whose house no longer exists', async ({ page }) => {
    test.setTimeout(40_000)
    await setupWithRecommendedItems(page)

    // A small house keeps totalHouses > 0 after the medium house is removed —
    // the solve watcher early-returns at 0 total houses before reconciling the
    // registry, so an orphan only materializes while at least one house remains.
    await setSpinbutton(page, 'house-small', 1)

    // Re-solve reruns after the new small house; the medium house's panel stays
    // open because its HouseRecord is keyed by stable house id.
    await expect(page.getByTestId('recommended-items-list')).toBeVisible({ timeout: 5000 })

    await page.getByTestId('add-to-cart').first().click()
    await expect(page.getByTestId('cart-item')).toHaveCount(1, { timeout: 2000 })

    // Remove the medium house — its cart group becomes orphaned
    const mediumSpin = page.locator('#house-medium')
    await mediumSpin.click()
    await mediumSpin.press('ArrowDown')

    await expect(page.getByTestId('cart-orphan-note')).toBeVisible({ timeout: 2000 })
    await expect(page.getByTestId('cart-orphan-note')).toContainText('no longer exists')
    await expect(page.getByTestId('cart-house-group')).toHaveClass(/cart-house-group--orphan/)

    // Item controls still work: removing the orphan item restores the empty state
    await page.getByTestId('cart-remove').first().click()
    await expect(page.getByTestId('cart-empty')).toBeVisible({ timeout: 2000 })
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
    await expect(page.getByTestId('cart-item')).toHaveCount(1)
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

test.describe('Usability (P2 audit fixes)', () => {
  // @lat: [[ui#HomeView#Saved Queries#Deletes saved island with undo]]
  test('saved islands can be deleted from the manage modal and undone', async ({ page }) => {
    test.setTimeout(15_000)
    await page.goto('/')

    // Save a titled island via the modal
    await page.getByRole('button', { name: 'Save current island' }).click()
    const saveModal = page.getByRole('dialog', { name: 'Save island' })
    await expect(saveModal).toBeVisible({ timeout: 2000 })
    await saveModal.locator('#query-title-input').fill('Undo test island')
    await saveModal.locator('#query-title-input').press('Enter')
    await expect(page.getByText('Island saved.')).toBeVisible({ timeout: 2000 })

    // Open the manage modal and delete the entry
    await page.getByTestId('saved-queries-manage').click()
    const manageModal = page.getByRole('dialog', { name: 'Saved islands' })
    await expect(manageModal).toBeVisible({ timeout: 2000 })
    await expect(manageModal.getByText('Undo test island')).toBeVisible()

    await manageModal.getByTestId('saved-query-delete').click()
    await expect(manageModal.getByText('No saved islands.')).toBeVisible()
    const afterDelete = await page.evaluate(() => localStorage.getItem('pokehousing_saved_queries'))
    expect(JSON.parse(afterDelete!)).toEqual([])

    // Close the manage modal (header ✕) — the undo alert sits behind it
    await manageModal.getByRole('button', { name: 'Close' }).click()
    await expect(manageModal).toBeHidden({ timeout: 2000 })

    const deletedAlert = page.getByTestId('saved-query-deleted')
    await expect(deletedAlert).toBeVisible()
    await expect(deletedAlert).toContainText('Undo test island')

    // Deleting the only entry hides the restore select
    await expect(page.locator('#saved-queries-select')).toHaveCount(0)

    // Undo re-inserts the entry and re-persists it
    await page.getByTestId('saved-query-undo').click()
    await expect(deletedAlert).toBeHidden()
    const afterUndo = await page.evaluate(() => localStorage.getItem('pokehousing_saved_queries'))
    expect(JSON.parse(afterUndo!)).toHaveLength(1)
    expect(JSON.parse(afterUndo!)[0].title).toBe('Undo test island')

    // The restored entry survives a reload
    await page.reload()
    await expect(page.locator('#saved-queries-select')).toContainText('Undo test island', {
      timeout: 30_000,
    })
  })

  // @lat: [[ui#HomeView#Accessibility#Pin and favorite controls meet 24px tap target]]
  // @lat: [[ui#HomeView#Accessibility#Cart remove controls meet 24px tap target]]
  test('pin toggles, cart removes and favorite badges meet the 24px minimum tap target', async ({ page }) => {
    test.setTimeout(90_000)

    async function assertTapTarget(
      page: import('@playwright/test').Page,
      label: string,
      locator: import('@playwright/test').Locator,
    ) {
      await expect(locator).toBeVisible()
      const box = await locator.boundingBox()
      expect(box, `${label} must render`).not.toBeNull()
      expect(box!.width, `${label} width must be ≥ 24px`).toBeGreaterThanOrEqual(24)
      expect(box!.height, `${label} height must be ≥ 24px`).toBeGreaterThanOrEqual(24)
    }

    await page.setViewportSize({ width: 1200, height: 800 })

    // Deterministic setup: known Bulbasaur+Ivysaur recommendations yield exactly
    // one cart item and therefore both remove controls exist. Also supplies the
    // house pin, pokemon pin, and favorite badge targets. (setupWithRecommendedItems
    // is scoped to the Shopping Cart describe, so inline the same steps here.)
    await page.goto('/')
    await setSpinbutton(page, 'house-medium', 1)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })
    const details = page.getByTestId('recommended-items')
    await expect(details).toBeVisible()
    await details.locator('summary').click()
    await expect(page.getByTestId('recommended-items-list')).toBeVisible()
    await page.getByTestId('add-to-cart').first().click()
    await expect(page.getByTestId('cart-item')).toHaveCount(1, { timeout: 2000 })

    await assertTapTarget(page, 'house pin', page.getByTestId('progress-checkbox-house').first())
    await assertTapTarget(page, 'pokemon pin', page.getByTestId('progress-checkbox-pokemon').first())
    await assertTapTarget(page, 'favorite badge', page.getByTestId('fave-badge').first())
    // The "+" add-to-cart control leads the action rail — density compaction
    // must not shrink it below the 24px floor.
    await assertTapTarget(page, 'add-to-cart', page.getByTestId('add-to-cart').first())
    // Desktop cart remove controls — also asserts AC.5 (visible at ≥992px)
    await assertTapTarget(page, 'cart-remove', page.getByTestId('cart-remove').first())
    await assertTapTarget(page, 'recommendation-remove', page.getByTestId('recommendation-remove').first())
    await assertTapTarget(
      page,
      'recommendation-placed',
      page.locator('.recommended-items-table .progress-action--placed').first(),
    )

    // Mobile width — resize, state persists (no re-setup). House cards stay in
    // main content; the cart sidebar is behind the overlay, so open it first.
    await page.setViewportSize({ width: 390, height: 844 })
    const toggle = page.getByTestId('cart-mobile-toggle')
    await expect(toggle).toBeVisible()
    await toggle.click()
    await expect(page.getByTestId('shopping-cart')).toBeVisible()

    await assertTapTarget(page, 'cart-remove', page.getByTestId('cart-remove').first())
    await assertTapTarget(page, 'recommendation-remove', page.getByTestId('recommendation-remove').first())
    await assertTapTarget(
      page,
      'recommendation-placed',
      page.locator('.recommended-items-table .progress-action--placed').first(),
    )
    // The "+" rails are mounted behind the cart overlay but must still keep the
    // 24px floor at mobile width.
    await assertTapTarget(page, 'add-to-cart', page.getByTestId('add-to-cart').first())
  })

  // @lat: [[ui#HomeView#Accessibility#Layout uses dynamic viewport units]]
  test('body min-height tracks the dynamic viewport height', async ({ page }) => {
    test.setTimeout(15_000)
    await page.goto('/')
    await expect(
      page.getByTestId('houses-card').getByRole('button', { name: 'Clear all' }),
    ).toBeVisible({ timeout: 10_000 })

    const { minHeight, viewport } = await page.evaluate(() => ({
      minHeight: parseFloat(getComputedStyle(document.body).minHeight),
      viewport: window.innerHeight,
    }))
    // 100dvh resolves to the dynamic viewport height in Chromium; allow
    // sub-pixel/scrollbar slack.
    expect(minHeight).toBeGreaterThanOrEqual(0.9 * viewport)
  })
})
