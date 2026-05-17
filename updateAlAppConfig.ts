/**
 * @file updateAlAppConfig.ts
 * @description Manages entries in AlAppConfig.json for the ICM CUSS Platform.
 *
 * Responsibilities:
 *   - Enumerate CUSSConnectorService-* Windows services to build a live port map.
 *   - Auto-detect the port for a given airport from the Procrun registry key.
 *   - Prompt the operator for any values that cannot be auto-detected.
 *   - Compute, apply, and persist AlAppConfig.json entry changes.
 *   - Create the airport-specific CussConnector directory from a template if absent.
 *
 * The module follows a pure-compute + explicit-apply pattern:
 *   1. loadAlAppConfig          - read AlAppConfig.json into memory
 *   2. getUsedPorts             - enumerate ports from live Windows services
 *   3. computeAlAppConfigChange - diff / build the new entry (prompts user)
 *   4. applyAlAppConfigChange   - splice the change into the in-memory array
 *   5. applyAlAppConfigCussFolder - create the CussConnector folder if needed
 *   6. saveAlAppConfig          - write the updated array back to disk
 *
 * All file paths and defaults are sourced from paths.config.ts.
 */

import * as fs       from 'fs';
import * as path     from 'path';
import * as readline from 'readline';
import { execSync }  from 'child_process';
import {
    AL_APP_CONFIG_PATH,
    CUSS_CONNECTOR_ROOT,
    CUSS_CONNECTOR_TEMPLATE,
    CHROME_EXE,
    CHROME_FLAGS,
    DEFAULT_BASE_URL,
    PROCRUN_BASE,
} from './paths.config';

// ─── Types ────────────────────────────────────────────────────────────────────────────────

/**
 * Describes a pending change to a single AlAppConfig.json entry.
 * A negative `entryIndex` (-1) indicates a new entry to be appended.
 */
export interface AlAppConfigChange {
    /** Fully-qualified PC name (e.g. `WSIT1SIMULATOR`). */
    pcName       : string;
    /** Index of the matching entry in the entries array, or -1 if new. */
    entryIndex   : number;
    /** The original entry object, or `null` if no existing entry was found. */
    originalEntry: any | null;
    /** The fully-built entry object to write. */
    newEntry     : any;
    /** Absolute path to the airport-specific CussConnector folder. */
    cussFolder   : string;
    /** CUSSConnector port number to embed in the launch URL. */
    port         : number;
}

/**
 * Associates a CUSSConnector port number with the airport that owns it,
 * as read from the Windows service registry.
 */
export interface UsedPortInfo {
    port   : number;
    airport: string;
}

// ─── Helper: prompt ───────────────────────────────────────────────────────────
/**
 * Prompts the user with `question` and resolves with the trimmed answer.
 * Creates a fresh readline interface per call so it can be used in sequence.
 */
function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

/**
 * Reads the `-DPort=` value from the Procrun registry `Options` entry for a
 * given airport's CUSSConnectorService.
 *
 * @param airport - IATA airport code suffix of the service name
 *                  (e.g. `WSI` for `CUSSConnectorService-WSI`).
 * @returns The port number, or `null` if the key/value is absent.
 */
function getPortFromRegistry(airport: string): number | null {
    const regPath = `${PROCRUN_BASE}\\CUSSConnectorService-${airport}\\Parameters\\Java`;
    try {
        const output = execSync(`reg query "${regPath}" /v Options`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const match = output.match(/-DPort=(\d+)/);
        if (match) return parseInt(match[1], 10);
    } catch {
        // Service not registered on this machine — caller will fall back to manual prompt
    }
    return null;
}

// ─── Helper: check whether a Windows service exists (any state) ───────────────
/**
 * Checks whether a named Windows service exists (in any state) using `sc query`.
 *
 * @param serviceName - The Windows service name to look up.
 * @returns `true` if the service is registered, `false` otherwise.
 */
function serviceExists(serviceName: string): boolean {
    try {
        execSync(`sc query "${serviceName}"`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        return true;
    } catch {
        return false;
    }
}

// ─── Helper: recursive directory copy ────────────────────────────────────────
/**
 * Recursively copies `src` directory into `dest`, creating it if necessary.
 *
 * @param src  - Absolute path to the source directory.
 * @param dest - Absolute path to the destination directory.
 */
function copyDirRecursive(src: string, dest: string): void {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
        const srcItem  = path.join(src, item);
        const destItem = path.join(dest, item);
        if (fs.statSync(srcItem).isDirectory()) {
            copyDirRecursive(srcItem, destItem);
        } else {
            fs.copyFileSync(srcItem, destItem);
        }
    }
}

// ─── Load ─────────────────────────────────────────────────────────────────────
/**
 * Reads AlAppConfig.json from disk and returns the parsed array of app entries.
 *
 * @returns Parsed JSON array (each element is an AlApp entry object).
 * @throws Calls `process.exit(1)` if the file is missing or unparseable.
 */
export function loadAlAppConfig(): any[] {
    if (!fs.existsSync(AL_APP_CONFIG_PATH)) {
        console.error(`❌ AlAppConfig.json not found at: ${AL_APP_CONFIG_PATH}`);
        process.exit(1);
    }
    try {
        return JSON.parse(fs.readFileSync(AL_APP_CONFIG_PATH, 'utf-8'));
    } catch (error) {
        console.error(`❌ Failed to parse AlAppConfig.json:`, error);
        process.exit(1);
    }
}

// ─── Utility: collect ports already used by enumerating Windows services ──────
// Queries all CUSSConnectorService-* subkeys under the Procrun 2.0 registry
// key, extracts the airport suffix and -DPort= value from each one.
/**
 * Enumerates all `CUSSConnectorService-*` subkeys under the Procrun 2.0
 * registry base path, extracts the airport code from each service name, and
 * reads the associated `-DPort=` value from the service's Java Options.
 *
 * Only services that actually have a port registered are included.
 *
 * @returns Array of {@link UsedPortInfo} sorted ascending by port number.
 */
export function getUsedPorts(): UsedPortInfo[] {
    const results: UsedPortInfo[] = [];
    try {
        const output = execSync(`reg query "${PROCRUN_BASE}"`, {
            encoding: 'utf-8',
            stdio: ['pipe', 'pipe', 'pipe'],
        });
        const lines = output.split(/\r?\n/);
        for (const line of lines) {
            // Each line is a full registry path; match subkeys named CUSSConnectorService-<airport>
            const svcMatch = line.trim().match(/CUSSConnectorService-([A-Z0-9]+)$/i);
            if (!svcMatch) continue;
            const airport   = svcMatch[1].toUpperCase();
            // Skip if the Windows service no longer exists (stale registry key)
            if (!serviceExists(`CUSSConnectorService-${airport}`)) continue;
            const detectedPort = getPortFromRegistry(airport);
            if (detectedPort !== null) {
                results.push({ port: detectedPort, airport });
            }
        }
    } catch {
        // Procrun base key not found — no CUSS services installed
    }
    return results.sort((a, b) => a.port - b.port);
}

// ─── Compute (prompts user, returns change or null if skipped) ────────────────
/**
 * Interactively computes the AlAppConfig.json change needed for a given PC name.
 *
 * Steps performed:
 *   1. Locates any existing entry for `pcName` (matched on `ABDID`).
 *   2. Displays ports already in use (sourced from live Windows services).
 *   3. Auto-detects the CUSSConnector port via `sc query` + registry; falls back
 *      to a manual prompt if the service is absent or the port is not registered.
 *   4. Prompts for the KioskID URL suffix and base URL (defaults supplied).
 *   5. Builds the full PathOrURL Chrome launch string and the new entry object.
 *
 * @param entries        - Current AlAppConfig.json entry array (not mutated here).
 * @param airport        - IATA airport code (e.g. `WSI`).
 * @param airline        - Airline code (e.g. `QF`).
 * @param pcName         - Fully-qualified PC name (e.g. `WSIT1SIMULATOR`).
 * @param keyword        - Setup keyword used to derive the terminal tag.
 * @param usedPorts      - List of ports already assigned (for display only).
 * @param defaultKioskId - Optional kiosk ID from `setup.config.json`; overrides
 *                         the derived `<airport><terminalNum>ABD01` default.
 * @returns A {@link AlAppConfigChange} ready to be applied, or `null` if the
 *          operator skipped (invalid / empty port input).
 */
export async function computeAlAppConfigChange(
    entries        : any[],
    airport        : string,
    airline        : string,
    pcName         : string,
    keyword        : string,
    usedPorts      : UsedPortInfo[],
    defaultKioskId?: string            // from setup.config.json keywordKioskIds
): Promise<AlAppConfigChange | null> {

    // Derive terminal tag: strip airport prefix from keyword
    // e.g. keyword=WSIT1, airport=WSI → terminalTag="T1", terminalNum="1"
    const terminalTag = keyword.toUpperCase().replace(airport.toUpperCase(), '');
    const terminalNum = terminalTag.replace(/[^0-9]/g, '');

    // Locate existing entry — update it regardless of IsComment; create if absent
    const entryIndex = entries.findIndex((e: any) => e.ABDID === pcName);
    if (entryIndex !== -1) {
        const isActive = entries[entryIndex].IsComment === false;
        console.log(`   ℹ️  Entry for "${pcName}" found (IsComment=${entries[entryIndex].IsComment}) — will update it${isActive ? '' : ' and activate it'}.`);
    } else {
        console.log(`   ℹ️  No entry for "${pcName}" found — will create and add a new entry.`);
    }

    // Show ports already taken — sourced from live Windows services
    if (usedPorts.length) {
        const uniquePorts = [...new Set(usedPorts.map(p => p.port))].sort((a, b) => a - b);
        console.log(`\n   ℹ️  Ports already used (from Windows services): ${uniquePorts.join(', ')}`);
    } else {
        console.log(`\n   ℹ️  Ports already used: (no CUSSConnectorService-* entries found in Windows services)`);
    }

    // Auto-detect port: verify service exists via sc query, then read port from registry
    let port: number;
    const serviceName  = `CUSSConnectorService-${airport}`;
    const svcPresent   = serviceExists(serviceName);
    const detectedPort = svcPresent ? getPortFromRegistry(airport) : null;

    if (svcPresent) {
        if (detectedPort !== null) {
            console.log(`\n   🔍 Windows service "${serviceName}" found. Auto-detected port: ${detectedPort}.`);
            const portOverride = await prompt(`   Press Enter to use port ${detectedPort}, or type a different port: `);
            const overrideVal  = parseInt(portOverride.trim(), 10);
            port = isNaN(overrideVal) ? detectedPort : overrideVal;
        } else {
            console.warn(`\n   ⚠️  Windows service "${serviceName}" exists but -DPort= was not found in its registry Options.`);
            const portStr = await prompt(`   Enter CussConnector port for ${pcName}: `);
            port = parseInt(portStr.trim(), 10);
            if (isNaN(port)) {
                console.warn(`⚠️  Invalid port "${portStr}". Skipping ${pcName}.`);
                return null;
            }
        }
    } else {
        console.warn(`\n   ⚠️  Windows service "${serviceName}" not found — enter port manually.`);
        const portStr = await prompt(`   Enter CussConnector port for ${pcName}: `);
        port = parseInt(portStr.trim(), 10);
        if (isNaN(port)) {
            console.warn(`⚠️  Invalid port "${portStr}". Skipping ${pcName}.`);
            return null;
        }
    }

    // Prompt: kiosk identifier (URL suffix)
    // If a default is provided via config, show it; otherwise fall back to derived pattern
    const derivedDefault = `${airport.toUpperCase()}${terminalNum}ABD01`;
    const effectiveDefault = defaultKioskId ?? derivedDefault;
    const kioskInput   = await prompt(`   Enter KioskID URL suffix (d = default: ${effectiveDefault}): `);
    const kioskId      = (kioskInput.trim() === '' || kioskInput.trim().toLowerCase() === 'd')
        ? effectiveDefault
        : kioskInput.trim();

    // Prompt: base URL — Enter or "d" = use default from paths.config
    const baseUrlInput = await prompt(`   Enter base URL (d = default: ${DEFAULT_BASE_URL}): `);
    const baseUrlRaw   = baseUrlInput.trim();
    const baseUrl      = (baseUrlRaw === '' || baseUrlRaw.toLowerCase() === 'd')
        ? DEFAULT_BASE_URL
        : baseUrlRaw;

    // Build PathOrURL
    const appUrl      = `${baseUrl}/AirBagDropAppWebServer/AirBagDropAppWebServerService/AirlineApp/${airport}/${airport}/${terminalTag}/${kioskId}?cussConnectorPort=${port}`;
    const userDataDir = `--user-data-dir"C:\\CUSSUsers\\${airport}\\Local\\Google\\Chrome\\User Data"`;
    const pathOrURL   = `${CHROME_EXE} ${CHROME_FLAGS} ${userDataDir} ${appUrl}`;

    // CussConnector folder is named after the airport (e.g. C:/Cussconnector/WSI/)
    const cussFolder  = path.join(CUSS_CONNECTOR_ROOT, airport);
    const startAuxApp = `C:/Cussconnector/${airport}/StartService.bat install ${port} ${airport}`;
    const stopAuxApp  = `C:/Cussconnector/${airport}/StopService.bat Stop ${airport}`;

    const newEntry = {
        AirlineID           : airport,  // AirlineID = airport code (e.g. WSI, MUC)
        CompanyID           : 'ICM-AirApp',
        IsAdmin             : true,
        IsAlApp             : true,
        ABDID               : pcName,
        KioskID             : pcName,
        PathOrURL           : pathOrURL,
        StartAuxApp         : startAuxApp,
        StopAuxApp          : stopAuxApp,
        AlAppMainWindowTitle: '',
        GuiAppLaunchDelay   : 0,
        IsComment           : false,
    };

    return { pcName, entryIndex, originalEntry: entryIndex !== -1 ? entries[entryIndex] : null, newEntry, cussFolder, port };
}

// ─── Apply: update entries array in-place ─────────────────────────────────────
/**
 * Applies a computed change to the in-memory `entries` array.
 *
 * Side-effects:
 *   - Sets `IsComment: true` on **all** existing entries (deactivates them).
 *   - Either updates the entry at `change.entryIndex` in-place, or appends
 *     `change.newEntry` as a new element if `entryIndex` is -1.
 *
 * @param entries - The AlAppConfig.json entry array (mutated in-place).
 * @param change  - A {@link AlAppConfigChange} produced by
 *                  {@link computeAlAppConfigChange}.
 */
export function applyAlAppConfigChange(entries: any[], change: AlAppConfigChange): void {
    // Set IsComment=true for all existing entries before applying our change
    for (const entry of entries) {
        if (typeof entry === 'object' && entry !== null && 'IsComment' in entry) {
            entry.IsComment = true;
        }
    }

    if (change.entryIndex !== -1) {
        entries[change.entryIndex] = change.newEntry;
        console.log(`   ✏️  Existing AlAppConfig entry updated for ${change.pcName}`);
    } else {
        entries.push(change.newEntry);
        console.log(`   ✏️  New AlAppConfig entry appended for ${change.pcName}`);
    }
}

// ─── Apply: create CussConnector folder from template ────────────────────────
/**
 * Creates the airport-specific CussConnector folder by copying the template
 * directory, if the folder does not already exist.
 *
 * Folder path: `<CUSS_CONNECTOR_ROOT>/<airport>` (e.g. `C:\Cussconnector\WSI`).
 *
 * @param change - A {@link AlAppConfigChange} whose `cussFolder` property
 *                 specifies the target path.
 */
export function applyAlAppConfigCussFolder(change: AlAppConfigChange): void {
    if (!fs.existsSync(change.cussFolder)) {
        if (!fs.existsSync(CUSS_CONNECTOR_TEMPLATE)) {
            console.warn(`⚠️  Template folder not found at "${CUSS_CONNECTOR_TEMPLATE}". CussConnector folder NOT created.`);
        } else {
            copyDirRecursive(CUSS_CONNECTOR_TEMPLATE, change.cussFolder);
            console.log(`   📁 Created CussConnector folder: ${change.cussFolder}`);
        }
    } else {
        console.log(`   ✅ CussConnector folder already exists: ${change.cussFolder}`);
    }
}

// ─── Save ─────────────────────────────────────────────────────────────────────
/**
 * Serialises the `entries` array to JSON and writes it to AlAppConfig.json.
 *
 * @param entries - The complete, up-to-date AlAppConfig.json entry array.
 * @throws Calls `process.exit(1)` on serialisation or write failure.
 */
export function saveAlAppConfig(entries: any[]): void {
    console.log(`   Writing to: ${AL_APP_CONFIG_PATH}`);
    try {
        const json = JSON.stringify(entries, null, 2);
        console.log(`   JSON serialised OK (${json.length} chars). Writing file...`);
        fs.writeFileSync(AL_APP_CONFIG_PATH, json, 'utf-8');
        console.log(`\n✅ AlAppConfig.json saved successfully.`);
    } catch (error: any) {
        console.error(`❌ Failed to write AlAppConfig.json`);
        console.error(`   Path  : ${AL_APP_CONFIG_PATH}`);
        console.error(`   Error : ${error?.message ?? error}`);
        if (error?.code) console.error(`   Code  : ${error.code}`);
        process.exit(1);
    }
}
