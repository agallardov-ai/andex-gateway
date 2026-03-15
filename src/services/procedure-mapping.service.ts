/**
 * Procedure Mapping Service
 * Mapea nombres de procedimientos del PACS a tipos estándar de la PWA
 */

// Tipos de procedimientos válidos en la PWA
export const VALID_PROCEDURES = [
  'Endoscopia Digestiva Alta',
  'Colonoscopia',
  'Nasofibroscopía',
  'Cistoscopia',
  'Biopsia de Próstata',
  'Gastrostomía',
  'Cistostomía',
  'ERCP',
  'EUS',
  'EBUS'
] as const;

export type ValidProcedure = typeof VALID_PROCEDURES[number];

/**
 * Mapeo de términos PACS a procedimientos estándar PWA
 * Las claves son patrones en minúsculas que se buscarán en el texto
 */
const PROCEDURE_PATTERNS: Array<{ patterns: string[], procedure: ValidProcedure }> = [
  // Endoscopia Digestiva Alta
  {
    patterns: [
      'endoscopia digestiva alta',
      'eda',
      'gastroscopia',
      'panendoscopia',
      'esofagogastroduodenoscopia',
      'egds',
      'egd',
      'endoscopia alta',
      'endoscopia superior',
      'upper endoscopy',
      'gastro',
      'eda + biopsia',
      'eda con biopsia'
    ],
    procedure: 'Endoscopia Digestiva Alta'
  },
  // Colonoscopia
  {
    patterns: [
      'colonoscopia',
      'colonoscopy',
      'colono',
      'colonoscopia total',
      'colonoscopia larga',
      'rectocolonoscopia',
      'videocolonoscopia'
    ],
    procedure: 'Colonoscopia'
  },
  // Nasofibroscopía
  {
    patterns: [
      'nasofibroscopia',
      'nasofibroscopía',
      'nasofibrolaringoscopia',
      'laringoscopia',
      'rinoscopia',
      'endoscopia nasal',
      'fibroscopia nasal'
    ],
    procedure: 'Nasofibroscopía'
  },
  // Cistoscopia
  {
    patterns: [
      'cistoscopia',
      'cistoscopía',
      'cystoscopy',
      'uretrocistoscopia',
      'endoscopia vesical',
      'cistouretroscopia'
    ],
    procedure: 'Cistoscopia'
  },
  // Biopsia de Próstata
  {
    patterns: [
      'biopsia de prostata',
      'biopsia prostata',
      'biopsia prostatica',
      'biopsia de próstata',
      'biopsia prostática',
      'prostate biopsy',
      'bp transrectal',
      'bp ecog'
    ],
    procedure: 'Biopsia de Próstata'
  },
  // Gastrostomía
  {
    patterns: [
      'gastrostomia',
      'gastrostomía',
      'peg',
      'gastrostomía endoscópica',
      'gastrostomia percutanea'
    ],
    procedure: 'Gastrostomía'
  },
  // Cistostomía
  {
    patterns: [
      'cistostomia',
      'cistostomía',
      'cistostomia suprapubica'
    ],
    procedure: 'Cistostomía'
  },
  // ERCP
  {
    patterns: [
      'ercp',
      'cpre',
      'colangiopancreatografia',
      'colangiopancreatografía',
      'colangiografia retrograda'
    ],
    procedure: 'ERCP'
  },
  // EUS - Endosonografía
  {
    patterns: [
      'eus',
      'endosonografia',
      'endosonografía',
      'ecoendoscopia',
      'ultrasonido endoscopico'
    ],
    procedure: 'EUS'
  },
  // EBUS - Endosonografía Bronquial
  {
    patterns: [
      'ebus',
      'endosonografia bronquial',
      'ultrasonido endobronquial'
    ],
    procedure: 'EBUS'
  }
];

/**
 * Mapea un texto de procedimiento PACS a un tipo estándar de la PWA
 * @param pacsText - Texto del procedimiento como viene del PACS
 * @returns Tipo de procedimiento estándar o el texto original si no hay match
 */
export function mapProcedure(pacsText: string | null | undefined): string | null {
  if (!pacsText) return null;
  
  const normalized = pacsText.toLowerCase().trim();
  
  // Buscar coincidencia en los patrones
  for (const mapping of PROCEDURE_PATTERNS) {
    for (const pattern of mapping.patterns) {
      // Buscar el patrón como substring o coincidencia exacta
      if (normalized.includes(pattern) || pattern.includes(normalized)) {
        return mapping.procedure;
      }
    }
  }
  
  // Si no hay match pero contiene "endoscopia", asumir EDA
  if (normalized.includes('endoscopia') || normalized.includes('endoscopy')) {
    return 'Endoscopia Digestiva Alta';
  }
  
  // Si no hay match, devolver el texto original capitalizado
  return pacsText.trim();
}

/**
 * Verifica si un procedimiento es válido para la PWA
 */
export function isValidProcedure(procedure: string): procedure is ValidProcedure {
  return VALID_PROCEDURES.includes(procedure as ValidProcedure);
}

/**
 * Obtiene la lista de procedimientos válidos
 */
export function getValidProcedures(): readonly string[] {
  return VALID_PROCEDURES;
}
