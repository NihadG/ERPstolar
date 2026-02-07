import { test, expect } from '@playwright/test';

test.describe('Projects', () => {
    // Run before each test
    test.beforeEach(async ({ page }) => {
        console.log('Projects Test: Navigating to home...');
        await page.goto('/');

        if (page.url().includes('/login')) {
            console.log('Projects Test: Logging in...');
            await page.fill('input[type="email"]', 'nihad.tae@gmail.com');
            await page.fill('input[type="password"]', 'admin123');
            await page.click('button[type="submit"]');
            await page.waitForURL('/', { timeout: 10000 });
        }
    });

    test('should verify project list loads', async ({ page }) => {
        await page.goto('/projects');
        console.log('Projects Test: Verifying list...');
        await expect(page.locator('h1:has-text("Projekti")').first()).toBeVisible();
    });

    test('should open new project modal', async ({ page }) => {
        await page.goto('/projects');
        const newProjectBtn = page.locator('button:has-text("Novi Projekat")').first();
        await expect(newProjectBtn).toBeVisible();
        await newProjectBtn.click();
        await expect(page.locator('div[role="dialog"]')).toBeVisible();
        await expect(page.locator('div[role="dialog"]')).toContainText('Novi Projekat');
    });
});
