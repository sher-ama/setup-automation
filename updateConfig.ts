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
import { ABD_MASTER_CONFIG_PATH } from './paths.config';

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
/**
 * Computes the changes needed to the DEFAULT `<ABDConfig>` XML block for the
 * given PC name without touching the file system.
 *
 * Changes applied:
 *   - Sets `SupportedAirlines` to `"<airport>,<airline>"`.
 *   - Replaces `<SharedAppSupport>` content with a single matching entry.
 *   - Ensures `IsDevEnv="true"` is present on the `<ABDConfig>` element.
 *   - Ensures `AmadeusKioskBelt="true"` is present on the `<ABDConfig>` element.
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