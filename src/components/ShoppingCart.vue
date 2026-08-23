<script setup lang="ts">
import { assetPath } from '@/assetPath'
import { useCartStore } from '@/stores/cart'
import { useHouseStore } from '@/stores/houses'
import { useProgressStore } from '@/stores/progress'
import {
  BBadge,
  BButton,
  BCloseButton,
  BListGroup,
  BListGroupItem,
  BOffcanvas,
} from 'bootstrap-vue-next'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const cart = useCartStore()
const progressStore = useProgressStore()
const houseStore = useHouseStore()

// Below the lg breakpoint BOffcanvas responsive="lg" hides the sidebar entirely,
// so a floating toggle reveals it as a slide-over. `showMobileCart` gates only
// that below-lg overlay: desktop inline display is driven by the component's own
// breakpoint matchMedia (`isOpenByBreakpoint`), not the model, so forcing `true`
// at lg+ keeps desktop rendering identical to a model-less BOffcanvas. The
// update handler fires on close-button / Esc / backdrop interactions.
//
// `body-scrolling="!isBelowLg"` prevents BOffcanvas's useSafeScrollLock from
// locking body scroll at desktop, where the cart renders inline (not as an
// overlay). Without this, a setup-time race locks body overflow:hidden
// permanently: useSafeScrollLock applies its initial lock as a one-shot during
// setup while isOpenByBreakpoint is still false, and nothing subsequently
// clears it (the registry-based restore path only resets when a lock is set by
// the registry, not by this initial call). At mobile, body-scrolling is false
// so the overlay correctly locks scroll while open.
const showMobileCart = ref(false)

// Query kept aligned with Bootstrap Vue Next's own smallerOrEqual('lg')
// (max-width: 992px) to avoid a fractional-pixel boundary disagreement.
//
// Initialized synchronously — not in onMounted — so a below-lg page load never
// spends a frame with isBelowLg=false: during that window the model would be
// `true`, and the (invisible, still-closed) offcanvas would install its focus
// trap and steal focus back from any control the user clicks, swallowing
// keyboard input on phones until the trap tears down.
const isBelowLg = ref(
  typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 992px)').matches,
)
let mediaQuery: MediaQueryList | undefined

function syncBreakpoint(event?: MediaQueryListEvent) {
  isBelowLg.value = event ? event.matches : (mediaQuery?.matches ?? false)
}

onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    mediaQuery = window.matchMedia('(max-width: 992px)')
    syncBreakpoint()
    mediaQuery.addEventListener('change', syncBreakpoint)
  }
})

onBeforeUnmount(() => {
  mediaQuery?.removeEventListener('change', syncBreakpoint)
})

const offcanvasId = 'shopping-cart-offcanvas'

const cartToggleLabel = computed(
  () => `Open shopping cart, ${cart.itemList.length} item${cart.itemList.length === 1 ? '' : 's'}`,
)

// Offcanvas close interactions (X / Esc / backdrop) surface as
// update:modelValue(false). Per the ARIA dialog dismissal pattern, return
// keyboard focus to the floating toggle when closing below lg — the toggle is
// v-show-hidden until after the state flip, so focus on next tick.
function onCartModelUpdate(open: boolean) {
  showMobileCart.value = open
  if (!open && isBelowLg.value) {
    void nextTick(() => {
      document.querySelector<HTMLElement>('[data-testid="cart-mobile-toggle"]')?.focus()
    })
  }
}

// Houses removed from the registry (counts reduced, or only present in a
// restored legacy hash) keep their cart items — annotate rather than
// auto-delete so user effort is preserved. Removal stays a user action.
const liveHouseIds = computed(() => new Set(houseStore.registry.keys()))

const ORPHAN_SIZE_LABEL: Record<string, string> = { S: 'small', M: 'medium', L: 'large' }

function orphanNote(houseId: string): string {
  const size = ORPHAN_SIZE_LABEL[houseId.charAt(0)]
  return size
    ? `Items are kept in case you re-add a ${size} house.`
    : 'Items are kept in case you re-add this house.'
}
</script>

<template>
  <BOffcanvas
    :id="offcanvasId"
    responsive="lg"
    placement="end"
    title="Shopping Cart"
    class="cart-sidebar-panel"
    data-testid="shopping-cart"
    :body-scrolling="!isBelowLg"
    :model-value="isBelowLg ? showMobileCart : true"
    @update:model-value="onCartModelUpdate"
  >
    <template v-if="cart.itemList.length === 0">
      <p class="text-muted" data-testid="cart-empty">No items in cart.</p>
    </template>

    <template v-else>
      <div class="d-flex justify-content-end mb-2">
        <BButton
          variant="outline-danger"
          class="beach-button beach-button--sm"
          data-testid="cart-clear"
          @click="cart.clearCart()"
        >
          Clear all
        </BButton>
      </div>

      <h6>
        Total materials
        <BBadge variant="secondary" pill>{{ cart.aggregated.length }}</BBadge>
      </h6>
      <BListGroup flush data-testid="cart-aggregated">
        <BListGroupItem
          v-for="mat in cart.aggregated"
          :key="mat.name"
          class="d-flex align-items-center gap-2 py-1"
          data-testid="cart-aggregated-item"
        >
          <img
            v-if="mat.picturePath"
            :src="assetPath(mat.picturePath)"
            :alt="mat.name"
            class="cart-thumbnail"
          />
          <span>{{ mat.total }}&times; {{ mat.name }}</span>
        </BListGroupItem>
      </BListGroup>

      <hr />

      <div data-testid="cart-items">
        <p class="cart-steps-legend">
          <span class="step-hint step-hint--craft">🔨 Crafted</span> removes from totals
        </p>

        <div
          v-for="[houseId, houseItems] in cart.itemsByHouse"
          :key="houseId"
          class="mb-3"
          :class="{ 'cart-house-group--orphan': !liveHouseIds.has(houseId) }"
          data-testid="cart-house-group"
        >
          <h6 class="cart-house-heading">House {{ houseId }}</h6>
          <p
            v-if="!liveHouseIds.has(houseId)"
            class="cart-orphan-note small mb-1"
            data-testid="cart-orphan-note"
            :title="orphanNote(houseId)"
          >
            ⚠ House {{ houseId }} no longer exists.
            <span class="text-muted">{{ orphanNote(houseId) }}</span>
          </p>
          <BListGroup flush>
            <BListGroupItem
              v-for="item in houseItems"
              :key="`${item.houseId}:${item.name}`"
              class="cart-item"
              :class="{
                'checked-off': progressStore.isCartItemChecked(item.houseId, item.name),
              }"
              data-testid="cart-item"
            >
              <div class="d-flex align-items-start gap-2">
                <img
                  v-if="item.picturePath"
                  :src="assetPath(item.picturePath)"
                  :alt="item.name"
                  class="cart-thumbnail mt-1 flex-shrink-0"
                />
                <div class="flex-grow-1 cart-item-body">
                  <div class="d-flex align-items-start gap-1 mb-1">
                    <strong
                      :title="item.flavorText ?? undefined"
                      data-testid="item-name"
                      class="flex-grow-1"
                      :class="{
                        'text-decoration-line-through': progressStore.isCartItemChecked(
                          item.houseId,
                          item.name,
                        ),
                      }"
                      >{{ item.name }}</strong
                    >
                    <BCloseButton
                      class="item-remove"
                      data-testid="cart-remove"
                      :aria-label="`Remove ${item.name} from house ${item.houseId} cart`"
                      :title="`Remove ${item.name} from house ${item.houseId} cart`"
                      @click="cart.removeItem(item.houseId, item.name)"
                    />
                  </div>

                  <div class="d-flex gap-1 flex-wrap mb-2">
                    <BBadge
                      :variant="item.isCraftable ? 'success' : 'secondary'"
                      pill
                      data-testid="item-craftable-badge"
                      >{{ item.isCraftable ? 'Craft' : 'Buy' }}</BBadge
                    >
                    <BBadge
                      v-if="item.category"
                      variant="warning"
                      pill
                      data-testid="item-category-badge"
                      >{{ item.category }}</BBadge
                    >
                    <BBadge v-if="item.tag" variant="info" pill data-testid="item-tag-badge">{{
                      item.tag
                    }}</BBadge>
                  </div>
                </div>
              </div>

              <ul v-if="item.recipe.length" class="cart-recipe">
                <li
                  v-for="ing in item.recipe"
                  :key="ing.ingredientName"
                  class="d-flex align-items-center gap-1"
                >
                  <img
                    v-if="ing.ingredientPicture"
                    :src="assetPath(ing.ingredientPicture)"
                    :alt="ing.ingredientName"
                    class="cart-thumbnail-sm"
                  />
                  <span>{{ ing.count }}&times; {{ ing.ingredientName }}</span>
                </li>
              </ul>
              <span v-else class="text-muted small cart-recipe-empty">(no recipe)</span>

              <div class="progress-actions">
                <label
                  class="progress-action progress-action--craft"
                  title="Mark as crafted — removes ingredient cost from totals above"
                >
                  <input
                    type="checkbox"
                    :checked="progressStore.isCartItemChecked(item.houseId, item.name)"
                    data-testid="progress-checkbox-cart-item"
                    @change="progressStore.toggleCartItem(item.houseId, item.name)"
                  />
                  <span>Crafted — removes from totals</span>
                </label>
              </div>
            </BListGroupItem>
          </BListGroup>
        </div>
      </div>
    </template>
  </BOffcanvas>

  <!-- Floating toggle: only reachable below the lg breakpoint, where the
       offcanvas sidebar is hidden entirely. Hidden while the overlay is open. -->
  <BButton
    v-show="!showMobileCart"
    class="d-lg-none cart-mobile-toggle"
    variant="primary"
    data-testid="cart-mobile-toggle"
    :aria-expanded="String(showMobileCart)"
    :aria-controls="offcanvasId"
    :aria-label="cartToggleLabel"
    @click="showMobileCart = true"
  >
    🛒 Cart
    <BBadge v-if="cart.itemList.length" variant="light" pill class="ms-1">{{
      cart.itemList.length
    }}</BBadge>
  </BButton>
</template>
