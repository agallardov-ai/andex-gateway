#!/usr/bin/env python3
"""Patch worklist.service.ts para agregar modo mock"""

filepath = '/Users/alvarogallardo/andex-gateway/src/services/worklist.service.ts'

with open(filepath, 'r') as f:
    lines = f.readlines()

# Buscar la línea que contiene "export async function queryWorklist"
insert_idx = None
for i, line in enumerate(lines):
    if 'export async function queryWorklist' in line:
        insert_idx = i
        break

if insert_idx is None:
    print('❌ No se encontró queryWorklist')
    exit(1)

# Buscar la línea "}> {" que cierra la definición de tipo de retorno
brace_idx = None
for i in range(insert_idx, min(insert_idx + 10, len(lines))):
    if '}> {' in lines[i]:
        brace_idx = i
        break

if brace_idx is None:
    print('❌ No se encontró cierre de tipo de retorno')
    exit(1)

# Modificar la línea del source para incluir 'mock'
for i in range(insert_idx, brace_idx + 1):
    if "source?: 'ups-rs' | 'qido-mwl';" in lines[i]:
        lines[i] = lines[i].replace(
            "source?: 'ups-rs' | 'qido-mwl';",
            "source?: 'ups-rs' | 'qido-mwl' | 'mock';"
        )
        break

# Buscar la línea "  try {" después de "}> {"
try_idx = None
for i in range(brace_idx + 1, min(brace_idx + 5, len(lines))):
    if lines[i].strip() == 'try {':
        try_idx = i
        break

if try_idx is None:
    print('❌ No se encontró try {')
    exit(1)

# Insertar código mock antes del try
mock_code = '''  // ===== MODO MOCK PARA DESARROLLO =====
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
'''

lines.insert(try_idx, mock_code)

# Escribir archivo
with open(filepath, 'w') as f:
    f.writelines(lines)

print('✅ worklist.service.ts parcheado exitosamente')
