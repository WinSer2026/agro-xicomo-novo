/**
 * Verificação/seed de credenciais (executado no arranque).
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Garantias (revistas na Auditoria FASE 1):
 *  - Nunca reescreve a palavra-passe, o perfil/MFA de uma conta existente;
 *  - Nunca recria contas que foram eliminadas;
 *  - Em falha de rede, aborta sem qualquer escrita;
 *  - Só cria as contas oficiais iniciais em instalação nova (coleção vazia);
 *  - O carimbo `passwordResetVersion` é preenchido preservando todos os campos.
 */

import { dbService } from './firebaseDB';
import { hashPassword } from './securityHelper';
import { OFFICIAL_RESET_CREDENTIALS, CREDENTIALS_RESET_VERSION } from '../data/credentialsReset';
import { UserCredentials } from '../types';

/**
 * VERIFICAÇÃO/SEED DE CREDENCIAIS (comportamento seguro — Auditoria FASE 1, A-01).
 *
 * O comportamento antigo reescrevia palavras-passe e perfis de contas sempre
 * que a leitura falhava ou faltava o campo `passwordResetVersion` — era a causa
 * raiz da "perda diária de credenciais" e da "mudança espontânea de hierarquias".
 *
 * Regras actuais (invioláveis):
 *  1. Se a leitura da base falhar → aborta SEM escrever nada;
 *  2. NUNCA substitui a palavra-passe, o perfil/MFA de uma conta existente;
 *  3. Contas eliminadas não voltam a ser recriadas;
 *  4. Apenas em instalação nova (coleção vazia, lida com sucesso) são criadas
 *     as contas oficiais iniciais;
 *  5. O carimbo `passwordResetVersion` é preenchido preservando todos os
 *     campos actuais da conta (nunca "repõe" valores).
 */
export async function runCredentialsReset(): Promise<void> {
  try {
    const existing = await dbService.getCredentials();
    const byUser = new Map<string, UserCredentials>();
    (existing || []).forEach(c => {
      if (c && c.username) byUser.set(c.username.toLowerCase(), c);
    });

    // Instalação nova: a coleção foi lida com sucesso e está realmente vazia.
    // Só neste caso criamos as contas oficiais iniciais.
    if (byUser.size === 0) {
      const seedAccounts: UserCredentials[] = OFFICIAL_RESET_CREDENTIALS.map(seed => ({
        id: seed.id,
        username: seed.username,
        passwordHash: seed.passwordHash,
        role: seed.role,
        roles: seed.roles,
        mfaEnabled: false,
        mustChangePassword: true,
        passwordResetVersion: CREDENTIALS_RESET_VERSION
      }));

      for (const cred of seedAccounts) {
        await dbService.saveCredential(cred);
      }

      void dbService.addAuditLog({
        id: 'log-' + Date.now(),
        timestamp: new Date().toISOString(),
        username: 'Sistema (Credenciais Iniciais)',
        ipAddress: '127.0.0.1',
        action: 'Instalação Nova — Contas Iniciais Criadas',
        status: 'Alerta',
        level: 'CRITICAL',
        details: `Base de credenciais vazia: criadas ${seedAccounts.length} conta(s) oficiais iniciais. Cada operador deve definir a sua palavra-passe no primeiro login.`
      });
      return;
    }

    // Base com contas existentes: nunca reescrever palavra-passe nem perfis.
    // Apenas garantir o carimbo de versão (preservando todos os campos).
    const toStamp: UserCredentials[] = [];
    for (const current of existing || []) {
      if (!current || !current.username) continue;
      if ((current.passwordResetVersion || 0) >= CREDENTIALS_RESET_VERSION) continue;
      toStamp.push({
        ...current,
        mfaEnabled: current.mfaEnabled || false,
        passwordResetVersion: CREDENTIALS_RESET_VERSION
      });
    }

    if (toStamp.length === 0) return;

    for (const cred of toStamp) {
      await dbService.saveCredential(cred);
    }

    void dbService.addAuditLog({
      id: 'log-' + Date.now(),
      timestamp: new Date().toISOString(),
      username: 'Sistema (Credenciais)',
      ipAddress: '127.0.0.1',
      action: 'Carimbo de Versão de Credenciais',
      status: 'Sucesso',
      details: `${toStamp.length} conta(s) carimbadas com a versão ${CREDENTIALS_RESET_VERSION}. Palavras-passe e perfis intactos (nenhuma redefinição aplicada).`
    });
  } catch (err) {
    // Falha de leitura/escrita: abortar sem tocar em nada é a acção correcta.
    console.error('[CredentialsReset] Verificação de credenciais abortada (sem escritas):', err);
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
      id: 'log-' + Date.now(),
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
