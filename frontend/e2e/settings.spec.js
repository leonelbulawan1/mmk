import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test('add beneficiary checks every field', async ({ page }) => {
  await signIn(page)
  await page.goto('/beneficiaries')
  await page.getByRole('button', { name: 'Add beneficiary' }).first().click()
  await page.getByRole('button', { name: 'Add and send invite' }).click()
  await expect(page.getByText('Enter their first name.')).toBeVisible()
  await expect(page.getByText('Enter their last name.')).toBeVisible()
  await expect(page.getByText('Enter their email address.')).toBeVisible()
  await expect(page.getByText('Enter a policy handle.')).toBeVisible()
})

test('download my data gives one JSON file with the diary', async ({ page }) => {
  await signIn(page)
  await page.goto('/settings')
  const [file] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Download my data' }).click()])
  expect(file.suggestedFilename()).toMatch(/^mmk-my-data-.*\.json$/)
  const data = JSON.parse(readFileSync(await file.path(), 'utf8'))
  expect(data.profile.email).toBe('elena@example.com')
  expect(data.entries.length).toBeGreaterThan(0)
})
