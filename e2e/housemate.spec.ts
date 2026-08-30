import { expect, test } from '@playwright/test'

// Empty-slot "+" cards on partially-vacant house cards open the housemate
// suggestion modal; selecting a suggestion adds the pokemon to the island and
// auto-pins it to that house. A totally empty house (no pokemon, no cart
// items) shows the inline search input instead.

async function selectPokemon(page: import('@playwright/test').Page, name: string) {
  const input = page.getByPlaceholder('Add pokemon to your island...')
  await expect(input).toBeVisible({ timeout: 10_000 })
  await input.fill(name)
  const option = page.locator('.tropical-dropdown').getByRole('option', { name, exact: true })
  await expect(option).toBeVisible({ timeout: 10_000 })
  await input.press('Enter')
  await expect(page.locator('.pokemon-select .favorite-pill', { hasText: name }).first()).toBeVisible({ timeout: 5_000 })
}

async function setSpinbutton(page: import('@playwright/test').Page, id: string, value: number) {
  const spinbutton = page.locator(`#${id}`)
  await expect(spinbutton).toBeVisible({ timeout: 10_000 })
  await spinbutton.click()
  for (let i = 0; i < value; i++) {
    await spinbutton.press('ArrowUp')
  }
}

// One large house with one occupant: capacity 4 − 1 = 3 vacant beds.
async function setupPartiallyFullHouse(page: import('@playwright/test').Page) {
  await setSpinbutton(page, 'house-large', 1)
  await selectPokemon(page, 'Bulbasaur')
  await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })
  return page.getByTestId('house-card').filter({
    has: page.locator('.house-title', { hasText: /large house L\d/ }),
  })
}

test.describe('Housemate suggestions', () => {
  test('selecting a suggestion adds the pokemon to the house, pinned, and survives a hash reload', async ({
    page,
  }) => {
    await page.goto('/')
    let house = await setupPartiallyFullHouse(page)

    // One plus-card per vacant bed in this house's grid.
    const slots = house.getByTestId('house-empty-slot')
    await expect(slots).toHaveCount(3)

    await slots.first().click()
    const modal = page.getByTestId('housemate-modal')
    await expect(modal).toBeVisible()
    await expect(modal).toContainText('The best fitting Pokemon to join this house')

    // At most 5 ranked options (the spinner resolves to rows).
    const options = modal.getByTestId('housemate-option')
    await expect(options.first()).toBeVisible({ timeout: 10_000 })
    const count = await options.count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(5)

    const addedName = (await options.first().locator('.housemate-option-name').textContent())!
    await options.first().click()
    await expect(modal).toBeHidden()

    // After the re-solve the newcomer is in THIS house and its pin is active.
    house = page.getByTestId('house-card').filter({
      has: page.locator('.house-title', { hasText: /large house L\d/ }),
    })
    await expect(house).toContainText(addedName, { timeout: 30_000 })
    await expect(
      house.locator('[data-testid="progress-checkbox-pokemon"][aria-checked="true"]'),
    ).toHaveCount(1)

    // The pin + pokemon both serialize into the URL hash: a fresh load of the
    // same hash restores placement AND the lock.
    const hash = page.url()
    expect(hash).toContain('#')
    await page.goto(hash)
    await page.reload()

    const restored = page.getByTestId('house-card').filter({
      has: page.locator('.house-title', { hasText: /large house L\d/ }),
    })
    await expect(restored).toContainText(addedName, { timeout: 30_000 })
    await expect(
      restored.locator('[data-testid="progress-checkbox-pokemon"][aria-checked="true"]'),
    ).toHaveCount(1)
  })

  test('plus-cards meet the 24×24px tap-target floor at 390px with no horizontal overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    const house = await setupPartiallyFullHouse(page)

    await expect(house.getByTestId('house-empty-slot').first()).toBeVisible()
    for (const slot of await house.getByTestId('house-empty-slot').all()) {
      const box = await slot.boundingBox()
      expect(box, 'house-empty-slot must render').not.toBeNull()
      expect(box!.width, 'house-empty-slot width must be ≥ 24px').toBeGreaterThanOrEqual(24)
      expect(box!.height, 'house-empty-slot height must be ≥ 24px').toBeGreaterThanOrEqual(24)
    }

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - window.innerWidth,
    )
    expect(overflow, 'no horizontal overflow at 390px').toBeLessThanOrEqual(0)
  })

  test("an open picker's menu layers above inline pickers in other houses", async ({ page }) => {
    // Several empty houses → several inline pickers. Each coilable picker's
    // wrap is `position: relative; z-index: 20`, which creates its own stacking
    // context; without a lift the DOM-later house's input paints over an
    // earlier card's open menu. Focusing one must raise only that instance.
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 2)
    await setSpinbutton(page, 'house-medium', 2)
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    const inputs = page.getByTestId('house-empty-input').locator('input.pokemon-search')
    await expect(inputs).toHaveCount(4)

    const wrapZ = (index: number) =>
      page.evaluate((i) => {
        const inputs = document.querySelectorAll(
          '[data-testid="house-empty-input"] input.pokemon-search',
        )
        const wrap = inputs[i]!.closest('.pokemon-select-wrap')! as HTMLElement
        return getComputedStyle(wrap).zIndex
      }, index)

    // Not focused: every wrap shares the baseline z-index (active = none).
    expect(await wrapZ(0)).toBe('20')
    expect(await wrapZ(1)).toBe('20')

    await inputs.nth(0).click()
    await inputs.nth(0).fill('bulb')
    await expect(page.locator('.tropical-dropdown').first()).toBeVisible()

    // On focus the open instance's wrap is lifted well above its siblings, so
    // the second house's input can no longer paint over the open menu.
    expect(await wrapZ(0)).toBe('900')
    expect(await wrapZ(1)).toBe('20')

    // And the dropdown option is genuinely the topmost element at its own
    // center (nothing from a lower card is stacked over it).
    const option = page.locator('.tropical-dropdown').getByRole('option').first()
    const box = await option.boundingBox()
    expect(box).not.toBeNull()
    const topmostIsOption = await page.evaluate(
      ([x, y]) => (document.elementFromPoint(x, y)?.closest('[role="option"]') ?? null) !== null,
      [box!.x + box!.width / 2, box!.y + box!.height / 2],
    )
    expect(topmostIsOption).toBe(true)
  })

  test('a totally empty house shows the inline search input', async ({ page }) => {
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 1)
    await expect(page.getByTestId('results')).toBeVisible({ timeout: 30_000 })

    const house = page.getByTestId('house-card')
    await expect(house).toHaveCount(1)
    await expect(house.getByTestId('house-empty-input')).toBeVisible()
    await expect(house.getByTestId('empty')).toHaveCount(0)
    await expect(house.getByTestId('house-empty-slot')).toHaveCount(0)
  })
})
