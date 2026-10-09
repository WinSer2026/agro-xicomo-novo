/**
 * Reset de credenciais (executado automaticamente uma única vez por conta).
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Garantias:
 *  - Idempotente: cada conta guarda a versão de reset aplicada. Correr o reset em vários
 *    dispositivos NÃO repõe a palavra-passe que o operador já alterou.
 *  - Todos os operadores da lista oficial entram com uma palavra-passe temporária e são
 *    obrigados a definir uma nova palavra-passe no primeiro login.
 */

import { dbService } from './firebaseDB';
import { uid } from './idHelper';
import { hashPassword } from './securityHelper';
import { OFFICIAL_RESET_CREDENTIALS, CREDENTIALS_RESET_VERSION } from '../data/credentialsReset';
import { UserCredentials } from '../types';

export async function runCredentialsReset(): Promise<void> {
  try {
    const existing = await dbService.getCredentials();
    const byUser = new Map<string, UserCredentials>();
    (existing || []).forEach(c => {
      if (c && c.username) byUser.set(c.username.toLowerCase(), c);
    });

    const toWrite: UserCredentials[] = [];

    for (const seed of OFFICIAL_RESET_CREDENTIALS) {
      const current = byUser.get(seed.username.toLowerCase());
      const appliedVersion = current?.passwordResetVersion || 0;

      if (current && appliedVersion >= CREDENTIALS_RESET_VERSION) {
        // Reset já aplicado nesta conta (a palavra-passe atual é a que o operador definiu).
        continue;
      }

      toWrite.push({
        id: current?.id || seed.id,
        username: seed.username,
        passwordHash: seed.passwordHash,
        role: seed.role,
        roles: seed.roles,
        mfaEnabled: false,
        mustChangePassword: true,
        passwordResetVersion: CREDENTIALS_RESET_VERSION
      });
    }

    // Contas extra criadas fora da lista oficial: mantêm a palavra-passe, mas terão também
    // de a atualizar no próximo login (não repõe credenciais de terceiros).
    for (const current of existing || []) {
      if (!current || !current.username) continue;
      const isOfficial = OFFICIAL_RESET_CREDENTIALS.some(
        s => s.username.toLowerCase() === current.username.toLowerCase()
      );
      if (isOfficial) continue;
      if ((current.passwordResetVersion || 0) >= CREDENTIALS_RESET_VERSION) continue;

      toWrite.push({
        ...current,
        mfaEnabled: current.mfaEnabled || false,
        mustChangePassword: true,
        passwordResetVersion: CREDENTIALS_RESET_VERSION
      });
    }

    if (toWrite.length === 0) return;

    for (const cred of toWrite) {
      await dbService.saveCredential(cred);
    }

    // Auditoria é secundária ao reset concluído; a base guarda-a localmente e
    // tenta sincronizá-la depois caso a ligação esteja indisponível.
    void dbService.addAuditLog({
      id: uid('log-'),
      timestamp: new Date().toISOString(),
      username: 'Sistema (Reset de Credenciais)',
      ipAddress: '127.0.0.1',
      action: 'Reset Global de Credenciais',
      status: 'Alerta',
      level: 'CRITICAL',
      details: `Reset de credenciais aplicado (versão ${CREDENTIALS_RESET_VERSION}) a ${toWrite.length} conta(s). Todos os operadores terão de definir nova palavra-passe no próximo login.`
    });
  } catch (err) {
    console.error('[CredentialsReset] Failed to apply credential reset:', err);
  }
}

/**
 * Aplica a nova palavra-passe escolhida pelo operador (4 a 6 caracteres, letras/números),
 * libertando o acesso normal ao sistema. Não há restrição de reutilização de palavras-passe.
 */
export async function applyNewPassword(
  username: string,
  newPassword: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const all = await dbService.getCredentials();
    const current = all.find(c => c.username.toLowerCase() === username.toLowerCase());
    if (!current) {
      return { ok: false, message: 'Conta de utilizador não encontrada.' };
    }

    const updated: UserCredentials = {
      ...current,
      passwordHash: await hashPassword(newPassword),
      mustChangePassword: false,
      passwordResetVersion: current.passwordResetVersion || CREDENTIALS_RESET_VERSION
    };

    await dbService.saveCredential(updated);

    void dbService.addAuditLog({
      id: uid('log-'),
      timestamp: new Date().toISOString(),
      username: current.username,
      ipAddress: '127.0.0.1',
      action: 'Palavra-passe Atualizada',
      status: 'Sucesso',
      details: 'O operador definiu uma nova palavra-passe no primeiro acesso após o reset de credenciais.'
    });

    return { ok: true };
  } catch (err) {
    console.error('[CredentialsReset] Failed to update password:', err);
    return { ok: false, message: 'Erro ao gravar a nova palavra-passe.' };
  }
}

/** Devolve true se a conta ainda está com a palavra-passe temporária do reset. */
export function isTemporarySeedAccount(username: string, storedHash: string): boolean {
  const seed = OFFICIAL_RESET_CREDENTIALS.find(
    s => s.username.toLowerCase() === username.toLowerCase()
  );
  if (!seed) return false;
  return seed.passwordHash === storedHash;
}
