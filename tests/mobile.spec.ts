import { test, expect } from '@playwright/test';

// Use iPhone 12 viewport
test.use({ viewport: { width: 375, height: 667 } });

test.describe('Mobile Material Editing', () => {
    test.beforeEach(async ({ page }) => {
        console.log('Navigating to home...');
        await page.goto('/');

        if (page.url().includes('/login')) {
            console.log('Logging in...');
            await page.fill('input[type="email"]', 'nihad.tae@gmail.com');
            await page.fill('input[type="password"]', 'admin123');
            await page.screenshot({ path: 'debug-login-filled.png' });
            await page.click('button[type="submit"]');
            try {
                await page.waitForURL('/', { timeout: 10000 });
                console.log('Login successful, current URL:', page.url());
                await page.screenshot({ path: 'debug-login-success.png' });
            } catch (e) {
                console.log('Login timeout or failure. URL:', page.url());
                await page.screenshot({ path: 'debug-login-failed.png' });
                throw e;
            }
        } else {
            console.log('Already logged in or not redirecting to login. URL:', page.url());
            await page.screenshot({ path: 'debug-already-logged-in.png' });
        }

        console.log('Navigating to projects...');
        await page.goto('/projects');
    });

    test('should open mobile edit modal', async ({ page }) => {
        // Wait for list to load
        await expect(page.locator('.mobile-project-card').first()).toBeVisible({ timeout: 10000 });

        // 1. Expand a project (first one)
        console.log('Expanding project...');
        const projectCard = page.locator('.mobile-project-card').first();
        await projectCard.click();

        // 2. Find a product with materials
        console.log('Looking for a product with materials...');
        const productCards = page.locator('.mp-product-card');
        await expect(productCards.first()).toBeVisible({ timeout: 10000 });
        const count = await productCards.count();
        console.log(`Found ${count} products`);

        let foundMaterial = false;

        for (let i = 0; i < count; i++) {
            const card = productCards.nth(i);
            // Click to expand
            await card.click();
            await page.waitForTimeout(500); // Animation

            // Check if materials exist (look for edit button)
            // Note: scoped locator matches inside the card
            const editBtn = card.locator('.m-actions button.mini-btn').first();

            if (await editBtn.isVisible({ timeout: 1000 })) {
                console.log(`Product ${i} has materials. Clicking edit...`);
                await editBtn.click();
                foundMaterial = true;
                break;
            }

            console.log(`Product ${i} has no materials. Trying next...`);
            // Optional: collapse it back? Or just leave it.
        }

        if (!foundMaterial) {
            throw new Error('No materials found in any product. Please add materials to a product manually or update test to create data.');
        }

        // 4. Verify modal
        console.log('Verifying modal...');
        const sheet = page.locator('.mobile-sheet');
        await expect(sheet).toBeVisible();
        await expect(sheet).toContainText('Uredi Materijal');

        // 5. Verify controls
        await expect(page.locator('div.essential-toggle-card')).toBeVisible();
        await expect(page.locator('button:has-text("+1")')).toBeVisible();
    });
});
