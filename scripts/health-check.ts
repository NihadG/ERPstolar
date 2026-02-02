#!/usr/bin/env node
/**
 * ERP Health Check Script
 * Provjerava zdravlje i stanje ERP aplikacije
 * 
 * Pokrenuti: npx ts-node scripts/health-check.ts
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Boje za konzolu
const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

const log = {
    success: (msg: string) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
    error: (msg: string) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
    warning: (msg: string) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
    info: (msg: string) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
    header: (msg: string) => console.log(`\n${colors.cyan}━━━ ${msg} ━━━${colors.reset}\n`),
};

interface CheckResult {
    name: string;
    passed: boolean;
    message: string;
    details?: string;
}

const results: CheckResult[] = [];

function runCommand(cmd: string): { success: boolean; output: string } {
    try {
        const output = execSync(cmd, { encoding: 'utf8', stdio: 'pipe' });
        return { success: true, output };
    } catch (error: any) {
        return { success: false, output: error.stdout || error.message };
    }
}

// ============================================
// PROVJERE
// ============================================

log.header('ERP HEALTH CHECK');

// 1. TypeScript kompilacija
log.info('Checking TypeScript compilation...');
const tscResult = runCommand('npx tsc --noEmit');
if (tscResult.success) {
    log.success('TypeScript: Nema grešaka');
    results.push({ name: 'TypeScript', passed: true, message: 'Kompilacija uspješna' });
} else {
    log.error('TypeScript: Pronađene greške');
    results.push({ name: 'TypeScript', passed: false, message: 'Greške u kompilaciji', details: tscResult.output });
}

// 2. Testovi
log.info('Running tests...');
const testResult = runCommand('npm test -- --passWithNoTests');
if (testResult.success && testResult.output.includes('passed')) {
    const match = testResult.output.match(/(\d+) passed/);
    const passed = match ? match[1] : '?';
    log.success(`Testovi: ${passed} testova prošlo`);
    results.push({ name: 'Tests', passed: true, message: `${passed} testova prošlo` });
} else {
    log.error('Testovi: Neki testovi nisu prošli');
    results.push({ name: 'Tests', passed: false, message: 'Testovi nisu prošli', details: testResult.output });
}

// 3. Provjera package.json
log.info('Checking package.json...');
const packageJsonPath = path.join(process.cwd(), 'package.json');
if (fs.existsSync(packageJsonPath)) {
    const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    const hasAllScripts = ['dev', 'build', 'start', 'lint', 'test'].every(s => pkg.scripts?.[s]);
    if (hasAllScripts) {
        log.success('package.json: Svi potrebni skripti prisutni');
        results.push({ name: 'Package.json', passed: true, message: 'Svi skripti prisutni' });
    } else {
        log.warning('package.json: Nedostaju neki skripti');
        results.push({ name: 'Package.json', passed: false, message: 'Nedostaju skripti' });
    }
} else {
    log.error('package.json: Fajl ne postoji!');
    results.push({ name: 'Package.json', passed: false, message: 'Fajl ne postoji' });
}

// 4. Provjera env varijabli
log.info('Checking environment variables...');
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const hasFirebase = envContent.includes('NEXT_PUBLIC_FIREBASE');
    const hasGemini = envContent.includes('GEMINI_API_KEY') || envContent.includes('GOOGLE_API_KEY');

    if (hasFirebase) {
        log.success('Environment: Firebase config pronađen');
        results.push({ name: 'Firebase Config', passed: true, message: 'Konfiguracija prisutna' });
    } else {
        log.error('Environment: Firebase config nedostaje');
        results.push({ name: 'Firebase Config', passed: false, message: 'Nedostaje konfiguracija' });
    }

    if (hasGemini) {
        log.success('Environment: Gemini API key pronađen');
        results.push({ name: 'Gemini API', passed: true, message: 'API key prisutan' });
    } else {
        log.warning('Environment: Gemini API key nedostaje (AI import neće raditi)');
        results.push({ name: 'Gemini API', passed: false, message: 'API key nedostaje' });
    }
} else {
    log.error('Environment: .env.local ne postoji!');
    results.push({ name: 'Environment', passed: false, message: '.env.local ne postoji' });
}

// 5. Provjera ključnih fajlova
log.info('Checking critical files...');
const criticalFiles = [
    'lib/firebase.ts',
    'lib/database.ts',
    'lib/auth.ts',
    'lib/types.ts',
    'context/AuthContext.tsx',
    'firestore.rules',
];

let allFilesExist = true;
for (const file of criticalFiles) {
    const filePath = path.join(process.cwd(), file);
    if (!fs.existsSync(filePath)) {
        log.error(`Missing: ${file}`);
        allFilesExist = false;
    }
}

if (allFilesExist) {
    log.success('Critical Files: Svi ključni fajlovi postoje');
    results.push({ name: 'Critical Files', passed: true, message: 'Svi fajlovi prisutni' });
} else {
    log.error('Critical Files: Neki fajlovi nedostaju');
    results.push({ name: 'Critical Files', passed: false, message: 'Nedostaju fajlovi' });
}

// 6. Broj linija koda
log.info('Counting lines of code...');
const countLinesResult = runCommand('npx cloc lib components app --json 2>nul || echo "cloc not available"');
if (countLinesResult.success && !countLinesResult.output.includes('not available')) {
    try {
        const clocData = JSON.parse(countLinesResult.output);
        const tsLines = clocData?.TypeScript?.code || 0;
        const tsxLines = clocData?.['TypeScript JSX']?.code || 0;
        log.info(`Lines of Code: ${tsLines + tsxLines} (TS: ${tsLines}, TSX: ${tsxLines})`);
    } catch {
        log.info('Lines of Code: Unable to parse');
    }
}

// ============================================
// SUMMARY
// ============================================

log.header('SUMMARY');

const passed = results.filter(r => r.passed).length;
const failed = results.filter(r => !r.passed).length;

console.log('');
console.table(results.map(r => ({
    'Check': r.name,
    'Status': r.passed ? '✅ PASS' : '❌ FAIL',
    'Message': r.message,
})));

console.log('');
log.info(`Total: ${passed} passed, ${failed} failed`);

if (failed === 0) {
    log.success('🎉 All checks passed! Application is healthy.');
    process.exit(0);
} else {
    log.warning(`⚠️  ${failed} check(s) failed. Review the issues above.`);
    process.exit(1);
}
