import { execSync } from 'child_process';

const REGISTRY_PATH = 'HKLM\\SOFTWARE\\WOW6432Node\\ICM Airport Technics Australia Pty. Ltd.\\ABD';
const REGISTRY_KEY  = 'ABDPCName';

export function isAdminPrivilege(): boolean {
    try {
        execSync('net session', { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

export function setRegistryValue(pcName: string): void {
    if (!isAdminPrivilege()) {
        console.error('❌ ERROR: This script must be run as Administrator.');
        console.error('   Right-click terminal → "Run as Administrator" and retry.');
        process.exit(1);
    }

    try {
        const command = `reg add "${REGISTRY_PATH}" /v ${REGISTRY_KEY} /t REG_SZ /d "${pcName}" /f`;
        console.log(`🔧 Setting registry: ${REGISTRY_KEY} = ${pcName}`);
        execSync(command, { stdio: 'inherit' });
        console.log(`✅ Registry updated: ${pcName}`);
    } catch (error) {
        console.error(`❌ Failed to update registry for ${pcName}:`, error);
        process.exit(1);
    }
}