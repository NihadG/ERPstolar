// Script to generate PWA icons from SVG
// Run with: node scripts/generate-icons.js

const fs = require('fs');
const path = require('path');

// Since sharp is already a dependency of Next.js, we can use it
const sharp = require('sharp');

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];
const inputSvg = path.join(__dirname, '../public/icons/icon.svg');
const outputDir = path.join(__dirname, '../public/icons');

async function generateIcons() {
    console.log('Generating PWA icons...');

    for (const size of sizes) {
        const outputPath = path.join(outputDir, `icon-${size}x${size}.png`);

        try {
            await sharp(inputSvg)
                .resize(size, size)
                .png()
                .toFile(outputPath);
            console.log(`✓ Generated ${size}x${size} icon`);
        } catch (err) {
            console.error(`✗ Failed to generate ${size}x${size}:`, err.message);
        }
    }

    console.log('Done!');
}

generateIcons();
