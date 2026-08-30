import { changelog } from '@/changelog'
import ChangelogView from '@/views/ChangelogView.vue'
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

describe('ChangelogView', () => {
  it('renders the changelog section and heading', () => {
    const wrapper = mount(ChangelogView)
    expect(wrapper.find('[data-testid="changelog"]').exists()).toBe(true)
    expect(wrapper.get('h2.section-heading').text()).toBe('Changelog')
  })

  it('renders one entry card per changelog entry with date, summary, and bullets', () => {
    const wrapper = mount(ChangelogView)
    const entries = wrapper.findAll('[data-testid="changelog-entry"]')
    expect(entries.length).toBe(changelog.length)

    changelog.forEach((entry, i) => {
      const card = entries[i]!
      expect(card.get('h3').text()).toContain(entry.date)
      expect(card.get('h3').text()).toContain(entry.summary)
      const bullets = card.findAll('li')
      expect(bullets.length).toBe(entry.changes.length)
      entry.changes.forEach((change, j) => {
        expect(bullets[j]!.text()).toBe(change)
      })
    })
  })
})
