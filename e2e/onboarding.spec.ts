// Guided-tour (v-onboarding) e2e coverage. Each acceptance criterion maps to a
// named test below so a regression fails exactly the criterion it belongs to.
//
// The app's Playwright per-test timeout is 5s; every test here loads a sample
// island and waits on a solve, so each opts out with test.setTimeout(...) the
// same way e2e/compactness.spec.ts does for its sample-island case.

import { expect, test } from '@playwright/test'

const STEP_TITLES = [
  'Set up your houses',
  'Add Pokémon',
  'Meet your house',
  'House items',
  'Combined favorites',
  'Add an item',
  'Needs fulfilled',
  'Auto-sort vs. manual',
  'Save & share your island',
]

// The v-onboarding dimming overlay is an SVG with inline `position: fixed`;
// its cutout `<path>` draws a hole around the highlighted element. The hole
// starts at the second `M`, whose coordinates (viewport space) are the hole's
// top-left — and should sit on the intended target's top-left. Reading these
// is the only reliable way to assert "the right element is highlighted" on a
// state-changing step, since the popper/dialog placement is flexible but the
// cutout always hugs the target exactly.
async function cutoutHoleTopLeft(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>('svg[style*="position: fixed"]')
    const d = svg?.querySelector('path')?.getAttribute('d')
    if (!d) return null
    const secondM = d.match(/Z\s*M\s*([\d.]+)\s*,\s*([\d.]+)/)
    if (!secondM) return null
    return { x: parseFloat(secondM[1]!), y: parseFloat(secondM[2]!) }
  })
}

// The re-attach after a state change (open table / add item) is asynchronous,
// so poll the cutout-vs-target gap until it converges within 6px (the fix) — it
// stays far (or unmeasurable) if the highlight is stuck on the previous step.
async function expectCutoutOn(
  page: import('@playwright/test').Page,
  target: import('@playwright/test').Locator,
) {
  await expect
    .poll(
      async () => {
        const hole = await cutoutHoleTopLeft(page)
        const box = await target.boundingBox()
        if (!hole || !box) return Infinity
        return Math.max(Math.abs(hole.x - box.x), Math.abs(hole.y - box.y))
      },
      { timeout: 5000 },
    )
    .toBeLessThanOrEqual(6)
}

// AC.1 → T-lazy
test('T-lazy: the onboarding chunk is fetched only once the tour is started', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => localStorage.setItem('pokehousing_tour_seen', '1'))

  const onboardingRequests: string[] = []
  page.on('request', (request) => {
    if (/onboardingtour/i.test(request.url())) onboardingRequests.push(request.url())
  })

  await page.goto('/')
  // The "Take the tour" button only renders once the catalog gates pass, which
  // is also the moment any auto-start would have fired and fetched the chunk.
  await expect(page.getByTestId('take-the-tour')).toBeVisible({ timeout: 15_000 })
  expect(onboardingRequests).toHaveLength(0)

  await page.getByTestId('take-the-tour').click()
  await expect(page.getByTestId('onboarding-step')).toBeVisible({ timeout: 30_000 })
  expect(onboardingRequests.length).toBeGreaterThan(0)
})

// AC.2 → T-autostart
test('T-autostart: a first visit (no flag, no hash) auto-starts at step 1', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')

  const step = page.getByTestId('onboarding-step')
  await expect(step).toBeVisible({ timeout: 30_000 })
  await expect(step).toContainText('Set up your houses')
})

// AC.3 → T-manual
test('T-manual: the seen flag suppresses auto-start and the button re-launches in-session', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => localStorage.setItem('pokehousing_tour_seen', '1'))
  await page.goto('/')

  await expect(page.getByTestId('take-the-tour')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('onboarding-step')).toHaveCount(0)

  await page.getByTestId('take-the-tour').click()
  await expect(page.getByTestId('onboarding-step')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('onboarding-step')).toContainText('Set up your houses')

  // Skip closes it; a second click re-launches step 1 in the same session.
  await page.getByTestId('onboarding-skip').click()
  await expect(page.getByTestId('onboarding-step')).toHaveCount(0)
  await page.getByTestId('take-the-tour').click()
  await expect(page.getByTestId('onboarding-step')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('onboarding-step')).toContainText('Set up your houses')
})

// AC.4 → T-walkthrough
test('T-walkthrough: advances through all nine steps and Finish persists the flag', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')

  const step = page.getByTestId('onboarding-step')
  await expect(step).toBeVisible({ timeout: 30_000 })

  for (const [index, title] of STEP_TITLES.entries()) {
    await expect(step).toContainText(title, { timeout: 30_000 })
    if (index < STEP_TITLES.length - 1) {
      await page.getByTestId('onboarding-next').click()
    }
  }

  // The final Next is "Finish": it closes the tour and persists the seen flag.
  await page.getByTestId('onboarding-next').click()
  await expect(step).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('pokehousing_tour_seen'))).toBe('1')
})

// AC.5 → T-skip
test('T-skip: Skip closes the tour, persists the flag, and stops future auto-start', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')

  await expect(page.getByTestId('onboarding-step')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('onboarding-skip').click()
  await expect(page.getByTestId('onboarding-step')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('pokehousing_tour_seen'))).toBe('1')

  await page.reload()
  await expect(page.getByTestId('take-the-tour')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('onboarding-step')).toHaveCount(0)
})

// AC.6 → T-housesteps
// The tour's five house-items steps (house card → items button → combined
// favorites header → add button → added-item row) each highlight a progressively
// deeper surface of the first house's recommendations panel. The overlay's
// focus trap makes direct user clicks impossible, so the *tour itself* performs
// the expand (before step 5) and the add (before step 7); this test only walks
// the tour and asserts each target surface is where it should be.
test('T-housesteps: zooms from house → items button → header → add → added item', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')

  const step = page.getByTestId('onboarding-step')
  await expect(step).toBeVisible({ timeout: 30_000 })

  // Walk to the house card (steps 1–3).
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Add Pokémon', { timeout: 30_000 })
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Meet your house', { timeout: 30_000 })
  await expect(page.getByTestId('house-card').first()).toBeVisible()

  // Step 4 targets the "House items" summary WITHOUT expanding the panel.
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('House items', { timeout: 30_000 })
  const firstDetails = page.getByTestId('recommended-items').first()
  await expect(firstDetails).toBeVisible()
  expect(await firstDetails.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false)

  // Step 5 expands the panel and highlights the combined-favorites header row.
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Combined favorites', { timeout: 30_000 })
  expect(await firstDetails.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true)
  const table = page.getByTestId('recommended-items-list').first()
  // The first-pass highlight must land on the header row (regression guard for
  // the re-attach fix — a stale highlight would hover over the step-4 button).
  await expectCutoutOn(page, table.locator('thead'))

  // Step 6 highlights the add-to-cart control (still nothing added).
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Add an item', { timeout: 30_000 })
  await expect(table.getByTestId('add-to-cart').first()).toBeVisible()
  await expect(table.getByTestId('recommendation-remove')).toHaveCount(0)

  // Step 7's beforeStep stocks the first item; the added row is now highlighted
  // with its "Added" badge and a remove control.
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Needs fulfilled', { timeout: 30_000 })
  const addedRow = table.locator('tbody tr.recommendation-added-row').first()
  await expect(table.getByTestId('recommendation-added-badge').first()).toBeVisible()
  await expect(table.getByTestId('recommendation-remove').first()).toBeVisible()
  // The first-pass highlight must move onto the freshly added row.
  await expectCutoutOn(page, addedRow)
})

// AC.7 → T-a11y
test('T-a11y: the tour is an accessible dialog with a working focus trap', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')

  const step = page.getByTestId('onboarding-step')
  await expect(step).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('dialog', { name: 'Guided tour' })).toBeVisible()

  // Advance to step 2 so Back (hidden on step 1) is rendered.
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Add Pokémon', { timeout: 30_000 })

  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Next' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Skip' })).toBeVisible()

  // Focus the Next button and Tab repeatedly; focus must never leave the dialog.
  await page.getByTestId('onboarding-next').focus()
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press('Tab')
    const focusedInsideDialog = await page.evaluate(() => {
      const el = document.activeElement
      return el != null && el.closest('[role="dialog"][aria-label="Guided tour"]') != null
    })
    expect(focusedInsideDialog).toBe(true)
  }
})
