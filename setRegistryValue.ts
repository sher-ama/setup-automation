/**
 * @file setRegistryValue.ts
 * @description Writes the ABD PC name into the Windows registry so that the
 *              ICM CUSS Platform can identify this workstation.  Must be run
 *              with Administrator privileges.
 *
 * Exported functions:
 *   - {@link isAdminPrivilege}  — checks whether the current process is elevated
 *   - {@link setRegistryValue}  — writes ABDPCName to the ICM ABD registry key
 */

import { execSync } from 'child_process';
import { ABD_REGISTRY_PATH, ABD_REGISTRY_KEY } from './paths.config';

/**
 * Determines whether the current Node.js process is running with Windows
 * Administrator (elevated) privileges by attempting `net session`.
 *
 * @returns `true` if the process is elevated; `false` otherwise.
 */
export function isAdminPrivilege(): boolean {
    try {
        execSync('net session', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

/**
 * Writes the given PC name into the Windows registry at the ICM ABD key so
 * that the CUSS Platform recognises this workstation.
 *
 * Registry target:
 *   `HKLM\SOFTWARE\WOW6432Node\ICM Airport Technics Australia Pty. Ltd.\ABD`
 *   Value name : `ABDPCName` (REG_SZ)
 *
 * @param pcName - The fully-qualified PC name to store (e.g. `WSIT1SIMULATOR`).
 * @throws Calls `process.exit(1)` if the process is not elevated or if the
 *         `reg add` command fails.
 */
export function setRegistryValue(pcName: string): void {
    if (!isAdminPrivilege()) {
        console.error('❌ ERROR: This script must be run as Administrator.');
        console.error('   Right-click terminal → "Run as Administrator" and retry.');
        process.exit(1);
    }

    try {
        const command = `reg add "${ABD_REGISTRY_PATH}" /v ${ABD_REGISTRY_KEY} /t REG_SZ /d "${pcName}" /f`;
        console.log(`🔧 Setting registry: ${ABD_REGISTRY_KEY} = ${pcName}`);
        execSync(command, { stdio: 'inherit' });
        console.log(`✅ Registry updated: ${pcName}`);
    } catch (error) {
        console.error(`❌ Failed to update registry for ${pcName}:`, error);
        process.exit(1);
    }
}