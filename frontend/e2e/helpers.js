// Shared steps. All accounts are fictional demo data (see backend/app/seed.py).
import { expect } from '@playwright/test'

export const OWNER = { email: 'elena@example.com', password: 'alaala2026', name: 'Elena Ramos' }
export const BENEFICIARY = { email: 'maria@example.com', password: 'alaala2026' }

export async function signIn(page, { email, password } = OWNER) {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).not.toHaveURL(/\/login/)
}

// Open the Write menu and pick Diary or Letter.
export async function openWriter(page, kind = 'Diary') {
  await page.getByRole('button', { name: 'Write' }).click()
  await page.getByRole('menuitem', { name: new RegExp(`^${kind}`) }).click()
  await expect(page.getByRole('dialog', { name: kind === 'Diary' ? 'New diary' : 'New letter' })).toBeVisible()
}
