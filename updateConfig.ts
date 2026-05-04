import * as fs from 'fs';

// ─── Path ─────────────────────────────────────────────────────────────────────
const ABD_MASTER_CONFIG_PATH =
    'C:\\Program Files (x86)\\ICM CUSS Platform\\v3.14.0\\ABDMasterConfig.cfg';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface ABDMasterConfigChange {
    pcName           : string;
    originalBlock    : string;
    updatedBlock     : string;
    firstAbdConfigIdx: number;
    firstAbdConfigEnd: number;
}

// ─── Load ─────────────────────────────────────────────────────────────────────
export function loadABDMasterConfig(): string {
    if (!fs.existsSync(ABD_MASTER_CONFIG_PATH)) {
        console.error(`❌ ABDMasterConfig not found at: ${ABD_MASTER_CONFIG_PATH}`);
        process.exit(1);
    }
    try {
        return fs.readFileSync(ABD_MASTER_CONFIG_PATH, 'utf-8');
    } catch (error) {
        console.error(`❌ Failed to read ABDMasterConfig:`, error);
        process.exit(1);
    }
}

// ─── Compute (pure — no I/O side-effects) ────────────────────────────────────
export function computeABDMasterConfigChange(
    content: string,
    airport: string,
    airline: string,
    pcName : string
): ABDMasterConfigChange | null {

    const pcNameIdx = content.indexOf(`ComputerName="${pcName}"`);
    if (pcNameIdx === -1) {
        console.warn(`⚠️  ComputerName="${pcName}" not found in ABDMasterConfig. Skipping.`);
        return null;
    }

    const abdConfigsOpenIdx = content.lastIndexOf('<ABDConfigs>', pcNameIdx);
    if (abdConfigsOpenIdx === -1) {
        console.warn(`⚠️  <ABDConfigs> opening tag not found before ${pcName}. Skipping.`);
        return null;
    }

    const firstAbdConfigIdx = content.indexOf('<ABDConfig ', abdConfigsOpenIdx);
    if (firstAbdConfigIdx === -1 || firstAbdConfigIdx >= pcNameIdx) {
        console.warn(`⚠️  No DEFAULT <ABDConfig> entry found before ${pcName}. Skipping.`);
        return null;
    }

    const firstAbdConfigEnd =
        content.indexOf('</ABDConfig>', firstAbdConfigIdx) + '</ABDConfig>'.length;
    if (firstAbdConfigEnd < '</ABDConfig>'.length) {
        console.warn(`⚠️  Could not find closing </ABDConfig> for DEFAULT block. Skipping.`);
        return null;
    }

    let defaultBlock = content.substring(firstAbdConfigIdx, firstAbdConfigEnd);
    const originalBlock = defaultBlock;
    let changed = false;

    // ── SupportedAirlines + SharedAppSupport ──────────────────────────────────
    const supportedMatch = defaultBlock.match(/SupportedAirlines="([^"]*)"/);
    if (!supportedMatch) {
        console.warn(`⚠️  SupportedAirlines attribute not found in DEFAULT block for ${pcName}. Skipping.`);
        return null;
    }

    const expectedSupportedAirlines = `${airport},${airline}`;
    if (supportedMatch[1] === expectedSupportedAirlines) {
        console.log(`   ✅ SupportedAirlines already set to "${expectedSupportedAirlines}" for ${pcName}.`);
    } else {
        defaultBlock = defaultBlock.replace(
            /SupportedAirlines="[^"]*"/,
            `SupportedAirlines="${expectedSupportedAirlines}"`
        );

        // Replace the entire content inside <SharedAppSupport> with a single airline entry
        const sharedAppMatch = defaultBlock.match(/<SharedAppSupport>([\s\S]*?)<\/SharedAppSupport>/);
        if (sharedAppMatch) {
            const existingEntryMatch = sharedAppMatch[1].match(/^([ \t]*)<Airline /m);
            const entryIndent = existingEntryMatch ? existingEntryMatch[1] : '              ';
            const closingTagMatch = defaultBlock.match(/([ \t]*)<\/SharedAppSupport>/);
            const closingIndent = closingTagMatch ? closingTagMatch[1] : '            ';
            const newAirlineEntry = `${entryIndent}<Airline Name="${airline}" SharedAirline="${airport}" />`;
            defaultBlock = defaultBlock.replace(
                /<SharedAppSupport>[\s\S]*?<\/SharedAppSupport>/,
                `<SharedAppSupport>\n${newAirlineEntry}\n${closingIndent}</SharedAppSupport>`
            );
        } else {
            console.warn(`⚠️  <SharedAppSupport> block not found in DEFAULT block for ${pcName}. SupportedAirlines was updated but SharedAppSupport was not modified.`);
        }

        console.log(`   ✏️  Set SupportedAirlines="${expectedSupportedAirlines}" and updated SharedAppSupport for ${pcName}.`);
        changed = true;
    }

    // ── Ensure IsDevEnv="true" is present ───────────────────────────────────
    if (!/IsDevEnv="/.test(defaultBlock)) {
        defaultBlock = defaultBlock.replace(
            /(<ABDConfig\b[^>]*?)(\/?>)/,
            `$1 IsDevEnv="true"$2`
        );
        console.log(`   ➕ Added IsDevEnv="true" to DEFAULT block for ${pcName}.`);
        changed = true;
    } else if (/IsDevEnv="true"/.test(defaultBlock)) {
        console.log(`   ✅ IsDevEnv="true" already present for ${pcName}.`);
    } else {
        defaultBlock = defaultBlock.replace(/IsDevEnv="[^"]*"/, `IsDevEnv="true"`);
        console.log(`   ✏️  IsDevEnv was not "true" — corrected to IsDevEnv="true" for ${pcName}.`);
        changed = true;
    }

    // ── Ensure AmadeusKioskBelt="true" is present ────────────────────────────
    if (!/AmadeusKioskBelt="/.test(defaultBlock)) {
        defaultBlock = defaultBlock.replace(
            /(<ABDConfig\b[^>]*?)(\/?>)/,
            `$1 AmadeusKioskBelt="true"$2`
        );
        console.log(`   ➕ Added AmadeusKioskBelt="true" to DEFAULT block for ${pcName}.`);
        changed = true;
    } else if (/AmadeusKioskBelt="true"/.test(defaultBlock)) {
        console.log(`   ✅ AmadeusKioskBelt="true" already present for ${pcName}.`);
    } else {
        console.log(`   ⚠️  AmadeusKioskBelt attribute found but is NOT "true" for ${pcName} — left unchanged.`);
    }

    if (!changed) {
        console.log(`   ℹ️  DEFAULT block for ${pcName} requires no changes.`);
        return null;
    }

    return { pcName, originalBlock, updatedBlock: defaultBlock, firstAbdConfigIdx, firstAbdConfigEnd };
}

// ─── Apply ────────────────────────────────────────────────────────────────────
export function applyABDMasterConfigChange(
    content: string,
    change : ABDMasterConfigChange
): string {
    return (
        content.substring(0, change.firstAbdConfigIdx) +
        change.updatedBlock +
        content.substring(change.firstAbdConfigEnd)
    );
}

// ─── Save ─────────────────────────────────────────────────────────────────────
export function saveABDMasterConfig(content: string): void {
    try {
        fs.writeFileSync(ABD_MASTER_CONFIG_PATH, content, 'utf-8');
        console.log(`\n✅ ABDMasterConfig saved successfully.`);
    } catch (error) {
        console.error(`❌ Failed to write ABDMasterConfig:`, error);
        process.exit(1);
    }
}