/**
 * Gerador de identificadores únicos.
 *
 * MOTIVO: o sistema gerava ids com `'log-' + Date.now()`, `'sale-' + Date.now()`, etc.
 * Vários registos criados no mesmo milissegundo (ex.: vários logs de auditoria na
 * mesma operação, ou duas vendas em terminais diferentes) recebiam EXACTAMENTE o
 * mesmo id e, como o Firestore grava por id, uns sobrescreviam os outros de forma
 * silenciosa — perda de vendas e de rasto de auditoria.
 */

let sequence = 0;

/** Devolve um id único e estável (prefixo + timestamp + sequência + aleatório). */
export function uid(prefix = 'id-'): string {
  sequence = (sequence + 1) % 1_000_000;
  const stamp = Date.now().toString(36);
  const seq = sequence.toString(36).padStart(3, '0');
  const rand = Math.random().toString(36).slice(2, 7);
  return `${prefix}${stamp}-${seq}-${rand}`;
}

/** Alias legível para ids de documentos. */
export const newId = uid;
