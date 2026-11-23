import { expect, test } from '@playwright/test'
import { signIn } from './helpers'

test('on a phone the dashboard fits the screen and nothing spills sideways', async ({ page }) => {
  await signIn(page)
  await expect(page.getByText('Recent entries')).toBeVisible()
  const { extraX, extraY } = await page.evaluate(() => ({
    extraX: document.documentElement.scrollWidth - innerWidth,
    extraY: document.documentElement.scrollHeight - innerHeight,
  }))
  expect(extraX).toBeLessThanOrEqual(0)
  expect(extraY).toBeLessThanOrEqual(1)
})

test('on a phone the entry tabs fit on one line', async ({ page }) => {
  await signIn(page)
  await page.goto('/entries')
  const extraX = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  expect(extraX).toBeLessThanOrEqual(0)
})
