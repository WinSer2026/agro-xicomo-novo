/**
 * Bootstrap de credenciais iniciais (comportamento seguro — Auditoria FASE 1, A-01).
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * O comportamento antigo ("reset global") reescrevia palavras-passe e perfis de
 * contas existentes — era a causa raiz da "perda diária de credenciais" e da
 * "mudança espontânea de hierarquias". Foi removido.
 *
 * Regras actuais (invioláveis):
 *  1. Se a leitura da base falhar → aborta SEM escrever nada;
 *  2. NUNCA substitui a palavra-passe, o perfil/MFA de uma conta existente;
 *  3. Contas eliminadas não voltam a ser recriadas;
 *  4. Apenas em instalação nova (coleção vazia, lida com sucesso) é criada a
 *     conta inicial `admin`, com palavra-passe TEMPORÁRIA ALEATÓRIA exibida uma
 *     única vez no ecrã de login (campo `bootstrapNotice` nas definições);
 *  5. O operador é obrigado a definir a sua palavra-passe no primeiro login.
 */

import { dbService } from './firebaseDB';
import { hashPassword, generateTemporaryPassword } from './securityHelper';
import { UserCredentials } from '../types';

export async function runCredentialsReset(): Promise<void> {
  try {
    const existing = await dbService.getCredentials();

    // Base com contas existentes: nada a fazer — nunca tocar em contas alheias.
    if ((existing || []).length > 0) return;

    // Instalação nova: a coleção foi lida com sucesso e está realmente vazia.
    const tempPassword = generateTemporaryPassword(10);
    const adminAccount: UserCredentials = {
      id: 'usr-admin-inicial',
      username: 'admin',
      passwordHash: await hashPassword(tempPassword),
      role: 'Técnico',
      roles: ['Técnico'],
      mfaEnabled: false,
      mustChangePassword: true
    };

    await dbService.saveCredential(adminAccount);

    // Nota visível no ecrã de login (apenas nesta instalação nova), para o
    // administrador definir a palavra-passe definitiva no primeiro acesso.
    try {
      const settings = await dbService.getSettings();
      await dbService.saveSettings({
        ...settings,
        bootstrapNotice: `Instalação nova: conta "admin" criada com palavra-passe temporária: ${tempPassword}. Altere-a no primeiro login e limpe este aviso.`
      });
    } catch (noticeErr) {
      console.warn('[CredentialsReset] Could not write bootstrap notice:', noticeErr);
    }

    void dbService.addAuditLog({
      id: 'log-' + Date.now(),
      timestamp: new Date().toISOString(),
      username: 'Sistema (Credenciais Iniciais)',
      ipAddress: 'N/D',
      action: 'Instalação Nova — Conta Inicial Criada',
      status: 'Alerta',
      level: 'CRITICAL',
      details: 'Base de credenciais vazia: criada a conta inicial "admin" com palavra-passe temporária aleatória (exibida no ecrã de login). Defina a palavra-passe definitiva no primeiro acesso.'
    });
  } catch (err) {
    // Falha de leitura/escrita: abortar sem tocar em nada é a acção correcta.
    console.error('[CredentialsReset] Bootstrap de credenciais abortado (sem escritas):', err);
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
      mustChangePassword: false
    };

    await dbService.saveCredential(updated);

    void dbService.addAuditLog({
      id: 'log-' + Date.now(),
      timestamp: new Date().toISOString(),
      username: current.username,
      ipAddress: 'N/D',
      action: 'Palavra-passe Atualizada',
      status: 'Sucesso',
      details: 'O operador definiu uma nova palavra-passe.'
    });

    return { ok: true };
  } catch (err) {
    console.error('[CredentialsReset] Failed to update password:', err);
    return { ok: false, message: 'Erro ao gravar a nova palavra-passe.' };
  }
}
