/**
 * @file paths.config.ts
 * Usage: npx ts-node setupEnv.ts --airport=<IATA> --airline=<CODE>
 */

import * as path from 'path';

// =============================================================================
// ✏️  EDIT THESE VALUES before running the setup tool (Only the first time or when versions change).
// =============================================================================

/** ICM CUSS Platform installation folder (update when the version changes). */
export const CUSS_PLATFORM_PATH = 'C:\\Program Files (x86)\\ICM CUSS Platform\\v3.14.0';

/** Root folder that holds one sub-folder per airport (e.g. C:\Cussconnector\WSI). */
export const CUSS_CONNECTOR_ROOT = 'C:\\Cussconnector';

/** Name of the template folder inside CUSS_CONNECTOR_ROOT used to create new airport folders. */
export const CUSS_CONNECTOR_TEMPLATE_FOLDER = 'Airline1 - Copy';

/** Full path to the Chrome executable. */
export const CHROME_EXE = 'C:\\cussusers\\Chrome-bin119\\chrome.exe';

/** Default base URL for the AirBagDrop application. */
export const DEFAULT_BASE_URL = 'https://dev.stg.icm.aero';


// =============================================================================
// 🔒  DO NOT EDIT — derived from the values above
// =============================================================================

export const ABD_MASTER_CONFIG_PATH    = path.join(CUSS_PLATFORM_PATH, 'ABDMasterConfig.cfg');
export const AL_APP_CONFIG_PATH        = path.join(CUSS_PLATFORM_PATH, 'AlAppConfig.json');
export const CUSS_CONNECTOR_TEMPLATE   = path.join(CUSS_CONNECTOR_ROOT, CUSS_CONNECTOR_TEMPLATE_FOLDER);

export const CHROME_FLAGS =
    '--disable-background-timer-throttling' +
    ' --disable-renderer-backgrounding' +
    ' --disable-backgrounding-occluded-windows' +
    ' --disable-web-security' +
    ' --new-window' +
    ' --allow-outdated-plugins' +
    ' --disable-prompt-on-repost' +
    ' --no-default-browser-check' +
    ' --no-first-run' +
    ' --disable-translate' +
    ' --disable-background-networking' +
    ' --safebrowsing-disable-auto-update' +
    ' --safebrowsing-disable-download-protection' +
    ' --disable-client-side-phishing-detection' +
    ' --disable-component-update' +
    ' --disable-default-apps' +
    ' --noerrdialogs' +
    ' --allow-file-access' +
    ' --allow-running-insecure-content' +
    ' --always-authorize-plugins' +
    ' --disable-session-crashed-bubble' +
    ' --disable-infobars' +
    ' --disable-pinch' +
    ' --overscroll-history-navigation=0' +
    ' --enable-npapi' +
    ' --disable-gpu' +
    ' --no-sandbox' +
    ' --user-data-dir';

export const ABD_REGISTRY_PATH =
    'HKLM\\SOFTWARE\\WOW6432Node\\ICM Airport Technics Australia Pty. Ltd.\\ABD';
export const ABD_REGISTRY_KEY  = 'ABDPCName';

export const PROCRUN_BASE =
    'HKLM\\SOFTWARE\\WOW6432Node\\Apache Software Foundation\\Procrun 2.0';
