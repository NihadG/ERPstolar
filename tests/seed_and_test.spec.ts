import { test, expect } from '@playwright/test';

test.describe('Phase 2: Data Seeding & Planner Verification', () => {

    test.beforeEach(async ({ page }) => {
        // Capture Logs
        page.on('console', msg => console.log('PAGE LOG:', msg.text()));
        page.on('pageerror', exception => console.log(`PAGE ERROR: "${exception}"`));
        page.on('response', response => {
            if (response.status() >= 400) {
                console.log(`HTTP ERROR: ${response.status()} ${response.url()}`);
            }
        });

        // Login Flow - credentials from .env.test (see playwright.config.ts)
        await page.goto('/login');
        await page.fill('input[type="email"]', process.env.TEST_USER_EMAIL || '');
        await page.fill('input[type="password"]', process.env.TEST_USER_PASSWORD || '');
        await page.click('button:has-text("Prijavi se")');

        try {
            await expect(page).toHaveURL('/', { timeout: 10000 });
        } catch (e) {
            const alert = page.locator('.alert-error');
            if (await alert.isVisible()) {
                console.log('LOGIN ERROR ALERT:', await alert.textContent());
            } else {
                console.log('LOGIN FAILED: URL did not change and no alert found.');
            }
            throw e;
        }
    });

    test('Seed Data and Verify Work Order/Planner Flow', async ({ page }) => {
        const projectName = 'Hotel Central';
        const productName = 'Reception Desk';
        const materialName = 'Oak Veneer';

        // 1. Create Project
        console.log('--- Creating Project: ' + projectName + ' ---');
        // Navigation uses Buttons in Sidebar, not Links. Force click to bypass overlays.
        await page.click('button:has-text("Projekti")', { force: true });

        // Wait for list to load
        await page.waitForSelector('.projects-list');

        // Use unique name to ensure clean state if multiple runs
        const uniqueProjectName = `${projectName} ${Date.now()}`;

        await page.click('button:has-text("Novi Projekat")');
        await page.fill('input[placeholder*="npr. Kuhinja"]', uniqueProjectName);

        // Client Name input has no placeholder, use label ref
        await page.fill('div.form-group:has-text("Klijent *") input', uniqueProjectName);

        await page.click('button:has-text("Sačuvaj")');

        // Wait for loading overlay loop (visible -> hidden)
        try {
            await expect(page.locator('.loading-overlay')).toBeVisible({ timeout: 2000 });
            await expect(page.locator('.loading-overlay')).toBeHidden({ timeout: 10000 });
        } catch (e) {
            console.log('Loading overlay handling warning:', e);
        }

        // Search and Expand Group
        const searchInput = page.locator('input[placeholder="Pretraži projekte..."]');
        await searchInput.fill(uniqueProjectName);
        await page.waitForTimeout(500);

        // Click Nacrt group if visible
        const nacrtGroup = page.locator('.status-group-header:has-text("Nacrt")');
        if (await nacrtGroup.isVisible()) {
            await nacrtGroup.click();
            await page.waitForTimeout(500);
        }

        // Wait for project to appear in the list using exact text match to avoid partial matches
        const projectCard = page.locator(`.project-card:has-text("${uniqueProjectName}")`).first();
        await expect(projectCard).toBeVisible();

        // 2. Add Product
        console.log('--- Adding Product: ' + productName + ' ---');
        // Expand the project first to see "Dodaj proizvod"
        await projectCard.click();
        await page.waitForTimeout(500); // Animation wait

        // Click "Dodaj proizvod" inside the expanded project
        const addProductBtn = projectCard.locator('button:has-text("Dodaj proizvod")');
        await addProductBtn.click();

        await page.fill('input[placeholder*="npr. Gornji"]', productName);
        await page.fill('input[min="1"]', '5'); // Quantity
        await page.click('button:has-text("Sačuvaj")');

        try {
            await expect(page.locator('.loading-overlay')).toBeVisible({ timeout: 2000 });
            await expect(page.locator('.loading-overlay')).toBeHidden({ timeout: 10000 });
        } catch (e) {
            // ignore
        }

        const productCard = page.locator(`.product-card:has-text("${productName}")`).first();
        await expect(productCard).toBeVisible();

        // 3. Add Material to Product
        console.log('--- Adding Material: ' + materialName + ' ---');
        // Expand the product to see "Dodaj materijal"
        await productCard.click();
        await page.waitForTimeout(500); // Animation wait

        // Click "Dodaj materijal"
        const addMaterialBtn = productCard.locator('button:has-text("Dodaj materijal")');
        await addMaterialBtn.click();

        // Fill material details
        // SearchableSelect is a trigger div, not input. Click it to open.
        await page.click('.searchable-select-trigger');

        // Wait for dropdown in portal
        await page.waitForSelector('.dropdown-item');

        // Select first option
        await page.click('.dropdown-item:first-child');

        // Quantity input by label
        await page.fill('div.form-group:has-text("Količina *") input', '10');

        // Click "Dodaj" in the modal footer (to avoid matching "Dodaj materijal" button behind overlay)
        await page.click('.modal-footer button:has-text("Dodaj")');

        try {
            await expect(page.locator('.loading-overlay')).toBeVisible({ timeout: 2000 });
            await expect(page.locator('.loading-overlay')).toBeHidden({ timeout: 10000 });
        } catch (e) { }

        // 4. Create Work Order
        console.log('--- Creating Work Order ---');
        console.log('Current URL:', page.url());

        // Smart Sidebar Navigation to "Nalozi"

        // 1. Locate "Proizvodnja" group header
        // The button itself has class 'nav-group-header' and contains text "Proizvodnja"
        const productionGroupBtn = page.locator('button.nav-group-header:has-text("Proizvodnja")');
        await productionGroupBtn.waitFor({ state: 'visible' });

        // Check if already expanded (has 'active' class)
        const isExpanded = await productionGroupBtn.evaluate(el => el.classList.contains('active'));

        if (!isExpanded) {
            console.log('Expanding Proizvodnja group...');
            await productionGroupBtn.click();
            // Wait for animation/expansion
            await page.waitForTimeout(500);
        } else {
            console.log('Proizvodnja group already expanded.');
        }

        // 2. Click "Nalozi" (Orders)
        // Ensure we target the nav item specifically
        const naloziBtn = page.locator('button.nav-item:has-text("Nalozi")');

        // Wait for it to be visible (it should be after expansion)
        try {
            await naloziBtn.waitFor({ state: 'visible', timeout: 3000 });
        } catch (e) {
            console.log('Nalozi button not visible after expansion? trying to expand again...');
            await productionGroupBtn.click();
            await naloziBtn.waitFor({ state: 'visible', timeout: 3000 });
        }

        console.log('Clicking Nalozi...');
        await naloziBtn.click();

        // 3. Wait for "Novi Radni Nalog" button to appear
        // This confirms the "Production" tab is active and rendered
        try {
            await page.waitForSelector('button:has-text("Novi Radni Nalog")', { state: 'visible', timeout: 5000 });
        } catch (e) {
            console.log('Novi Radni Nalog button not found within 5s. Navigation might have failed.');
            console.log('Retrying Nalozi click with force...');
            await naloziBtn.click({ force: true });
            await page.waitForSelector('button:has-text("Novi Radni Nalog")', { state: 'visible', timeout: 10000 });
        }

        await page.click('button:has-text("Novi Radni Nalog")');

        // Wizard Step 1: Select Project
        await page.locator(`.wz-card:has-text("${uniqueProjectName}")`).click();
        await page.click('button:has-text("Dalje")');

        // Wizard Step 2: Select Products
        await page.locator(`.wz-list-item:has-text("${productName}")`).click();
        await page.click('button:has-text("Dalje")');

        // Wizard Step 3: Processes
        await page.click('button:has-text("Dalje")');

        // Wizard Step 4: Details & Assignments
        await page.click('button:has-text("Kreiraj")');

        // Verify WO created
        await expect(page.locator(`.project-card:has-text("${uniqueProjectName}")`).first()).toBeVisible();

        // 5. Schedule in Planner
        console.log('--- Scheduling in Planner ---');
        await page.click('button:has-text("Planer")', { force: true });

        // Locate in backlog
        await page.waitForSelector('.planner-sidebar');

        // Check if our item is in there
        const backlogItem = page.locator(`.planner-sidebar div:has-text("${uniqueProjectName}")`).first();

        await expect(backlogItem).toBeVisible();
    });
});
