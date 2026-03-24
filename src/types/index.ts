export interface PrintTemplate {
  badgeWidthMm: number;
  badgeHeightMm: number;
  backgroundImageUrl: string | null;
  qrCodeTop: number;
  qrCodeLeft: number;
  qrCodeWidth: number;
  nameTop: number;
  nameLeft: number;
  textColor: string;
  nameCase: 'TITLE' | 'UPPERCASE' | 'LOWERCASE';
  showSerialNumber: boolean;
  snTop?: number;
  snLeft?: number;
}

export interface PrintJob {
  jobId: string;
  attendeeName: string;
  qrCodeValue: string;
  printerType: 'HP' | 'HONEYWELL';
  serialNumber?: string;
  template: PrintTemplate;
  priority?: number;
}

export interface SinglePrintRequest {
  jobId: string;
  attendeeName: string;
  qrCodeValue: string;
  printerType: 'HP' | 'HONEYWELL';
  serialNumber?: string;
  template: PrintTemplate;
}

export interface BulkPrintRequest {
  jobs: Array<{
    jobId: string;
    attendeeName: string;
    qrCodeValue: string;
    serialNumber?: string;
  }>;
  printerType: 'HP' | 'HONEYWELL';
  template: PrintTemplate;
}

export interface JobRecord {
  jobId: string;
  attendeeName: string;
  printerType: string;
  status: string;
  createdAt: string;
  printedAt: string | null;
  error: string | null;
}

export interface QueueStats {
  total: number;
  pending: number;
  processing: number;
  completed: number;
  failed: number;
}

export interface PendingWebhook {
  id: number;
  jobId: string;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}
