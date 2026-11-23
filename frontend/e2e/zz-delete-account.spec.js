// Runs last: erases a separate fictional owner made only for this test (see e2e/start-api.sh).
import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

const DANA = { email: 'delete.me@example.com', password: 'alaala2026' }

test('delete account needs the password and the phrase, then erases the account', async ({ page }) => {
  await signIn(page, DANA)
  await page.goto('/settings#delete')
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await expect(page.getByText('Enter your password.')).toBeVisible()
  await expect(page.getByText('Type DELETE MY ACCOUNT exactly as shown.')).toBeVisible()

  const section = page.locator('#delete')
  await section.getByLabel('Your password').fill(DANA.password)
  await section.getByLabel(/Type/).fill('DELETE MY ACCOUNT')
  await page.getByRole('button', { name: 'Delete my account' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByText('Your account and diary were deleted.')).toBeVisible()

  await page.getByLabel('Email address').fill(DANA.email)
  await page.getByLabel('Password', { exact: true }).fill(DANA.password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password')
})
