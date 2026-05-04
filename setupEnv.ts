import * as fs       from 'fs';
import * as path     from 'path';
import * as readline from 'readline';
import * as os from 'os';
import { setRegistryValue, isAdminPrivilege } from './setRegistryValue';
import { loadABDMasterConfig, computeABDMasterConfigChange, applyABDMasterConfigChange, saveABDMasterConfig } from './updateConfig';
import { loadAlAppConfig, getUsedPorts, computeAlAppConfigChange, applyAlAppConfigChange, applyAlAppConfigCussFolder, saveAlAppConfig, UsedPortInfo } from './updateAlAppConfig';

// ─── Synchronous stdin prompt ─────────────────────────────────────────────────
function prompt(question: string): string {
    process.stdout.write(question);
    const buf = Buffer.alloc(1024);
    let bytesRead = 0;
    try {
        bytesRead = (fs as any).readSync(0, buf, 0, buf.length, null);
    } catch {
        return '';
    }
    return buf.toString('utf-8', 0, bytesRead).trim();
}

// ─── Config file path ────────────────────────────────────────────────────────
const CONFIG_PATH = path.resolve(__dirname, 'setup.config.json');

// ─── Parse CLI Arguments ─────────────────────────────────────────────────────
function getArg(name: string): string | undefined {
    const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.split('=')[1] : undefined;
}

const airport = getArg('airport');
const airline = getArg('airline');

// ─── Validate CLI Arguments ───────────────────────────────────────────────────
if (!airport || !airline) {
    console.error('❌ Missing required arguments.');
    console.error('   Usage: ts-node setupEnv.ts --airport=SYD --airline=QF');
    process.exit(1);
}

// ─── Read setup.config.json ───────────────────────────────────────────────────
if (!fs.existsSync(CONFIG_PATH)) {
    console.error(`❌ setup.config.json not found at: ${CONFIG_PATH}`);
    process.exit(1);
}

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
const allKeywords    : string[]                  = config.keywords;
const suffix         : string                    = config.registrySuffix ?? 'SIMULATOR';
const keywordKioskIds: Record<string, string>    = config.keywordKioskIds ?? {};

if (!allKeywords || allKeywords.length === 0) {
    console.error('❌ No keywords found in setup.config.json');
    process.exit(1);
}

// Filter keywords to only those matching the given airport code
const keywords: string[] = allKeywords.filter(k =>
    k.toUpperCase().includes(airport!.toUpperCase())
);

if (keywords.length === 0) {
    console.error(`❌ No keywords found matching airport: ${airport!.toUpperCase()}`);
    console.error(`   Available keywords: ${allKeywords.join(', ')}`);
    process.exit(1);
}

// ─── Print Summary ────────────────────────────────────────────────────────────
console.log('');
console.log('==========================================');
console.log('   🚀 Playwright Environment Setup');
console.log('==========================================');
console.log(`   Airport  : ${airport.toUpperCase()}`);
console.log(`   Airline  : ${airline.toUpperCase()}`);
console.log(`   Keywords : ${keywords.join(', ')}`);
console.log(`   PCNames  : ${keywords.map(k => `${k.toUpperCase()}${suffix}`).join(', ')}`);
console.log('==========================================');
console.log('');

// ─── If multiple PCNames, ask user which one to use ───────────────────────────
if (keywords.length > 1) {
    console.log('⚠️  Multiple PC names found. Please select one:');
    keywords.forEach((k, i) => {
        console.log(`   [${i + 1}] ${k.toUpperCase()}${suffix}`);
    });
    console.log('');
    const selection = prompt(`Enter number (1-${keywords.length}): `);
    const idx = parseInt(selection, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= keywords.length) {
        console.error(`❌ Invalid selection: "${selection}". Exiting.`);
        process.exit(1);
    }
    keywords.splice(0, keywords.length, keywords[idx]);
    console.log(`\n✅ Selected: ${keywords[0].toUpperCase()}${suffix}`);
    console.log('');
}

// ─── Step 1: Update Registry for each keyword ─────────────────────────────────
console.log('📋 Step 1: Updating Windows Registry...');
for (const keyword of keywords) {
    const pcName = `${keyword.toUpperCase()}${suffix}`;
    setRegistryValue(pcName);
}

// ─── Confirm before proceeding ────────────────────────────────────────────────
console.log('');
const answer = prompt('⚠️  Registry updated. Do you want to continue with further steps? (y/n): ');
if (answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
    console.log('');
    console.log('🛑 Setup stopped after registry update. Step 2 (ABDMasterConfig) was skipped.');
    console.log('');
    process.exit(0);
}

// ─── Steps 2 & 3: per-pcName combined diff ───────────────────────────────────
(async () => {
    const sep = '─'.repeat(60);

    // Async readline prompt helper
    const rlPrompt = (q: string) => new Promise<string>(res => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(q, a => { rl.close(); res(a); });
    });

    let abdContent  = loadABDMasterConfig();
    const alEntries = loadAlAppConfig();
    const usedPorts = getUsedPorts(alEntries);
    let abdModified = false;
    let alModified  = false;

    for (const keyword of keywords) {
        const pcName = `${keyword.toUpperCase()}${suffix}`;
        console.log(`\n🔍 Processing: ${pcName}`);

        // ── Compute changes for both files ────────────────────────────────────
        const abdChange = computeABDMasterConfigChange(
            abdContent, airport.toUpperCase(), airline.toUpperCase(), pcName
        );
        // Look up the config-supplied default kiosk ID for this keyword (case-insensitive)
        const configKioskId = keywordKioskIds[keyword] ?? keywordKioskIds[keyword.toUpperCase()] ?? undefined;
        const alChange = await computeAlAppConfigChange(
            alEntries, airport.toUpperCase(), airline.toUpperCase(), pcName, keyword, usedPorts, configKioskId
        );

        if (!abdChange && !alChange) {
            console.log(`   ℹ️  Nothing to change for ${pcName}.`);
            continue;
        }

        // ── Build combined diff content ───────────────────────────────────────
        const lines: string[] = [];

        if (abdChange) {
            lines.push(
                sep,
                `  [ABDMasterConfig] BEFORE — DEFAULT block for ${pcName}:`,
                sep,
                abdChange.originalBlock,
                '',
                sep,
                `  [ABDMasterConfig] AFTER  — DEFAULT block for ${pcName}:`,
                sep,
                abdChange.updatedBlock,
                sep,
            );
        } else {
            lines.push(sep, `  [ABDMasterConfig] No changes required for ${pcName}.`, sep);
        }

        lines.push('');

        if (alChange) {
            const folderNote = fs.existsSync(alChange.cussFolder)
                ? 'EXISTS — no copy needed'
                : `MISSING → will copy from template`;
            lines.push(
                sep,
                `  [AlAppConfig] BEFORE — entry for ${pcName}:`,
                sep,
                alChange.originalEntry ? JSON.stringify(alChange.originalEntry, null, 2) : '(no existing entry)',
                '',
                sep,
                `  [AlAppConfig] AFTER  — entry for ${pcName}:`,
                sep,
                JSON.stringify(alChange.newEntry, null, 2),
                sep,
                '',
                `  CussConnector folder : ${alChange.cussFolder}`,
                `  Folder status        : ${folderNote}`,
            );
        } else {
            lines.push(sep, `  [AlAppConfig] No changes required for ${pcName}.`, sep);
        }

        // ── Write combined diff to a single temp file ─────────────────────────
        const tmpFile = path.join(os.tmpdir(), `setup-diff-${pcName}-${Date.now()}.txt`);
        fs.writeFileSync(tmpFile, lines.join('\n'), 'utf-8');
        console.log(`\n📄 Combined diff for ${pcName} written to: ${tmpFile}`);

        // ── Single confirmation prompt ────────────────────────────────────────
        const confirm = await rlPrompt(`\nProceed with all changes for ${pcName}? (y to confirm): `);
        if (confirm.trim() !== 'y') {
            console.log(`⏭️  Skipping ${pcName}.`);
            continue;
        }

        // ── Apply ─────────────────────────────────────────────────────────────
        if (abdChange) {
            abdContent  = applyABDMasterConfigChange(abdContent, abdChange);
            abdModified = true;
            console.log(`   ✅ ABDMasterConfig change staged for ${pcName}.`);
        }
        if (alChange) {
            console.log(`   🔧 Applying AlAppConfig change for ${pcName} (entryIndex=${alChange.entryIndex})...`);
            applyAlAppConfigChange(alEntries, alChange);
            applyAlAppConfigCussFolder(alChange);
            usedPorts.push({ port: alChange.port, airport: airport.toUpperCase() });
            usedPorts.sort((a, b) => a.port - b.port);
            alModified = true;
            console.log(`   ✅ AlAppConfig change staged. alEntries length=${alEntries.length}`);
        } else {
            console.log(`   ⚠️  alChange is null — AlAppConfig will NOT be modified for ${pcName}.`);
        }
    }

    // ── Save files ────────────────────────────────────────────────────────────
    console.log(`\n💾 abdModified=${abdModified}  alModified=${alModified}`);

    if (abdModified) saveABDMasterConfig(abdContent);
    else console.log('ℹ️  No changes required in ABDMasterConfig.');

    if (alModified) {
        console.log(`💾 Writing AlAppConfig.json (${alEntries.length} entries)...`);
        saveAlAppConfig(alEntries);
    } else {
        console.log('ℹ️  No changes required in AlAppConfig.json.');
    }

    console.log('');
    console.log('✅ Environment setup complete. Playwright tests can now start.');
    console.log('');
})();