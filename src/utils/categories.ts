/**
 * Categorias de artigos — uma lista, não uma ideia por produto.
 *
 * ES-51: a categoria era texto livre. «Adubos», «adubos» e «adubos » eram três
 * categorias diferentes: os totais por categoria no inventário não fechavam e a
 * lista de filtros enchia-se de duplicados.
 *
 * Aqui a chave de comparação ignora maiúsculas, acentos e espaços a mais; o
 * rótulo apresentado é o mais usado (empate → o que começa por maiúscula).
 */

/** Chave de comparação: minúsculas, sem acentos, sem espaços a mais. */
export function categoryKey(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rótulo limpo (espaços colapsados), sem alterar maiúsculas/minúsculas. */
export function cleanCategoryLabel(value: unknown): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Lista canónica de categorias: uma por chave, com o rótulo mais usado.
 * `extras` (p.ex. as categorias fixas do sistema) entram à frente.
 */
export function collectCategories(
  products: Array<{ category?: string | null }> | null | undefined,
  extras: string[] = []
): string[] {
  const contagem = new Map<string, Map<string, number>>();

  const registar = (bruto: unknown) => {
    const rotulo = cleanCategoryLabel(bruto);
    if (!rotulo) return;
    const chave = categoryKey(rotulo);
    if (!chave) return;
    if (!contagem.has(chave)) contagem.set(chave, new Map());
    const variantes = contagem.get(chave)!;
    variantes.set(rotulo, (variantes.get(rotulo) || 0) + 1);
  };

  extras.forEach(registar);
  (Array.isArray(products) ? products : []).forEach(p => registar(p?.category));

  return Array.from(contagem.entries())
    .map(([, variantes]) => {
      const ordenadas = Array.from(variantes.entries()).sort((a, b) => {
        if (b[1] !== a[1]) return b[1] - a[1];
        const aMaiuscula = a[0].charAt(0) === a[0].charAt(0).toUpperCase();
        const bMaiuscula = b[0].charAt(0) === b[0].charAt(0).toUpperCase();
        if (aMaiuscula !== bMaiuscula) return aMaiuscula ? -1 : 1;
        return a[0].localeCompare(b[0]);
      });
      return ordenadas[0][0];
    })
    .sort((a, b) => a.localeCompare(b, 'pt'));
}

/**
 * Rótulo a gravar para uma categoria escrita pelo utilizador: se já existe uma
 * equivalente, usa essa (para não criar duplicados por causa de um espaço).
 */
export function canonicalCategory(input: unknown, existentes: string[]): string {
  const rotulo = cleanCategoryLabel(input);
  if (!rotulo) return '';
  const chave = categoryKey(rotulo);
  const encontrada = (Array.isArray(existentes) ? existentes : []).find(
    cat => categoryKey(cat) === chave
  );
  return encontrada ? cleanCategoryLabel(encontrada) : rotulo;
}
