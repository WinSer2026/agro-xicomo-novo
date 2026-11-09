/**
 * Dados da empresa usados nos documentos.
 *
 * O NUIT aparecia no código como `|| '401976590'` em nove pontos. Se as
 * definições não estivessem carregadas, todos os documentos saíam com um NUIT
 * que podia não ser o da empresa (achado E-03). Um documento fiscal com o
 * número errado é pior do que um documento com um aviso visível.
 */
export const MISSING_NUIT_LABEL = 'NUIT não configurado';

export function companyNuit(nuit?: string | null): string {
  const value = (nuit || '').trim();
  return value || MISSING_NUIT_LABEL;
}

export function hasCompanyNuit(settings?: { companyNuit?: string | null } | null): boolean {
  return Boolean(settings?.companyNuit && String(settings.companyNuit).trim());
}

export const MISSING_COMPANY_NAME_LABEL = 'Empresa não configurada';

export function companyName(name?: string | null): string {
  const value = (name || '').trim();
  return value || MISSING_COMPANY_NAME_LABEL;
}
