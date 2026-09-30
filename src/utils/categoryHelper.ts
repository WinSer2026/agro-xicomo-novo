/**
 * Category Helper for Agro-Xicomo & Serviços, LDA
 * Normalizes and categorizes products and sale items reliably without diacritic / accent issues.
 */

export interface ReportCategory {
  key: string;
  label: string;
  name: string;
  color: string;
}

export const REPORT_CATEGORIES: ReportCategory[] = [
  { key: 'quimicos', label: 'QUÍMICOS', name: 'Químicos', color: '#7C3AED' },
  { key: 'sementes', label: 'SEMENTES', name: 'Sementes', color: '#10B981' },
  { key: 'adubos', label: 'ADUBOS', name: 'Adubos', color: '#F59E0B' },
  { key: 'ferramentas', label: 'FERRAMENTAS E FERRAGENS', name: 'Ferramentas', color: '#3B82F6' },
  { key: 'jardinagem', label: 'JARDINAGEM E IRRIGAÇÃO', name: 'Jardinagem e Irrigação', color: '#06B6D4' },
  { key: 'maquinas', label: 'MÁQUINAS E EQUIPAMENTOS', name: 'Máquinas e Equipamentos', color: '#EC4899' },
  { key: 'limpeza', label: 'LIMPEZA E HIGIENE', name: 'Limpeza', color: '#8B5CF6' },
  { key: 'servicos', label: 'SERVIÇOS', name: 'Serviços', color: '#6366F1' },
  { key: 'transformados', label: 'TRANSFORMADOS / FRACIONADOS', name: 'Transformados', color: '#14B8A6' },
  { key: 'outro', label: 'OUTROS / DIVERSOS', name: 'Outros', color: '#64748B' }
];

export function normalizeCategoryText(str?: string): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

export function matchCategory(productCategory: string | undefined, targetCategoryKey: string): boolean {
  const norm = normalizeCategoryText(productCategory);
  const target = normalizeCategoryText(targetCategoryKey);

  if (target.startsWith('quimic') || target === 'quimicos') {
    return (
      norm.includes('quimic') ||
      norm.includes('pesticid') ||
      norm.includes('herbicid') ||
      norm.includes('fungicid') ||
      norm.includes('insecticid') ||
      norm.includes('acaricid')
    );
  }

  if (target.startsWith('semente') || target === 'sementes') {
    return norm.includes('semente');
  }

  if (target.startsWith('adubo') || target === 'adubos') {
    return norm.includes('adubo') || norm.includes('fertiliz') || norm.includes('ureia') || norm.includes('npk');
  }

  if (target.startsWith('ferramenta') || target === 'ferramentas') {
    return norm.includes('ferramenta') || norm.includes('ferrag') || norm.includes('enxada') || norm.includes('catana');
  }

  if (target.startsWith('jardina') || target.startsWith('irriga') || target === 'jardinagem') {
    return norm.includes('jardina') || norm.includes('irriga') || norm.includes('regador') || norm.includes('pulverizad');
  }

  if (target.startsWith('maquina') || target.startsWith('equipamento') || target === 'maquinas') {
    return norm.includes('maquina') || norm.includes('equipamento') || norm.includes('moageira') || norm.includes('motor') || norm.includes('bomba');
  }

  if (target.startsWith('limpeza') || target === 'limpeza') {
    return norm.includes('limpeza') || norm.includes('higiene') || norm.includes('balde');
  }

  if (target.startsWith('servic') || target === 'servicos') {
    return norm.includes('servic');
  }

  if (target.startsWith('transform') || target === 'transformados') {
    return norm.includes('transform') || norm.includes('fraciona');
  }

  if (target.startsWith('outro') || target === 'outros') {
    return (
      !matchCategory(productCategory, 'quimicos') &&
      !matchCategory(productCategory, 'sementes') &&
      !matchCategory(productCategory, 'adubos') &&
      !matchCategory(productCategory, 'ferramentas') &&
      !matchCategory(productCategory, 'jardinagem') &&
      !matchCategory(productCategory, 'maquinas') &&
      !matchCategory(productCategory, 'limpeza') &&
      !matchCategory(productCategory, 'servicos') &&
      !matchCategory(productCategory, 'transformados')
    );
  }

  return norm.includes(target);
}
