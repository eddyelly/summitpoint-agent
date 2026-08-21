import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

/**
 * Sending ZPL to a Windows printer as RAW, through the print spooler.
 *
 * Replaces `copy /b file \\localhost\<name>`, which was fragile for three
 * reasons: `\\localhost\X` resolves X as the printer's SHARE name while the
 * agent passes its PRINTER name (different strings, and a name like
 * "Honeywell PC310T (300 dpi) - DP" cannot be a share name at all); it needs
 * File & Printer Sharing enabled; and it needs SMB loopback working. Three
 * things that vary per venue laptop, and the reason sharing had to be
 * re-named by hand on each machine.
 *
 * Talking to the spooler directly needs none of that - the printer is
 * addressed by the name Windows already knows it by, shared or not.
 *
 * PowerShell rather than a native addon deliberately: `printer` and its forks
 * are C++ addons needing VS Build Tools and a prebuild matching each PC's
 * Node version. .NET is already on every Windows box, so this installs
 * nothing.
 */

/** Where the helper script is cached. Written once per agent run, then reused. */
let scriptPath: string | null = null;

/**
 * `StartDocPrinter` with datatype "RAW" is what stops the driver rendering
 * ZPL as if it were text to be printed - the bytes reach the printer
 * untouched, which is what `copy /b` was achieving by a different route.
 *
 * The ZPL travels as a FILE rather than on the command line: an attendee
 * called O'Brien would otherwise terminate the PowerShell string, and no
 * amount of escaping is worth the risk on a name we do not control.
 */
const RAW_PRINT_SCRIPT = `
param(
  [Parameter(Mandatory=$true)][string]$PrinterName,
  [Parameter(Mandatory=$true)][string]$FilePath
)

$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class SummitRawPrinter
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct DOCINFO
    {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDataType;
    }

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool OpenPrinter(string src, out IntPtr hPrinter, IntPtr pd);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool ClosePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", CharSet = CharSet.Unicode, SetLastError = true)]
    public static extern bool StartDocPrinter(IntPtr hPrinter, int level, ref DOCINFO di);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndDocPrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool StartPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool EndPagePrinter(IntPtr hPrinter);

    [DllImport("winspool.drv", SetLastError = true)]
    public static extern bool WritePrinter(IntPtr hPrinter, IntPtr pBytes, int dwCount, out int dwWritten);

    public static void SendBytes(string printerName, byte[] bytes)
    {
        IntPtr hPrinter;
        if (!OpenPrinter(printerName, out hPrinter, IntPtr.Zero))
            throw new Exception("OpenPrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")");

        try
        {
            DOCINFO di = new DOCINFO();
            di.pDocName = "SummitPoint Badge";
            di.pDataType = "RAW";

            if (!StartDocPrinter(hPrinter, 1, ref di))
                throw new Exception("StartDocPrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")");

            try
            {
                if (!StartPagePrinter(hPrinter))
                    throw new Exception("StartPagePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")");

                IntPtr unmanaged = Marshal.AllocCoTaskMem(bytes.Length);
                try
                {
                    Marshal.Copy(bytes, 0, unmanaged, bytes.Length);
                    int written;
                    if (!WritePrinter(hPrinter, unmanaged, bytes.Length, out written))
                        throw new Exception("WritePrinter failed (Win32 error " + Marshal.GetLastWin32Error() + ")");
                    if (written != bytes.Length)
                        throw new Exception("WritePrinter wrote " + written + " of " + bytes.Length + " bytes");
                }
                finally
                {
                    Marshal.FreeCoTaskMem(unmanaged);
                }

                EndPagePrinter(hPrinter);
            }
            finally
            {
                EndDocPrinter(hPrinter);
            }
        }
        finally
        {
            ClosePrinter(hPrinter);
        }
    }
}
"@

$bytes = [System.IO.File]::ReadAllBytes($FilePath)
[SummitRawPrinter]::SendBytes($PrinterName, $bytes)
Write-Output "OK"
`;

/**
 * Writes the helper script to temp on first use and reuses it thereafter.
 * Regenerated if something deletes it mid-run, because a temp directory is
 * not ours to rely on.
 */
function ensureScript(): string {
  if (scriptPath && fs.existsSync(scriptPath)) return scriptPath;
  const target = path.join(os.tmpdir(), 'summitpoint-raw-print.ps1');
  fs.writeFileSync(target, RAW_PRINT_SCRIPT, 'utf-8');
  scriptPath = target;
  return target;
}

/** Shared PowerShell invocation. `-NoProfile` keeps a user's profile script
 *  from breaking the agent; `-ExecutionPolicy Bypass` applies to this process
 *  only and changes nothing on the machine. */
function runPowerShell(args: string[], timeout: number): string {
  return execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', ...args],
    { encoding: 'utf-8', timeout, windowsHide: true },
  );
}

/**
 * Sends the bytes of `filePath` to `printerName` as RAW.
 *
 * The file is not deleted here - the caller owns its own temp file.
 */
export function printRaw(
  printerName: string,
  filePath: string,
  timeout = 15000,
): { success: boolean; error?: string } {
  try {
    const script = ensureScript();
    runPowerShell(['-File', script, '-PrinterName', printerName, '-FilePath', filePath], timeout);
    return { success: true };
  } catch (err: any) {
    // PowerShell writes the useful part to stderr; `err.message` alone is
    // usually just "Command failed", which diagnoses nothing remotely.
    const detail = (err?.stderr || err?.stdout || '').toString().trim();
    const reason = detail || err?.message || 'Unknown PowerShell error';
    return { success: false, error: `Windows RAW print failed: ${reason}` };
  }
}

/**
 * The printer list is cached, for two reasons that both bite in production:
 * `/health` races `checkStatus()` against a ONE SECOND timeout, and spawning
 * PowerShell reliably takes longer than that - so an uncached lookup would
 * report a perfectly healthy printer as disconnected. It is also polled
 * often, and spawning a process per poll is waste. Printers do not come and
 * go on a badge desk, so a short TTL is honest.
 */
let printerCache: { names: string[]; at: number } | null = null;
const PRINTER_CACHE_TTL_MS = 30000;

/**
 * Every printer Windows knows about.
 *
 * Worth having beyond status: when a print fails because the configured name
 * does not match, this is the list of strings that WOULD have worked.
 *
 * Pass `force` to bypass the cache - used after a failed print, where a stale
 * list would send someone hunting the wrong problem.
 */
export function listPrinters(timeout = 10000, force = false): string[] {
  if (!force && printerCache && Date.now() - printerCache.at < PRINTER_CACHE_TTL_MS) {
    return printerCache.names;
  }
  try {
    const out = runPowerShell(
      ['-Command', 'Get-Printer | Select-Object -ExpandProperty Name'],
      timeout,
    );
    const names = out
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    printerCache = { names, at: Date.now() };
    return names;
  } catch {
    // A failed enumeration is not evidence there are no printers, so an old
    // list is better than an empty one. Only report empty when we never had
    // a list to begin with.
    return printerCache ? printerCache.names : [];
  }
}

/** Whether Windows knows a printer by exactly this name. */
export function printerExists(printerName: string, timeout = 10000): boolean {
  return listPrinters(timeout).includes(printerName);
}

/**
 * Populates the cache at startup, so the first `/health` poll answers from
 * memory instead of losing its one-second race. Costs one PowerShell spawn
 * during boot, where half a second does not matter.
 */
export function warmPrinterCache(): void {
  if (process.platform !== 'win32') return;
  listPrinters(10000, true);
}
