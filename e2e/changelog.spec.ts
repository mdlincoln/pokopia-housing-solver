import { expect, test } from '@playwright/test'

// The changelog route is a static, cart-less route that shares the App.vue
// shell (hero header + footer + global cart sidebar). It needs no tour seed —
// the tour never auto-starts off the `/changelog` route. Seeding it anyway is
// harmless and keeps a returning visitor's session stable if they navigate
// back to `/`.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pokehousing_tour_seen', '1'))
})

// Navigate to the changelog via the footer link (client-side router
// navigation). A direct `page.goto('/changelog')` only works on the dev
// server (base '/'): on the preview/production server the bundle is served
// under base `/pokopia-housing-solver/` and the bare path hits Vite's 404
// hint page instead of the SPA. The footer link resolves the base correctly
// in both modes.
async function gotoChangelog(page: import('@playwright/test').Page) {
  await page.goto('/')
  const link = page.getByTestId('changelog-link')
  await expect(link).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(/\/changelog$/)
}

test.describe('changelog page', () => {
  test('renders the changelog on /changelog with the themed shell', async ({ page }) => {
    await gotoChangelog(page)

    // Shared shell from App.vue (hero header + footer).
    await expect(
      page.getByRole('heading', { name: 'Pokopia Housing Solver', exact: true }),
    ).toBeVisible()

    const section = page.getByTestId('changelog')
    await expect(section).toBeVisible()
    await expect(section.getByRole('heading', { name: 'Changelog', exact: true })).toBeVisible()

    // At least one backfilled entry card.
    await expect(section.getByTestId('changelog-entry').first()).toBeVisible()
  })

  test('footer Changelog link navigates to /changelog', async ({ page }) => {
    await page.goto('/')
    const link = page.getByTestId('changelog-link')
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/\/changelog$/)
    await expect(page.getByTestId('changelog')).toBeVisible()
  })

  test('no horizontal overflow at 390px viewport width', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await gotoChangelog(page)
    await expect(page.getByTestId('changelog')).toBeVisible()
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
    expect(scrollWidth).toBeLessThanOrEqual(390)
  })
})
