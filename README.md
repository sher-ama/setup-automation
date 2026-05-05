# setup-automation

A Node.js/TypeScript CLI tool that **eliminates the manual effort involved in QA environment setup** for the ICM CUSS Airport Platform used in ABD (Automated Baggage Drop) testing.

Without this tool, a QA engineer must manually open the Windows Registry Editor, locate the correct key, edit two platform configuration files, and create the required folder structure — a tedious, error-prone process that must be repeated for every airport/airline combination under test. This tool performs all of that automatically from a single command.

---

## Overview

Before running Playwright end-to-end tests against a CUSS simulator, each test machine must be configured for a specific airport and airline combination. Doing this manually requires navigating the Windows Registry Editor, editing two platform XML/JSON configuration files by hand, and setting up supporting folder structures — all of which are repetitive, time-consuming, and highly prone to human error.

This tool replaces that entire manual process with a single CLI command. It automates every setup task in the correct order:

1. **Windows Registry Editor** — Directly writes the `ABDPCName` registry value under the ICM ABD key, which tells the CUSS platform which simulator PC it is running on. Eliminates the need to manually open `regedit`, navigate to the key, and edit the value.

2. **ABDMasterConfig.cfg** — Locates the `DEFAULT` `<ABDConfig>` block for the target PC and automatically updates:
   - `SupportedAirlines` attribute to `<AIRPORT>,<AIRLINE>`
   - The `<SharedAppSupport>` block to reflect the correct airline/airport pairing
   
   Removes the need to manually search through the XML config file and carefully edit the right block without breaking the file structure.

3. **AlAppConfig.json** — Upserts the simulator's full application entry including kiosk ID, CUSS connector port, Chrome executable path, and launch flags. Resolves the correct port automatically from the Windows registry where possible, and prompts for manual entry only as a fallback.

4. **CussConnector folder provisioning** — If the required `CussConnector` directory for the target airport does not already exist under `C:\Cussconnector\`, it is automatically created by copying from the template directory (`Airline1 - Copy`). This step previously required the QA engineer to manually duplicate and rename folders.

---

## Requirements

| Requirement | Details |
|---|---|
| **OS** | Windows (registry writes required) |
| **Privileges** | Must be run **as Administrator** |
| **Node.js** | v18 or later |
| **ICM CUSS Platform** | Installed at `C:\Program Files (x86)\ICM CUSS Platform\v3.14.0\` |
| **CussConnector template** | Present at `C:\Cussconnector\Airline1 - Copy\` |

---

## Installation

```bash
npm install
```

---

## Usage

```bash
npm run setup -- --airport=<IATA_CODE> --airline=<AIRLINE_CODE>
```

### Arguments

| Argument | Required | Description |
|---|---|---|
| `--airport` | Yes | IATA airport code (e.g. `SYD`, `LHR`, `DXB`) |
| `--airline` | Yes | Airline code to configure (e.g. `QF`, `EK`) |

### Example

```bash
npm run setup -- --airport=SYD --airline=QF
```

---

## What Happens at Runtime

### Step 0 — Resolve PC name
The tool reads `setup.config.json` and filters all `keywords` for entries matching the supplied airport code. If multiple matches are found (e.g. two simulator terminals at the same airport), an interactive numbered list lets you select the exact PC name to configure.

### Step 1 — Registry update
Sets the following Windows registry value, which the CUSS platform reads on startup to identify the simulator:

```
HKLM\SOFTWARE\WOW6432Node\ICM Airport Technics Australia Pty. Ltd.\ABD
  ABDPCName = <KEYWORD>SIMULATOR
```

> Requires Administrator privileges. The tool checks for elevation and exits with a clear error message if the terminal is not running as Administrator.

After the registry write you are shown a confirmation prompt — you can stop here if you only need the registry updated.

### Step 2 — ABDMasterConfig.cfg update
For the resolved PC name the tool:
- Locates the `<ABDConfigs>` section containing `ComputerName="<PCNAME>"`
- Finds the first (DEFAULT) `<ABDConfig>` entry within that section
- Updates `SupportedAirlines` to `"<AIRPORT>,<AIRLINE>"`
- Replaces the `<SharedAppSupport>` block with a single entry matching the new airline/airport pair

The before/after diff of the affected XML block is written to a temporary file and its path is printed so you can review the exact change before confirming.

### Step 3 — AlAppConfig.json update
For the resolved PC name the tool:
- Searches for an existing entry matching the PC name
- Constructs (or updates) the full entry: kiosk ID (from `setup.config.json` or prompted), CUSS connector port (auto-resolved from the registry service `CUSSConnectorService-<AIRPORT>`, or prompted if not found), Chrome executable path, and all required launch flags
- Stages the new JSON entry for writing

The before/after diff of the JSON entry is included in the same combined diff file as Step 2.

### Step 4 — CussConnector folder provisioning
After confirming the config changes the tool checks whether the airport's `CussConnector` directory exists at `C:\Cussconnector\<AIRPORT>`. If it is missing, the entire template directory (`C:\Cussconnector\Airline1 - Copy`) is copied recursively to create it — no manual folder duplication required.

### Final save
Config file writes (`ABDMasterConfig.cfg` and `AlAppConfig.json`) happen only after all per-PC confirmations are accepted. If a file required no changes it is not touched.

---

## Configuration

### `setup.config.json`

| Field | Type | Description |
|---|---|---|
| `keywords` | `string[]` | List of simulator PC keyword identifiers |
| `registrySuffix` | `string` | Suffix appended to each keyword to form a PC name (default: `"SIMULATOR"`) |
| `keywordKioskIds` | `Record<string, string>` | Maps each keyword to its default kiosk ID written into `AlAppConfig.json` |

### Supported Airports (keywords)

The following airport/PC keywords are pre-configured in `setup.config.json`:

`KIX`, `PER`, `DXB`, `DME`, `BNE`, `WSI`, `FUK`, `NGO`, `IAH`, `JFK`, `MUC`, `STR`, `TPE`, `CDG`, `AKL`, `WLG`, `SYD`, `GEN`, `NRT`, `KEF`, `LHR`, `SIN`, `DXN`, `MEL`, `ANA`

---

## Project Structure

```
setup-automation/
├── setupEnv.ts           # Main entry point — orchestrates all setup steps
├── setRegistryValue.ts   # Writes ABDPCName to the Windows registry
├── updateConfig.ts       # Reads/writes ABDMasterConfig.cfg
├── updateAlAppConfig.ts  # Reads/writes AlAppConfig.json and provisions CussConnector folders
├── setup.config.json     # Airport keyword and kiosk ID configuration
├── tsconfig.json         # TypeScript compiler configuration
└── package.json
```

---

## Notes

- All config file changes are **shown as a diff and require explicit confirmation** before being written to disk — no silent modifications.
- The tool is idempotent: re-running it for the same airport/airline will report no changes if the files are already correctly configured.
- CUSS connector port assignment reads from the Windows registry (`CUSSConnectorService-<airport>`) when available, and falls back to an interactive prompt if the service is not registered on the current machine.
