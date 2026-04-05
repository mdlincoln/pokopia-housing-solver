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
    await expect(page.getByRole('button', { name: 'Solve' })).toBeVisible()

    await expect(page.locator('.results')).toBeHidden()
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

    // Solve
    await page.getByRole('button', { name: 'Solve' }).click()

    // Wait for results
    await expect(page.locator('.results')).toBeVisible({ timeout: 30_000 })

    // Verify house cards rendered
    const cards = page.locator('.house-card')
    await expect(cards).toHaveCount(2)

    // All 3 pokemon should appear somewhere in the results
    const resultsText = await page.locator('.results').textContent()
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

    await page.getByRole('button', { name: 'Solve' }).click()
    await expect(page.locator('.results')).toBeVisible({ timeout: 30_000 })

    // Should have unhoused section with 2 pokemon
    const unhoused = page.locator('.unhoused')
    await expect(unhoused).toBeVisible()
    const unhousedItems = unhoused.locator('li')
    await expect(unhousedItems).toHaveCount(2)
  })

  test('solves with no pokemon selected', async ({ page }) => {
    await page.goto('/')

    const inputs = page.locator('input[type="number"]')
    await inputs.nth(0).fill('1')
    await inputs.nth(1).fill('1')

    await page.getByRole('button', { name: 'Solve' }).click()
    await expect(page.locator('.results')).toBeVisible({ timeout: 30_000 })

    // Houses should render but be empty
    const cards = page.locator('.house-card')
    await expect(cards).toHaveCount(2)
    await expect(page.locator('.empty')).toHaveCount(2)
  })
})
