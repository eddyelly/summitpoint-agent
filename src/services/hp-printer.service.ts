import ipp from '@sealsystems/ipp';

export class HpPrinterService {
  private printerUrl: string;

  constructor(printerUrl: string) {
    this.printerUrl = printerUrl;
  }

  async print(pdfBuffer: Buffer, jobName: string): Promise<{ success: boolean; error?: string }> {
    return new Promise((resolve) => {
      const printer = ipp.Printer(this.printerUrl);

      const msg: any = {
        'operation-attributes-tag': {
          'requesting-user-name': 'SummitPoint',
          'job-name': jobName,
          'document-format': 'application/pdf',
        },
        data: pdfBuffer,
      };

      printer.execute('Print-Job', msg, (err: any, res: any) => {
        if (err) {
          resolve({ success: false, error: err.message || 'IPP error' });
        } else if (res?.statusCode?.startsWith?.('successful')) {
          resolve({ success: true });
        } else {
          resolve({
            success: false,
            error: `IPP status: ${res?.statusCode || 'unknown'}`,
          });
        }
      });
    });
  }

  async checkStatus(): Promise<boolean> {
    // Quick TCP check first - avoids IPP hanging on unreachable printers
    try {
      const url = new URL(this.printerUrl);
      const net = await import('net');
      return new Promise((resolve) => {
        const socket = new net.Socket();
        const timeout = setTimeout(() => { socket.destroy(); resolve(false); }, 2000);
        socket.connect(parseInt(url.port) || 631, url.hostname, () => {
          clearTimeout(timeout);
          socket.destroy();
          resolve(true);
        });
        socket.on('error', () => { clearTimeout(timeout); resolve(false); });
      });
    } catch {
      return false;
    }
  }
}
