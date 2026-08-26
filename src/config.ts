import path from 'path';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  apiKey: process.env.API_KEY || 'shared-secret-key',
  cloudApiUrl: process.env.CLOUD_API_URL || 'http://localhost:3000',
  cloudApiKey: process.env.CLOUD_API_KEY || 'shared-secret-key',
  hpPrinterUrl: process.env.HP_PRINTER_URL || 'http://192.168.1.50:631/ipp/printer',
  hpPrinterName: process.env.HP_PRINTER_NAME || 'HP_Color_LaserJet',
  honeywellDevicePath: process.env.HONEYWELL_DEVICE_PATH || '',

  /**
   * Which language the label printer speaks. ZPL is the Honeywell PC310T;
   * TSPL is Xprinter and most other Chinese thermal label printers.
   *
   * A property of the hardware at this desk, not of the job. The backend
   * sends `printerType: HONEYWELL` meaning "the label printer" - the agent
   * knows what its own printer understands, which keeps this out of the
   * database and off the deploy path entirely.
   */
  labelLanguage: (process.env.LABEL_LANGUAGE || 'ZPL').toUpperCase() as 'ZPL' | 'TSPL',

  /**
   * The physical stock in this printer, when it differs from the badge
   * template's design size. TSPL's SIZE describes the LABEL, not the artwork:
   * declare it wrong and the printer feeds the wrong length and drifts a
   * little further off with every label.
   *
   * Left unset, the template's dimensions are used.
   */
  labelWidthMm: process.env.LABEL_WIDTH_MM ? Number(process.env.LABEL_WIDTH_MM) : undefined,
  labelHeightMm: process.env.LABEL_HEIGHT_MM ? Number(process.env.LABEL_HEIGHT_MM) : undefined,
  labelGapMm: process.env.LABEL_GAP_MM ? Number(process.env.LABEL_GAP_MM) : 2,
  // How often to ask the cloud for work. Three seconds keeps a walk-up badge
  // feeling instant without hammering the API; the request is tiny and returns
  // an empty list when there is nothing to do.
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '3000', 10),
  queueConcurrency: parseInt(process.env.QUEUE_CONCURRENCY || '2', 10),
  templateCacheDir: process.env.TEMPLATE_CACHE_DIR || path.join(process.cwd(), 'data', 'templates'),
  sqlitePath: process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'print-agent.db'),
};
