/**
 * Security, Cryptography & Input Sanitization Helpers
 * AGRO - XICOMO & SERVIÇOS, LDA
 */

// Simple robust browser & Node compatible SHA-256 with salt
export async function hashPassword(password: string): Promise<string> {
  const salt = generateSalt(16);
  const hash = await sha256(salt + password);
  return `sha256:${salt}:${hash}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (!storedHash) return false;

  // Modern salted SHA-256 hash
  if (storedHash.startsWith('sha256:')) {
    const parts = storedHash.split(':');
    if (parts.length === 3) {
      const salt = parts[1];
      const expectedHash = parts[2];
      const computedHash = await sha256(salt + password);
      return computedHash === expectedHash;
    }
  }

  // Legacy plaintext fallback check for backwards compatibility
  return password === storedHash;
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
    .replace(/[<>'"]/g, '')     // Strip special chars
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
    return { strong: false, message: 'A palavra-passe só pode conter letras, números e os símbolos @#$%&*!?._- .' };
  }
  return { strong: true };
}

/**
 * Decisão de palavra-passe no formulário de utilizadores.
 *
 * MOTIVO: na edição, o campo era preenchido com o hash guardado e, ao gravar, o
 * hash/senha antiga era tratado como palavra-passe NOVA e rejeitado pela política
 * de 4 a 6 caracteres — bloqueando a gravação de contas antigas.
 *
 * Regras:
 *  - edição + campo vazio                 → MANTER a palavra-passe actual;
 *  - edição + campo igual ao hash guardado → MANTER (o hash foi carregado pelo UI);
 *  - criação (ou alteração real)           → validar pela política oficial e HASHEAR.
 */
export type PasswordDecision =
  | { action: 'keep'; hash: string }
  | { action: 'set'; password: string }
  | { action: 'invalid'; message: string };

export function decidePasswordUpdate(
  editing: { passwordHash: string } | null | undefined,
  typedRaw: string
): PasswordDecision {
  const typed = (typedRaw || '').trim();

  if (editing) {
    if (!typed || typed === editing.passwordHash) {
      return { action: 'keep', hash: editing.passwordHash };
    }
    if (typed.startsWith('sha256:')) {
      // O operador não escreve hashes à mão: é o valor antigo carregado pelo UI.
      return { action: 'keep', hash: editing.passwordHash };
    }
    const policy = validateAccessPassword(typed);
    if (!policy.strong) {
      return { action: 'invalid', message: policy.message || 'Palavra-passe inválida.' };
    }
    return { action: 'set', password: typed };
  }

  const policy = validateAccessPassword(typed);
  if (!policy.strong) {
    return { action: 'invalid', message: policy.message || 'Palavra-passe inválida.' };
  }
  return { action: 'set', password: typed };
}
