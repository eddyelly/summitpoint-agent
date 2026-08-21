import path from 'path';

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  apiKey: process.env.API_KEY || 'shared-secret-key',
  cloudApiUrl: process.env.CLOUD_API_URL || 'http://localhost:3000',
  cloudApiKey: process.env.CLOUD_API_KEY || 'shared-secret-key',
  hpPrinterUrl: process.env.HP_PRINTER_URL || 'http://192.168.1.50:631/ipp/printer',
  hpPrinterName: process.env.HP_PRINTER_NAME || 'HP_Color_LaserJet',
  honeywellDevicePath: process.env.HONEYWELL_DEVICE_PATH || '',
  // How often to ask the cloud for work. Three seconds keeps a walk-up badge
  // feeling instant without hammering the API; the request is tiny and returns
  // an empty list when there is nothing to do.
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '3000', 10),
  queueConcurrency: parseInt(process.env.QUEUE_CONCURRENCY || '2', 10),
  templateCacheDir: process.env.TEMPLATE_CACHE_DIR || path.join(process.cwd(), 'data', 'templates'),
  sqlitePath: process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'print-agent.db'),
};
