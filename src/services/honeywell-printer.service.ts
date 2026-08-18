import * as fs from 'fs';
import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

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

  private printWindows(zplCommands: string): { success: boolean; error?: string } {
    try {
      const tmpFile = path.join(process.env.TEMP || 'C:\\Temp', `badge_${Date.now()}.zpl`);
      fs.writeFileSync(tmpFile, zplCommands);
      execSync(`copy /b "${tmpFile}" "\\\\localhost\\${this.printerName}"`, { stdio: 'ignore' });
      fs.unlinkSync(tmpFile);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: `Windows print error: ${err.message}` };
    }
  }

  async checkStatus(): Promise<boolean> {
    if (process.platform === 'win32') return true;

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
