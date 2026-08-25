import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const SHOPPING_CART_PATH = path.join(process.cwd(), 'src', 'components', 'ShoppingCart.vue')
const HOMEVIEW_PATH = path.join(process.cwd(), 'src', 'views', 'HomeView.vue')
const CART_STORE_PATH = path.join(process.cwd(), 'src', 'stores', 'cart.ts')

const SHOPPING_CART_SOURCE = readFileSync(SHOPPING_CART_PATH, 'utf8')
const HOMEVIEW_SOURCE = readFileSync(HOMEVIEW_PATH, 'utf8')
const CART_STORE_SOURCE = readFileSync(CART_STORE_PATH, 'utf8')

describe('cart itemList guard regression contract', () => {
  it('ShoppingCart.vue does not use itemList.length for count checks', () => {
    expect(
      SHOPPING_CART_SOURCE,
      'ShoppingCart.vue must use cart.cartCount, not cart.itemList.length',
    ).not.toContain('itemList.length')
  })

  it('HomeView.vue does not dereference itemList directly', () => {
    expect(
      HOMEVIEW_SOURCE,
      'HomeView.vue must use cartStore.serializedCart, not cartStore.itemList',
    ).not.toContain('itemList')
  })

  it('cart store exposes cartCount and serializedCart accessors', () => {
    expect(
      CART_STORE_SOURCE,
      'cart.ts must define cartCount computed',
    ).toContain('cartCount')
    expect(
      CART_STORE_SOURCE,
      'cart.ts must define serializedCart computed',
    ).toContain('serializedCart')
  })

  it('cart store registers acceptHMRUpdate', () => {
    expect(
      CART_STORE_SOURCE,
      'cart.ts must register acceptHMRUpdate for HMR',
    ).toContain('acceptHMRUpdate')
  })
})
