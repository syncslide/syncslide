// @ts-check
const { test, expect } = require('@playwright/test');
const { loginAsAdmin } = require('./helpers');

// Tests lock in the stage toolbar layout:
//  - #qrToggle and #record-toggle each occupy their own visual row
//  - Record button label is just "Record: <status>" — no timer inside
//  - #rec-timer lives inside #record-section with an "Elapsed:" label
//  - The timer still updates while recording

test.describe('stage toolbar layout', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto('/admin/1');
    await expect(page.locator('#stage-heading')).toBeFocused();
  });

  test('QR and Record toggles are on separate visual rows', async ({ page }) => {
    const qrBox = await page.locator('#qrToggle').boundingBox();
    const recBox = await page.locator('#record-toggle').boundingBox();
    expect(qrBox).not.toBeNull();
    expect(recBox).not.toBeNull();
    expect(recBox.y).toBeGreaterThanOrEqual(qrBox.y + qrBox.height);
  });

  test('Record button accessible name contains status but not a timer', async ({ page }) => {
    const btn = page.locator('#record-toggle');
    await expect(btn).toHaveAccessibleName('Record: Stopped');
    const text = (await btn.textContent()) || '';
    expect(text).not.toMatch(/\d{2}:\d{2}:\d{2}/);
  });

  test('#rec-timer lives inside #record-section with an Elapsed label', async ({ page }) => {
    await page.locator('#record-toggle').click();
    const section = page.locator('#record-section');
    await expect(section).toBeVisible();
    await expect(section.locator('#rec-timer')).toHaveCount(1);
    await expect(page.locator('#record-toggle #rec-timer')).toHaveCount(0);
    await expect(section).toContainText('Elapsed:');
    await expect(page.locator('#rec-timer')).toHaveText('00:00:00');
  });

  test('timer in the detail panel updates while recording', async ({ page }) => {
    await page.locator('#record-toggle').click();
    await page.locator('#recordStart').click();
    await expect(page.locator('#rec-status')).toHaveText('Recording', { timeout: 5000 });
    await expect(page.locator('#rec-timer')).not.toHaveText('00:00:00', { timeout: 5000 });
    await page.locator('#recordStop').click();
    await expect(page.locator('#rec-status')).toHaveText('Stopped', { timeout: 5000 });
  });
});
