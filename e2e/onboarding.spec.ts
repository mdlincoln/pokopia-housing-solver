// Guided-tour (v-onboarding) e2e coverage. Each acceptance criterion maps to a
// named test below so a regression fails exactly the criterion it belongs to.
//
// AC.1 → T-autostart + T-manual (intro step shows before any highlight)
// AC.2 → T-intro (no cutout on the intro step; highlighting starts at step 2)
// AC.3 → T-walkthrough (10 steps + copy in order; Finish persists the flag)
// AC.4 → T-housesteps (house-items zoom steps still work after the shift)
// AC.5 → T-intro (Back-nav shows no stale cutout)
// AC.6 → T-autostart / T-manual / T-skip (gate helpers) — unchanged gates
// T-lazy  → regression (code-split chunk fetched only on tour start)
// T-a11y  → regression (dialog + focus trap)
//
// The app's Playwright per-test timeout is 5s; every test here loads a sample
// island and waits on a solve, so each opts out with test.setTimeout(...) the
// same way e2e/compactness.spec.ts does for its sample-island case.

import { expect, test } from '@playwright/test'

const STEP_TITLES = [
  'Welcome to the Pokopia Housing Solver',
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
    // The `-?` is required: the intro step's padding pushes the hole's top-left
    // to large NEGATIVE coordinates (`M-99999,-99999`), which the old `[\d.]+`
    // character class silently failed to capture.
    const secondM = d.match(/Z\s*M\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/)
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

// The intro (text-only) step pads its cutout hole out past the viewport so the
// whole viewport becomes the un-dimmed "hole" and no specific element is
// highlighted. Assert the hole fully covers the viewport by scanning only the
// hole subpath (everything after the second `M`, which skips the outer dim-rect
// whose `M{w},h H0 V0 H{w} Z` always contributes `innerWidth`/`innerHeight`
// tokens and would otherwise satisfy a max-bound) for its global min/max: with
// symmetric padding the hole's left/top are the only large-negative coordinates
// and right/bottom the only large-positive ones, so a global scan suffices
// without an axis parser. Requires the whole hole to sit OUTSIDE the viewport on
// all four sides — a single-corner "top-left is negative" check would miss a
// regression that only clamps the right/bottom padding.
async function expectCutoutCoversViewport(page: import('@playwright/test').Page) {
  await expect
    .poll(
      async () => {
        return page.evaluate(() => {
          const svg = document.querySelector<SVGSVGElement>('svg[style*="position: fixed"]')
          const d = svg?.querySelector('path')?.getAttribute('d')
          if (!d) return false
          const firstM = d.indexOf('M')
          if (firstM === -1) return false
          const secondM = d.indexOf('M', firstM + 1)
          if (secondM === -1) return false
          const tokens = (d.slice(secondM + 1).match(/-?[\d.]+/g) ?? []).map(Number)
          if (tokens.length === 0) return false
          const min = Math.min(...tokens)
          const max = Math.max(...tokens)
          const vp = Math.max(window.innerWidth, window.innerHeight)
          return min < 0 && max >= vp
        })
      },
      { timeout: 5000 },
    )
    .toBe(true)
}

// regression (code-split)
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

// AC.1/AC.6 → T-autostart
test('T-autostart: a first visit (no flag, no hash) auto-starts at the welcome step', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')

  const step = page.getByTestId('onboarding-step')
  await expect(step).toBeVisible({ timeout: 30_000 })
  // AC.1: the very first thing shown is the site intro, before any element
  // highlight / UI walkthrough appears.
  await expect(step).toContainText('Welcome to the Pokopia Housing Solver')

  // AC.3: advancing once reaches the (unchanged) first feature step.
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Set up your houses', { timeout: 30_000 })
})

// AC.1/AC.6 → T-manual
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
  await expect(page.getByTestId('onboarding-step')).toContainText('Welcome to the Pokopia Housing Solver')

  // Skip closes it; a second click re-launches at the welcome step in-session.
  await page.getByTestId('onboarding-skip').click()
  await expect(page.getByTestId('onboarding-step')).toHaveCount(0)
  await page.getByTestId('take-the-tour').click()
  await expect(page.getByTestId('onboarding-step')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('onboarding-step')).toContainText('Welcome to the Pokopia Housing Solver')
})

// AC.2/AC.5 → T-intro
test('T-intro: welcome step has no cutout; highlighting starts at step 2 and Back-nav stays clean', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')

  const step = page.getByTestId('onboarding-step')
  await expect(step).toBeVisible({ timeout: 30_000 })

  // AC.2: the intro step shows the site intro copy with NO in-element cutout —
  // its cutout hole is expanded past the whole viewport, so nothing is dimmed.
  await expect(step).toContainText('Welcome to the Pokopia Housing Solver')
  await expectCutoutCoversViewport(page)

  // AC.2: the very next step ('Set up your houses') DOES highlight its target.
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Set up your houses', { timeout: 30_000 })
  await expectCutoutOn(page, page.getByTestId('houses-card'))

  // AC.5: going Back to the intro shows no stale dim/cutout from the houses
  // step — the intro's hole stays expanded past the viewport (guards the
  // v-onboarding stale-`currentTarget`/`refresh()` Back-nav path).
  await page.getByTestId('onboarding-prev').click()
  await expect(step).toContainText('Welcome to the Pokopia Housing Solver', { timeout: 30_000 })
  await expectCutoutCoversViewport(page)
})

// AC.3 → T-walkthrough
test('T-walkthrough: advances through all ten steps and Finish persists the flag', async ({
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

// AC.6 → T-skip
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

// AC.4 → T-housesteps
// The tour's five house-items steps (house card → items button → combined
// favorites header → add button → added-item row) each highlight a progressively
// deeper surface of the first house's recommendations panel. The overlay's
// focus trap makes direct user clicks impossible, so the *tour itself* performs
// the expand (before step 6) and the add (before step 8); this test only walks
// the tour and asserts each target surface is where it should be. (These steps
// shifted one slot later with the intro's addition: house card is steps 2–4,
// the expand runs before step 6 and the add before step 8.)
test('T-housesteps: zooms from house → items button → header → add → added item', async ({
  page,
}) => {
  test.setTimeout(90_000)
  await page.goto('/')

  const step = page.getByTestId('onboarding-step')
  await expect(step).toBeVisible({ timeout: 30_000 })

  // Walk past the welcome step to the house card (steps 2–4).
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Set up your houses', { timeout: 30_000 })
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Add Pokémon', { timeout: 30_000 })
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Meet your house', { timeout: 30_000 })
  await expect(page.getByTestId('house-card').first()).toBeVisible()

  // Step 5 targets the "House items" summary WITHOUT expanding the panel.
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('House items', { timeout: 30_000 })
  const firstDetails = page.getByTestId('recommended-items').first()
  await expect(firstDetails).toBeVisible()
  expect(await firstDetails.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false)

  // Step 6 expands the panel and highlights the combined-favorites header row.
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Combined favorites', { timeout: 30_000 })
  expect(await firstDetails.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(true)
  const table = page.getByTestId('recommended-items-list').first()
  // The first-pass highlight must land on the header row (regression guard for
  // the re-attach fix — a stale highlight would hover over the step-5 button).
  await expectCutoutOn(page, table.locator('thead'))

  // Step 7 highlights the add-to-cart control (still nothing added).
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Add an item', { timeout: 30_000 })
  await expect(table.getByTestId('add-to-cart').first()).toBeVisible()
  await expect(table.getByTestId('recommendation-remove')).toHaveCount(0)

  // Step 8's beforeStep stocks the first item; the added row is now highlighted
  // with its "Added" badge and a remove control.
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Needs fulfilled', { timeout: 30_000 })
  const addedRow = table.locator('tbody tr.recommendation-added-row').first()
  await expect(table.getByTestId('recommendation-added-badge').first()).toBeVisible()
  await expect(table.getByTestId('recommendation-remove').first()).toBeVisible()
  // The first-pass highlight must move onto the freshly added row.
  await expectCutoutOn(page, addedRow)
})

// regression (a11y focus trap)
test('T-a11y: the tour is an accessible dialog with a working focus trap', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')

  const step = page.getByTestId('onboarding-step')
  await expect(step).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('dialog', { name: 'Guided tour' })).toBeVisible()

  // Advance past the welcome step to step 3 so Back (hidden on step 1) is shown.
  await page.getByTestId('onboarding-next').click()
  await expect(step).toContainText('Set up your houses', { timeout: 30_000 })
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
