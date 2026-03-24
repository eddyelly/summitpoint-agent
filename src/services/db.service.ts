import Database from 'better-sqlite3';
import type { JobRecord, QueueStats, PendingWebhook } from '../types/index';

export class DbService {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.initialize();
  }

  private initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS print_jobs (
        jobId TEXT PRIMARY KEY,
        attendeeName TEXT NOT NULL,
        printerType TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'QUEUED',
        createdAt TEXT NOT NULL,
        printedAt TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS pending_webhooks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jobId TEXT NOT NULL,
        status TEXT NOT NULL,
        errorMessage TEXT,
        createdAt TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_jobs_status ON print_jobs(status);
    `);
  }

  saveJob(job: {
    jobId: string;
    attendeeName: string;
    printerType: string;
    status: string;
    createdAt: string;
  }) {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO print_jobs (jobId, attendeeName, printerType, status, createdAt)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(job.jobId, job.attendeeName, job.printerType, job.status, job.createdAt);
  }

  updateJobStatus(jobId: string, status: string, printedAt?: string, error?: string) {
    this.db
      .prepare(`UPDATE print_jobs SET status = ?, printedAt = ?, error = ? WHERE jobId = ?`)
      .run(status, printedAt || null, error || null, jobId);
  }

  getJob(jobId: string): JobRecord | undefined {
    return this.db.prepare('SELECT * FROM print_jobs WHERE jobId = ?').get(jobId) as
      | JobRecord
      | undefined;
  }

  getStats(): QueueStats {
    const row = this.db
      .prepare(
        `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'PRINTING' THEN 1 ELSE 0 END) as processing,
        SUM(CASE WHEN status = 'DONE' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) as failed
      FROM print_jobs`,
      )
      .get() as any;

    return {
      total: row.total || 0,
      pending: row.pending || 0,
      processing: row.processing || 0,
      completed: row.completed || 0,
      failed: row.failed || 0,
    };
  }

  getJobs(filter?: { status?: string; limit?: number; offset?: number }): {
    jobs: JobRecord[];
    total: number;
  } {
    const params: any[] = [];
    let where = '';

    if (filter?.status) {
      where = ' WHERE status = ?';
      params.push(filter.status);
    }

    const total = (
      this.db.prepare(`SELECT COUNT(*) as count FROM print_jobs${where}`).get(...params) as any
    ).count;

    const limit = filter?.limit || 50;
    const offset = filter?.offset || 0;
    const jobs = this.db
      .prepare(`SELECT * FROM print_jobs${where} ORDER BY createdAt DESC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as JobRecord[];

    return { jobs, total };
  }

  deleteJob(jobId: string) {
    this.db.prepare('DELETE FROM print_jobs WHERE jobId = ?').run(jobId);
  }

  clearCompleted() {
    this.db.prepare("DELETE FROM print_jobs WHERE status = 'DONE'").run();
  }

  savePendingWebhook(jobId: string, status: string, errorMessage?: string) {
    this.db
      .prepare(`INSERT INTO pending_webhooks (jobId, status, errorMessage) VALUES (?, ?, ?)`)
      .run(jobId, status, errorMessage || null);
  }

  getPendingWebhooks(): PendingWebhook[] {
    return this.db
      .prepare('SELECT * FROM pending_webhooks ORDER BY id ASC')
      .all() as PendingWebhook[];
  }

  deletePendingWebhook(id: number) {
    this.db.prepare('DELETE FROM pending_webhooks WHERE id = ?').run(id);
  }
}
