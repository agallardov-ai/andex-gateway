/**
 * Supabase Service
 * Cliente para conectar con el backend de la PWA (Supabase)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { supabaseConfig } from '../config/env.js';
import { log } from './observability.service.js';

let supabaseClient: SupabaseClient | null = null;

// Tipos de las tablas de Supabase
export interface Paciente {
  id: string;
  rut: string;
  nombre: string;
  fecha_nacimiento?: string;
  nhc?: string;
  hl7_patient_id?: string;
  source?: 'pacs' | 'manual';
  centro_id?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Agenda {
  id: string;
  paciente_id: string;
  fecha: string;
  hora: string;
  box_id?: string;
  centro_id?: string;
  estado: 'pendiente' | 'en_curso' | 'completado' | 'cancelado' | 'cancelado_pacs';
  source?: 'pacs' | 'manual';
  accession_number?: string;
  pacs_synced_at?: string;
  created_at?: string;
  updated_at?: string;
}

export interface Evento {
  id: string;
  agenda_id: string;
  accession_number?: string;
  study_instance_uid?: string;
  pacs_status?: string;
  created_at?: string;
}

/**
 * Inicializa el cliente de Supabase
 */
export function initSupabase(): boolean {
  if (!supabaseConfig.enabled) {
    log('warn', 'Supabase not configured - sync disabled');
    return false;
  }

  try {
    supabaseClient = createClient(supabaseConfig.url, supabaseConfig.serviceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    log('info', 'Supabase client initialized');
    return true;
  } catch (error) {
    log('error', 'Failed to initialize Supabase', { error: String(error) });
    return false;
  }
}

/**
 * Obtiene el cliente de Supabase
 */
export function getSupabase(): SupabaseClient | null {
  return supabaseClient;
}

/**
 * Verifica si Supabase está disponible
 */
export function isSupabaseEnabled(): boolean {
  return supabaseConfig.enabled && supabaseClient !== null;
}

// =========== OPERACIONES CON PACIENTES ===========

/**
 * Busca un paciente por RUT normalizado
 */
export async function findPacienteByRut(rutNormalizado: string): Promise<Paciente | null> {
  if (!supabaseClient) return null;

  const { data, error } = await supabaseClient
    .from('pacientes')
    .select('*')
    .eq('rut', rutNormalizado)
    .maybeSingle();

  if (error) {
    log('error', 'Error finding paciente by RUT', { rut: rutNormalizado, error: error.message });
    return null;
  }

  return data;
}

/**
 * Crea un nuevo paciente
 */
export async function createPaciente(paciente: Partial<Paciente>): Promise<Paciente | null> {
  if (!supabaseClient) return null;

  const { data, error } = await supabaseClient
    .from('pacientes')
    .insert({
      ...paciente,
      source: 'pacs',
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    log('error', 'Error creating paciente', { rut: paciente.rut, error: error.message });
    return null;
  }

  log('info', 'Created paciente from PACS', { rut: paciente.rut, id: data.id });
  return data;
}

/**
 * Actualiza un paciente existente
 */
export async function updatePaciente(id: string, updates: Partial<Paciente>): Promise<Paciente | null> {
  if (!supabaseClient) return null;

  const { data, error } = await supabaseClient
    .from('pacientes')
    .update({
      ...updates,
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    log('error', 'Error updating paciente', { id, error: error.message });
    return null;
  }

  return data;
}

// =========== OPERACIONES CON AGENDA ===========

/**
 * Busca una cita por accession_number
 */
export async function findAgendaByAccession(accessionNumber: string): Promise<Agenda | null> {
  if (!supabaseClient) return null;

  const { data, error } = await supabaseClient
    .from('agenda')
    .select('*')
    .eq('accession_number', accessionNumber)
    .maybeSingle();

  if (error) {
    log('error', 'Error finding agenda by accession', { accessionNumber, error: error.message });
    return null;
  }

  return data;
}

/**
 * Busca citas por paciente y fecha
 */
export async function findAgendaByPacienteFecha(pacienteId: string, fecha: string): Promise<Agenda[]> {
  if (!supabaseClient) return [];

  const { data, error } = await supabaseClient
    .from('agenda')
    .select('*')
    .eq('paciente_id', pacienteId)
    .eq('fecha', fecha);

  if (error) {
    log('error', 'Error finding agenda', { pacienteId, fecha, error: error.message });
    return [];
  }

  return data || [];
}

/**
 * Crea una nueva cita en agenda
 */
export async function createAgenda(agenda: Partial<Agenda>): Promise<Agenda | null> {
  if (!supabaseClient) return null;

  const { data, error } = await supabaseClient
    .from('agenda')
    .insert({
      ...agenda,
      source: 'pacs',
      estado: 'pendiente',
      pacs_synced_at: new Date().toISOString(),
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    log('error', 'Error creating agenda', { accession: agenda.accession_number, error: error.message });
    return null;
  }

  log('info', 'Created agenda from PACS', { accession: agenda.accession_number, id: data.id });
  return data;
}

/**
 * Actualiza una cita existente
 */
export async function updateAgenda(id: string, updates: Partial<Agenda>): Promise<Agenda | null> {
  if (!supabaseClient) return null;

  const { data, error } = await supabaseClient
    .from('agenda')
    .update({
      ...updates,
      pacs_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', id)
    .select()
    .single();

  if (error) {
    log('error', 'Error updating agenda', { id, error: error.message });
    return null;
  }

  return data;
}

/**
 * Marca una cita como cancelada por PACS
 */
export async function cancelAgendaByPacs(id: string): Promise<boolean> {
  if (!supabaseClient) return false;

  const { error } = await supabaseClient
    .from('agenda')
    .update({
      estado: 'cancelado_pacs',
      pacs_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq('id', id);

  if (error) {
    log('error', 'Error cancelling agenda', { id, error: error.message });
    return false;
  }

  log('info', 'Agenda cancelled by PACS', { id });
  return true;
}

/**
 * Obtiene todas las citas de hoy con source='pacs'
 */
export async function getTodayPacsAgenda(): Promise<Agenda[]> {
  if (!supabaseClient) return [];

  const today = new Date().toISOString().split('T')[0];

  const { data, error } = await supabaseClient
    .from('agenda')
    .select('*')
    .eq('fecha', today)
    .eq('source', 'pacs');

  if (error) {
    log('error', 'Error getting today PACS agenda', { error: error.message });
    return [];
  }

  return data || [];
}
