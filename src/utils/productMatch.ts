/**
 * Correspondência de artigos para a entrada de stock por IA.
 *
 * ES-44: a IA devolve texto livre («Adubo NPK») e o módulo procurava o artigo
 * com `name.includes(texto)`. Bastava «Adubo» para encontrar «Adubo NPK
 * 12-24-12» e somar 50 kg ao artigo errado — mercadoria a entrar no stock de
 * outra mercadoria, sem ninguém dar por isso.
 *
 * Aqui só há correspondência **exacta**: código igual, ou nome igual. Se não
 * houver, não se adivinha. Se houver dois, também não se escolhe.
 */
import type { Product } from '../types';

export type MatchStatus = 'exact' | 'ambiguous' | 'none';

export interface ProductMatch {
  status: MatchStatus;
  product: Product | null;
  matches: Product[];
}

/** Minúsculas, sem acentos, sem espaços a mais. */
export function normalizeTerm(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function unicos(produtos: Product[]): Product[] {
  const vistos = new Set<string>();
  return produtos.filter(p => {
    const chave = String(p.id);
    if (vistos.has(chave)) return false;
    vistos.add(chave);
    return true;
  });
}

/**
 * Procura o artigo cujo **código** ou **nome** é exactamente o texto dado.
 * Devolve `ambiguous` quando mais do que um artigo corresponde — nesse caso o
 * chamador tem de pedir ao utilizador para escolher, nunca escolher sozinho.
 */
export function matchProduct(products: Product[], term: string): ProductMatch {
  const alvo = normalizeTerm(term);
  if (!alvo) return { status: 'none', product: null, matches: [] };

  const lista = Array.isArray(products) ? products : [];

  const porCodigo = unicos(lista.filter(p => normalizeTerm(p.code) === alvo));
  if (porCodigo.length === 1) return { status: 'exact', product: porCodigo[0], matches: porCodigo };
  if (porCodigo.length > 1) return { status: 'ambiguous', product: null, matches: porCodigo };

  const porNome = unicos(lista.filter(p => normalizeTerm(p.name) === alvo));
  if (porNome.length === 1) return { status: 'exact', product: porNome[0], matches: porNome };
  if (porNome.length > 1) return { status: 'ambiguous', product: null, matches: porNome };

  return { status: 'none', product: null, matches: [] };
}

/** Texto para o ecrã quando a correspondência não é única. */
export function describeMatchStatus(match: ProductMatch): string {
  if (match.status === 'exact') return match.product ? match.product.name : '';
  if (match.status === 'ambiguous') {
    return `Ambíguo — ${match.matches.length} artigos com este nome/código`;
  }
  return 'Não encontrado no catálogo';
}
