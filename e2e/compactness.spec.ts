import { expect, test, type Page, type Locator } from '@playwright/test'

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

/** documentElement.scrollWidth — the definitive horizontal-overflow measure. */
async function documentScrollWidth(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth)
}

async function computedStyles(locator: Locator, properties: string[]) {
  return locator.evaluate((el, props) => {
    const cs = getComputedStyle(el)
    return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)]))
  }, properties)
}

test.describe('Compact density', () => {
  // @lat: [[ui#HomeView#Accessibility#No horizontal overflow at phone widths]]
  test('AC.1: no horizontal overflow at 390px in initial, populated, and expanded states', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')

    // (a) Initial load
    await expect(page.getByTestId('houses-card')).toBeVisible({ timeout: 10_000 })
    expect(await documentScrollWidth(page)).toBeLessThanOrEqual(390)

    // (b) Sample island populated, results rendered
    await page.getByRole('button', { name: 'Show a sample island' }).click()
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })
    expect(await documentScrollWidth(page)).toBeLessThanOrEqual(390)

    // (c) One house's recommendations panel opened — the lazily-mounted table
    // is the widest surface, so the overflow probe must run with it rendered.
    await page.getByTestId('recommended-items').first().locator('summary').click()
    await expect(page.getByTestId('recommended-items-list').first()).toBeVisible({
      timeout: 10_000,
    })
    expect(await documentScrollWidth(page)).toBeLessThanOrEqual(390)
  })

  // @lat: [[ui#HomeView#Accessibility#Compact density paddings at phone widths]]
  test('AC.2: hero, house card, and shell card body keep compact vertical padding at 390px', async ({
    page,
  }) => {
    test.setTimeout(60_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    // Populate results so .house-card exists to measure.
    await page.getByRole('button', { name: 'Show a sample island' }).click()
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    const hero = await computedStyles(page.locator('.page-hero'), [
      'padding-top',
      'padding-bottom',
    ])
    expect(parseFloat(hero['padding-top']!)).toBeLessThanOrEqual(12)
    expect(parseFloat(hero['padding-bottom']!)).toBeLessThanOrEqual(12)

    const houseCard = await computedStyles(page.getByTestId('house-card').first(), [
      'padding-top',
      'padding-bottom',
    ])
    expect(parseFloat(houseCard['padding-top']!)).toBeLessThanOrEqual(12)
    expect(parseFloat(houseCard['padding-bottom']!)).toBeLessThanOrEqual(12)

    const shellBody = await computedStyles(
      page.getByTestId('houses-card').locator('.shell-card-body'),
      ['padding-top', 'padding-bottom'],
    )
    expect(parseFloat(shellBody['padding-top']!)).toBeLessThanOrEqual(12)
    expect(parseFloat(shellBody['padding-bottom']!)).toBeLessThanOrEqual(12)

    // Regression guard: the shell geometry is token-driven through the themed
    // .app-shell rule — >0 padding proves the rule actually applied.
    const shell = await computedStyles(page.locator('.app-shell'), ['padding-top'])
    const shellPad = parseFloat(shell['padding-top']!)
    expect(shellPad).toBeGreaterThan(0)
    expect(shellPad).toBeLessThanOrEqual(12)
  })

  // @lat: [[ui#HomeView#Accessibility#Desktop tier retains breathing room]]
  test('AC.3: desktop tier keeps shell card body padding at 1rem', async ({ page }) => {
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/')
    const shellBody = page.getByTestId('houses-card').locator('.shell-card-body')
    await expect(shellBody).toBeVisible({ timeout: 10_000 })
    const styles = await computedStyles(shellBody, ['padding-top', 'padding-bottom'])
    expect(styles['padding-top']).toBe('16px')
    expect(styles['padding-bottom']).toBe('16px')
  })

  // @lat: [[ui#HomeView#Accessibility#Buttons share one themed pill recipe]]
  test('AC.5: modal buttons match the merged pill recipe; spinbutton matches form-control', async ({
    page,
  }) => {
    test.setTimeout(30_000)
    await page.setViewportSize({ width: 1400, height: 900 })
    await page.goto('/')

    // Reference pill: the sample-island CTA carries the beach-button class.
    const reference = page.getByRole('button', { name: 'Show a sample island' })
    await expect(reference).toBeVisible({ timeout: 10_000 })
    const props = ['border-radius', 'border-top-width', 'font-weight']
    const referenceStyles = await computedStyles(reference, props)

    // Filled modal buttons inherit the same recipe via the :is() merge.
    const saveButton = page.getByRole('button', { name: 'Save current island' })
    await expect(saveButton).toBeEnabled({ timeout: 10_000 })
    await saveButton.click()
    const saveDialog = page.getByRole('dialog', { name: 'Save island' })
    await expect(saveDialog).toBeVisible({ timeout: 5_000 })
    // Scope to the save dialog — other BModals mount their footers in the DOM.
    const modalPrimary = saveDialog.locator('.modal-footer .btn-primary')
    const modalStyles = await computedStyles(modalPrimary, props)
    expect(modalStyles).toEqual(referenceStyles)

    // Modal hover lift is part of the recipe: force the hover state and read
    // the transform. Poll to ride out the 180ms transition's opening frame,
    // which can still compute to the un-animated 'none'.
    await modalPrimary.hover()
    await expect
      .poll(async () => (await computedStyles(modalPrimary, ['transform']))['transform'])
      .not.toBe('none')

    await page.keyboard.press('Escape')

    // Spinbutton shell shares the control recipe with .form-control.
    const spinbutton = page.getByTestId('houses-card').locator('.b-form-spinbutton').first()
    const formControl = page.getByPlaceholder('Add pokemon to your island...')
    await expect(spinbutton).toBeVisible()
    await expect(formControl).toBeVisible()
    const controlProps = ['border-top-left-radius', 'border-top-color']
    expect(await computedStyles(spinbutton, controlProps)).toEqual(
      await computedStyles(formControl, controlProps),
    )
  })

  // @lat: [[ui#HomeView#Accessibility#Pokemon cards wrap instead of squeezing]]
  test('AC.6: a full large house stacks pokemon cards at 390px and flows them at 1400px', async ({
    page,
  }) => {
    test.setTimeout(90_000)
    // One large house + four mutually compatible (all Dark) pokemon fills the
    // house deterministically with a grid of exactly four PokemonCards.
    const pokemon = ['Abra', 'Absol', 'Alakazam', 'Arbok']

    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await setSpinbutton(page, 'house-large', 1)
    for (const name of pokemon) {
      await selectPokemon(page, name)
    }
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByTestId('house-card').first()).toContainText('large house L1')

    const grid = page.locator('.pokemon-grid')
    await expect(grid).toHaveCount(1)
    const mobileCards = grid.locator('.pokemon-card')
    await expect(mobileCards).toHaveCount(4)

    const mobileRows = await mobileCards.evaluateAll((nodes) =>
      nodes.map((n) => Math.round(n.getBoundingClientRect().y)),
    )
    // One card per row: every card starts at a distinct y position.
    expect(new Set(mobileRows).size).toBe(mobileRows.length)

    // Desktop: the same grid flows several cards per row.
    await page.setViewportSize({ width: 1400, height: 900 })
    await expect(mobileCards).toHaveCount(4)
    const desktopRows = await mobileCards.evaluateAll((nodes) =>
      nodes.map((n) => Math.round(n.getBoundingClientRect().y)),
    )
    const counts = new Map<number, number>()
    for (const y of desktopRows) counts.set(y, (counts.get(y) ?? 0) + 1)
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(2)
  })
})
