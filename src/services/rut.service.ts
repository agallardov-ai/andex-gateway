/**
 * RUT Service
 * Normalización y validación de RUT chileno
 */

/**
 * Normaliza un RUT chileno a formato estándar (XXXXXXXX-X sin puntos)
 * Acepta formatos: 12345678-9, 12.345.678-9, 123456789
 */
export function normalizeRut(rut: string): string {
  if (!rut) return '';

  // Remover todo excepto números y K/k
  let cleaned = rut.toUpperCase().replace(/[^0-9K]/g, '');

  if (cleaned.length < 2) return '';

  // Separar cuerpo y dígito verificador
  const dv = cleaned.slice(-1);
  const body = cleaned.slice(0, -1);

  return `${body}-${dv}`;
}

/**
 * Extrae el RUT de un PatientID HL7
 * El PatientID puede venir en formatos:
 * - "12345678-9" (RUT directo)
 * - "RUT:12345678-9"
 * - "12.345.678-9"
 * - Otros formatos de ID hospitalario
 */
export function extractRutFromPatientId(patientId: string): string | null {
  if (!patientId) return null;

  // Patrón para RUT chileno (7-8 dígitos + dígito verificador)
  const rutPattern = /(\d{7,8})[-.K]?([0-9K])/i;

  // Buscar en el patientId
  const match = patientId.toUpperCase().replace(/\./g, '').match(rutPattern);

  if (match) {
    const body = match[1];
    const dv = match[2];
    return `${body}-${dv}`;
  }

  return null;
}

/**
 * Valida que un RUT tenga el dígito verificador correcto
 */
export function validateRut(rut: string): boolean {
  const normalized = normalizeRut(rut);
  if (!normalized || !normalized.includes('-')) return false;

  const [body, dv] = normalized.split('-');

  if (!body || body.length < 7 || body.length > 8) return false;

  // Calcular dígito verificador
  const calculatedDv = calculateDV(body);

  return dv === calculatedDv;
}

/**
 * Calcula el dígito verificador de un RUT
 */
function calculateDV(rutBody: string): string {
  const rutDigits = rutBody.split('').reverse().map(Number);
  const multipliers = [2, 3, 4, 5, 6, 7];

  let sum = 0;
  for (let i = 0; i < rutDigits.length; i++) {
    sum += rutDigits[i] * multipliers[i % 6];
  }

  const remainder = sum % 11;
  const dv = 11 - remainder;

  if (dv === 11) return '0';
  if (dv === 10) return 'K';
  return String(dv);
}

/**
 * Formatea un RUT para mostrar (con puntos)
 */
export function formatRutDisplay(rut: string): string {
  const normalized = normalizeRut(rut);
  if (!normalized || !normalized.includes('-')) return rut;

  const [body, dv] = normalized.split('-');

  // Agregar puntos cada 3 dígitos desde la derecha
  const formatted = body.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

  return `${formatted}-${dv}`;
}

/**
 * Extrae el nombre del paciente en formato legible
 * HL7 usa formato: "APELLIDO^NOMBRE" o "APELLIDO^NOMBRE^SEGUNDO"
 */
export function parsePatientName(hl7Name: string): string {
  if (!hl7Name) return '';

  // Separar por ^ (formato HL7)
  const parts = hl7Name.split('^');

  if (parts.length >= 2) {
    const apellido = parts[0].trim();
    const nombre = parts.slice(1).join(' ').trim();
    return `${nombre} ${apellido}`.trim();
  }

  // Si no tiene ^, devolver tal cual
  return hl7Name.trim();
}

/**
 * Parsea fecha HL7 (YYYYMMDD) a formato ISO (YYYY-MM-DD)
 */
export function parseHl7Date(hl7Date: string): string | null {
  if (!hl7Date || hl7Date.length < 8) return null;

  const year = hl7Date.substring(0, 4);
  const month = hl7Date.substring(4, 6);
  const day = hl7Date.substring(6, 8);

  return `${year}-${month}-${day}`;
}

/**
 * Parsea hora HL7 (HHMMSS) a formato HH:MM
 */
export function parseHl7Time(hl7Time: string): string {
  if (!hl7Time || hl7Time.length < 4) return '00:00';

  const hour = hl7Time.substring(0, 2);
  const minute = hl7Time.substring(2, 4);

  return `${hour}:${minute}`;
}

/**
 * Parsea scheduledDateTime combinado (puede venir en varios formatos)
 * - YYYYMMDDHHMMSS
 * - YYYYMMDD HHMMSS
 * - YYYY-MM-DD HH:MM:SS
 * - YYYY-MM-DDTHH:MM:SS
 */
export function parseScheduledDateTime(dateTime: string): { fecha: string; hora: string } {
  if (!dateTime) {
    return { fecha: new Date().toISOString().split('T')[0], hora: '00:00' };
  }

  // Si tiene T (ISO format)
  if (dateTime.includes('T')) {
    const [datePart, timePart] = dateTime.split('T');
    const fecha = datePart;
    const hora = timePart ? timePart.substring(0, 5) : '00:00';
    return { fecha, hora };
  }

  // Si tiene - (formato YYYY-MM-DD HH:MM:SS)
  if (dateTime.includes('-')) {
    const parts = dateTime.split(' ');
    const fecha = parts[0];
    const hora = parts[1] ? parts[1].substring(0, 5) : '00:00';
    return { fecha, hora };
  }

  // Formato HL7 puro: YYYYMMDDHHMMSS o YYYYMMDD
  const cleaned = dateTime.replace(/\s/g, '');
  
  if (cleaned.length >= 8) {
    const year = cleaned.substring(0, 4);
    const month = cleaned.substring(4, 6);
    const day = cleaned.substring(6, 8);
    const fecha = `${year}-${month}-${day}`;

    let hora = '00:00';
    if (cleaned.length >= 12) {
      const hour = cleaned.substring(8, 10);
      const minute = cleaned.substring(10, 12);
      hora = `${hour}:${minute}`;
    }

    return { fecha, hora };
  }

  return { fecha: new Date().toISOString().split('T')[0], hora: '00:00' };
}
