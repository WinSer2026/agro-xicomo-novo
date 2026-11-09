import { SystemSettings } from '../types';
import { verifyPassword } from './securityHelper';

/**
 * Palavra-passe de autorização de stock (gestor).
 *
 * Antes existiam três palavras-passe universais em texto simples no bundle
 * (`05082`, `0147`, `admin`), aceites em qualquer módulo. `0147` abria ainda o
 * login como Técnico. Isso foi removido: agora só é aceite a palavra-passe
 * configurada nas definições — em hash (`sha256:salt:hash`) quando disponível,
 * ou em texto simples apenas para instalações legadas.
 *
 * O valor por omissão só se aplica quando NÃO existe nenhuma palavra-passe
 * configurada (primeira instalação), e deve ser alterado imediatamente.
 */
export const DEFAULT_AUTHORIZATION_PASSWORD = '05082';

export async function verifyAuthorizationPassword(
  input: string,
  settings?: Partial<SystemSettings> | null
): Promise<boolean> {
  const typed = (input || '').trim();
  if (!typed) return false;

  const configured = (settings as Record<string, unknown> | null | undefined)?.stockPasswordHash;
  const stored = typeof configured === 'string' ? configured.trim() : '';

  if (!stored) {
    return typed === DEFAULT_AUTHORIZATION_PASSWORD;
  }

  // Formato moderno: hash com salt.
  if (stored.startsWith('sha256:')) {
    return verifyPassword(typed, stored);
  }

  // Instalações antigas guardavam a palavra-passe em texto simples.
  return typed === stored;
}

/** Indica se a palavra-passe configurada já está protegida por hash. */
export function isAuthorizationPasswordHashed(settings?: Partial<SystemSettings> | null): boolean {
  const configured = (settings as Record<string, unknown> | null | undefined)?.stockPasswordHash;
  return typeof configured === 'string' && configured.trim().startsWith('sha256:');
}
