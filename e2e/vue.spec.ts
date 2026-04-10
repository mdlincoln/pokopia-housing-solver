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
  test('renders the form', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('h1')).toHaveText('Pokopia Housing Solver')
    await expect(page.locator('#house-small')).toBeVisible()
    await expect(page.locator('#house-medium')).toBeVisible()
    await expect(page.locator('#house-large')).toBeVisible()
    await expect(page.getByPlaceholder('Search pokemon...')).toBeVisible()

    await expect(page.getByTestId('results')).toBeHidden()
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

  test('saves query with title and shows it in restore dropdown', async ({ page }) => {
    test.setTimeout(5000)
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)

    await page.getByRole('button', { name: 'Save query' }).click()
    const modal = page.getByRole('dialog', { name: 'Save query' })
    await expect(modal).toBeVisible({ timeout: 2000 })

    const saveBtn = modal.getByRole('button', { name: 'Save' })
    await expect(saveBtn).toBeEnabled({ timeout: 2000 })
    await modal.getByLabel('Title (optional)').fill('My test query')
    await saveBtn.click()
    await expect(modal).toBeHidden({ timeout: 2000 })

    const select = page.locator('#saved-queries-select')
    await expect(select).toBeVisible({ timeout: 2000 })
    await expect(select.locator('option', { hasText: 'My test query' })).toHaveCount(1)
  })

  test('saves query without title and shows timestamp fallback in dropdown', async ({ page }) => {
    test.setTimeout(5000)
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)

    await page.getByRole('button', { name: 'Save query' }).click()
    const modal = page.getByRole('dialog', { name: 'Save query' })
    await expect(modal).toBeVisible({ timeout: 2000 })

    const saveBtn = modal.getByRole('button', { name: 'Save' })
    await expect(saveBtn).toBeEnabled({ timeout: 2000 })
    await saveBtn.click()
    await expect(modal).toBeHidden({ timeout: 2000 })

    const select = page.locator('#saved-queries-select')
    await expect(select).toBeVisible({ timeout: 2000 })
    const option = select.locator('option').nth(1)
    const text = await option.textContent()
    expect(text?.trim().length).toBeGreaterThan(0)
    expect(text?.trim()).not.toBe('My test query')
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
      has: page.getByRole('heading', { name: 'medium house #2' }),
    })
    await expect(mediumHouse).toHaveCount(1)

    const weezingInMedium = (await mediumHouse.getByText('Weezing', { exact: true }).count()) > 0
    const venonatInMedium = (await mediumHouse.getByText('Venonat', { exact: true }).count()) > 0
    expect(weezingInMedium && venonatInMedium).toBe(false)
  })

  // @lat: [[ui#House#Item Metadata Display#Shows craftable badge on recommended items]]
  test('shows craftable and buy badges on recommended items', async ({ page }) => {
    await page.goto('/')

    await setSpinbutton(page, 'house-medium', 1)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')

    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    const details = page.getByTestId('recommended-items')
    await expect(details).toBeVisible()
    await details.locator('summary').click()

    // At least one item must have a craftable or buy badge
    const craftBadge = page.getByTestId('item-craftable-badge').first()
    await expect(craftBadge).toBeVisible({ timeout: 5000 })
    const text = await craftBadge.textContent()
    expect(['Craft', 'Buy']).toContain(text?.trim())
  })

  // @lat: [[ui#House#Item Metadata Display#Shows category badge on recommended items]]
  test('shows category badge on recommended items', async ({ page }) => {
    await page.goto('/')

    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Bulbasaur')

    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    const details = page.getByTestId('recommended-items')
    await expect(details).toBeVisible()
    await details.locator('summary').click()

    await expect(page.getByTestId('item-category-badge').first()).toBeVisible({ timeout: 5000 })
  })

  // @lat: [[ui#House#Item Metadata Display#Shows craftable badge in favorite modal]]
  test('shows craftable badge in favorite items modal', async ({ page }) => {
    await page.goto('/')

    await setSpinbutton(page, 'house-medium', 1)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')

    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    await page.getByTestId('shared-favorite-badge').first().click()
    const modal = page.getByTestId('favorite-items-modal')
    await expect(modal).toBeVisible({ timeout: 2000 })

    const badge = modal.getByTestId('item-craftable-badge').first()
    await expect(badge).toBeVisible({ timeout: 5000 })
    const text = await badge.textContent()
    expect(['Craft', 'Buy']).toContain(text?.trim())
  })

  test('displays recommended items for house with shared favorites', async ({ page }) => {
    await page.goto('/')

    await setSpinbutton(page, 'house-medium', 1)

    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')

    // Wait for the solve with both pokemon to complete
    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    const details = page.getByTestId('recommended-items')
    await expect(details).toBeVisible()

    const summary = details.locator('summary')
    await expect(summary).toContainText('Recommended items')

    const clusters = page.getByTestId('item-cluster')
    const count = await clusters.count()
    expect(count).toBeGreaterThan(0)
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

  // @lat: [[ui#ShoppingCart#Adds item from favorite items modal]]
  test('adds item from favorite items modal', async ({ page }) => {
    test.setTimeout(40_000)
    await setupWithRecommendedItems(page)

    // Click the first shared favorite badge to open the item modal
    await page.getByTestId('shared-favorite-badge').first().click()
    const modal = page.getByTestId('favorite-items-modal')
    await expect(modal).toBeVisible({ timeout: 2000 })

    // Wait for items to load and click + on the first one
    const addBtn = modal.getByTestId('add-to-cart').first()
    await expect(addBtn).toBeVisible({ timeout: 5000 })
    await addBtn.click()

    // Dismiss modal — item already visible in always-open sidebar
    await modal.locator('.modal-footer button').click()
    await expect(modal).toBeHidden({ timeout: 2000 })

    await expect(page.getByTestId('cart-item')).toHaveCount(1, { timeout: 2000 })
  })

  // @lat: [[ui#ShoppingCart#Incrementing quantity updates badge]]
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
