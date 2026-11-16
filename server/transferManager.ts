import { SdBackend } from './sdBackend.ts';
import fs from 'fs';
import { Readable } from 'stream';

export interface TransferJob {
  id: string;
  fileName: string;
  sizeBytes: number;
  bytesTransferred: number;
  speedBytesPerSec: number;
  progressPercent: number;
  status: 'queued' | 'transferring' | 'completed' | 'failed';
  targetDirectory: string;
  checksum?: string;
  errorMessage?: string;
  startedAt: number;
  updatedAt: number;
}

export class TransferManager {
  private jobs = new Map<string, TransferJob>();

  createJob(fileName: string, sizeBytes: number, targetDirectory: string): TransferJob {
    const id = `job-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const job: TransferJob = {
      id,
      fileName,
      sizeBytes,
      bytesTransferred: 0,
      speedBytesPerSec: 0,
      progressPercent: 0,
      status: 'queued',
      targetDirectory,
      startedAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.jobs.set(id, job);
    return job;
  }

  getJob(id: string): TransferJob | undefined {
    return this.jobs.get(id);
  }

  listJobs(): TransferJob[] {
    return Array.from(this.jobs.values()).sort((a, b) => b.startedAt - a.startedAt);
  }

  async runJob(
    jobId: string,
    backend: SdBackend,
    source: string | Buffer | NodeJS.ReadableStream
  ): Promise<TransferJob> {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Job not found: ${jobId}`);

    job.status = 'transferring';
    let lastBytes = 0;
    let lastTime = Date.now();

    const onProgress = (bytes: number) => {
      job.bytesTransferred = bytes;
      job.progressPercent = job.sizeBytes > 0 ? Math.min(100, Math.round((bytes / job.sizeBytes) * 100)) : 100;
      const now = Date.now();
      const elapsedSec = (now - lastTime) / 1000;
      if (elapsedSec >= 0.5) {
        job.speedBytesPerSec = Math.round((bytes - lastBytes) / elapsedSec);
        lastBytes = bytes;
        lastTime = now;
      }
      job.updatedAt = now;
    };

    try {
      let stream: NodeJS.ReadableStream;
      if (typeof source === 'string') {
        stream = fs.createReadStream(source);
      } else if (Buffer.isBuffer(source)) {
        stream = Readable.from(source);
      } else {
        stream = source;
      }

      const res = await backend.uploadFile(
        job.targetDirectory,
        job.fileName,
        stream,
        job.sizeBytes,
        onProgress
      );

      job.status = 'completed';
      job.bytesTransferred = res.bytesWritten;
      job.progressPercent = 100;
      job.checksum = `SHA256:${res.sha256Hex}`;
      job.updatedAt = Date.now();
      return job;
    } catch (err) {
      job.status = 'failed';
      job.errorMessage = (err as Error).message;
      job.updatedAt = Date.now();
      throw err;
    }
  }
}
