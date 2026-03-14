/**
 * Worklist Mock Service - Andex Gateway
 * ======================================
 * Datos de prueba para desarrollo local sin PACS real.
 * Activa con WORKLIST_MODE=mock en .env
 */

import { WorklistItem } from './worklist.service.js';

/**
 * Genera la fecha de hoy en formato DICOM (YYYYMMDD)
 */
function getTodayDicom(): string {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Genera datetime ISO para hoy a una hora específica
 */
function getTodayAt(hour: number, minute: number = 0): string {
  const today = new Date();
  today.setHours(hour, minute, 0, 0);
  return today.toISOString();
}

/**
 * Datos mock de Worklist con procedimientos realistas de endoscopia
 */
export function generateMockWorklist(): WorklistItem[] {
  const today = getTodayDicom();
  
  return [
    {
      // Procedimiento 1: Endoscopia Digestiva Alta
      accessionNumber: `ACC${today}001`,
      studyInstanceUID: `1.2.840.113619.2.55.3.${Date.now()}.1`,
      scheduledProcedureStepID: 'SPS001',
      requestedProcedureID: 'RP001',
      
      patientID: '12.345.678-9',
      patientName: 'PEREZ GONZALEZ^JUAN CARLOS',
      patientBirthDate: '19750515',
      patientSex: 'M',
      
      scheduledDateTime: getTodayAt(9, 0),
      modality: 'ES',
      scheduledStationAET: 'ANDEX01',
      scheduledStationName: 'Sala Endoscopia 1',
      
      scheduledProcedureDescription: 'ENDOSCOPIA DIGESTIVA ALTA',
      requestedProcedureDescription: 'EDA por pirosis y reflujo gastroesofágico',
      
      referringPhysicianName: 'DR. MARTINEZ SOTO^ROBERTO',
      scheduledPerformingPhysician: 'DR. GALLARDO VILLALOBOS^ALVARO',
      
      institutionName: 'Hospital Naval Talcahuano',
      departmentName: 'Unidad de Endoscopia',
      
      procedureStepState: 'SCHEDULED'
    },
    {
      // Procedimiento 2: Colonoscopia Total
      accessionNumber: `ACC${today}002`,
      studyInstanceUID: `1.2.840.113619.2.55.3.${Date.now()}.2`,
      scheduledProcedureStepID: 'SPS002',
      requestedProcedureID: 'RP002',
      
      patientID: '11.222.333-4',
      patientName: 'RODRIGUEZ MUNOZ^MARIA ELENA',
      patientBirthDate: '19821120',
      patientSex: 'F',
      
      scheduledDateTime: getTodayAt(10, 30),
      modality: 'ES',
      scheduledStationAET: 'ANDEX01',
      scheduledStationName: 'Sala Endoscopia 1',
      
      scheduledProcedureDescription: 'COLONOSCOPIA TOTAL',
      requestedProcedureDescription: 'Screening cáncer colorrectal por antecedentes familiares',
      
      referringPhysicianName: 'DRA. SILVA FERNANDEZ^CAROLINA',
      scheduledPerformingPhysician: 'DR. GALLARDO VILLALOBOS^ALVARO',
      
      institutionName: 'Hospital Naval Talcahuano',
      departmentName: 'Unidad de Endoscopia',
      
      procedureStepState: 'SCHEDULED'
    },
    {
      // Procedimiento 3: EDA + Biopsia (en progreso)
      accessionNumber: `ACC${today}003`,
      studyInstanceUID: `1.2.840.113619.2.55.3.${Date.now()}.3`,
      scheduledProcedureStepID: 'SPS003',
      requestedProcedureID: 'RP003',
      
      patientID: '15.642.819-1',
      patientName: 'FERNANDEZ CASTRO^LUIS ALBERTO',
      patientBirthDate: '19680708',
      patientSex: 'M',
      
      scheduledDateTime: getTodayAt(11, 0),
      modality: 'ES',
      scheduledStationAET: 'ANDEX01',
      scheduledStationName: 'Sala Endoscopia 1',
      
      scheduledProcedureDescription: 'EDA + BIOPSIA GASTRICA',
      requestedProcedureDescription: 'Control úlcera gástrica con toma de biopsias',
      
      referringPhysicianName: 'DR. TORRES LAGOS^PEDRO',
      scheduledPerformingPhysician: 'DR. GALLARDO VILLALOBOS^ALVARO',
      
      institutionName: 'Hospital Naval Talcahuano',
      departmentName: 'Unidad de Endoscopia',
      
      procedureStepState: 'IN PROGRESS'
    },
    {
      // Procedimiento 4: Rectosigmoidoscopia
      accessionNumber: `ACC${today}004`,
      studyInstanceUID: `1.2.840.113619.2.55.3.${Date.now()}.4`,
      scheduledProcedureStepID: 'SPS004',
      requestedProcedureID: 'RP004',
      
      patientID: '9.876.543-2',
      patientName: 'SANCHEZ MORALES^PATRICIA',
      patientBirthDate: '19901225',
      patientSex: 'F',
      
      scheduledDateTime: getTodayAt(14, 0),
      modality: 'ES',
      scheduledStationAET: 'ANDEX01',
      scheduledStationName: 'Sala Endoscopia 1',
      
      scheduledProcedureDescription: 'RECTOSIGMOIDOSCOPIA',
      requestedProcedureDescription: 'Estudio por rectorragia intermitente',
      
      referringPhysicianName: 'DR. VARGAS PINTO^MIGUEL',
      scheduledPerformingPhysician: 'DR. GALLARDO VILLALOBOS^ALVARO',
      
      institutionName: 'Hospital Naval Talcahuano',
      departmentName: 'Unidad de Endoscopia',
      
      procedureStepState: 'SCHEDULED'
    },
    {
      // Procedimiento 5: EDA + Test Ureasa (H. pylori)
      accessionNumber: `ACC${today}005`,
      studyInstanceUID: `1.2.840.113619.2.55.3.${Date.now()}.5`,
      scheduledProcedureStepID: 'SPS005',
      requestedProcedureID: 'RP005',
      
      patientID: '16.789.012-3',
      patientName: 'GONZALEZ VERA^ANDRES FELIPE',
      patientBirthDate: '19880314',
      patientSex: 'M',
      
      scheduledDateTime: getTodayAt(15, 30),
      modality: 'ES',
      scheduledStationAET: 'ANDEX01',
      scheduledStationName: 'Sala Endoscopia 1',
      
      scheduledProcedureDescription: 'EDA + TEST UREASA',
      requestedProcedureDescription: 'Sospecha de infección por H. pylori, epigastralgia crónica',
      
      referringPhysicianName: 'DRA. NUNEZ CONTRERAS^ANA MARIA',
      scheduledPerformingPhysician: 'DR. GALLARDO VILLALOBOS^ALVARO',
      
      institutionName: 'Hospital Naval Talcahuano',
      departmentName: 'Unidad de Endoscopia',
      
      procedureStepState: 'SCHEDULED'
    },
    {
      // Procedimiento 6: Colonoscopia + Polipectomía
      accessionNumber: `ACC${today}006`,
      studyInstanceUID: `1.2.840.113619.2.55.3.${Date.now()}.6`,
      scheduledProcedureStepID: 'SPS006',
      requestedProcedureID: 'RP006',
      
      patientID: '8.765.432-1',
      patientName: 'MUÑOZ BRAVO^CARMEN GLORIA',
      patientBirthDate: '19650420',
      patientSex: 'F',
      
      scheduledDateTime: getTodayAt(16, 30),
      modality: 'ES',
      scheduledStationAET: 'ANDEX01',
      scheduledStationName: 'Sala Endoscopia 1',
      
      scheduledProcedureDescription: 'COLONOSCOPIA + POLIPECTOMIA',
      requestedProcedureDescription: 'Resección de pólipos detectados en colonoscopia previa',
      
      referringPhysicianName: 'DR. SOTO FUENTES^JORGE',
      scheduledPerformingPhysician: 'DR. GALLARDO VILLALOBOS^ALVARO',
      
      institutionName: 'Hospital Naval Talcahuano',
      departmentName: 'Unidad de Endoscopia',
      
      procedureStepState: 'SCHEDULED'
    }
  ];
}

/**
 * Filtra worklist mock según query
 */
export function filterMockWorklist(items: WorklistItem[], query: {
  patientID?: string;
  patientName?: string;
  accessionNumber?: string;
  modality?: string;
  date?: string;
}): WorklistItem[] {
  return items.filter(item => {
    // Filtrar por Patient ID (RUT)
    if (query.patientID && !item.patientID.includes(query.patientID)) {
      return false;
    }
    
    // Filtrar por nombre (case insensitive, soporta wildcards *)
    if (query.patientName) {
      const pattern = query.patientName.replace(/\*/g, '.*');
      const regex = new RegExp(pattern, 'i');
      if (!regex.test(item.patientName)) {
        return false;
      }
    }
    
    // Filtrar por Accession Number
    if (query.accessionNumber && !item.accessionNumber.includes(query.accessionNumber)) {
      return false;
    }
    
    // Filtrar por modalidad
    if (query.modality && item.modality !== query.modality) {
      return false;
    }
    
    return true;
  });
}

/**
 * Busca un item específico por Accession Number
 */
export function getMockWorklistItem(accessionNumber: string): WorklistItem | null {
  const items = generateMockWorklist();
  return items.find(item => item.accessionNumber === accessionNumber) || null;
}

console.log('🧪 Worklist Mock Service cargado');
