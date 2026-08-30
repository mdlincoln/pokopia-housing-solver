<script setup lang="ts">
import { markTourSeen, ONBOARDING_STEPS } from '@/onboarding'
import { useCartStore } from '@/stores/cart'
import { BButton } from 'bootstrap-vue-next'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { VOnboardingStep, VOnboardingWrapper, useVOnboarding, type StepEntity } from 'v-onboarding'
import 'v-onboarding/dist/style.css'

const cartStore = useCartStore()

const props = defineProps<{
  /** Sample island loaded AND its first solve completed, so every step has a target. */
  isReady: boolean
}>()

const emit = defineEmits<{
  /** Fired on finish and skip so HomeView unmounts this component (re-arms the latch). */
  exited: []
}>()

const wrapper = ref<InstanceType<typeof VOnboardingWrapper> | null>(null)
// `useVOnboarding(wrapper)` is the library's typed API for programmatic control;
// it delegates to the wrapper's exposed `start`/`finish`/`goToStep` methods.
const { start, finish } = useVOnboarding(wrapper)

// The house-items targets all hang off the first house's recommendation
// `<details>` (`[data-testid="recommended-items"]`), which only exists after
// the sample solve's recommendation build. Poll briefly for it, then (when a
// step needs the table) open it through the summary's real click path so
// `HouseRecommendations`' `toggle` handler latches `hasOpenedRecs` and mounts
// the table. The idempotent open is used on the expand/header step AND the
// add-item step so Back/Next navigation never collapses the panel.
async function ensureFirstHouseItemsExists() {
  const deadline = Date.now() + 10_000
  while (!document.querySelector('[data-testid="recommended-items"]') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
}

async function ensureFirstHouseItemsOpen() {
  await ensureFirstHouseItemsExists()
  const details = document.querySelector<HTMLDetailsElement>('[data-testid="recommended-items"]')
  if (!details) return

  if (!details.open) {
    details.querySelector('summary')?.click()
    if (!details.open) {
      // Fallback: the summary click may be a no-op if already open; guarantee
      // the native toggle event so the lazy-table latch runs either way.
      details.open = true
      details.dispatchEvent(new Event('toggle'))
    }
  }
  details.scrollIntoView({ block: 'nearest' })
  forceReattach()
}

// Add the first recommended item to the first house's cart, then wait for the
// reactive recommendation recompute so the row's "Added" badge (and the
// `recommendation-added-row` class the final step targets) is present. Only
// adds once, so stepping Back then Next doesn't stock a second item.
//
// The item is added via the cart STORE directly rather than clicking the
// `+` button: v-onboarding's `preventOverlayInteraction` neuters the overlay-
// covered button's DOM click (a synthetic `.click()` dispatches the event but
// Vue's `@click` never runs), while calling `addItem` exercises the same
// mutation the button would and works regardless of the overlay.
async function addFirstSuggestedItem() {
  await ensureFirstHouseItemsOpen()
  const table = document.querySelector('[data-testid="recommended-items-list"]')
  if (!table) return

  const hasAdded = () => !!table.querySelector('[data-testid="recommendation-added-badge"]')
  if (!hasAdded()) {
    const firstAdd = table.querySelector<HTMLElement>('[data-testid="add-to-cart"]')
    const name = firstAdd
      ?.closest('tr')
      ?.querySelector('[data-testid="item-name"]')
      ?.textContent?.trim()
    const houseId = firstAdd?.closest('[data-drop-house]')?.getAttribute('data-drop-house')
    if (name && houseId) {
      await cartStore.addItem(houseId, name)
    }
    const deadline = Date.now() + 10_000
    while (!hasAdded() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50))
    }
  }
  table.scrollIntoView({ block: 'nearest' })
  forceReattach()
}

// Zero-based index → preparation to run just before that step is shown.
//  3 = "House items" button: exists, but NOT expanded yet.
//  4 = "Combined favorites" header: expand the panel so the thead renders.
//  6 = "Needs fulfilled" row: stock the first recommended item.
const STEP_PREPARE: Record<number, () => Promise<void>> = {
  3: ensureFirstHouseItemsExists,
  4: ensureFirstHouseItemsOpen,
  6: addFirstSuggestedItem,
}

// v-onboarding resolves and positions its popper (and the SVG highlight cutout)
// against the step's target element when the step's object identity changes —
// i.e. when we advance to the step. For the state-changing steps (open the items
// pane, add an item) the target element does not exist yet at that moment, so
// the highlight lands against stale/absent geometry; it only becomes correct on
// a second pass (Back→Next) once the DOM is already settled. `preparedTick` is a
// reactive counter the mutating `beforeStep`s bump AFTER their DOM change is in:
// because the `steps` computed below depends on it, the recompute yields a fresh
// step-object identity, which re-triggers `attachElement` to re-resolve and
// re-position the popper against the now-final geometry.
const preparedTick = ref(0)

function forceReattach() {
  preparedTick.value++
}

const steps = computed<StepEntity[]>(() => {
  // Reading preparedTick makes the recompute reactive to forceReattach().
  void preparedTick.value
  return ONBOARDING_STEPS.map((step, index) => ({
    attachTo: { element: step.attachTo },
    content: { title: step.title, description: step.description },
    ...(STEP_PREPARE[index] ? { on: { beforeStep: STEP_PREPARE[index]! } } : {}),
  }))
})

// Mount-driven self-start latch. It covers both entry paths: mounting after the
// island is already solved (`isReady` true → the `immediate` watcher pass starts
// right away) and mounting before the sample solve finishes (`isReady` flips
// true later → the watch fires). `nextTick` lets the pending target DOM settle,
// and `started` prevents a second `.start()` on later solves.
const started = ref(false)

onMounted(() => {
  watch(
    () => props.isReady,
    (ready) => {
      if (ready && !started.value) {
        started.value = true
        void nextTick(() => start())
      }
    },
    { immediate: true },
  )
})

// Finish and Skip share one teardown: mark seen, tear down the overlay cleanly
// (`finish()` restores `document.body` pointer-events that the overlay's
// `preventOverlayInteraction` disabled), then unmount via `exited`.
function complete() {
  markTourSeen()
  finish()
  emit('exited')
}
</script>

<template>
  <VOnboardingWrapper ref="wrapper" :steps="steps">
    <template #default="{ step, next, previous, isFirst, isLast }">
      <VOnboardingStep data-testid="onboarding-tour">
        <div
          role="dialog"
          aria-label="Guided tour"
          data-testid="onboarding-step"
          class="onboarding-card"
        >
          <h3 class="onboarding-card__title">{{ step?.content.title }}</h3>
          <p class="onboarding-card__description">{{ step?.content.description }}</p>
          <div
            class="d-flex flex-wrap align-items-center justify-content-end gap-2 onboarding-card__actions"
          >
            <BButton
              v-if="!isFirst"
              variant="outline-secondary"
              class="beach-button beach-button--sm"
              data-testid="onboarding-prev"
              @click="previous"
            >
              Back
            </BButton>
            <BButton
              variant="primary"
              class="beach-button beach-button--sm"
              data-testid="onboarding-next"
              @click="isLast ? complete() : next()"
            >
              {{ isLast ? 'Finish' : 'Next' }}
            </BButton>
            <BButton
              variant="outline-secondary"
              class="beach-button beach-button--sm"
              data-testid="onboarding-skip"
              @click="complete"
            >
              Skip
            </BButton>
          </div>
        </div>
      </VOnboardingStep>
    </template>
  </VOnboardingWrapper>
</template>
