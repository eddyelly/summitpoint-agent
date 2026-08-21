import * as fs from 'fs';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { printRaw, printerExists, listPrinters } from './windows-raw-print';

export class HoneywellPrinterService {
  private printerName: string;
  private devicePath: string;

  constructor(devicePathOrName?: string) {
    // If a CUPS printer name is provided (no slashes), use CUPS
    // If a device path is provided (/dev/...), use direct write
    if (devicePathOrName && !devicePathOrName.startsWith('/dev')) {
      this.printerName = devicePathOrName;
      this.devicePath = '';
    } else {
      this.devicePath = devicePathOrName || '';
      this.printerName = 'Honeywell_PC310T';
    }
  }

  async print(zplCommands: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (process.platform === 'win32') {
        return this.printWindows(zplCommands);
      }

      // Try direct device write first (fastest)
      if (this.devicePath && fs.existsSync(this.devicePath)) {
        return this.printDeviceDirect(zplCommands);
      }

      // Fall back to CUPS `lp` command (most reliable)
      return this.printCups(zplCommands);
    } catch (err: any) {
      return { success: false, error: err.message || 'Print error' };
    }
  }

  private printDeviceDirect(zplCommands: string): { success: boolean; error?: string } {
    try {
      const fd = fs.openSync(this.devicePath, 'w');
      fs.writeSync(fd, zplCommands);
      fs.closeSync(fd);
      return { success: true };
    } catch (err: any) {
      // Device write failed - try CUPS fallback
      console.warn(`Direct USB write failed: ${err.message}, trying CUPS...`);
      return this.printCups(zplCommands);
    }
  }

  private printCups(zplCommands: string): { success: boolean; error?: string } {
    try {
      // Write ZPL to a temp file, then send via lp command with raw option
      const tmpFile = path.join(os.tmpdir(), `badge_${Date.now()}.zpl`);
      fs.writeFileSync(tmpFile, zplCommands);

      execSync(`lp -d "${this.printerName}" -o raw "${tmpFile}"`, {
        stdio: 'ignore',
        timeout: 10000,
      });

      fs.unlinkSync(tmpFile);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: `CUPS print error: ${err.message}` };
    }
  }

  /**
   * Sends ZPL through the Windows print spooler as RAW.
   *
   * This used to be `copy /b file \\localhost\<name>`, which required the
   * printer to be SHARED and addressed by its share name - not the printer
   * name the agent actually holds. The two differ by default, and a name like
   * "Honeywell PC310T (300 dpi) - DP" cannot be a share name at all, which is
   * why each venue PC needed its share renamed by hand before printing worked.
   * The spooler needs no sharing and takes the printer's real name.
   */
  private printWindows(zplCommands: string): { success: boolean; error?: string } {
    const tmpFile = path.join(process.env.TEMP || 'C:\\Temp', `badge_${Date.now()}.zpl`);
    try {
      fs.writeFileSync(tmpFile, zplCommands);
      const result = printRaw(this.printerName, tmpFile);
      if (result.success) return result;

      // A wrong printer name is the likeliest cause and the hardest to guess
      // at remotely, so the error carries the names that WOULD have worked.
      const available = listPrinters(10000, true);
      if (available.length > 0 && !available.includes(this.printerName)) {
        return {
          success: false,
          error:
            `${result.error} - no printer named "${this.printerName}". ` +
            `Windows knows: ${available.map((n) => `"${n}"`).join(', ')}`,
        };
      }
      return result;
    } catch (err: any) {
      return { success: false, error: `Windows print error: ${err.message}` };
    } finally {
      // Runs on every path. The old code deleted the temp file only on
      // success, so every failed badge leaked one into TEMP forever.
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        /* already gone, or never written - nothing to recover */
      }
    }
  }

  async checkStatus(): Promise<boolean> {
    // Was a hardcoded `true`, so a missing or renamed printer looked healthy
    // right up until a badge failed to print. The spooler can answer properly.
    if (process.platform === 'win32') return printerExists(this.printerName);

    // Check direct device path first
    if (this.devicePath && fs.existsSync(this.devicePath)) return true;

    // Check if CUPS knows the printer
    try {
      const output = execSync(`lpstat -p "${this.printerName}" 2>/dev/null`, {
        encoding: 'utf-8',
        timeout: 3000,
      });
      return output.includes('enabled') || output.includes('idle') || !output.includes('disabled');
    } catch {
      return false;
    }
  }
}
