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

// =====================================================
// VALIDACIÓN DE CAMPOS CRÍTICOS PARA SYNAPSE
// =====================================================

interface DicomValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Valida campos críticos que Synapse 7 requiere
 * Si faltan, el estudio puede ser rechazado o mal indexado
 */
function validateDicomForSynapse(info: {
  studyUID?: string;
  seriesUID?: string;
  sopInstanceUID?: string;
  patientId?: string;
  patientName?: string;
  modality?: string;
  accessionNumber?: string;
}): DicomValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ===== ERRORES (campos obligatorios) =====
  
  // StudyInstanceUID es OBLIGATORIO para almacenar en PACS
  if (!info.studyUID) {
    errors.push('StudyInstanceUID (0020,000D) es obligatorio');
  } else if (!isValidUID(info.studyUID)) {
    errors.push('StudyInstanceUID tiene formato inválido');
  }

  // SOPInstanceUID es OBLIGATORIO para DICOM
  if (!info.sopInstanceUID) {
    errors.push('SOPInstanceUID (0008,0018) es obligatorio');
  } else if (!isValidUID(info.sopInstanceUID)) {
    errors.push('SOPInstanceUID tiene formato inválido');
  }

  // PatientID es crítico para Synapse - sin esto no puede vincular
  if (!info.patientId) {
    errors.push('PatientID (0010,0020) es obligatorio para Synapse');
  } else if (info.patientId.length < 5) {
    warnings.push('PatientID muy corto, verificar RUT completo');
  }

  // ===== WARNINGS (campos recomendados) =====

  // SeriesInstanceUID - importante para organización
  if (!info.seriesUID) {
    warnings.push('SeriesInstanceUID (0020,000E) no presente');
  }

  // PatientName - importante para búsqueda
  if (!info.patientName) {
    warnings.push('PatientName (0010,0010) no presente');
  }

  // Modality - importante para filtrado
  if (!info.modality) {
    warnings.push('Modality (0008,0060) no presente, se asumirá OT');
  }

  // AccessionNumber - crítico para vincular con Worklist
  if (!info.accessionNumber) {
    warnings.push('AccessionNumber (0008,0050) no presente - no se vinculará con Worklist');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Valida formato de DICOM UID (números y puntos)
 */
function isValidUID(uid: string): boolean {
  // UID format: números separados por puntos, max 64 chars
  return /^[\d.]+$/.test(uid) && uid.length <= 64 && uid.length >= 10;
}

// =====================================================
// RUTAS
// =====================================================

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

        // Validate DICOM header
        if (!isValidDicom(fileBuffer)) {
          return reply.code(400).send({ 
            success: false, 
            error: 'Invalid DICOM file (missing DICM header at offset 128)' 
          });
        }

        // Extract DICOM metadata
        const dicomInfo = extractDicomInfo(fileBuffer);

        // ===== VALIDACIÓN CRÍTICA PARA SYNAPSE =====
        const validation = validateDicomForSynapse(dicomInfo);
        
        if (!validation.valid) {
          log('error', 'DICOM validation failed', { 
            filename: data.filename,
            errors: validation.errors 
          });
          
          return reply.code(400).send({ 
            success: false, 
            error: 'DICOM validation failed for Synapse',
            validationErrors: validation.errors,
            validationWarnings: validation.warnings,
            extractedInfo: {
              studyUID: dicomInfo.studyUID || null,
              patientId: dicomInfo.patientId || null,
              modality: dicomInfo.modality || null
            }
          });
        }

        // Log warnings pero continuar
        if (validation.warnings.length > 0) {
          log('warn', 'DICOM has warnings', { 
            filename: data.filename,
            warnings: validation.warnings 
          });
        }

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
        log('info', 'DICOM file received and validated', { 
          jobId: job.id, 
          filename, 
          size: fileBuffer.length,
          patientId: dicomInfo.patientId,
          studyUID: dicomInfo.studyUID?.substring(0, 20) + '...',
          warnings: validation.warnings.length
        });

        // Try to process immediately (non-blocking)
        setImmediate(() => {
          processJob(job).catch(err => {
            fastify.log.error({ jobId: job.id, error: err }, 'Immediate processing failed');
          });
        });

        const response: UploadResponse & { warnings?: string[] } = {
          success: true,
          jobId: job.id,
          message: validation.warnings.length > 0 
            ? 'File received with warnings, queued for processing'
            : 'File received and queued for processing',
          status: job.status,
        };

        // Incluir warnings en respuesta
        if (validation.warnings.length > 0) {
          response.warnings = validation.warnings;
        }

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

  // ===== NUEVO: Upload con validación de Worklist =====
  fastify.post('/api/upload/validated', {
    preHandler: apiKeyAuth,
    handler: async (request: FastifyRequest<{
      Querystring: { accessionNumber?: string; patientId?: string }
    }>, reply: FastifyReply) => {
      const { accessionNumber, patientId } = request.query;
      
      // Si viene accessionNumber, el DICOM DEBE coincidir con la Worklist
      if (accessionNumber && !patientId) {
        return reply.code(400).send({
          success: false,
          error: 'Si especifica accessionNumber, debe incluir patientId para validación cruzada'
        });
      }

      // Continuar con upload normal pero agregar metadata de worklist
      // Esto es útil para tracking
      log('info', 'Upload validado con Worklist', { accessionNumber, patientId });
      
      // Redirigir al handler normal
      // En producción, aquí se verificaría contra la worklist
      return reply.code(501).send({
        success: false,
        error: 'Endpoint en desarrollo - usar /api/upload'
      });
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
