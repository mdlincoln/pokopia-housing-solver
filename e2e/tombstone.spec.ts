import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// Entity-tombstone e2e coverage. Songs of both worlds:
//  * Cases 1-2 exercise the drop path against the real (empty) committed
//    tombstone payload: names that resolve to no live entity are removed and
//    surfaced via a native alert.
//  * Cases 3-4 exercise the successful-upgrade path by intercepting the
//    *fetched* public/data/tombstones.json asset (page.route), so the
//    committed DB stays free of fake renames and the test works identically
//    against the dev server and the CI preview server.
// Existing suites model a returning visitor: seeding the tour's seen flag
// keeps the first-run guided tour from auto-starting and blocking the page.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('pokehousing_tour_seen', '1'))
})

const fixturePath = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'legacy-island.json')
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
  hash: string
  decoded: {
    version: number
    small: number
    medium: number
    large: number
    pokemon: string[]
    cart: Array<{ houseId: string; name: string }>
    autoSort?: boolean
  }
}

// Bluesky check contract: the happy path must never surface a dialog.
function failOnUnexpectedDialog(page: Page): () => boolean {
  let sawDialog = false
  page.on('dialog', (dialog) => {
    sawDialog = true
    void dialog.dismiss().catch(() => {})
  })
  return () => sawDialog
}

// Resolves with the first dialog's message. Registered BEFORE page.goto so no
// alert is auto-dismissed unobserved (Chromium dialogs otherwise block nothing
// for Playwright, which dismisses unhandled dialogs silently).
function captureFirstDialog(page: Page): { promise: Promise<string> } {
  let resolveMessage!: (message: string) => void
  const promise = new Promise<string>((resolve) => {
    resolveMessage = resolve
  })
  page.on('dialog', (dialog) => {
    resolveMessage(dialog.message())
    void dialog.accept().catch(() => {})
  })
  return { promise }
}

// Builds a SharedState with the fixture's shape but a patched pokemon array,
// encoded exactly like the app does (btoa(JSON.stringify(state))).
function encodeState(state: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64')
}

const NON_POKEMON = 'NotARealPokemon'
const NON_ITEM = 'NotARealItem'
const OLD_POKEMON = 'Pikachu-Test' // absent from the live catalog by construction

test.describe('Entity tombstone restore upgrades', () => {
  test('case 1: unmapped pokemon is dropped and surfaced via an alert', async ({ page }) => {
    test.setTimeout(40_000)

    const kept = fixture.decoded.pokemon.slice(0, fixture.decoded.pokemon.length - 1)
    const state = {
      version: fixture.decoded.version,
      small: fixture.decoded.small,
      medium: fixture.decoded.medium,
      large: fixture.decoded.large,
      autoSort: fixture.decoded.autoSort ?? true,
      pokemon: [...kept, NON_POKEMON],
    }

    const dialog = captureFirstDialog(page)
    await page.goto(`/#${encodeState(state)}`)

    // House counts restore.
    await expect(page.locator('#house-small')).toHaveText(String(fixture.decoded.small), {
      timeout: 30_000,
    })
    await expect(page.locator('#house-medium')).toHaveText(String(fixture.decoded.medium), {
      timeout: 30_000,
    })
    await expect(page.locator('#house-large')).toHaveText(String(fixture.decoded.large), {
      timeout: 30_000,
    })

    // The alert content names the type, the failed entity, and the CTA.
    const dialogMessage = await dialog.promise
    expect(dialogMessage).toContain(NON_POKEMON)
    expect(dialogMessage).toContain('Pokémon:')
    expect(dialogMessage).toContain('Try searching')

    // Everything else restores; the fake name appears nowhere.
    const results = page.getByTestId('results')
    await expect(results).toBeVisible({ timeout: 30_000 })
    for (const name of kept) {
      await expect(results).toContainText(name, { timeout: 30_000 })
    }
    await expect(results).not.toContainText(NON_POKEMON)
    await expect(page.getByTestId('error')).toHaveCount(0)
    await expect(page.getByTestId('unhoused')).toHaveCount(0)
  })

  test('case 2: unmapped cart item is dropped and surfaced via an alert', async ({ page }) => {
    test.setTimeout(40_000)

    const cart = fixture.decoded.cart.map((entry) => ({ ...entry }))
    const last = cart[cart.length - 1]!
    last.name = NON_ITEM
    const state = {
      version: fixture.decoded.version,
      small: fixture.decoded.small,
      medium: fixture.decoded.medium,
      large: fixture.decoded.large,
      autoSort: fixture.decoded.autoSort ?? true,
      pokemon: [...fixture.decoded.pokemon],
      cart,
    }

    const dialog = captureFirstDialog(page)
    await page.goto(`/#${encodeState(state)}`)

    await expect(page.locator('#house-small')).toHaveText(String(fixture.decoded.small), {
      timeout: 30_000,
    })

    const dialogMessage = await dialog.promise
    expect(dialogMessage).toContain(NON_ITEM)
    expect(dialogMessage).toContain('Items:')
    expect(dialogMessage).toContain('Try searching')

    // Other cart entries still restore; the failed one is not rendered.
    await expect(page.getByTestId('error')).toHaveCount(0)
    await expect(page.getByTestId('unhoused')).toHaveCount(0)
    for (const entry of fixture.decoded.cart.slice(0, -1)) {
      await expect(page.getByTestId('cart-items')).toContainText(entry.name, { timeout: 20_000 })
    }
    await expect(page.getByTestId('cart-items')).not.toContainText(NON_ITEM)
  })

  test('case 3: a tombstoned pokemon upgrades to canonical, rewriting the hash, with no alert', async ({
    page,
  }) => {
    test.setTimeout(40_000)
    const noDialog = failOnUnexpectedDialog(page)

    // Interception targets the fetched public/data/ asset, so this works on
    // dev and CI preview servers alike.
    await page.route('**/data/tombstones.json', (route) =>
      route.fulfill({
        json: { pokemon: { [OLD_POKEMON]: 'Pikachu' }, items: {}, habitats: {} },
      }),
    )

    const state = {
      version: fixture.decoded.version,
      small: fixture.decoded.small,
      medium: fixture.decoded.medium,
      large: fixture.decoded.large,
      autoSort: fixture.decoded.autoSort ?? true,
      pokemon: [OLD_POKEMON, ...fixture.decoded.pokemon.slice(0, 2)],
    }
    await page.goto(`/#${encodeState(state)}`)

    // The canonical name renders; the old name appears nowhere.
    const results = page.getByTestId('results')
    await expect(results).toBeVisible({ timeout: 30_000 })
    await expect(results).toContainText('Pikachu', { timeout: 30_000 })
    await expect(results).not.toContainText(OLD_POKEMON)

    // No alert fired.
    expect(noDialog()).toBe(false)

    // The URL hash carried canonical names after the upgrade restore.
    await expect
      .poll(async () => {
        const hash = await page.evaluate(() => window.location.hash.slice(1))
        if (!hash) return null
        try {
          const state = JSON.parse(Buffer.from(hash, 'base64').toString('utf8')) as {
            pokemon?: string[]
          }
          return state.pokemon ?? null
        } catch {
          return null
        }
      }, {
        message: 'URL hash should have been rewritten with canonical names',
        timeout: 10_000,
      })
      .toContain('Pikachu')
    const finalPokemon = (await decodedPokemon(page))!
    expect(finalPokemon).not.toContain(OLD_POKEMON)
  })

  test('case 4: a saved-query entry upgrades via localStorage rewrite on restore', async ({
    page,
  }) => {
    test.setTimeout(40_000)
    const noDialog = failOnUnexpectedDialog(page)

    await page.route('**/data/tombstones.json', (route) =>
      route.fulfill({
        json: { pokemon: { [OLD_POKEMON]: 'Pikachu' }, items: {}, habitats: {} },
      }),
    )

    const entry = {
      title: 'Tombstone island',
      timestamp: 1726000000000,
      version: 2,
      small: 1,
      medium: 1,
      large: 0,
      pokemon: [OLD_POKEMON],
    }
    await page.addInitScript((stored) => {
      localStorage.setItem('pokehousing_saved_queries', stored)
    }, JSON.stringify([entry]))
    await page.goto('/')

    const select = page.locator('#saved-queries-select')
    await expect(select).toBeVisible({ timeout: 30_000 })
    await expect(select).toContainText('Tombstone island')
    await select.selectOption(String(entry.timestamp))

    // The canonical pokemon renders; no dialog fired.
    const results = page.getByTestId('results')
    await expect(results).toBeVisible({ timeout: 30_000 })
    await expect(results).toContainText('Pikachu', { timeout: 30_000 })
    expect(noDialog()).toBe(false)

    // Re-read localStorage: the entry was rewritten in place with the
    // canonical name, title/timestamp intact.
    const persisted = (await getStoredEntry(page, entry.timestamp)) as {
      title?: string
      pokemon: string[]
    } | null
    expect(persisted).not.toBeNull()
    expect(persisted!.title).toBe('Tombstone island')
    expect(persisted!.pokemon).toContain('Pikachu')
    expect(persisted!.pokemon).not.toContain(OLD_POKEMON)
  })
})

function getStoredEntry(page: Page, timestamp: number): Promise<unknown | null> {
  return page.evaluate((ts) => {
    const parsed = JSON.parse(localStorage.getItem('pokehousing_saved_queries') ?? '[]') as Array<{
      timestamp: number
    }>
    return parsed.find((e) => e.timestamp === ts) ?? null
  }, timestamp)
}

function decodedPokemon(page: Page): Promise<string[] | null> {
  return page.evaluate(() => {
    const hash = window.location.hash.slice(1)
    if (!hash) return null
    try {
      const state = JSON.parse(decodeURIComponent(escape(atob(hash)))) as { pokemon?: string[] }
      return state.pokemon ?? null
    } catch {
      return null
    }
  })
}
