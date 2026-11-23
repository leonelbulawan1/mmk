import { expect, test } from '@playwright/test'
import { openWriter, signIn } from './helpers'

test.beforeEach(async ({ page }) => { await signIn(page) })

test('write and save a diary entry', async ({ page }) => {
  await openWriter(page, 'Diary')
  await page.getByLabel('Title').fill('E2E market day')
  await page.locator('#composer textarea').fill('Bought mangoes at the market and talked with the vendor about rain.')
  await page.getByRole('button', { name: 'Save entry' }).click()
  await page.getByRole('button', { name: 'Save permanently' }).click()
  await expect(page).toHaveURL(/\/entries\/\d+/)
  await expect(page.getByText('Bought mangoes at the market', { exact: false }).first()).toBeVisible()
})

test('closing with Discard keeps the writing in Drafts, on the server too', async ({ page, context }) => {
  await openWriter(page, 'Diary')
  await page.getByLabel('Title').fill('E2E unfinished thought')
  await page.locator('#composer textarea').fill('Started this on the laptop.')
  await page.getByRole('button', { name: 'Discard' }).click()
  await expect(page.getByText('Saved to Drafts.')).toBeVisible()
  await page.waitForTimeout(1600)  // the server copy is sent shortly after saving

  // A fresh browser session (another device) sees the draft.
  const other = await context.browser().newContext()
  const page2 = await other.newPage()
  await signIn(page2)
  await page2.goto('/entries?kind=draft')
  await expect(page2.getByRole('button', { name: /E2E unfinished thought/ })).toBeVisible()

  // Open it and delete it.
  await page2.getByRole('button', { name: /E2E unfinished thought/ }).click()
  await page2.getByRole('dialog').getByRole('button', { name: 'Delete' }).click()
  await page2.getByRole('dialog', { name: 'Delete this draft?' }).getByRole('button', { name: 'Delete' }).click()
  await expect(page2.getByText('Draft deleted.')).toBeVisible()
  await other.close()
})

test('a letter needs a recipient before it can be sent', async ({ page }) => {
  await openWriter(page, 'Letter')
  await page.locator('#composer textarea').fill('Dear you, this is a test letter.')
  await expect(page.getByRole('button', { name: 'Send letter' })).toBeDisabled()
  await expect(page.getByText('Choose a recipient.')).toBeVisible()
})
