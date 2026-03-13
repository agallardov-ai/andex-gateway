import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { 
  createJob, 
  getJobById, 
  getJobs, 
  getJobStats, 
  updateJobStatus,
  deleteJob
} from '../db/database.js';
import { 
  saveFile, 
  extractDicomInfo, 
  isValidDicom, 
  deleteFile 
} from '../services/storage.service.js';
import { processJob } from '../services/queue.service.js';
import { apiKeyAuth } from '../plugins/auth.plugin.js';
import { recordUpload, recordApiRequest, log } from '../services/observability.service.js';
import type { JobStatus, UploadResponse } from '../types/index.js';

export async function dicomRoutes(fastify: FastifyInstance): Promise<void> {
  
  // Upload DICOM file
  fastify.post('/api/upload', {
    preHandler: apiKeyAuth,
    handler: async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        const data = await request.file();
        
        if (!data) {
          return reply.code(400).send({ 
            success: false, 
            error: 'No file uploaded' 
          });
        }

        // Read file buffer
        const chunks: Buffer[] = [];
        for await (const chunk of data.file) {
          chunks.push(chunk);
        }
        const fileBuffer = Buffer.concat(chunks);

        // Validate DICOM
        if (!isValidDicom(fileBuffer)) {
          return reply.code(400).send({ 
            success: false, 
            error: 'Invalid DICOM file (missing DICM header)' 
          });
        }

        // Extract DICOM metadata
        const dicomInfo = extractDicomInfo(fileBuffer);

        // Save file to pending directory
        const filename = data.filename || 'unknown.dcm';
        const filepath = await saveFile(filename, fileBuffer);

        // Create job in database
        const job = createJob({
          filename,
          filepath,
          filesize: fileBuffer.length,
          study_uid: dicomInfo.studyUID,
          series_uid: dicomInfo.seriesUID,
          sop_instance_uid: dicomInfo.sopInstanceUID,
          patient_id: dicomInfo.patientId,
          patient_name: dicomInfo.patientName,
          modality: dicomInfo.modality,
        });

        // Record metrics
        recordUpload(true, fileBuffer.length);
        recordApiRequest('/api/upload');
        log('info', 'DICOM file received', { jobId: job.id, filename, size: fileBuffer.length });

        // Try to process immediately (non-blocking)
        setImmediate(() => {
          processJob(job).catch(err => {
            fastify.log.error({ jobId: job.id, error: err }, 'Immediate processing failed');
          });
        });

        const response: UploadResponse = {
          success: true,
          jobId: job.id,
          message: 'File received and queued for processing',
          status: job.status,
        };

        return reply.code(202).send(response);

      } catch (error) {
        recordUpload(false);
        recordApiRequest('/api/upload', true);
        log('error', 'Upload failed', { error: String(error) });
        return reply.code(500).send({ 
          success: false, 
          error: 'Internal server error' 
        });
      }
    }
  });

  // List jobs
  fastify.get('/api/jobs', {
    preHandler: apiKeyAuth,
    handler: async (request: FastifyRequest<{
      Querystring: { status?: JobStatus; limit?: string; offset?: string }
    }>, reply: FastifyReply) => {
      const { status, limit = '50', offset = '0' } = request.query;
      
      const jobs = getJobs({
        status,
        limit: parseInt(limit, 10),
        offset: parseInt(offset, 10),
      });
      
      const stats = getJobStats();

      return reply.send({ 
        jobs, 
        stats,
        pagination: {
          limit: parseInt(limit, 10),
          offset: parseInt(offset, 10),
          total: stats.total,
        }
      });
    }
  });

  // Get single job
  fastify.get('/api/jobs/:id', {
    preHandler: apiKeyAuth,
    handler: async (request: FastifyRequest<{
      Params: { id: string }
    }>, reply: FastifyReply) => {
      const { id } = request.params;
      const job = getJobById(id);
      
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      return reply.send(job);
    }
  });

  // Retry a failed job
  fastify.post('/api/jobs/:id/retry', {
    preHandler: apiKeyAuth,
    handler: async (request: FastifyRequest<{
      Params: { id: string }
    }>, reply: FastifyReply) => {
      const { id } = request.params;
      const job = getJobById(id);
      
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      if (job.status === 'sent') {
        return reply.code(400).send({ error: 'Job already sent' });
      }

      // Reset status to pending for retry
      updateJobStatus(id, 'pending', { error_message: undefined });
      
      // Process immediately
      const updatedJob = getJobById(id)!;
      const success = await processJob(updatedJob);

      return reply.send({ 
        success, 
        job: getJobById(id) 
      });
    }
  });

  // Cancel/delete a job
  fastify.delete('/api/jobs/:id', {
    preHandler: apiKeyAuth,
    handler: async (request: FastifyRequest<{
      Params: { id: string }
    }>, reply: FastifyReply) => {
      const { id } = request.params;
      const job = getJobById(id);
      
      if (!job) {
        return reply.code(404).send({ error: 'Job not found' });
      }

      // Delete associated file
      if (job.filepath) {
        await deleteFile(job.filepath);
      }

      // Delete job record
      deleteJob(id);

      return reply.send({ success: true, message: 'Job deleted' });
    }
  });

  // Get stats only
  fastify.get('/api/stats', {
    preHandler: apiKeyAuth,
    handler: async (_request: FastifyRequest, reply: FastifyReply) => {
      const stats = getJobStats();
      return reply.send(stats);
    }
  });
}
