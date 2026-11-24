import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test.beforeEach(async ({ page }) => { await signIn(page); await page.goto('/entries') })

test('tabs show all, diary, letters and drafts', async ({ page }) => {
  for (const name of ['All', 'Diary', 'Letters', 'Drafts']) await expect(page.getByRole('tab', { name: new RegExp(`^${name}`) })).toBeVisible()
  await page.getByRole('tab', { name: /^Letters/ }).click()
  await expect(page).toHaveURL(/kind=letter/)
  await expect(page.getByText(/^To /).first()).toBeVisible()
})

test('a diary entry opens in a window with Edit and Delete', async ({ page }) => {
  await page.getByRole('tab', { name: /^Diary/ }).click()
  await page.locator('li button').filter({ hasText: 'Check-up' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Diary entry')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Edit' })).toBeVisible()
  await dialog.getByRole('button', { name: 'Edit' }).click()
  // Edit stays in the same window, on the same page.
  await expect(page).toHaveURL(/\/entries(\?|$)/)
  const editor = page.getByRole('dialog', { name: 'Edit diary' })
  const box = editor.getByLabel('Entry text')
  await expect(box).toBeVisible()
  await box.fill('Another hospital check-up. The doctor is happy with the new medicine.')
  await editor.getByRole('button', { name: 'Save changes' }).click()
  await expect(page.getByText('Changes saved.')).toBeVisible()
  await expect(page.getByRole('dialog').getByText('Edited 1 time')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Edit' })).toBeVisible()
})

test('closing an edit with changes asks first', async ({ page }) => {
  await page.getByRole('tab', { name: /^Diary/ }).click()
  await page.locator('li button').filter({ hasText: 'Garden' }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: 'Edit' }).click()
  await dialog.getByLabel('Entry text').fill('changed')
  await dialog.getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('dialog', { name: 'Discard changes?' })).toBeVisible()
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Edit' })).toBeVisible()
})

test('deleting a diary entry removes it and the vault still verifies', async ({ page }) => {
  await page.getByRole('tab', { name: /^Diary/ }).click()
  await page.locator('li button').filter({ hasText: 'Garden' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await page.getByRole('button', { name: 'Delete entry' }).click()
  await expect(page.getByText('Entry deleted.')).toBeVisible()
  await expect(page.locator('li button').filter({ hasText: 'Garden' })).toHaveCount(0)
  await page.goto('/vault')
  await expect(page.getByText('Verified: every record matches its hash')).toBeVisible()
})

test('a letter opens read-only in a window', async ({ page }) => {
  await page.getByRole('tab', { name: /^Letters/ }).click()
  await page.locator('li button').first().click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByText('Letter', { exact: true })).toBeVisible()
  await expect(dialog.getByText('Delivery')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Edit' })).toHaveCount(0)
  await expect(dialog.getByRole('button', { name: 'Delete' })).toHaveCount(0)
})

test('search highlights the words and year headings stay in view', async ({ page }) => {
  await page.getByLabel('Search entries and letters').fill('hospital')
  await expect(page.locator('mark').first()).toBeVisible()
  await page.getByLabel('Clear search').click()
  await page.getByRole('tab', { name: /^Diary/ }).click()
  const first = page.locator('li.sticky').first()
  await page.mouse.wheel(0, 600)
  await page.waitForTimeout(300)
  const box = await first.boundingBox()
  const bar = await page.locator('form[role=search]').boundingBox()
  expect(box.y).toBeGreaterThan(bar.y)   // a year heading is pinned under the toolbar, not scrolled away
})

test('search has one clear button, and Esc clears too', async ({ page }) => {
  const box = page.getByLabel('Search entries and letters')
  await box.fill('hospital')
  await expect(page.getByLabel('Clear search')).toHaveCount(1)
  const hidden = await page.evaluate(() => [...document.styleSheets].some((sh) => {
    let rules = []; try { rules = [...sh.cssRules] } catch { /* a font sheet from another site */ }
    return rules.some((r) => r.cssText.includes('::-webkit-search-cancel-button') && r.cssText.includes('appearance: none'))
  }))
  expect(hidden).toBe(true)   // the browser's own × is hidden
  await page.screenshot({ path: 'test-results/search-one-clear.png', clip: await page.locator('form[role=search]').boundingBox() })
  await page.getByLabel('Clear search').click()
  await expect(box).toHaveValue('')
  await expect(box).toBeFocused()
  await box.fill('hospital')
  await box.press('Escape')
  await expect(box).toHaveValue('')
})

test('diary is grouped by year; needs review is a filter, not a tab', async ({ page }) => {
  await page.getByRole('tab', { name: 'Diary' }).click()
  await expect(page.locator('li.sticky h3').first()).toHaveText(/^\d{4}$/)
  await expect(page.getByRole('tab', { name: /review/i })).toHaveCount(0)
  const review = page.locator('button[aria-pressed]', { hasText: /review/i })
  if (await review.count()) {
    await review.click()
    await expect(review).toHaveAttribute('aria-pressed', 'true')
    await expect(page).toHaveURL(/review=1/)
  }
})

test('letters come first in All, and filter by status', async ({ page }) => {
  const heads = page.locator('main h2')
  await expect(heads.first()).toHaveText('Letters')
  await page.getByRole('tab', { name: 'Letters' }).click()
  await page.getByRole('button', { name: 'After passing', exact: true }).click()
  await expect(page).toHaveURL(/status=after/)
  await expect(page.locator('li button').first()).toBeVisible()
  await page.getByRole('button', { name: 'Scheduled', exact: true }).click()
  await expect(page.getByText('No matches')).toBeVisible()
})

test('year picker jumps to a year, and "/" focuses search', async ({ page }) => {
  await page.getByLabel('Jump to year').selectOption('2012')
  await expect(page.locator('#year-2012')).toBeInViewport()
  await page.locator('main').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('/')
  await expect(page.getByLabel('Search entries and letters')).toBeFocused()
})
