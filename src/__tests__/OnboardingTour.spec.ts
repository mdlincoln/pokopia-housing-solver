// OnboardingTour analytics: AC.2 — tour_completed is emitted with the correct
// `method` on both finish and skip. v-onboarding's real Popper/focus-trap stack
// is exercised at e2e; here the wrapper/step components and useVOnboarding are
// stubbed so the component's own complete() glue (the part that calls the
// analytics wrapper) is unit-testable. The stub mirrors v-onboarding's
// scoped-slot contract so the real default-slot template's Finish/Skip button
// bindings are clickable too.

import OnboardingTour from '@/components/OnboardingTour.vue'
import posthog from 'posthog-js'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { nextMock, finishMock } = vi.hoisted(() => ({
  nextMock: vi.fn<(v: unknown) => void>(),
  finishMock: vi.fn<() => void>(),
}))

vi.mock('v-onboarding', () => ({
  VOnboardingWrapper: {
    name: 'VOnboardingWrapper',
    props: ['steps'],
    template:
      '<div><slot :step="step" :next="next" :previous="previous" :is-first="isFirst" :is-last="isLast" /></div>',
    data() {
      return {
        step: { content: { title: 'Stub step', description: 'stub' }, attachTo: {} },
        next: nextMock,
        previous: () => {},
        isFirst: false,
        // Last step so the Finish button (isLast ? complete('finish') : next())
        // exercises the finish binding in the template test.
        isLast: true,
      }
    },
  },
  VOnboardingStep: { name: 'VOnboardingStep', template: '<div><slot /></div>' },
  useVOnboarding: () => ({ start: vi.fn<() => void>(), finish: finishMock }),
}))

function mountTour() {
  return mount(OnboardingTour, {
    props: { isReady: false },
    global: { plugins: [createPinia()] },
  })
}

describe('OnboardingTour', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    localStorage.clear()
  })

  it('complete("finish") tracks tour_completed finish and exits', async () => {
    const wrapper = mountTour()
    await flushPromises()

    wrapper.vm.complete('finish')
    await flushPromises()

    expect(finishMock).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('exited')).toHaveLength(1)
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('tour_completed', { method: 'finish' })
  })

  it('complete("skip") tracks tour_completed skip and exits', async () => {
    const wrapper = mountTour()
    await flushPromises()

    wrapper.vm.complete('skip')
    await flushPromises()

    expect(finishMock).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('exited')).toHaveLength(1)
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('tour_completed', { method: 'skip' })
  })

  it('Finish button (isLast) binds complete("finish")', async () => {
    const wrapper = mountTour()
    await flushPromises()

    await wrapper.find('[data-testid="onboarding-next"]').trigger('click')
    await flushPromises()

    expect(finishMock).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('exited')).toHaveLength(1)
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('tour_completed', { method: 'finish' })
  })

  it('Skip button binds complete("skip")', async () => {
    const wrapper = mountTour()
    await flushPromises()

    await wrapper.find('[data-testid="onboarding-skip"]').trigger('click')
    await flushPromises()

    expect(finishMock).toHaveBeenCalledTimes(1)
    expect(wrapper.emitted('exited')).toHaveLength(1)
    expect(vi.mocked(posthog.capture)).toHaveBeenCalledWith('tour_completed', { method: 'skip' })
  })
})
