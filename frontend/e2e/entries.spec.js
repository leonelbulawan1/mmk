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
  await expect(page.getByRole('button', { name: 'Save changes' })).toBeVisible()
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

test('a letter has no Edit button', async ({ page }) => {
  await page.getByRole('tab', { name: /^Letters/ }).click()
  await page.locator('li a').first().click()
  await expect(page.getByText("Letters can't be edited once they are sent.")).toBeVisible()
  await expect(page.getByRole('button', { name: 'Edit' })).toHaveCount(0)
})
