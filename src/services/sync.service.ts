/**
 * Sync Service
 * Sincroniza Worklist PACS → Supabase Agenda
 * 
 * Comportamiento:
 * - Auto-crea pacientes nuevos (source='pacs')
 * - Auto-crea citas nuevas (source='pacs')
 * - Auto-registra médicos PACS y busca mapeo a usuarios
 * - Auto-cancela si PACS elimina (estado='cancelado_pacs', NUNCA borra)
 * - Auto-actualiza hora solo si source='pacs' (no toca manuales)
 * - Polling cada 30 segundos
 */

import { WorklistItem } from './worklist.service.js';
import { syncConfig, supabaseConfig } from '../config/env.js';
import { log } from './observability.service.js';
import {
  isSupabaseEnabled,
  findPacienteByRut,
  createPaciente,
  findAgendaByAccession,
  findAgendaByPacienteFecha,
  createAgenda,
  updateAgenda,
  getTodayPacsAgenda,
  Paciente,
  Agenda
} from './supabase.service.js';
import {
  normalizeRut,
  extractRutFromPatientId,
  parsePatientName,
  parseScheduledDateTime,
  parseHl7Date
} from './rut.service.js';
import { findOrCreatePacsPhysician } from './pacs-physician.service.js';
import { mapProcedure } from './procedure-mapping.service.js';

export interface SyncResult {
  success: boolean;
  created: number;
  updated: number;
  cancelled: number;
  errors: string[];
}

/**
 * Sincroniza una lista de WorklistItems con Supabase
 */
export async function syncWorklistToSupabase(items: WorklistItem[]): Promise<SyncResult> {
  const result: SyncResult = {
    success: true,
    created: 0,
    updated: 0,
    cancelled: 0,
    errors: []
  };

  if (!syncConfig.enabled) {
    log('debug', 'Sync disabled by config');
    return result;
  }

  if (!isSupabaseEnabled()) {
    log('debug', 'Supabase not enabled, skipping sync');
    return result;
  }

  log('info', `Starting sync of ${items.length} worklist items`);

  // Obtener accession numbers actuales del worklist
  const currentAccessions = new Set(items.map(i => i.accessionNumber).filter(Boolean));

  // Procesar cada item del worklist
  for (const item of items) {
    try {
      await syncWorklistItem(item, result);
    } catch (error) {
      const errMsg = `Error syncing ${item.accessionNumber}: ${error instanceof Error ? error.message : String(error)}`;
      result.errors.push(errMsg);
      log('error', errMsg);
    }
  }

  // Detectar citas canceladas en PACS
  try {
    await detectCancelledItems(currentAccessions, result);
  } catch (error) {
    const errMsg = `Error detecting cancellations: ${error instanceof Error ? error.message : String(error)}`;
    result.errors.push(errMsg);
    log('error', errMsg);
  }

  result.success = result.errors.length === 0;
  log('info', `Sync completed`, { 
    created: result.created, 
    updated: result.updated, 
    cancelled: result.cancelled,
    errors: result.errors.length 
  });

  return result;
}

/**
 * Sincroniza un item individual del worklist
 */
async function syncWorklistItem(item: WorklistItem, result: SyncResult): Promise<void> {
  if (!item.accessionNumber) {
    log('warn', 'Skipping worklist item without accessionNumber');
    return;
  }

  // 1. Buscar o crear paciente
  const paciente = await findOrCreatePaciente(item);
  if (!paciente) {
    result.errors.push(`Could not find/create paciente for ${item.patientID}`);
    return;
  }

  // 2. Buscar cita existente por accession_number
  let agenda = await findAgendaByAccession(item.accessionNumber);

  if (agenda) {
    // Cita existe - verificar si hay cambios
    await handleExistingAgenda(agenda, item, paciente, result);
  } else {
    // Cita nueva - crear
    await handleNewAgenda(item, paciente, result);
  }
}

/**
 * Busca o crea un paciente basado en el WorklistItem
 */
async function findOrCreatePaciente(item: WorklistItem): Promise<Paciente | null> {
  // Extraer RUT del PatientID
  const rut = extractRutFromPatientId(item.patientID || '');
  
  if (!rut) {
    log('warn', `Could not extract RUT from patientID: ${item.patientID}`);
    return null;
  }

  const rutNormalizado = normalizeRut(rut);

  // Buscar paciente existente
  let paciente = await findPacienteByRut(rutNormalizado);

  if (paciente) {
    log('debug', `Found existing paciente: ${rutNormalizado}`);
    return paciente;
  }

  // Crear nuevo paciente
  const nombreCompleto = parsePatientName(item.patientName || '');
  const fechaNacimiento = parseHl7Date(item.patientBirthDate || '');

  paciente = await createPaciente({
    rut: rutNormalizado,
    nombre: nombreCompleto || 'Sin Nombre',
    fecha_nacimiento: fechaNacimiento || undefined,
    hl7_patient_id: item.patientID,
    centro_id: syncConfig.defaultCentroId,
    source: 'pacs'
  });

  return paciente;
}

/**
 * Obtiene el médico (usuario_id) desde el nombre PACS
 * Registra el nombre PACS si no existe
 */
async function resolveMedicoId(item: WorklistItem): Promise<string | null> {
  // Prioridad: scheduledPerformingPhysician > referringPhysicianName
  const physicianName = item.scheduledPerformingPhysician || item.referringPhysicianName;
  
  if (!physicianName || !physicianName.trim()) {
    return null;
  }

  // Filtrar nombres genéricos/inválidos de Synapse y otros PACS
  const invalidNames = [
    'unknown',
    'tecnologo',
    'tecnologa',
    'enfermero',
    'enfermera',
    'admin',
    'sistema',
    'system',
    'n/a',
    'na',
    'sin asignar',
    'por asignar'
  ];
  
  const nameLower = physicianName.toLowerCase().replace(/\^/g, ' ').trim();
  if (invalidNames.some(invalid => nameLower.includes(invalid))) {
    log('debug', `Skipping invalid physician name: ${physicianName}`);
    return null;
  }

  const centroId = syncConfig.defaultCentroId;
  if (!centroId) {
    return null;
  }

  // Buscar o crear el médico PACS y obtener el usuario mapeado
  const { usuarioId } = await findOrCreatePacsPhysician(centroId, physicianName);
  
  if (usuarioId) {
    log('debug', `Resolved PACS physician "${physicianName}" to usuario ${usuarioId}`);
  } else {
    log('debug', `PACS physician "${physicianName}" not mapped yet`);
  }
  
  return usuarioId;
}

/**
 * Maneja una cita existente - actualiza si es necesario
 * IMPORTANTE: No sobrescribe procedimiento ni medico_id si fueron modificados manualmente
 */
async function handleExistingAgenda(
  agenda: Agenda,
  item: WorklistItem,
  paciente: Paciente,
  result: SyncResult
): Promise<void> {
  // Solo actualizar si la cita fue creada por PACS
  if (agenda.source !== 'pacs') {
    log('debug', `Skipping update - agenda ${agenda.id} is manual`);
    return;
  }

  // Parsear fecha/hora del worklist
  const { fecha, hora } = parseScheduledDateTime(item.scheduledDateTime || '');

  // Mapear procedimiento original del PACS para comparación
  const pacsProcedimiento = mapProcedure(item.scheduledProcedureDescription || item.requestedProcedureDescription);
  const currentProcedimiento = (agenda as any).procedimiento;
  
  // Detectar si el procedimiento fue modificado manualmente
  // Si el procedimiento actual NO coincide con el mapeo del PACS, no lo sobrescribimos
  const procedimientoModificado = currentProcedimiento && currentProcedimiento !== pacsProcedimiento;
  
  // Resolver médico (solo si no hay uno asignado manualmente)
  const currentMedicoId = (agenda as any).medico_id;
  const medicoId = currentMedicoId ? null : await resolveMedicoId(item);
  
  // Verificar si hay cambios (solo fecha/hora, no procedimiento ni médico si fueron modificados)
  const hasChanges = 
    agenda.fecha !== fecha || 
    agenda.hora !== hora ||
    (!currentMedicoId && medicoId);

  if (hasChanges) {
    const updates: any = {
      fecha,
      hora,
      pacs_synced_at: new Date().toISOString()
    };
    
    // Solo actualizar medico_id si NO había uno asignado manualmente
    if (!currentMedicoId && medicoId) {
      updates.medico_id = medicoId;
    }
    
    // Solo actualizar procedimiento si NO fue modificado manualmente
    if (!procedimientoModificado) {
      updates.procedimiento = pacsProcedimiento;
    }
    
    await updateAgenda(agenda.id, updates);
    result.updated++;
    log('info', `Updated agenda ${agenda.accession_number}: hora=${hora}${!procedimientoModificado ? `, procedimiento="${pacsProcedimiento}"` : ' (proc manual)'}${medicoId ? `, medico=${medicoId}` : ''}`);
  }
}

/**
 * Crea una nueva cita en agenda
 */
async function handleNewAgenda(
  item: WorklistItem,
  paciente: Paciente,
  result: SyncResult
): Promise<void> {
  const { fecha, hora } = parseScheduledDateTime(item.scheduledDateTime || '');

  // Solo incluir box_id si es un UUID válido (36 chars con guiones)
  const boxId = syncConfig.defaultBoxId;
  const isValidUuid = boxId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(boxId);

  // Resolver médico desde PACS
  const medicoId = await resolveMedicoId(item);

  const agendaData: any = {
    paciente_id: paciente.id,
    procedimiento: mapProcedure(item.scheduledProcedureDescription || item.requestedProcedureDescription),
    fecha,
    hora,
    ...(isValidUuid && { box_id: boxId }),
    accession_number: item.accessionNumber,
    estado: 'pendiente',
    centro_id: syncConfig.defaultCentroId,
    source: 'pacs'
  };

  // Agregar medico_id si tenemos uno mapeado
  if (medicoId) {
    agendaData.medico_id = medicoId;
  }

  const agenda = await createAgenda(agendaData);

  if (agenda) {
    result.created++;
    log('info', `Created agenda for ${paciente.rut} at ${hora} (${item.accessionNumber})${medicoId ? ` with medico ${medicoId}` : ''}`);
  }
}

/**
 * Detecta citas que fueron canceladas en PACS
 * (ya no aparecen en el worklist pero existen en Supabase)
 */
async function detectCancelledItems(
  currentAccessions: Set<string>,
  result: SyncResult
): Promise<void> {
  // Guard: si el worklist vino vacio, no cancelar (puede ser error de red)
  if (currentAccessions.size === 0) {
    log('warn', 'Worklist vacio - omitiendo deteccion de cancelaciones para evitar falsos positivos');
    return;
  }

  // Obtener todas las citas de hoy con source='pacs'
  const todayPacsAgenda = await getTodayPacsAgenda();

  for (const agenda of todayPacsAgenda) {
    // Si ya está cancelada, ignorar
    if (agenda.estado === 'cancelado_pacs' || agenda.estado === 'cancelado' || agenda.estado === 'completado') {
      continue;
    }

    // Si no tiene accession_number, no podemos verificar
    if (!agenda.accession_number) {
      continue;
    }

    // Si el accession_number no está en el worklist actual, fue cancelado
    if (!currentAccessions.has(agenda.accession_number)) {
      await updateAgenda(agenda.id, {
        estado: 'cancelado_pacs'
      });
      result.cancelled++;
      log('info', `Cancelled agenda ${agenda.accession_number} (not in PACS worklist)`);
    }
  }
}

/**
 * Estado del último sync
 */
let lastSyncResult: SyncResult | null = null;
let lastSyncTime: Date | null = null;

export function getLastSyncStatus(): { result: SyncResult | null; time: Date | null } {
  return { result: lastSyncResult, time: lastSyncTime };
}

export function setLastSyncResult(result: SyncResult): void {
  lastSyncResult = result;
  lastSyncTime = new Date();
}
