import { expect, test, type Locator, type Page } from '@playwright/test'

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
 *
 * Before releasing, the drag verifies its own preconditions — the gesture armed
 * (the drag ghost renders) and the pointer resolves to a drop zone (that zone's
 * hover highlight is painted). Releasing without both is a silent no-op that a
 * loaded CI box can produce from the pointer choreography alone, so the drag is
 * retried; a genuinely broken drag still fails after the last attempt. Pass
 * `expectNoDrag` for the cases that deliberately press a non-handle region to
 * assert nothing moves.
 */
async function dragFrom(
  page: Page,
  handle: Locator,
  target: Locator,
  options: { expectNoDrag?: boolean } = {},
) {
  const attempts = options.expectNoDrag ? 1 : 3
  for (let attempt = 1; attempt <= attempts; attempt++) {
    await handle.scrollIntoViewIfNeeded()
    await handle.hover()
    await page.mouse.down()

    await target.scrollIntoViewIfNeeded()
    const to = await target.boundingBox()
    if (!to) throw new Error('dragFrom: missing target bounding box')
    const tx = to.x + to.width / 2
    const ty = to.y + to.height / 2
    await page.mouse.move(tx, ty, { steps: 12 })
    // Nudge the pointer so the composable re-resolves its drop target at the
    // final point, then confirm the *intended* zone is the live one before
    // releasing: a late re-layout can otherwise leave the release's fresh
    // hit-test resolving a different zone (a silent no-op drop).
    await page.mouse.move(tx + 1, ty)
    const armed = (await page.locator('.pokemon-drag-ghost').count()) > 0
    const overExpected = await target
      .evaluate((el) => !!el.closest('.drop-zone--over'))
      .catch(() => false)
    await page.mouse.up()

    if (options.expectNoDrag || (armed && overExpected)) return
    await page.mouse.move(0, 0) // reset the pointer before retrying
  }
  throw new Error('dragFrom: the drop point never resolved to the intended drop zone')
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
    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')
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
    await page.getByTestId('auto-sort-auto').click()
    await expect(page.getByTestId('auto-sort-auto')).toHaveAttribute('aria-pressed', 'true')
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

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

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

    // The target house may still hold a resident; aim at its card-free title so
    // this keeps pinning the zone-level append path (a drop onto a resident card
    // would swap instead).
    await dragFrom(page, sourceCard.locator('.pokemon-drag-handle'), target.locator('.house-title'))

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

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

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

    await dragFrom(page, sourceCard.locator('.pokemon-name'), target, { expectNoDrag: true })

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

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

    // The alert is a persistent drop target while OFF. With nothing unhoused yet
    // every point inside its grid is card-free, so this pins the zone-level
    // unhouse path — a drop onto a specific unhoused card would swap instead.
    const unhousedGrid = page.getByTestId('unhoused-pokemon-grid')
    await expect(unhousedGrid).toBeVisible({ timeout: 10_000 })
    await expect(page.getByTestId('unhoused-empty-hint')).toBeVisible()
    await expect(unhousedGrid.getByTestId('pokemon-card')).toHaveCount(0)

    const house = page.getByTestId('house-card').first()
    const bulbaCard = house.getByTestId('pokemon-card').filter({ hasText: 'Bulbasaur' }).first()
    await dragFrom(page, bulbaCard.locator('.pokemon-drag-handle'), unhousedGrid)

    await expect(unhousedGrid.getByTestId('pokemon-card')).toHaveCount(1, { timeout: 10_000 })
    await expect(unhousedGrid).toContainText('Bulbasaur')
    await expect(house).not.toContainText('Bulbasaur')
    // The dashed placeholder yields to the dropped card.
    await expect(page.getByTestId('unhoused-empty-hint')).toHaveCount(0)
    await expect(page.getByTestId('error')).toHaveCount(0)
  })

  // AC.3 — unhoused → house drag.
  test('drags an unhoused pokemon into a house', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-large', 1)
    await selectPokemon(page, 'Bulbasaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

    await selectPokemon(page, 'Ivysaur')
    const unhousedGrid = page.getByTestId('unhoused-pokemon-grid')
    await expect(unhousedGrid).toBeVisible({ timeout: 10_000 })
    const ivyCard = unhousedGrid.getByTestId('pokemon-card').filter({ hasText: 'Ivysaur' }).first()
    await expect(ivyCard).toBeVisible()

    const house = page.getByTestId('house-card').first()
    // Card-free house area: the house has a free slot, so this appends rather
    // than swapping with the resident already there.
    await dragFrom(page, ivyCard.locator('.pokemon-drag-handle'), house.locator('.house-title'))

    await expect(house).toContainText('Ivysaur', { timeout: 10_000 })
    // No pokemon left unhoused → the alert stays (persistent drop target) but
    // its grid is now empty.
    await expect(page.getByTestId('unhoused')).toBeVisible()
    await expect(page.getByTestId('unhoused-empty-hint')).toBeVisible()
    await expect(
      page.getByTestId('unhoused-pokemon-grid').getByTestId('pokemon-card'),
    ).toHaveCount(0)
  })

  // AC.1 — a drop onto the resident card of a full house performs a swap: the
  // dragged pokemon takes the resident's place, the resident moves to the drag's
  // origin house.
  test('swaps when dropped onto the resident of a full house', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

    const houses = page.getByTestId('house-card')
    await expect(houses).toHaveCount(2)
    const s1 = houses.nth(0)
    const s2 = houses.nth(1)
    const name1 = (await s1.getByTestId('pokemon-card').first().locator('.pokemon-name').innerText()).trim()
    const name2 = (await s2.getByTestId('pokemon-card').first().locator('.pokemon-name').innerText()).trim()

    // Both small houses are full (1/1); dropping onto s2's *pokemon card*
    // (not the bare house card center) swaps the two residents.
    await dragFrom(
      page,
      s1.getByTestId('pokemon-card').first().locator('.pokemon-drag-handle'),
      s2.getByTestId('pokemon-card').first(),
    )

    await expect(s2).toContainText(name1, { timeout: 10_000 })
    await expect(s1).toContainText(name2)
    await expect(s1).not.toContainText(name1)
    await expect(s2).not.toContainText(name2)
    await expect(page.getByTestId('unhoused-empty-hint')).toBeVisible()
    await expect(
      page.getByTestId('unhoused-pokemon-grid').getByTestId('pokemon-card'),
    ).toHaveCount(0)
    await expect(page.getByTestId('error')).toHaveCount(0)
  })

  // AC.3 — a drop into a full house that does NOT land on a resident card
  // (house title area) stays blocked.
  test('blocks a drop into a full house not over a resident card', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

    const houses = page.getByTestId('house-card')
    await expect(houses).toHaveCount(2)
    const s1 = houses.nth(0)
    const s2 = houses.nth(1)
    const name1 = (await s1.getByTestId('pokemon-card').first().locator('.pokemon-name').innerText()).trim()
    const name2 = (await s2.getByTestId('pokemon-card').first().locator('.pokemon-name').innerText()).trim()

    // Both small houses are full (1/1); dropping onto the s2 *title* area is
    // not over a resident card, so nothing moves.
    await dragFrom(page, s1.getByTestId('pokemon-card').first().locator('.pokemon-drag-handle'), s2.locator('.house-title'))

    await expect(s1).toContainText(name1)
    await expect(s2).toContainText(name2)
    // Nothing moved; the persistent OFF drop target is still present, empty.
    await expect(page.getByTestId('unhoused-empty-hint')).toBeVisible()
    await expect(
      page.getByTestId('unhoused-pokemon-grid').getByTestId('pokemon-card'),
    ).toHaveCount(0)
    await expect(page.getByTestId('error')).toHaveCount(0)
  })

  // AC.2 — dragging an unhoused pokemon onto a full house's resident card
  // evicts that resident back to the unhoused area.
  test('unhoused-origin drop evicts the resident to unhoused', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await selectPokemon(page, 'Venusaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    // With two small houses and three pokemon, the solver houses two and the
    // third lands in the warning.
    const unhousedGrid = page.getByTestId('unhoused-pokemon-grid')
    await expect(unhousedGrid.getByTestId('pokemon-card')).toHaveCount(1, { timeout: 30_000 })
    const drifter = unhousedGrid.getByTestId('pokemon-card').first()
    const drifterName = (await drifter.locator('.pokemon-name').innerText()).trim()

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

    const houses = page.getByTestId('house-card')
    await expect(houses).toHaveCount(2)
    const s1 = houses.nth(0)
    const s2 = houses.nth(1)
    const name2 = (await s2.getByTestId('pokemon-card').first().locator('.pokemon-name').innerText()).trim()

    // Drop the unhoused card onto s2's resident card: it takes the slot and
    // the resident is evicted to the unhoused grid.
    await dragFrom(page, drifter.locator('.pokemon-drag-handle'), s2.getByTestId('pokemon-card').first())

    await expect(s2).toContainText(drifterName, { timeout: 10_000 })
    await expect(s2).not.toContainText(name2)
    await expect(s1).not.toContainText(drifterName)
    // The evicted resident replaces the dragged pokemon in the unhoused grid:
    // drifter moved into s2, name2 lands unhoused — still exactly one card.
    await expect(unhousedGrid.getByTestId('pokemon-card')).toHaveCount(1, { timeout: 10_000 })
    await expect(unhousedGrid).toContainText(name2)
    await expect(unhousedGrid).not.toContainText(drifterName)
    await expect(page.getByTestId('error')).toHaveCount(0)
  })

  // AC.4 — a locked (pinned) resident is never displaced: dropping onto its
  // card in a full house is blocked.
  test('locked resident blocks the swap', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

    const houses = page.getByTestId('house-card')
    await expect(houses).toHaveCount(2)
    const s1 = houses.nth(0)
    const s2 = houses.nth(1)
    const s1Card = s1.getByTestId('pokemon-card').first()
    const s2Card = s2.getByTestId('pokemon-card').first()
    const name1 = (await s1Card.locator('.pokemon-name').innerText()).trim()
    const name2 = (await s2Card.locator('.pokemon-name').innerText()).trim()

    // Lock s2's resident (durable pin).
    await s2Card.getByTestId('progress-checkbox-pokemon').click()
    await expect(s2Card.getByTestId('progress-checkbox-pokemon')).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await dragFrom(page, s1Card.locator('.pokemon-drag-handle'), s2Card)

    // The locked resident keeps its slot and nothing moved.
    await expect(s1).toContainText(name1)
    await expect(s2).toContainText(name2)
    await expect(page.getByTestId('unhoused-empty-hint')).toBeVisible()
    await expect(page.getByTestId('error')).toHaveCount(0)
  })

  // The swap affordance is painted only while the pointer is over a swappable
  // resident card of a full house; a card-free hover in the same house keeps the
  // denied styling instead.
  test('highlights only the swappable resident during a full-house hover', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

    const houses = page.getByTestId('house-card')
    await expect(houses).toHaveCount(2)
    const sourceHandle = houses.nth(0).getByTestId('pokemon-card').first().locator('.pokemon-drag-handle')
    const targetCard = houses.nth(1).getByTestId('pokemon-card').first()

    // Manual gesture so we can assert mid-drag state before releasing.
    await sourceHandle.scrollIntoViewIfNeeded()
    const from = await sourceHandle.boundingBox()
    if (!from) throw new Error('missing handle bounding box')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()

    // Over the resident card of the full target house: exactly one swap
    // counterpart, and the house root carries the valid --swap highlight.
    await targetCard.scrollIntoViewIfNeeded()
    const cardBox = await targetCard.boundingBox()
    if (!cardBox) throw new Error('missing target card bounding box')
    await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2, { steps: 12 })
    await expect(page.locator('.pokemon-card--swap-target')).toHaveCount(1, { timeout: 5_000 })
    await expect(houses.nth(1)).toHaveClass(/drop-zone--swap/)
    // The pending swap must not read as the coral "blocked" highlight.
    const swapBorder = await houses.nth(1).evaluate((el) => getComputedStyle(el).borderTopColor)

    // Same house, card-free title area: the swap affordance must clear while the
    // house-level hover highlight stays.
    const titleBox = await houses.nth(1).locator('.house-title').boundingBox()
    if (!titleBox) throw new Error('missing title bounding box')
    await page.mouse.move(titleBox.x + titleBox.width / 2, titleBox.y + titleBox.height / 2, {
      steps: 6,
    })
    await expect(page.locator('.pokemon-card--swap-target')).toHaveCount(0, { timeout: 5_000 })
    await expect(houses.nth(1)).not.toHaveClass(/drop-zone--swap/)
    await expect(houses.nth(1)).toHaveClass(/drop-zone--over/)
    // ...and the same full house now paints the denied (coral) border, so a
    // blocked hover is visually distinguishable from a swappable one.
    const denyBorder = await houses.nth(1).evaluate((el) => getComputedStyle(el).borderTopColor)
    expect(denyBorder).not.toBe(swapBorder)

    await page.mouse.up()
    await expect(page.locator('.pokemon-card--swap-target')).toHaveCount(0)
  })

  // Dropping back onto the drag's own house is a no-op, so a housemate card there
  // must never be advertised as a swap counterpart.
  test('own-house hover advertises no swap', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-medium', 1)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

    const house = page.getByTestId('house-card').first()
    const cards = house.getByTestId('pokemon-card')
    await expect(cards).toHaveCount(2, { timeout: 30_000 })

    const handle = cards.nth(0).locator('.pokemon-drag-handle')
    await handle.scrollIntoViewIfNeeded()
    const from = await handle.boundingBox()
    if (!from) throw new Error('missing handle bounding box')
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()

    // Hover the housemate card inside the drag's own (full) house.
    const housemate = cards.nth(1)
    const to = await housemate.boundingBox()
    if (!to) throw new Error('missing housemate bounding box')
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })

    await expect(page.locator('.pokemon-card--swap-target')).toHaveCount(0)
    await expect(house).not.toHaveClass(/drop-zone--swap/)

    await page.mouse.up()
    // Dropping there is a no-op: both residents stay put.
    await expect(cards).toHaveCount(2)
    await expect(page.getByTestId('error')).toHaveCount(0)
  })

  // Requirement — dropping onto a resident of a house that still has room swaps
  // the two pokemon and leaves the vacant slot vacant (it does not merely fill
  // the free slot).
  test('swaps with the resident of a house that still has room', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-medium', 2)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await selectPokemon(page, 'Venusaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

    const houses = page.getByTestId('house-card')
    await expect(houses).toHaveCount(2)
    // Two medium houses (capacity 2) with three pokemon: one house is full, the
    // other holds a single resident with a vacant slot.
    const counts = await Promise.all([cardCount(houses.nth(0)), cardCount(houses.nth(1))])
    expect([...counts].sort()).toEqual([1, 2])
    const fullIdx = counts[0]! >= counts[1]! ? 0 : 1
    const roomIdx = fullIdx === 0 ? 1 : 0
    const full = houses.nth(fullIdx)
    const room = houses.nth(roomIdx)

    const draggedCard = full.getByTestId('pokemon-card').first()
    const draggedName = (await draggedCard.locator('.pokemon-name').innerText()).trim()
    const residentCard = room.getByTestId('pokemon-card').first()
    const residentName = (await residentCard.locator('.pokemon-name').innerText()).trim()

    // Aim at the resident card itself: the two swap places.
    await dragFrom(page, draggedCard.locator('.pokemon-drag-handle'), residentCard)

    await expect(room).toContainText(draggedName, { timeout: 10_000 })
    await expect(room).not.toContainText(residentName)
    await expect(full).toContainText(residentName)
    await expect(full).not.toContainText(draggedName)
    // The vacant slot is untouched: both houses keep their previous occupancy.
    expect(await cardCount(room)).toBe(1)
    expect(await cardCount(full)).toBe(2)
    await expect(page.getByTestId('error')).toHaveCount(0)
  })

  // Requirement — dropping a housed pokemon onto a specific unhoused card swaps
  // them: that pokemon goes into the house, the dragged one goes unhoused.
  test('drop onto an unhoused card swaps it into the house', async ({ page }) => {
    test.setTimeout(90_000)
    await page.goto('/')
    await setSpinbutton(page, 'house-small', 1)
    await selectPokemon(page, 'Bulbasaur')
    await selectPokemon(page, 'Ivysaur')
    await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })

    const unhousedGrid = page.getByTestId('unhoused-pokemon-grid')
    await expect(unhousedGrid.getByTestId('pokemon-card')).toHaveCount(1, { timeout: 30_000 })

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

    const house = page.getByTestId('house-card').first()
    const housedCard = house.getByTestId('pokemon-card').first()
    const housedName = (await housedCard.locator('.pokemon-name').innerText()).trim()
    const unhousedCard = unhousedGrid.getByTestId('pokemon-card').first()
    const unhousedName = (await unhousedCard.locator('.pokemon-name').innerText()).trim()

    // Aim at the unhoused card itself: the two swap places.
    await dragFrom(page, housedCard.locator('.pokemon-drag-handle'), unhousedCard)

    await expect(house).toContainText(unhousedName, { timeout: 10_000 })
    await expect(house).not.toContainText(housedName)
    await expect(unhousedGrid).toContainText(housedName)
    await expect(unhousedGrid).not.toContainText(unhousedName)
    // Still exactly one unhoused pokemon: they exchanged places.
    await expect(unhousedGrid.getByTestId('pokemon-card')).toHaveCount(1)
    await expect(page.getByTestId('error')).toHaveCount(0)
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

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

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

    await dragFrom(page, lockedCard.locator('.pokemon-name'), holder, { expectNoDrag: true })

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

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

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
    await page.getByTestId('auto-sort-auto').click()
    await expect(page.getByTestId('auto-sort-auto')).toHaveAttribute('aria-pressed', 'true')
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

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')

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
    const restoredManual = page.getByTestId('auto-sort-manual')
    await expect(restoredManual).toBeVisible({ timeout: 10_000 })
    await expect(restoredManual).toHaveAttribute('aria-pressed', 'true')

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

    await page.getByTestId('auto-sort-manual').click()
    await expect(page.getByTestId('auto-sort-manual')).toHaveAttribute('aria-pressed', 'true')
    await expect(page.locator('.pokemon-drag-handle').first()).toBeVisible({ timeout: 10_000 })
    await expect(page.locator('.pokemon-drag-handle')).toHaveCount(2)

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  })
})
