/**
 * PACS Physician Service
 * Mapeo de nombres de médicos PACS a usuarios del sistema
 */

import { getSupabase, isSupabaseEnabled } from './supabase.service.js';
import { log } from './observability.service.js';

export interface PacsPhysician {
  id: string;
  centro_id: string;
  pacs_name: string;
  usuario_id: string | null;
  estado: 'sin_mapear' | 'mapeado' | 'conflicto';
  created_at?: string;
  mapped_at?: string;
  mapped_by?: string;
}

/**
 * Busca o crea un médico PACS por nombre
 * Retorna el usuario_id si está mapeado, null si no
 */
export async function findOrCreatePacsPhysician(
  centroId: string,
  pacsName: string
): Promise<{ pacsPhysician: PacsPhysician | null; usuarioId: string | null }> {
  const supabase = getSupabase();
  
  if (!supabase || !pacsName || !centroId) {
    return { pacsPhysician: null, usuarioId: null };
  }

  const normalizedName = pacsName.trim();
  if (!normalizedName) {
    return { pacsPhysician: null, usuarioId: null };
  }

  // Buscar si ya existe
  const { data: existing, error: searchError } = await supabase
    .from('pacs_physicians')
    .select('*')
    .eq('centro_id', centroId)
    .eq('pacs_name', normalizedName)
    .maybeSingle();

  if (existing) {
    log('debug', `Found existing PACS physician: ${normalizedName}`, { 
      estado: existing.estado,
      usuario_id: existing.usuario_id 
    });
    return { 
      pacsPhysician: existing, 
      usuarioId: existing.estado === 'mapeado' ? existing.usuario_id : null 
    };
  }

  // No existe, crear nuevo
  const { data: created, error: createError } = await supabase
    .from('pacs_physicians')
    .insert({
      centro_id: centroId,
      pacs_name: normalizedName,
      estado: 'sin_mapear'
    })
    .select()
    .single();

  if (createError) {
    // Puede ser race condition, intentar buscar de nuevo
    if (createError.code === '23505') { // unique violation
      const { data: retry } = await supabase
        .from('pacs_physicians')
        .select('*')
        .eq('centro_id', centroId)
        .eq('pacs_name', normalizedName)
        .maybeSingle();
      
      if (retry) {
        return { 
          pacsPhysician: retry, 
          usuarioId: retry.estado === 'mapeado' ? retry.usuario_id : null 
        };
      }
    }
    
    log('error', 'Error creating PACS physician', { 
      pacs_name: normalizedName, 
      error: createError.message 
    });
    return { pacsPhysician: null, usuarioId: null };
  }

  log('info', `Created new PACS physician: ${normalizedName}`, { 
    id: created.id,
    estado: 'sin_mapear'
  });
  
  return { pacsPhysician: created, usuarioId: null };
}

/**
 * Obtiene el usuario_id mapeado para un nombre PACS
 * Versión rápida que solo retorna el ID
 */
export async function getMappedUsuarioId(
  centroId: string,
  pacsName: string
): Promise<string | null> {
  const supabase = getSupabase();
  
  if (!supabase || !pacsName || !centroId) return null;

  const { data, error } = await supabase
    .from('pacs_physicians')
    .select('usuario_id, estado')
    .eq('centro_id', centroId)
    .eq('pacs_name', pacsName.trim())
    .eq('estado', 'mapeado')
    .maybeSingle();

  if (error || !data) return null;
  return data.usuario_id;
}

/**
 * Obtiene todos los médicos PACS de un centro
 */
export async function getPacsPhysiciansByCentro(centroId: string): Promise<PacsPhysician[]> {
  const supabase = getSupabase();
  
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('pacs_physicians')
    .select('*')
    .eq('centro_id', centroId)
    .order('pacs_name');

  if (error) {
    log('error', 'Error getting PACS physicians', { error: error.message });
    return [];
  }

  return data || [];
}

/**
 * Obtiene médicos PACS sin mapear de un centro
 */
export async function getUnmappedPacsPhysicians(centroId: string): Promise<PacsPhysician[]> {
  const supabase = getSupabase();
  
  if (!supabase) return [];

  const { data, error } = await supabase
    .from('pacs_physicians')
    .select('*')
    .eq('centro_id', centroId)
    .eq('estado', 'sin_mapear')
    .order('pacs_name');

  if (error) {
    log('error', 'Error getting unmapped PACS physicians', { error: error.message });
    return [];
  }

  return data || [];
}
