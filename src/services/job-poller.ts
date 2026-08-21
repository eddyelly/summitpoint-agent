import axios from 'axios';
import type { QueueService } from './queue.service';
import type { PrintJob } from '../types/index';

/**
 * Pulls print jobs from the cloud instead of waiting to be pushed.
 *
 * The backend used to POST jobs to this agent at PRINT_AGENT_URL, which meant
 * the agent had to be reachable from the internet: a tunnel, a public
 * hostname, and a per-venue env change on the server. A registration desk on
 * venue wifi behind NAT cannot offer that, and the one deployment we checked
 * had PRINT_AGENT_URL pointing at 192.168.1.152 - an address the cloud can
 * never route to.
 *
 * Polling inverts it. The agent opens an ordinary outbound HTTPS connection,
 * the same direction it already uses to report job status, so it works on
 * hotel wifi, a mobile hotspot, or behind any firewall that permits normal
 * web traffic.
 *
 * The backend claims each job (QUEUED -> PRINTING) as it hands it over, so
 * two polls overlapping cannot both receive the same job and print a badge
 * twice.
 */
export class JobPoller {
  private timer: NodeJS.Timeout | null = null;
  private inFlight = false;
  private consecutiveFailures = 0;

  constructor(
    private cloudUrl: string,
    private apiKey: string,
    private queue: QueueService,
    private intervalMs: number,
  ) {}

  start(): void {
    if (this.timer) return;
    console.log(`Job poller started - checking the cloud every ${this.intervalMs / 1000}s`);
    // `void` because setInterval cannot await: an unhandled rejection here
    // would take the process down, and poll() already swallows its own errors.
    this.timer = setInterval(() => void this.poll(), this.intervalMs);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One poll.
   *
   * `inFlight` matters more than it looks: the request can outlast the
   * interval on a slow connection, and without the guard the ticks would pile
   * up, each claiming more jobs than this agent can print - jobs that then sit
   * in PRINTING while a queue builds locally.
   */
  private async poll(): Promise<void> {
    if (this.inFlight) return;
    this.inFlight = true;

    try {
      const res = await axios.get(`${this.cloudUrl}/api/v1/agent/print/jobs/pending`, {
        headers: { 'x-api-key': this.apiKey },
        timeout: 10000,
      });

      // The backend wraps every response as { data: ... }.
      const body = res.data?.data ?? res.data;
      const jobs: PrintJob[] = Array.isArray(body?.jobs) ? body.jobs : [];

      if (this.consecutiveFailures > 0) {
        console.log(`Cloud reachable again after ${this.consecutiveFailures} failed polls`);
        this.consecutiveFailures = 0;
      }
      if (jobs.length === 0) return;

      console.log(`Claimed ${jobs.length} print job(s) from the cloud`);
      for (const job of jobs) {
        // One bad job must not strand the rest of the batch - they are all
        // already claimed, so dropping out here would leave them in PRINTING
        // with nothing printing them.
        try {
          await this.queue.addJob(job);
        } catch (err: any) {
          console.warn(`Could not queue job ${job.jobId}: ${err?.message ?? err}`);
        }
      }
    } catch (err: any) {
      // A quiet venue with no internet must not fill the log with one error
      // every few seconds. Report the first failure and then every tenth.
      this.consecutiveFailures += 1;
      if (this.consecutiveFailures === 1 || this.consecutiveFailures % 10 === 0) {
        console.warn(
          `Job poll failed (${this.consecutiveFailures} in a row): ${err?.message ?? err}`,
        );
      }
    } finally {
      this.inFlight = false;
    }
  }
}
