<script setup lang="ts">
import { assetPath } from '@/assetPath'
import { useCartStore } from '@/stores/cart'
import { BBadge, BButton, BListGroup, BListGroupItem, BOffcanvas } from 'bootstrap-vue-next'

const cart = useCartStore()
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
      <BListGroup flush data-testid="cart-items">
        <BListGroupItem
          v-for="item in cart.itemList"
          :key="item.name"
          class="cart-item"
          data-testid="cart-item"
        >
          <div class="d-flex align-items-center gap-2 mb-1">
            <img
              v-if="item.picturePath"
              :src="assetPath(item.picturePath)"
              :alt="item.name"
              class="cart-thumbnail"
            />
            <div class="flex-grow-1">
              <strong :title="item.flavorText ?? undefined" data-testid="item-name">{{
                item.name
              }}</strong>
              <div class="d-flex gap-1 mt-1 flex-wrap">
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
              </div>
            </div>
            <div class="d-flex align-items-center gap-1 cart-controls">
              <BButton
                size="sm"
                variant="outline-secondary"
                data-testid="cart-decrement"
                @click="cart.decrementItem(item.name)"
              >
                &minus;
              </BButton>
              <span class="cart-quantity" data-testid="cart-quantity">{{ item.quantity }}</span>
              <BButton
                size="sm"
                variant="outline-secondary"
                data-testid="cart-increment"
                @click="cart.incrementItem(item.name)"
              >
                +
              </BButton>
              <BButton
                size="sm"
                variant="outline-danger"
                data-testid="cart-remove"
                @click="cart.removeItem(item.name)"
              >
                &times;
              </BButton>
            </div>
          </div>

          <ul v-if="item.recipe.length" class="cart-recipe mb-0 ps-3">
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
              <span>{{ ing.count * item.quantity }}&times; {{ ing.ingredientName }}</span>
            </li>
          </ul>
          <span v-else class="text-muted small ps-3">(no recipe)</span>
        </BListGroupItem>
      </BListGroup>

      <hr />

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
    </template>
  </BOffcanvas>
</template>
