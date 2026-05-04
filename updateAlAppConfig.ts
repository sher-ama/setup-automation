import * as fs       from 'fs';
import * as path     from 'path';
import * as readline from 'readline';
import { execSync }  from 'child_process';

// ─── Paths ────────────────────────────────────────────────────────────────────
const AL_APP_CONFIG_PATH      = 'C:\\Program Files (x86)\\ICM CUSS Platform\\v3.14.0\\AlAppConfig.json';
const CUSS_CONNECTOR_ROOT     = 'C:\\Cussconnector';
const CUSS_CONNECTOR_TEMPLATE = path.join(CUSS_CONNECTOR_ROOT, 'Airline1 - Copy');

// ─── Chrome path (single \-pairs; JSON.stringify produces the correct output) ──
const CHROME_EXE   = 'C:\\cussusers\\Chrome-bin119\\chrome.exe';
const CHROME_FLAGS = '--disable-background-timer-throttling --disable-renderer-backgrounding --disable-backgrounding-occluded-windows --disable-web-security --new-window --allow-outdated-plugins --disable-prompt-on-repost --no-default-browser-check --no-first-run --disable-translate --disable-background-networking --safebrowsing-disable-auto-update --safebrowsing-disable-download-protection --disable-client-side-phishing-detection --disable-component-update --disable-default-apps --noerrdialogs --allow-file-access --allow-running-insecure-content --always-authorize-plugins --disable-session-crashed-bubble --disable-infobars --disable-pinch --overscroll-history-navigation=0 --enable-npapi --disable-gpu --no-sandbox --user-data-dir';

// ─── Types ────────────────────────────────────────────────────────────────────
export interface AlAppConfigChange {
    pcName       : string;
    entryIndex   : number;      // -1 = new entry
    originalEntry: any | null;
    newEntry     : any;
    cussFolder   : string;
    port         : number;
}

// port → { airport } map so we can show which airport owns each port
export interface UsedPortInfo {
    port   : number;
    airport: string;
}

// ─── Helper: prompt ───────────────────────────────────────────────────────────
function prompt(question: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

// ─── Helper: read port from Windows registry ─────────────────────────────────
// Reads CUSSConnectorService-<airport>\Parameters\Java Options (REG_MULTI_SZ)
// and extracts the -DPort=XXXX value registered by prunsrv.
function getPortFromRegistry(airport: string): number | null {
    const regPath =
        `HKLM\\SOFTWARE\\WOW6432Node\\Apache Software Foundation\\Procrun 2.0` +
        `\\CUSSConnectorService-${airport}\\Parameters\\Java`;
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

// ─── Helper: recursive directory copy ────────────────────────────────────────
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

// ─── Utility: collect ports already used ─────────────────────────────────────
export function getUsedPorts(entries: any[]): UsedPortInfo[] {
    const portMap = new Map<number, string>();
    for (const e of entries) {
        const match = (e.PathOrURL as string)?.match(/cussConnectorPort=(\d+)/);
        if (match) {
            const port    = parseInt(match[1], 10);
            const airport = (e.AirlineID as string) ?? 'unknown';
            if (!portMap.has(port)) portMap.set(port, airport);
        }
    }
    return Array.from(portMap.entries())
        .map(([port, airport]) => ({ port, airport }))
        .sort((a, b) => a.port - b.port);
}

// ─── Compute (prompts user, returns change or null if skipped) ────────────────
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

    // Show ports already taken (with airport annotation)
    if (usedPorts.length) {
        const portDisplay = usedPorts.map(p => `${p.port}`).join(', ');
        console.log(`\n   ℹ️  Ports already used: ${portDisplay}`);
    } else {
        console.log(`\n   ℹ️  Ports already used: (none found)`);
    }

    // Auto-detect port from Windows registry (CUSSConnectorService-<airport>)
    let port: number;
    const detectedPort = getPortFromRegistry(airport);
    if (detectedPort !== null) {
        console.log(`\n   🔍 Auto-detected port ${detectedPort} from CUSSConnectorService-${airport} (registry).`);
        const portOverride = await prompt(`   Press Enter to use port ${detectedPort}, or type a different port: `);
        const overrideVal  = parseInt(portOverride.trim(), 10);
        port = isNaN(overrideVal) ? detectedPort : overrideVal;
    } else {
        console.warn(`\n   ⚠️  CUSSConnectorService-${airport} not found in registry — enter port manually.`);
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

    // Prompt: base URL — Enter or "d" = use default https://dev.stg.icm.aero
    const DEFAULT_BASE_URL = 'https://dev.stg.icm.aero';
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
