import { SystemSettings } from '../types';
import { verifyPassword, hashPassword } from './securityHelper';

/**
 * Código de autorização de operações sensíveis (stock, anulações, sangrias).
 *
 * Regras (SEG-03):
 *  - NÃO existe código por omissão. Antes, `05082` era aceite em qualquer
 *    instalação e estava escrito no repositório; agora, sem código definido, as
 *    operações sensíveis são recusadas e a interface deve pedir a configuração.
 *  - O código vive em settings.stockPasswordHash. Formato suportado:
 *      `pbkdf2:...` (actual, gerado por hashPassword)
 *      `sha256:...` (legado, ainda verificável)
 *      texto simples (instalações antigas — aceite para não bloquear a loja,
 *      mas deve ser migrado; ver migrationStatus)
 *  - O código de stock é independente da palavra-passe de login: é um PIN de
 *    operação, não uma conta.
 */

/** Já existe um código configurado (qualquer formato)? */
export function isAuthorizationConfigured(settings?: Partial<SystemSettings> | null): boolean {
  const configured = (settings as Record<string, unknown> | null | undefined)?.stockPasswordHash;
  return typeof configured === 'string' && configured.trim().length > 0;
}

export type AuthorizationStorageState = 'none' | 'legacy-plain' | 'legacy-sha256' | 'modern';

export function getAuthorizationStorageState(
  settings?: Partial<SystemSettings> | null
): AuthorizationStorageState {
  const configured = (settings as Record<string, unknown> | null | undefined)?.stockPasswordHash;
  const stored = typeof configured === 'string' ? configured.trim() : '';
  if (!stored) return 'none';
  if (stored.startsWith('pbkdf2:')) return 'modern';
  if (stored.startsWith('sha256:')) return 'legacy-sha256';
  return 'legacy-plain';
}

/**
 * Verifica o código introduzido.
 *
 * Sem código configurado devolve SEMPRE false — a operação é recusada e a
 * interface mostra "defina primeiro o código de gestor". Isto é deliberado:
 * melhor uma operação bloqueada do que uma operação aberta a todos.
 */
export async function verifyAuthorizationPassword(
  input: string,
  settings?: Partial<SystemSettings> | null
): Promise<boolean> {
  const typed = (input || '').trim();
  if (!typed) return false;

  const state = getAuthorizationStorageState(settings);
  if (state === 'none') return false;

  const stored = String(
    (settings as Record<string, unknown> | null | undefined)?.stockPasswordHash ?? ''
  ).trim();

  if (state === 'modern' || state === 'legacy-sha256') {
    return verifyPassword(typed, stored);
  }

  // Legado em texto simples: compara, mas avisa (a migração é feita no próximo
  // gravar das definições, em TechnicalModule).
  console.warn('[Authorization] Código de gestor guardado em texto simples. Migre no Painel Técnico.');
  return typed === stored;
}

/**
 * Preparado para gravar: devolve o valor a guardar em stockPasswordHash.
 * - vazio -> '' (código removido: operações sensíveis ficam bloqueadas)
 * - já em hash -> devolve igual (não re-hash)
 * - texto -> gera hash PBKDF2
 */
export async function prepareAuthorizationPassword(raw: string): Promise<string> {
  const value = (raw || '').trim();
  if (!value) return '';
  if (value.startsWith('pbkdf2:') || value.startsWith('sha256:')) return value;
  return hashPassword(value);
}
