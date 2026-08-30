import { expect, test, type Page } from '@playwright/test'

// Existing suites model a returning visitor: seeding the tour's seen flag keeps
// the first-run guided tour from auto-starting (and blocking the page) mid-test.
// Only e2e/onboarding.spec.ts exercises the auto-start path.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pokehousing_tour_seen', '1'))
})

// Auto-sort warning inside the housemate-suggestion modal: when auto-sort is
// ON, the modal body leads with a warning alert + inline switch; flipping the
// switch off removes the warning, unchecks the top-card toggle, and keeps the
// modal open for the normal suggestion flow.

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

// One large house with one occupant: capacity 4 − 1 = 3 vacant beds.
async function setupPartiallyFullHouse(page: Page) {
  await setSpinbutton(page, 'house-large', 1)
  await selectPokemon(page, 'Bulbasaur')
  await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })
  return page.getByTestId('house-card').filter({
    has: page.locator('.house-title', { hasText: /large house L\d/ }),
  })
}

test.describe('Housemate modal auto-sort warning', () => {
  test('shows the warning and checked switch when auto-sort is on', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const house = await setupPartiallyFullHouse(page)

    await house.getByTestId('house-empty-slot').first().click()
    const modal = page.getByTestId('housemate-modal')
    await expect(modal).toBeVisible()

    const warning = modal.getByTestId('housemate-autosort-warning')
    await expect(warning).toBeVisible()
    // AC.5: exact copy, collapsed whitespace across the <strong>ON</strong>.
    await expect(warning).toContainText(
      'Because auto-sort is currently ON, adding this pokemon will trigger your entire island to re-sort.',
    )
    await expect(warning).toContainText(
      'This new pokemon will stay in this house, but auto-sort may move your other, unpinned housemates to more optimal houses.',
    )
    await expect(warning).toContainText('Switch auto-sort off before you add a Pokemon?')

    // AC.2 pre-condition + WCAG 2.5.8 tap-target floor (24×24 CSS px).
    const switchEl = modal.getByTestId('housemate-autosort-switch')
    await expect(switchEl).toBeChecked()
    const box = await switchEl.boundingBox()
    expect(box, 'housemate-autosort-switch must render').not.toBeNull()
    expect(box!.width, 'switch width must be ≥ 24px').toBeGreaterThanOrEqual(24)
    expect(box!.height, 'switch height must be ≥ 24px').toBeGreaterThanOrEqual(24)
  })

  test('switching off hides the warning, unchecks the top toggle, keeps the modal open, and still adds pinned', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    const house = await setupPartiallyFullHouse(page)

    await house.getByTestId('house-empty-slot').first().click()
    const modal = page.getByTestId('housemate-modal')
    await expect(modal).toBeVisible()
    const warning = modal.getByTestId('housemate-autosort-warning')
    await expect(warning).toBeVisible()

    // AC.2: flipping the inline switch off removes the warning, unchecks the
    // top-card toggle, and leaves the modal open.
    await modal.getByTestId('housemate-autosort-switch').click()
    await expect(warning).toBeHidden()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()
    await expect(modal).toBeVisible()

    // AC.4: the normal suggestion flow still works — the newcomer appears in
    // the house, pinned, without wiping the prior occupant.
    const options = modal.getByTestId('housemate-option')
    await expect(options.first()).toBeVisible({ timeout: 10_000 })
    const addedName = (await options.first().locator('.housemate-option-name').textContent())!
    await options.first().click()
    await expect(modal).toBeHidden()

    await expect(house).toContainText('Bulbasaur', { timeout: 30_000 })
    await expect(house).toContainText(addedName, { timeout: 30_000 })
    await expect(
      house.locator('[data-testid="progress-checkbox-pokemon"][aria-checked="true"]'),
    ).toHaveCount(1)
  })

  test('selecting a suggestion while the warning is shown adds and pins the pokemon', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.goto('/')
    const house = await setupPartiallyFullHouse(page)

    await house.getByTestId('house-empty-slot').first().click()
    const modal = page.getByTestId('housemate-modal')
    await expect(modal).toBeVisible()
    // AC.4: the warning is visible for the whole suggestion-selection flow.
    await expect(modal.getByTestId('housemate-autosort-warning')).toBeVisible()

    const options = modal.getByTestId('housemate-option')
    await expect(options.first()).toBeVisible({ timeout: 10_000 })
    const addedName = (await options.first().locator('.housemate-option-name').textContent())!
    await options.first().click()
    await expect(modal).toBeHidden()

    // Auto-sort stayed on, so the re-solve keeps the newcomer pinned in THIS
    // house without wiping the prior occupant.
    await expect(page.getByTestId('autosort-switch')).toBeChecked()
    await expect(house).toContainText('Bulbasaur', { timeout: 30_000 })
    await expect(house).toContainText(addedName, { timeout: 30_000 })
    await expect(
      house.locator('[data-testid="progress-checkbox-pokemon"][aria-checked="true"]'),
    ).toHaveCount(1)
  })

  test('shows no warning when auto-sort is off', async ({ page }) => {
    await page.goto('/')
    await setSpinbutton(page, 'house-large', 1)
    await selectPokemon(page, 'Bulbasaur')
    await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })

    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()

    const house = page.getByTestId('house-card').filter({
      has: page.locator('.house-title', { hasText: /large house L\d/ }),
    })
    await house.getByTestId('house-empty-slot').first().click()
    const modal = page.getByTestId('housemate-modal')
    await expect(modal).toBeVisible()
    // AC.3: no warning element at all while auto-sort is off.
    await expect(modal.getByTestId('housemate-autosort-warning')).toHaveCount(0)
  })
})
