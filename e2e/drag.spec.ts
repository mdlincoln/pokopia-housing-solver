import { expect, test, type Locator, type Page } from '@playwright/test'

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
  const spinbutton = page.locator(`#${id}`)
  await expect(spinbutton).toBeVisible({ timeout: 10_000 })
  await spinbutton.click()
  for (let i = 0; i < value; i++) {
    await spinbutton.press('ArrowUp')
  }
}

async function cardCount(house: Locator): Promise<number> {
  return house.getByTestId('pokemon-card').count()
}

/**
 * Drag from the center of `handle` (a non-interactive card region, e.g. the
 * pokemon name) to the center of `target` (a drop zone). Chromium maps
 * page.mouse to PointerEvents; >6px of movement arms the gesture. Both
 * endpoints are scrolled into view so document.elementsFromPoint (which only
 * resolves within-viewport points) can hit-test the drop zone.
 */
async function dragFrom(page: Page, handle: Locator, target: Locator) {
  await handle.scrollIntoViewIfNeeded()
  const from = await handle.boundingBox()
  if (!from) throw new Error('dragFrom: missing handle bounding box')
  const sx = from.x + from.width / 2
  const sy = from.y + from.height / 2
  await page.mouse.move(sx, sy)
  await page.mouse.down()

  await target.scrollIntoViewIfNeeded()
  const to = await target.boundingBox()
  if (!to) throw new Error('dragFrom: missing target bounding box')
  const tx = to.x + to.width / 2
  const ty = to.y + to.height / 2
  await page.mouse.move(tx, ty, { steps: 12 })
  await page.mouse.up()
}

test.describe('Drag pokemon between houses (auto-sort off)', () => {
  // AC.1 — the bi-arrows-move handle is visible in both modes; it is disabled
  // (with an explanatory tooltip) while auto-sort is ON and enabled while OFF.
  test('handle affordance is visible and disabled while on, enabled while off', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    // While ON the handles are visible but disabled — moving manually requires
    // auto-sort to be off, which the tooltip explains.
    const handles = page.locator('.pokemon-drag-handle')
    await expect(handles.first()).toBeVisible({ timeout: 10_000 })
    await expect(handles).toHaveCount(2)
    await expect(page.locator('.pokemon-drag-handle--disabled')).toHaveCount(2)

    // The denied cursor belongs on the move-arrow handle only — never the card
    // body, even in a full house.
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('.pokemon-card')).cursor),
    ).not.toBe('not-allowed')
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('.pokemon-drag-handle')).cursor),
    ).toBe('not-allowed')

    // Hovering a disabled handle reveals the explanatory tooltip (a fixed,
    // un-clipped label, not a native `title`). Center the handle first so the
    // tooltip (rendered above it) stays inside the viewport.
    await handles.first().evaluate((el) => el.scrollIntoView({ block: 'center' }))
    await handles.first().hover()
    const tip = page.locator('.pokemon-drag-tooltip')
    await expect(tip).toBeVisible({ timeout: 5_000 })
    await expect(tip).toContainText(/Auto-sort is off/i)
    await page.mouse.move(5, 5) // move the pointer off the handle to dismiss it

    // OFF → enabled (no disabled handles, no tooltip, grab handle cursor).
    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()
    await expect(handles).toHaveCount(2)
    await expect(page.locator('.pokemon-drag-handle--disabled')).toHaveCount(0)
    await handles.first().hover()
    await expect(page.locator('.pokemon-drag-tooltip')).toHaveCount(0)
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('.pokemon-drag-handle')).cursor),
    ).toBe('grab')
    // The grab affordance stays on the move-arrow handle — the card body keeps
    // the default arrow cursor even when draggable.
    expect(
      await page.evaluate(() => getComputedStyle(document.querySelector('.pokemon-card')).cursor),
    ).not.toBe('grab')

    // Back on → disabled again.
    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).toBeChecked()
    await expect(page.locator('.pokemon-drag-handle--disabled')).toHaveCount(2, { timeout: 30_000 })
  })

  // AC.2 — house → house move while OFF, no error banner.
  test('drags a pokemon between houses while off', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-medium', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await selectPokemon(page, 'Venusaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()

    const houses = page.getByTestId('house-card')
    await expect(houses).toHaveCount(2)
    const counts = await Promise.all([cardCount(houses.nth(0)), cardCount(houses.nth(1))])
    // Source = house with more occupants; target = the other (always under
    // capacity 2 with only 3 pokemon across two medium houses).
    const sourceIdx = counts[0]! >= counts[1]! ? 0 : 1
    const targetIdx = sourceIdx === 0 ? 1 : 0
    const source = houses.nth(sourceIdx)
    const target = houses.nth(targetIdx)

    const sourceCard = source.getByTestId('pokemon-card').first()
    const name = (await sourceCard.locator('.pokemon-name').innerText()).trim()

    await dragFrom(page, sourceCard.locator('.pokemon-drag-handle'), target)

    await expect(target).toContainText(name, { timeout: 10_000 })
    await expect(source).not.toContainText(name)
    await expect(page.getByTestId('error')).toHaveCount(0)
  })

  // The move gesture is armed only from the header's move-arrow handle — pressing
  // and dragging from the card body (name, image, favorites) must not relocate it.
  test('dragging from the card body does not move it', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-medium', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await selectPokemon(page, 'Venusaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()

    const houses = page.getByTestId('house-card')
    await expect(houses).toHaveCount(2)
    const counts = await Promise.all([cardCount(houses.nth(0)), cardCount(houses.nth(1))])
    const sourceIdx = counts[0]! >= counts[1]! ? 0 : 1
    const targetIdx = sourceIdx === 0 ? 1 : 0
    const source = houses.nth(sourceIdx)
    const target = houses.nth(targetIdx)

    const sourceCard = source.getByTestId('pokemon-card').first()
    const name = (await sourceCard.locator('.pokemon-name').innerText()).trim()
    // The card carries an active handle, but here we deliberately drag from the
    // card body — which must be a no-op.
    await expect(sourceCard.locator('.pokemon-drag-handle')).toHaveCount(1)

    await dragFrom(page, sourceCard.locator('.pokemon-name'), target)

    await expect(source).toContainText(name)
    await expect(target.getByTestId('pokemon-card')).toHaveCount(counts[targetIdx]!)
    await expect(page.getByTestId('error')).toHaveCount(0)
  })

  // AC.3 — house → unhoused drag.
  test('drags a housed pokemon into the unhoused warning', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-large', 1)
    await selectPokemon(page, 'Bulbasaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()

    // A pokemon selected island-only lands in the warning so the alert renders
    // and acts as the drop zone.
    await selectPokemon(page, 'Ivysaur')
    const unhousedGrid = page.getByTestId('unhoused-pokemon-grid')
    await expect(unhousedGrid).toBeVisible({ timeout: 10_000 })
    await expect(unhousedGrid.getByTestId('pokemon-card')).toHaveCount(1)

    const house = page.getByTestId('house-card').first()
    const bulbaCard = house.getByTestId('pokemon-card').filter({ hasText: 'Bulbasaur' }).first()
    await dragFrom(page, bulbaCard.locator('.pokemon-drag-handle'), unhousedGrid)

    await expect(unhousedGrid.getByTestId('pokemon-card')).toHaveCount(2, { timeout: 10_000 })
    await expect(unhousedGrid).toContainText('Bulbasaur')
    await expect(house).not.toContainText('Bulbasaur')
    await expect(page.getByTestId('error')).toHaveCount(0)
  })

  // AC.3 — unhoused → house drag.
  test('drags an unhoused pokemon into a house', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-large', 1)
    await selectPokemon(page, 'Bulbasaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()

    await selectPokemon(page, 'Ivysaur')
    const unhousedGrid = page.getByTestId('unhoused-pokemon-grid')
    await expect(unhousedGrid).toBeVisible({ timeout: 10_000 })
    const ivyCard = unhousedGrid.getByTestId('pokemon-card').filter({ hasText: 'Ivysaur' }).first()
    await expect(ivyCard).toBeVisible()

    const house = page.getByTestId('house-card').first()
    await dragFrom(page, ivyCard.locator('.pokemon-drag-handle'), house)

    await expect(house).toContainText('Ivysaur', { timeout: 10_000 })
    // No pokemon left unhoused → the alert stays (persistent drop target) but
    // its grid is now empty.
    await expect(page.getByTestId('unhoused')).toBeVisible()
    await expect(page.getByTestId('unhoused-empty-hint')).toBeVisible()
    await expect(
      page.getByTestId('unhoused-pokemon-grid').getByTestId('pokemon-card'),
    ).toHaveCount(0)
  })

  // AC.5 — a drop into a full house is blocked.
  test('blocks a drop into a full house', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()

    const houses = page.getByTestId('house-card')
    await expect(houses).toHaveCount(2)
    const s1 = houses.nth(0)
    const s2 = houses.nth(1)
    const name1 = (await s1.getByTestId('pokemon-card').first().locator('.pokemon-name').innerText()).trim()
    const name2 = (await s2.getByTestId('pokemon-card').first().locator('.pokemon-name').innerText()).trim()

    // Both small houses are full (1/1); a cross-house drag must be blocked.
    await dragFrom(page, s1.getByTestId('pokemon-card').first().locator('.pokemon-drag-handle'), s2)

    await expect(s1).toContainText(name1)
    await expect(s2).toContainText(name2)
    // Nothing moved; the persistent OFF drop target is still present, empty.
    await expect(page.getByTestId('unhoused-empty-hint')).toBeVisible()
    await expect(
      page.getByTestId('unhoused-pokemon-grid').getByTestId('pokemon-card'),
    ).toHaveCount(0)
  })

  // AC.5 — a locked (pinned) pokemon shows no handle and cannot be dragged.
  test('a locked pokemon shows no handle and cannot be dragged', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-medium', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await selectPokemon(page, 'Venusaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()

    const houses = page.getByTestId('house-card')
    await expect(houses).toHaveCount(2)
    const counts = await Promise.all([cardCount(houses.nth(0)), cardCount(houses.nth(1))])
    const sourceIdx = counts[0]! >= counts[1]! ? 0 : 1
    const holderIdx = sourceIdx === 0 ? 1 : 0
    const source = houses.nth(sourceIdx)
    const holder = houses.nth(holderIdx)

    const lockedCard = source.getByTestId('pokemon-card').first()
    const lockedName = (await lockedCard.locator('.pokemon-name').innerText()).trim()
    await lockedCard.getByTestId('progress-checkbox-pokemon').click()
    await expect(lockedCard.getByTestId('progress-checkbox-pokemon')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await expect(lockedCard.locator('.pokemon-drag-handle')).toHaveCount(0)
    // Sibling unlocked cards keep their handles.
    await expect(source.locator('.pokemon-drag-handle')).toHaveCount(counts[sourceIdx]! - 1)

    await dragFrom(page, lockedCard.locator('.pokemon-name'), holder)

    // Nothing moved.
    await expect(source).toContainText(lockedName)
    await expect(holder.getByTestId('pokemon-card')).toHaveCount(counts[holderIdx]!)
    await expect(page.getByTestId('error')).toHaveCount(0)
  })

  // AC.6 — flipping back on clears temporary drags and re-solves: the locked
  // pokemon stays; the dragged (unlocked) pokemon is redistributed, not pinned.
  test('re-enabling sort clears temporary drags and keeps locked pokemon', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-medium', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    // With two compatible pokemon and two medium houses, the solver pairs them
    // into M1 and leaves M2 empty — the re-solve target below relies on that.
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()

    const m1 = page
      .getByTestId('house-card')
      .filter({ has: page.locator('.house-title', { hasText: 'medium house M1' }) })
    const m2 = page
      .getByTestId('house-card')
      .filter({ has: page.locator('.house-title', { hasText: 'medium house M2' }) })
    await expect(m1).toContainText('Bulbasaur', { timeout: 10_000 })
    await expect(m1).toContainText('Ivysaur')

    // Lock Bulbasaur (durable pin), leave Ivysaur unlocked.
    const bulbaCard = m1.getByTestId('pokemon-card').filter({ hasText: 'Bulbasaur' }).first()
    await bulbaCard.getByTestId('progress-checkbox-pokemon').click()
    await expect(bulbaCard.locator('.pokemon-drag-handle')).toHaveCount(0)

    // Temporary drag: Ivysaur (unlocked) to the empty M2.
    const ivyCard = m1.getByTestId('pokemon-card').filter({ hasText: 'Ivysaur' }).first()
    await dragFrom(page, ivyCard.locator('.pokemon-drag-handle'), m2)
    await expect(m2).toContainText('Ivysaur', { timeout: 10_000 })
    await expect(m1).not.toContainText('Ivysaur')

    // Flip back on: Bulbasaur's pin keeps it in M1; Ivysaur is re-solved next
    // to it (pin-complement fill), not pinned — the temporary M2 drag is gone.
    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).toBeChecked()
    await expect(m1).toContainText('Bulbasaur', { timeout: 30_000 })
    await expect(m1).toContainText('Ivysaur', { timeout: 30_000 })
    await expect(m1.locator('[data-testid="progress-checkbox-pokemon"][aria-checked="true"]')).toHaveCount(
      1,
    )
    await expect(m2.getByTestId('pokemon-card')).toHaveCount(0, { timeout: 30_000 })
  })

  // AC.6 — reload while OFF drops temporary drags and keeps pinned placements.
  test('reload while off drops temporary drags but keeps pinned placements', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-medium', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()

    const m1 = page
      .getByTestId('house-card')
      .filter({ has: page.locator('.house-title', { hasText: 'medium house M1' }) })
    const m2 = page
      .getByTestId('house-card')
      .filter({ has: page.locator('.house-title', { hasText: 'medium house M2' }) })
    await expect(m1).toContainText('Bulbasaur', { timeout: 10_000 })

    // Pin Bulbasaur to M1 (durable); drag Ivysaur to M2 (temporary).
    const bulbaCard = m1.getByTestId('pokemon-card').filter({ hasText: 'Bulbasaur' }).first()
    await bulbaCard.getByTestId('progress-checkbox-pokemon').click()
    const ivyCard = m1.getByTestId('pokemon-card').filter({ hasText: 'Ivysaur' }).first()
    await dragFrom(page, ivyCard.locator('.pokemon-drag-handle'), m2)
    await expect(m2).toContainText('Ivysaur', { timeout: 10_000 })

    await page.reload()
    const restoredSwitch = page.getByTestId('autosort-switch')
    await expect(restoredSwitch).toBeVisible({ timeout: 10_000 })
    await expect(restoredSwitch).not.toBeChecked()

    const rm1 = page
      .getByTestId('house-card')
      .filter({ has: page.locator('.house-title', { hasText: 'medium house M1' }) })
    const rm2 = page
      .getByTestId('house-card')
      .filter({ has: page.locator('.house-title', { hasText: 'medium house M2' }) })

    // Pinned Bulbasaur restored to M1; the temporary M2 drag reverted — Ivysaur
    // falls back to the warning (last-solve arrangement is not serialized).
    await expect(rm1).toContainText('Bulbasaur', { timeout: 30_000 })
    await expect(rm2.getByTestId('pokemon-card')).toHaveCount(0, { timeout: 10_000 })
    await expect(page.getByTestId('unhoused')).toContainText('Ivysaur', { timeout: 30_000 })
  })

  // AC.7 — no horizontal overflow at 390px with unhoused cards + drag handles.
  test('no horizontal overflow at 390px with unhoused cards and drag handles', async ({ page }) => {
    test.setTimeout(90_000)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('unhoused')).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('autosort-switch').click()
    await expect(page.getByTestId('autosort-switch')).not.toBeChecked()
    await expect(page.locator('.pokemon-drag-handle').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.pokemon-drag-handle')).toHaveCount(2)

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})
