// Accessibility scanner (axe) — a per-state scanning suite for the app's
// meaningful UI states, built on @axe-core/playwright (AxeBuilder).
//
// The suite enumerates each state and runs axe against it, applying a
// fail-on-critical/serious gate. Per the POK-5 plan this suite is *authored*
// here, but it is deliberately NOT run to enumerate/record the app's real
// violations — that enumeration plus the remediation document belong to a
// later plan phase. The only axe execution in this change is the controlled
// `axe-gate-fires` self-test, which proves the harness actually detects a real
// problem rather than vacantly passing.
//
// Run the whole suite (enumeration or gate):
//   npm run test:a11y
//   RUN_AXE_REPORT_ONLY=1 npx playwright test e2e/accessibility.spec.ts  # log-only, no assertions.

import { AxeBuilder } from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

// Existing suites model a returning visitor: seeding the tour's seen flag keeps
// the first-run guided tour from auto-starting (and blocking the page) mid-test.
// Only `axe-tour` clears the flag (via a later-registered init script) to
// exercise the auto-start path.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pokehousing_tour_seen', '1'))
})

type AxeViolation = { id: string; impact?: string | null; nodes: { target: unknown }[] }

// Low-level axe run: returns the full violations array (rule id + impact +
// per-node target selectors) so callers can inspect/filter. Used directly by
// the axe-gate-fires self-test (which must observe the violations *before* the
// gate throws) and by runAxe below.
async function analyze(page: Page): Promise<AxeViolation[]> {
  const { violations } = await new AxeBuilder({ page }).analyze()
  return violations as unknown as AxeViolation[]
}

// Fail the current test if any critical/serious violation remains (the
// pragmatic gate). moderate/minor violations are intentionally not asserted.
function failOnCriticalSerious(violations: AxeViolation[]): void {
  const serious = violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')
  expect(
    serious,
    `axe found ${serious.length} critical/serious violation(s):\n` +
      serious
        .map(
          (v) =>
            `- ${v.id} (${v.impact})\n  ${v.nodes.map((n) => JSON.stringify(n.target)).join('\n  ')}`,
        )
        .join('\n'),
  ).toEqual([])
}

// Per-state scan seam. In report-only mode (RUN_AXE_REPORT_ONLY) it logs every
// violation and never asserts — the enumeration path for the deferred phase.
// Otherwise it applies the critical/serious gate.
async function runAxe(page: Page): Promise<AxeViolation[]> {
  const violations = await analyze(page)
  if (process.env.RUN_AXE_REPORT_ONLY) {
    for (const v of violations) {
      const targets = v.nodes.map((n) => JSON.stringify(n.target)).join(', ')
      console.log(`[axe] ${v.impact} :: ${v.id} :: ${targets}`)
    }
    return violations
  }
  failOnCriticalSerious(violations)
  return violations
}

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

// Bare home page (catalog gates passed, no houses/pokemon yet).
test('axe-initial', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await expect(page.getByTestId('houses-card')).toBeVisible({ timeout: 30_000 })
  await runAxe(page)
})

// "Show a sample island" + first solve, with one house's recommendations panel
// opened. The sample island houses all 13 pokemon within its 15 capacity, so
// the `unhoused` warning does not render in this state.
test('axe-populated', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await page.getByRole('button', { name: 'Show a sample island' }).click()
  await expect(page.getByTestId('house-card').first()).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('recommended-items').first().locator('summary').click()
  await expect(page.getByTestId('recommended-items-list').first()).toBeVisible({
    timeout: 10_000,
  })
  await runAxe(page)
})

// Save-island BModal.
test('axe-modals-save', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await expect(page.getByTestId('houses-card')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Save current island' }).click()
  await expect(page.getByRole('dialog', { name: 'Save island' })).toBeVisible({
    timeout: 5_000,
  })
  await runAxe(page)
})

// Manage-islands modal.
test('axe-modals-manage', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await expect(page.getByTestId('houses-card')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('saved-queries-manage').click()
  await expect(page.getByTestId('saved-queries-modal')).toBeVisible({ timeout: 5_000 })
  await runAxe(page)
})

// Habitat-detail modal: Bulbasaur in a small house → first habitat thumbnail →
// the "Tall Grass" dialog with roster rows.
test('axe-habitat-modal', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await setSpinbutton(page, 'house-small', 1)
  await selectPokemon(page, 'Bulbasaur')
  await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })
  await page.getByTestId('habitat-thumb').first().click()
  const modal = page.getByRole('dialog', { name: 'Tall Grass' })
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await expect(modal.getByTestId('habitat-modal-spawn').first()).toBeVisible({ timeout: 5_000 })
  await runAxe(page)
})

// Housemate-suggestion modal: one large house with one occupant → empty-slot
// plus-card → the housemate modal with ranked option rows.
test('axe-housemate-modal', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await setSpinbutton(page, 'house-large', 1)
  await selectPokemon(page, 'Bulbasaur')
  await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })
  const house = page.getByTestId('house-card').filter({
    has: page.locator('.house-title', { hasText: /large house L\d/ }),
  })
  await house.getByTestId('house-empty-slot').first().click()
  const modal = page.getByTestId('housemate-modal')
  await expect(modal).toBeVisible({ timeout: 5_000 })
  await expect(modal.getByTestId('housemate-option').first()).toBeVisible({ timeout: 10_000 })
  await runAxe(page)
})

// Cart: shop the first recommended item so cart-item, the crafted stamp, and
// the aggregated ingredients render.
test('axe-cart', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await setSpinbutton(page, 'house-medium', 1)
  await selectPokemon(page, 'Bulbasaur')
  await selectPokemon(page, 'Ivysaur')
  await expect(page.getByTestId('results')).toContainText('Bulbasaur', { timeout: 30_000 })
  const details = page.getByTestId('recommended-items')
  await expect(details).toBeVisible()
  await details.locator('summary').click()
  await expect(page.getByTestId('recommended-items-list')).toBeVisible()
  await page.getByTestId('add-to-cart').first().click()
  await expect(page.getByTestId('cart-item')).toHaveCount(1, { timeout: 5_000 })
  await runAxe(page)
})

// Static changelog route.
test('axe-changelog', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/changelog')
  await expect(page.getByTestId('changelog')).toBeVisible({ timeout: 10_000 })
  await runAxe(page)
})

// First-visit guided tour. `localStorage.clear()` is registered here, AFTER the
// file-level beforeEach's init script (init scripts evaluate in registration
// order at navigation), so the flag ends up unset and the tour auto-starts.
test('axe-tour', async ({ page }) => {
  test.setTimeout(90_000)
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await expect(page.getByRole('dialog', { name: 'Guided tour' })).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByTestId('onboarding-step')).toBeVisible({ timeout: 30_000 })
  await runAxe(page)
})

// Harness self-test: prove `analyze` surfaces a real problem and the
// critical/serious gate actually fires. Injects a single deterministic visible
// violation (a nameless <button> → axe's `button-name` rule) and asserts both
// that it is reported and that failOnCriticalSerious throws. This is a
// controlled harness check, NOT an enumeration of the app's real violations.
test('axe-gate-fires', async ({ page }) => {
  test.setTimeout(90_000)
  await page.goto('/')
  await expect(page.getByTestId('houses-card')).toBeVisible({ timeout: 30_000 })

  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<button></button>'))

  const violations = await analyze(page)
  const buttonName = violations.find((v) => v.id === 'button-name')
  expect(
    buttonName,
    'axe should report the injected nameless <button> under the button-name rule',
  ).toBeTruthy()
  expect(() => failOnCriticalSerious(violations)).toThrow()
})
