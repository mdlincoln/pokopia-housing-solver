<script setup lang="ts">
import { assetPath } from '@/assetPath'
import { useCartStore } from '@/stores/cart'
import { useProgressStore } from '@/stores/progress'
import { BBadge, BButton, BListGroup, BListGroupItem, BOffcanvas } from 'bootstrap-vue-next'

const cart = useCartStore()
const progressStore = useProgressStore()
</script>

<template>
  <BOffcanvas
    responsive="lg"
    placement="end"
    title="Shopping Cart"
    class="cart-sidebar-panel"
    data-testid="shopping-cart"
  >
    <template v-if="cart.itemList.length === 0">
      <p class="text-muted" data-testid="cart-empty">No items in cart.</p>
    </template>

    <template v-else>
      <div class="d-flex justify-content-end mb-2">
        <BButton
          size="sm"
          variant="outline-danger"
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
          <span class="step-hint step-hint--craft">🔨 Crafted</span> removes from totals &middot;
          <span class="step-hint step-hint--placed">🏠 Placed</span> syncs with house cards
        </p>

        <div
          v-for="[houseId, houseItems] in cart.itemsByHouse"
          :key="houseId"
          class="mb-3"
          data-testid="cart-house-group"
        >
          <h6 class="cart-house-heading">House {{ houseId }}</h6>
          <BListGroup flush>
            <BListGroupItem
              v-for="item in houseItems"
              :key="`${item.houseId}:${item.name}`"
              class="cart-item"
              :class="{
                'checked-off': progressStore.isCartItemChecked(item.houseId, item.name),
                'cart-item--placed': progressStore.isItemPlaced(item.houseId, item.name),
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
                <div class="flex-grow-1" style="min-width: 0">
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
                    <BButton
                      size="sm"
                      variant="outline-danger"
                      class="flex-shrink-0"
                      data-testid="cart-remove"
                      @click="cart.removeItem(item.houseId, item.name)"
                      >&times;</BButton
                    >
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

              <ul v-if="item.recipe.length" class="cart-recipe mb-0 ps-3 mt-2">
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
              <span v-else class="text-muted small ps-3 mt-1 d-block">(no recipe)</span>

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
                <label
                  class="progress-action progress-action--placed"
                  title="Mark as placed in the house — syncs with the house card"
                >
                  <input
                    type="checkbox"
                    :checked="progressStore.isItemPlaced(item.houseId, item.name)"
                    data-testid="progress-checkbox-placed-item"
                    @change="progressStore.togglePlacedItem(item.houseId, item.name)"
                  />
                  <span>Placed in house</span>
                </label>
              </div>
            </BListGroupItem>
          </BListGroup>
        </div>
      </div>
    </template>
  </BOffcanvas>
</template>
