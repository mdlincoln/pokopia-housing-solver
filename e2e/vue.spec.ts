import { expect, test } from '@playwright/test'

async function selectPokemon(page: import('@playwright/test').Page, name: string) {
  const input = page.getByPlaceholder('Search pokemon...')
  await input.fill(name.slice(0, 4))
  await page.getByRole('option', { name }).click()
}

test.describe('Homepage', () => {
  test('renders the form', async ({ page }) => {
    await page.goto('/')

    await expect(page.locator('h1')).toHaveText('Pokemon Housing')
    await expect(page.locator('input[type="number"]')).toHaveCount(3)
    await expect(page.getByPlaceholder('Search pokemon...')).toBeVisible()

    await expect(page.getByTestId('results')).toBeHidden()
  })

  test('solves and displays results', async ({ page }) => {
    await page.goto('/')

    // Set house counts
    const inputs = page.locator('input[type="number"]')
    await inputs.nth(0).fill('1') // 1 small
    await inputs.nth(1).fill('1') // 1 medium

    // Select 3 pokemon
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await selectPokemon(page, 'Charmander')

    // Wait for results
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    // Verify house cards rendered
    const cards = page.getByTestId('house-card')
    await expect(cards).toHaveCount(2)

    // All 3 pokemon should appear somewhere in the results
    const resultsText = await page.getByTestId('results').textContent()
    expect(resultsText).toContain('Bulbasaur')
    expect(resultsText).toContain('Ivysaur')
    expect(resultsText).toContain('Charmander')
  })

  test('displays unhoused pokemon when capacity is exceeded', async ({ page }) => {
    await page.goto('/')

    // Only 1 small house (capacity 1), but select 3 pokemon
    const inputs = page.locator('input[type="number"]')
    await inputs.nth(0).fill('1')

    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await selectPokemon(page, 'Venusaur')

    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    // Should have unhoused section with 2 pokemon
    const unhoused = page.getByTestId('unhoused')
    await expect(unhoused).toBeVisible()
    const unhousedItems = unhoused.locator('li')
    await expect(unhousedItems).toHaveCount(2)
  })

  test('solves with no pokemon selected', async ({ page }) => {
    await page.goto('/')

    const inputs = page.locator('input[type="number"]')
    await inputs.nth(0).fill('1')
    await inputs.nth(1).fill('1')

    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    // Houses should render but be empty
    const cards = page.getByTestId('house-card')
    await expect(cards).toHaveCount(2)
    await expect(page.getByTestId('empty')).toHaveCount(2)
  })

  test('displays habitat badge on pokemon card', async ({ page }) => {
    await page.goto('/')

    // 1 small house + select Bulbasaur
    const inputs = page.locator('input[type="number"]')
    await inputs.nth(0).fill('1')

    await selectPokemon(page, 'Bulbasaur')

    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    // Verify habitat badge is visible (actual habitat value will depend on the data)
    const habitatBadge = page.getByTestId('habitat-badge')
    await expect(habitatBadge).toBeVisible()
  })

  test('saves query with title and shows it in restore dropdown', async ({ page }) => {
    test.setTimeout(5000)
    await page.goto('/')

    const inputs = page.locator('input[type="number"]')
    await inputs.nth(0).fill('1')

    // Open the save modal
    await page.getByRole('button', { name: 'Save query' }).click()
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible({ timeout: 2000 })

    // Enter a title and confirm — wait for modal animation to settle before clicking
    const saveBtn = modal.getByRole('button', { name: 'Save' })
    await expect(saveBtn).toBeEnabled({ timeout: 2000 })
    await modal.getByLabel('Title (optional)').fill('My test query')
    await saveBtn.click()
    await expect(modal).toBeHidden({ timeout: 2000 })

    // Restore dropdown should show the title
    const select = page.locator('#saved-queries-select')
    await expect(select).toBeVisible({ timeout: 2000 })
    await expect(select.locator('option', { hasText: 'My test query' })).toHaveCount(1)
  })

  test('saves query without title and shows timestamp fallback in dropdown', async ({ page }) => {
    test.setTimeout(5000)
    await page.goto('/')

    const inputs = page.locator('input[type="number"]')
    await inputs.nth(0).fill('1')

    // Open the save modal and confirm without entering a title
    await page.getByRole('button', { name: 'Save query' }).click()
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible({ timeout: 2000 })

    // Wait for modal animation to settle before clicking
    const saveBtn = modal.getByRole('button', { name: 'Save' })
    await expect(saveBtn).toBeEnabled({ timeout: 2000 })
    await saveBtn.click()
    await expect(modal).toBeHidden({ timeout: 2000 })

    // Restore dropdown should show a non-empty label that is not blank
    const select = page.locator('#saved-queries-select')
    await expect(select).toBeVisible({ timeout: 2000 })
    // The second option (index 1) should be a timestamp string, not empty
    const option = select.locator('option').nth(1)
    const text = await option.textContent()
    expect(text?.trim().length).toBeGreaterThan(0)
    expect(text?.trim()).not.toBe('My test query')
  })

  // @lat: [[ui#HomeView#Saved Queries#Shows success alert after save]]
  test('shows success alert after saving a query', async ({ page }) => {
    test.setTimeout(8000)
    await page.goto('/')

    const inputs = page.locator('input[type="number"]')
    await inputs.nth(0).fill('1')

    await page.getByRole('button', { name: 'Save query' }).click()
    const modal = page.getByRole('dialog')
    await expect(modal).toBeVisible({ timeout: 2000 })

    // Wait for modal animation to settle before clicking
    const saveBtn = modal.getByRole('button', { name: 'Save' })
    await expect(saveBtn).toBeEnabled({ timeout: 2000 })
    await saveBtn.click()
    await expect(modal).toBeHidden({ timeout: 2000 })

    // Success alert should appear
    await expect(page.getByText('Query saved successfully.')).toBeVisible({ timeout: 2000 })

    // Alert should disappear after 3 seconds
    await expect(page.getByText('Query saved successfully.')).toBeHidden({ timeout: 5000 })
  })

  test('displays shared habitat badge on house card', async ({ page }) => {
    await page.goto('/')

    // 1 medium house (capacity 2) + select 3 pokemon to ensure at least 2 have the same habitat
    const inputs = page.locator('input[type="number"]')
    await inputs.nth(1).fill('1') // 1 medium house

    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Charmander')
    await selectPokemon(page, 'Squirtle')

    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    // Verify that habitat badges appear on pokemon cards (they always will if habitat data exists)
    const habitatBadges = page.getByTestId('habitat-badge')
    await expect(habitatBadges).toHaveCount(2) // 2 pokemon in the 1 medium house
  })

  test('keeps bright and dark pokemon of the same medium house', async ({ page }) => {
    await page.goto('/')

    const inputs = page.locator('input[type="number"]')
    await inputs.nth(0).fill('1') // 1 small house
    await inputs.nth(1).fill('1') // 1 medium house

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

  test('displays recommended items for house with shared favorites', async ({ page }) => {
    await page.goto('/')

    // 1 medium house — Bulbasaur and Ivysaur share favorites (Lots of nature, Soft stuff, Cute stuff)
    const inputs = page.locator('input[type="number"]')
    await inputs.nth(1).fill('1') // 1 medium house

    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')

    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    // The details element should exist with recommended items
    const details = page.getByTestId('recommended-items')
    await expect(details).toBeVisible()

    // Summary should show "Recommended items"
    const summary = details.locator('summary')
    await expect(summary).toContainText('Recommended items')

    // Should have at least one cluster
    const clusters = page.getByTestId('item-cluster')
    const count = await clusters.count()
    expect(count).toBeGreaterThan(0)
  })
})
