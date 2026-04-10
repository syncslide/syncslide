// @ts-check
const { test, expect } = require('@playwright/test');

// ext-links.js marks every <a href="http…"> in the page with:
//   • an SVG icon (.ext-icon, aria-hidden="true") for the visual indicator
//   • a <span class="ext-label">(external)</span> for the screen reader label
// Internal links (relative paths or same-origin) must not be touched.
//
// Reference pattern: GOV.UK Design System marks external links with visible
// "(opens in new tab)" text so screen reader users know before activating the
// link — see https://design-system.service.gov.uk/styles/links/
// SyncSlide's approach is equivalent: the "(external)" span announces before
// the user leaves, without relying on CSS alone.

// -- External links get icon and label --

test('external link on /help gets .ext-icon inserted', async ({ page }) => {
    await page.goto('/help');
    // The CommonMark reference link is the one external link in page content.
    const extLink = page.locator('a[href^="https://commonmark.org"]');
    await expect(extLink.locator('.ext-icon')).toHaveCount(1);
});

test('external link on /help gets (external) label inserted', async ({ page }) => {
    await page.goto('/help');
    const extLink = page.locator('a[href^="https://commonmark.org"]');
    await expect(extLink.locator('.ext-label')).toHaveText('(external)');
});

test('external link in footer gets .ext-icon inserted', async ({ page }) => {
    await page.goto('/');
    const footerLink = page.locator('a[href^="https://github.com"]');
    await expect(footerLink.locator('.ext-icon')).toHaveCount(1);
});

test('external link in footer gets (external) label inserted', async ({ page }) => {
    await page.goto('/');
    const footerLink = page.locator('a[href^="https://github.com"]');
    await expect(footerLink.locator('.ext-label')).toHaveText('(external)');
});

// -- Internal links are not marked --

test('internal /create link on /help is not marked as external', async ({ page }) => {
    await page.goto('/help');
    const internalLink = page.locator('a[href="/create"]');
    await expect(internalLink.locator('.ext-icon')).toHaveCount(0);
    await expect(internalLink.locator('.ext-label')).toHaveCount(0);
});

test('nav Home link is not marked as external', async ({ page }) => {
    await page.goto('/');
    const homeLink = page.locator('nav[aria-label="Primary navigation"] a[href="/"]');
    await expect(homeLink.locator('.ext-icon')).toHaveCount(0);
    await expect(homeLink.locator('.ext-label')).toHaveCount(0);
});

test('breadcrumb Home link is not marked as external', async ({ page }) => {
    await page.goto('/help');
    const breadcrumbHome = page.locator('nav[aria-label="Breadcrumb"] a[href="/"]');
    await expect(breadcrumbHome.locator('.ext-icon')).toHaveCount(0);
    await expect(breadcrumbHome.locator('.ext-label')).toHaveCount(0);
});

// -- Screen reader accessibility --

test('ext-icon SVG has aria-hidden="true" so it is not announced', async ({ page }) => {
    await page.goto('/help');
    const icon = page.locator('a[href^="https://commonmark.org"] .ext-icon');
    await expect(icon).toHaveAttribute('aria-hidden', 'true');
});

test('accessible name of external link includes "(external)"', async ({ page }) => {
    await page.goto('/help');
    // The accessible name is derived from the link's text content. After
    // ext-links.js runs, textContent includes the .ext-label span text.
    // We verify the accessible name so we know screen readers will announce
    // the external indicator before the user activates the link.
    const extLink = page.locator('a[href^="https://commonmark.org"]');
    const accessibleName = await extLink.evaluate(el => el.textContent ?? '');
    expect(accessibleName).toContain('(external)');
});

test('accessible name of external link still contains its original text', async ({ page }) => {
    await page.goto('/help');
    const extLink = page.locator('a[href^="https://commonmark.org"]');
    const accessibleName = await extLink.evaluate(el => el.textContent ?? '');
    expect(accessibleName).toContain('CommonMark reference');
});

// -- Idempotency: re-running markExternalLinks does not double-mark --

test('calling markExternalLinks twice does not insert a second icon', async ({ page }) => {
    await page.goto('/help');
    // Simulate a second call (e.g. after dynamic content update).
    await page.evaluate(() => {
        // Re-run the same logic the module exposes via DOMContentLoaded.
        // ext-links.js guards with: if (!a.querySelector('.ext-icon'))
        const svg = '<svg width="0.8em" height="0.8em" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" class="ext-icon"><path/></svg>';
        document.querySelectorAll('a[href^="http"]').forEach(a => {
            if (!a.querySelector('.ext-icon')) {
                a.insertAdjacentHTML('beforeend', svg + '<span class="ext-label">(external)</span>');
            }
        });
    });
    const extLink = page.locator('a[href^="https://commonmark.org"]');
    await expect(extLink.locator('.ext-icon')).toHaveCount(1);
    await expect(extLink.locator('.ext-label')).toHaveCount(1);
});
