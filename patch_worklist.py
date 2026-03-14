import re

# Leer archivo
with open('/Users/alvarogallardo/andex-gateway/src/services/worklist.service.ts', 'r') as f:
    content = f.read()

# Texto a buscar (función queryWorklist original)
old_code = '''export async function queryWorklist(query: WorklistQuery = {}): Promise<{
  success: boolean;
  items: WorklistItem[];
  total?: number;
  error?: string;
  source?: 'ups-rs' | 'qido-mwl';
}> {
  try {
    // Intentar UPS-RS primero si está configurado
    if (worklistConfig.preferUps) {'''

# Nuevo código con soporte mock
new_code = '''export async function queryWorklist(query: WorklistQuery = {}): Promise<{
  success: boolean;
  items: WorklistItem[];
  total?: number;
  error?: string;
  source?: 'ups-rs' | 'qido-mwl' | 'mock';
}> {
  // ===== MODO MOCK PARA DESARROLLO =====
  if (config.worklistMode === 'mock') {
    console.log('🧪 Worklist en modo MOCK');
    const allItems = generateMockWorklist();
    const filteredItems = filterMockWorklist(allItems, query);
    return {
      success: true,
      items: filteredItems,
      total: filteredItems.length,
      source: 'mock'
    };
  }
  
  // ===== MODO PACS (producción) =====
  try {
    // Intentar UPS-RS primero si está configurado
    if (worklistConfig.preferUps) {'''

# Reemplazar
if old_code in content:
    content = content.replace(old_code, new_code)
    with open('/Users/alvarogallardo/andex-gateway/src/services/worklist.service.ts', 'w') as f:
        f.write(content)
    print('✅ queryWorklist modificado exitosamente')
else:
    print('❌ No se encontró el código a reemplazar')
    # Mostrar un fragmento para debug
    idx = content.find('export async function queryWorklist')
    if idx > 0:
        print('Fragmento encontrado:')
        print(repr(content[idx:idx+400]))
