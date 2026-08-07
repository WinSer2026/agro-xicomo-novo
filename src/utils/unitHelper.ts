/**
 * Helper to singularize units of measurement in Portuguese.
 * This is useful to display descriptive labels dynamically based on the product's unit.
 */
export function getSingularUnit(pluralUnit: string): string {
  if (!pluralUnit) return '';
  const u = pluralUnit.trim().toLowerCase();
  
  if (u === 'sacos') return 'Saco';
  if (u === 'caixas') return 'Caixa';
  if (u === 'bidões' || u === 'bidoes') return 'Bidão';
  if (u === 'unidades') return 'Unidade';
  if (u === 'litros') return 'Litro';
  if (u === 'gramas') return 'Grama';
  if (u === 'metros') return 'Metro';
  if (u === 'garrafas') return 'Garrafa';
  if (u === 'pacotes') return 'Pacote';
  if (u === 'tambores') return 'Tambor';
  if (u === 'rolos') return 'Rolo';
  if (u === 'quilos' || u === 'kilos' || u === 'kg') return 'Quilo';
  
  // Basic fallback: if ends with 's', remove it (e.g. Latas -> Lata, Garrafas -> Garrafa)
  if (pluralUnit.endsWith('s') && pluralUnit.length > 1) {
    return pluralUnit.slice(0, -1);
  }
  return pluralUnit;
}

/**
 * Returns a suitable dynamic icon name based on the unit of measurement.
 */
export function getUnitIcon(unit: string): string {
  if (!unit) return 'inventory_2';
  const u = unit.trim().toLowerCase();
  if (u.includes('saco') || u.includes('caix') || u.includes('pacot') || u.includes('tambor') || u.includes('rolo')) {
    return 'inventory_2'; // Package icon
  }
  if (u.includes('litro') || u.includes('bidõ') || u.includes('bidou') || u.includes('garraf')) {
    return 'opacity'; // Liquid droplet icon
  }
  if (u.includes('kg') || u.includes('gram') || u.includes('quilo') || u.includes('peso') || u.includes('kilo')) {
    return 'scale'; // Weight icon
  }
  if (u.includes('metro')) {
    return 'straighten'; // Ruler/meter icon
  }
  return 'filter_none';
}
