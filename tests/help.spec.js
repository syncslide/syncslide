// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

test('/help page has correct heading', async ({ page }) => {
  await page.goto('/help');
  await expect(page.getByRole('heading', { level: 1, name: 'Presenter Guide' })).toBeVisible();
});

test('nav contains Help link visible to logged-out users', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Help' })).toBeVisible();
});

test('nav contains Help link visible to logged-in users', async ({ page }) => {
  await loginAsAdmin(page);
  await page.goto('/');
  await expect(page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Help' })).toBeVisible();
});

test('homepage has presenter guide link', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('link', { name: 'presenter guide' })).toBeVisible();
});
