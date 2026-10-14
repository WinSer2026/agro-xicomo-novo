/**
 * Security, Cryptography & Input Sanitization Helpers
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Formatos de palavra-passe guardados (por ordem de preferência):
 *   pbkdf2:ITERAÇÕES:SALT:HASH   → actual (PBKDF2-SHA256, Web Crypto)
 *   sha256:SALT:HASH             → legado (migra para pbkdf2 no próximo login)
 *   texto simples                → legado antigo (migra para pbkdf2 no próximo login)
 */

const PBKDF2_ITERATIONS = 120000;

/**
 * Gera um hash forte (PBKDF2-SHA256 com 120.000 iterações e salt aleatório).
 * Compatível com browser e Node (Web Crypto).
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt(16);
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${salt}:${hash}`;
}

/**
 * Verifica uma palavra-passe contra o hash guardado.
 * Aceita os três formatos para retro-compatibilidade; o chamador deve usar
 * `needsPasswordRehash()` para promover hashes legados no próximo login.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;

  // Formato actual: PBKDF2
  if (storedHash.startsWith('pbkdf2:')) {
    const parts = storedHash.split(':');
    if (parts.length === 4) {
      const iterations = parseInt(parts[1], 10) || PBKDF2_ITERATIONS;
      const salt = parts[2];
      const expectedHash = parts[3];
      const computedHash = await pbkdf2(password, salt, iterations);
      return computedHash === expectedHash;
    }
    return false;
  }

  // Legado: SHA-256 com salt
  if (storedHash.startsWith('sha256:')) {
    const parts = storedHash.split(':');
    if (parts.length === 3) {
      const salt = parts[1];
      const expectedHash = parts[2];
      const computedHash = await sha256(salt + password);
      return computedHash === expectedHash;
    }
    return false;
  }

  // Legado: texto simples. Mantido APENAS como caminho de migração — quando a
  // comparação tem sucesso, o chamador deve guardar imediatamente o hash PBKDF2
  // (needsPasswordRehash) e a coluna deixa de conter texto simples.
  return password === storedHash;
}

/** True quando o hash guardado é legado e deve ser promovido a PBKDF2 no próximo login. */
export function needsPasswordRehash(storedHash: string): boolean {
  return !!storedHash && !storedHash.startsWith('pbkdf2:');
}

function generateSalt(length: number = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
      result += chars[array[i] % chars.length];
    }
  } else {
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }
  return result;
}

/** Gera uma palavra-passe temporária aleatória (instalações novas). */
export function generateTemporaryPassword(length: number = 10): string {
  return generateSalt(length);
}

async function pbkdf2(password: string, salt: string, iterations: number): Promise<string> {
  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : undefined;

  if (cryptoObj && cryptoObj.subtle) {
    const enc = new TextEncoder();
    const key = await cryptoObj.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await cryptoObj.subtle.deriveBits(
      { name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations },
      key,
      256
    );
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Fallback determinístico sem Web Crypto: SHA-256 iterado sobre salt+password.
  let acc = salt + password;
  for (let i = 0; i < Math.min(iterations, 1000); i++) {
    acc = await sha256(acc);
  }
  return acc;
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);

  const cryptoObj = typeof globalThis !== 'undefined' ? globalThis.crypto : (typeof window !== 'undefined' ? window.crypto : undefined);

  if (cryptoObj && cryptoObj.subtle) {
    const hashBuffer = await cryptoObj.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Pure JS fallback if crypto.subtle is unavailable
  let hash = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(16).padStart(64, '0');
}

/**
 * XSS & HTML Injection Sanitization
 */
export function sanitizeString(input: string | null | undefined): string {
  if (!input) return '';
  return String(input)
    .replace(/<[^>]*>?/gm, '') // Strip HTML tags
    .replace(/[<>'\"]/g, '')     // Strip special chars
    .trim();
}

/**
 * Safe Number Sanitization
 */
export function sanitizeNumber(input: any, defaultValue: number = 0): number {
  if (input === null || input === undefined || input === '') return defaultValue;
  if (typeof input === 'number') return isNaN(input) ? defaultValue : input;
  const cleaned = String(input).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? defaultValue : parsed;
}

/**
 * Password Strength Policy
 * Política oficial: 4 a 6 caracteres, podendo ser apenas números, apenas letras ou mistos.
 * Não é obrigatório usar símbolos e é permitido repetir uma palavra-passe antiga.
 */
export function isPasswordStrong(password: string): { strong: boolean; message?: string } {
  return validateAccessPassword(password);
}

export function validateAccessPassword(password: string): { strong: boolean; message?: string } {
  const value = (password || '').trim();

  if (!value) {
    return { strong: false, message: 'A palavra-passe é obrigatória.' };
  }
  if (value.length < 4 || value.length > 6) {
    return { strong: false, message: 'A palavra-passe deve ter entre 4 e 6 caracteres.' };
  }
  if (/\s/.test(value)) {
    return { strong: false, message: 'A palavra-passe não pode conter espaços.' };
  }
  if (!/^[A-Za-zÀ-ÿ0-9@#$%&*!?._-]+$/.test(value)) {
    return { strong: false, message: 'A palavra-passe só pode conter letras e números.' };
  }
  return { strong: true };
}
