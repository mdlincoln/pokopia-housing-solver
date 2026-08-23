import SavedIslandsCard from '@/components/SavedIslandsCard.vue'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

function mountCard(canSave = true) {
  return mount(SavedIslandsCard, {
    props: {
      savedQueries: [],
      selectedTimestamp: null,
      saveSuccess: false,
      deletedUndoTitle: '',
      canSave,
    },
  })
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('SavedIslandsCard share link', () => {
  it('renders a "Share island as a link" info button with a link icon, left of Save', () => {
    const wrapper = mountCard()

    const share = wrapper.find('[data-testid="share-link"]')
    expect(share.exists()).toBe(true)
    expect(share.text()).toContain('Share island as a link')
    expect(share.find('i.bi-link-45deg, i.bi.bi-link-45deg').exists()).toBe(true)
    // Blue info style via the beach-button recipe.
    expect(share.classes()).toContain('btn-info')
    expect(share.classes()).toContain('beach-button')

    // Save button sits to the right of the share button in the header.
    const save = wrapper.findAll('.config-card-header button')
    const idxShare = save.findIndex((b) => b.classes().includes('btn-info'))
    const idxSave = save.findIndex(
      (b) => b.attributes('disabled') === undefined && !b.classes().includes('btn-info'),
    )
    expect(idxShare).toBeGreaterThanOrEqual(0)
    expect(idxSave).toBeGreaterThan(idxShare)
  })

  it('copies the current URL to the clipboard and shows the toast', async () => {
    const writeText = vi.fn<(text: string) => Promise<void>>().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    })

    const wrapper = mountCard()

    await wrapper.find('[data-testid="share-link"]').trigger('click')
    await flushPromises()

    expect(writeText).toHaveBeenCalledTimes(1)
    expect(writeText).toHaveBeenCalledWith(window.location.href)
    // The toast carries the confirmation copy (jsdom can't observe BToast's
    // CSS visibility, but the markup resolves to the intended message).
    expect(wrapper.find('[data-testid="share-toast"]').text()).toContain(
      'Island link copied to clipboard',
    )
  })

  it('still shows the toast when the clipboard API is unavailable', async () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: undefined,
      configurable: true,
    })

    const wrapper = mountCard()
    // Clicking with no clipboard API must not throw and still triggers the toast.
    await wrapper.find('[data-testid="share-link"]').trigger('click')
    await flushPromises()

    expect(wrapper.find('[data-testid="share-toast"]').text()).toContain(
      'Island link copied to clipboard',
    )
  })
})
