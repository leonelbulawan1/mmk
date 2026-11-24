import { expect, test } from '@playwright/test'
import { OWNER, signIn } from './helpers'

test('sign-in form explains what is missing before sending anything', async ({ page }) => {
  await page.goto('/login')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Enter your email address.')).toBeVisible()
  await expect(page.getByText('Enter your password.')).toBeVisible()
  await page.getByLabel('Email address').fill('elena@')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByText('Enter a valid email address, like name@gmail.com.')).toBeVisible()
})

test('a wrong password shows a clear error', async ({ page }) => {
  await page.goto('/login')
  await page.getByLabel('Email address').fill(OWNER.email)
  await page.getByLabel('Password', { exact: true }).fill('not-the-password-1')
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password')
})

test('the owner signs in and lands on the dashboard', async ({ page }) => {
  await signIn(page)
  await expect(page.getByRole('heading', { level: 1, name: OWNER.name })).toBeVisible()
  await expect(page.getByText('Recent entries')).toBeVisible()
})
