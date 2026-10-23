/**
 * @file updateConfig.ts
 * @description Reads, modifies, and saves ABDMasterConfig.cfg for a given
 *              PC name / airport / airline combination.
 *
 * The module follows a pure-compute + explicit-apply pattern:
 *   1. {@link loadABDMasterConfig}          — read the file into memory
 *   2. {@link computeABDMasterConfigChange} — diff the relevant XML block (no I/O)
 *   3. {@link applyABDMasterConfigChange}   — splice the change back into the string
 *   4. {@link saveABDMasterConfig}          — write the result to disk
 *
 * All file paths are sourced from {@link ./paths.config}.
 */

import * as fs from 'fs';
import { ABD_MASTER_CONFIG_ARCHIVE_PATH, ABD_MASTER_CONFIG_PATH } from './paths.config';

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Describes a pending change to the DEFAULT `<ABDConfig>` block inside
 * ABDMasterConfig.cfg for a single PC name.
 */
export interface ABDMasterConfigChange {
    /** The fully-qualified PC name the change targets (e.g. `WSIT1SIMULATOR`). */
    pcName           : string;
    /** Original XML text of the DEFAULT `<ABDConfig>` block, before any edits. */
    originalBlock    : string;
    /** Updated XML text that should replace `originalBlock`. */
    updatedBlock     : string;
    /** Character offset in the full file where the DEFAULT `<ABDConfig>` tag starts. */
    firstAbdConfigIdx: number;
    /** Character offset in the full file immediately after `</ABDConfig>`. */
    firstAbdConfigEnd: number;
}

// ─── Load ─────────────────────────────────────────────────────────────────────
/**
 * Reads ABDMasterConfig.cfg from disk and returns its full contents as a string.
 *
 * @returns The raw file contents.
 * @throws Calls `process.exit(1)` if the file is missing or unreadable.
 */
export function loadABDMasterConfig(): string {
    if (!fs.existsSync(ABD_MASTER_CONFIG_PATH)) {
        if (!fs.existsSync(ABD_MASTER_CONFIG_ARCHIVE_PATH)) {
            console.error(`❌ ABDMasterConfig not found at: ${ABD_MASTER_CONFIG_PATH}`);
            console.error(`❌ Archive fallback not found at: ${ABD_MASTER_CONFIG_ARCHIVE_PATH}`);
            process.exit(1);
        }
        try {
            fs.copyFileSync(ABD_MASTER_CONFIG_ARCHIVE_PATH, ABD_MASTER_CONFIG_PATH);
            console.log(`   📦 Restored ABDMasterConfig from Archive: ${ABD_MASTER_CONFIG_ARCHIVE_PATH}`);
        } catch (error) {
            console.error(`❌ Failed to restore ABDMasterConfig from Archive:`, error);
            process.exit(1);
        }
    }
    try {
        return fs.readFileSync(ABD_MASTER_CONFIG_PATH, 'utf-8');
    } catch (error) {
        console.error(`❌ Failed to read ABDMasterConfig:`, error);
        process.exit(1);
    }
}

// ─── Compute (pure — no I/O side-effects) ────────────────────────────────────
/**
 * Computes the changes needed to the DEFAULT `<ABDConfig>` XML block for the
 * given PC name without touching the file system.
 *
 * Changes applied:
 *   - Preserves the existing `SupportedAirlines` list and appends the new airline.
 *   - Preserves existing `<SharedAppSupport>` entries and appends the new entry.
 *   - Ensures `IsDevEnv="true"` is present on the `<ABDConfig>` element.
 *   - Ensures `AmadeusKioskBelt` is set: appends the airline to a comma-separated string value, or keeps `"true"` as-is.
 *
 * @param content - Full text of ABDMasterConfig.cfg.
 * @param airport - IATA airport code (e.g. `WSI`).
 * @param airline - Airline code (e.g. `QF`).
 * @param pcName  - Fully-qualified PC name (e.g. `WSIT1SIMULATOR`).
 * @returns A {@link ABDMasterConfigChange} describing the diff, or `null` if no
 *          changes are needed or the PC name cannot be located.
 */
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

    const existingAirlines = supportedMatch[1]
        .split(',')
        .map(value => value.trim())
        .filter(Boolean);
    const hasAirline = existingAirlines.includes(airline);
    const updatedSupportedAirlines = hasAirline
        ? supportedMatch[1]
        : `${supportedMatch[1]},${airline}`;

    if (hasAirline) {
        console.log(`   ✅ SupportedAirlines already contains "${airline}" for ${pcName}.`);
    } else {
        defaultBlock = defaultBlock.replace(
            /SupportedAirlines="[^"]*"/,
            `SupportedAirlines="${updatedSupportedAirlines}"`
        );

        // Preserve existing entries and append the new airline when it is absent.
        const sharedAppMatch = defaultBlock.match(/<SharedAppSupport>([\s\S]*?)<\/SharedAppSupport>/);
        if (sharedAppMatch) {
            const hasSharedAppEntry = new RegExp(`<Airline\\s+Name="${airline}"\\b`).test(sharedAppMatch[1]);
            if (!hasSharedAppEntry) {
                const existingEntryMatch = sharedAppMatch[1].match(/^([ \t]*)<Airline /m);
                const entryIndent = existingEntryMatch ? existingEntryMatch[1] : '              ';
                const newAirlineEntry = `${entryIndent}<Airline Name="${airline}" SharedAirline="${airport}" />`;
                defaultBlock = defaultBlock.replace(
                    /([ \t]*)<\/SharedAppSupport>/,
                    `${newAirlineEntry}\n$1</SharedAppSupport>`
                );
            }
        } else {
            console.warn(`⚠️  <SharedAppSupport> block not found in DEFAULT block for ${pcName}. SupportedAirlines was updated but SharedAppSupport was not modified.`);
        }

        console.log(`   ✏️  Preserved existing airlines and appended "${airline}" for ${pcName}.`);
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

    // ── Ensure AmadeusKioskBelt is set ───────────────────────────────────────
    const kioskBeltMatch = defaultBlock.match(/AmadeusKioskBelt="([^"]*)"/); 
    if (!kioskBeltMatch) {
        defaultBlock = defaultBlock.replace(
            /(<ABDConfig\b[^>]*?)(\/?>)/,
            `$1 AmadeusKioskBelt="true"$2`
        );
        console.log(`   ➕ Added AmadeusKioskBelt="true" to DEFAULT block for ${pcName}.`);
        changed = true;
    } else if (kioskBeltMatch[1] === 'true') {
        console.log(`   ✅ AmadeusKioskBelt="true" already present for ${pcName}.`);
    } else {
        // Value is a comma-separated string of airline codes
        const kioskBeltCodes = kioskBeltMatch[1].split(',').map(s => s.trim());
        if (kioskBeltCodes.includes(airline)) {
            console.log(`   ✅ AmadeusKioskBelt already contains "${airline}" for ${pcName}.`);
        } else {
            const newValue = `${kioskBeltMatch[1]},${airline}`;
            defaultBlock = defaultBlock.replace(
                /AmadeusKioskBelt="[^"]*"/,
                `AmadeusKioskBelt="${newValue}"`
            );
            console.log(`   ✏️  Appended "${airline}" to AmadeusKioskBelt for ${pcName}.`);
            changed = true;
        }
    }

    if (!changed) {
        console.log(`   ℹ️  DEFAULT block for ${pcName} requires no changes.`);
        return null;
    }

    return { pcName, originalBlock, updatedBlock: defaultBlock, firstAbdConfigIdx, firstAbdConfigEnd };
}

export function computeABDAccessibilityChange(
    content: string,
    pcName: string = 'ABD-DEFAULT'
): ABDMasterConfigChange | null {
    const addMissing = pcName === 'ABD-DEFAULT';
    const openingTag = Array.from(content.matchAll(/<ABDConfig\b[^>]*\bComputerName\s*=\s*(["'])(.*?)\1[^>]*>/g))
        .find(match => match[2] === pcName);
    if (!openingTag) {
        if (!addMissing) return null;
        throw new Error('Cannot enable accessibility: ABD-DEFAULT block was not found.');
    }
    if (!addMissing && openingTag[0].endsWith('/>')) return null;
    const firstAbdConfigIdx = openingTag.index;
    const closingIdx = content.indexOf('</ABDConfig>', firstAbdConfigIdx);
    if (openingTag[0].endsWith('/>') || closingIdx === -1) {
        throw new Error(`Cannot enable accessibility: ${pcName} block requires a closing </ABDConfig>.`);
    }
    const firstAbdConfigEnd = closingIdx + '</ABDConfig>'.length;
    const originalBlock = content.substring(firstAbdConfigIdx, firstAbdConfigEnd);
    let defaultBlock = originalBlock;
    let changed = false;
    const settings: Record<string, Record<string, string>> = {
        TextToSpeech: {
            Disable: 'false', VolumeLevel: '50', VoiceGenderDeviceHelp: 'female', SpeechRate: '0',
        },
        NavigationPad: {
            Disable: 'false', NavigationPadModel: 'Navbar', UseDeviceSimulator: 'true',
            IsDedicatedtoAccessible: 'true',
        },
    };
    for (const [elementName, attributes] of Object.entries(settings)) {
        const elementPattern = new RegExp(`<${elementName}\\b[^>]*>`);
        const existingElement = defaultBlock.match(elementPattern);
        if (existingElement) {
            let updatedElement = existingElement[0];
            for (const [attributeName, value] of Object.entries(attributes)) {
                const attributePattern = new RegExp(`(\\s${attributeName}\\s*=\\s*)(["'])[^"']*\\2`);
                updatedElement = attributePattern.test(updatedElement)
                    ? updatedElement.replace(attributePattern, `$1"${value}"`)
                    : updatedElement.replace(/(\s*\/?>)$/, ` ${attributeName}="${value}"$1`);
            }
            if (updatedElement !== existingElement[0]) {
                defaultBlock = defaultBlock.replace(elementPattern, () => updatedElement);
                changed = true;
            }
        } else if (addMissing) {
            const newElement = `<${elementName} ${Object.entries(attributes)
                .map(([attributeName, value]) => `${attributeName}="${value}"`).join(' ')} />`;
            const closingIndent = defaultBlock.match(/(?:\r?\n)([ \t]*)<\/ABDConfig>/)?.[1] ?? '';
            const newline = defaultBlock.includes('\r\n') ? '\r\n' : '\n';
            defaultBlock = defaultBlock.replace(
                /[ \t]*<\/ABDConfig>/,
                `${closingIndent}  ${newElement}${newline}${closingIndent}</ABDConfig>`
            );
            changed = true;
        }
    }
    if (!changed) {
        console.log(`   ℹ️  Accessibility block for ${pcName} requires no changes.`);
        return null;
    }

    return { pcName, originalBlock, updatedBlock: defaultBlock, firstAbdConfigIdx, firstAbdConfigEnd };
}

// ─── Apply ────────────────────────────────────────────────────────────────────
/**
 * Splices the updated XML block from `change` back into the full config string
 * and returns the new file contents.  Pure function — does not write to disk.
 *
 * @param content - Current full text of ABDMasterConfig.cfg.
 * @param change  - A {@link ABDMasterConfigChange} produced by
 *                  {@link computeABDMasterConfigChange}.
 * @returns Updated full text with the DEFAULT block replaced.
 */
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
/**
 * Writes the supplied content string to ABDMasterConfig.cfg on disk.
 *
 * @param content - Updated full text to persist.
 * @throws Calls `process.exit(1)` on write failure.
 */
export function saveABDMasterConfig(content: string): void {
    try {
        fs.writeFileSync(ABD_MASTER_CONFIG_PATH, content, 'utf-8');
        console.log(`\n✅ ABDMasterConfig saved successfully.`);
    } catch (error) {
        console.error(`❌ Failed to write ABDMasterConfig:`, error);
        process.exit(1);
    }
}