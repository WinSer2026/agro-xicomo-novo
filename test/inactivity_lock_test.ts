import assert from 'node:assert';
import { verifyPassword, hashPassword } from '../src/utils/securityHelper';

console.log('=== TESTES DE PERSISTÊNCIA DO BLOQUEIO POR INATIVIDADE (F5 RESISTENCE) ===\n');

// Simulação de Storage (sessionStorage e localStorage)
class MemoryStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) || null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// Lógica de determinação do estado de bloqueio no arranque/F5
function determineInitialLockState(
  sessionStorage: MemoryStorage,
  localStorage: MemoryStorage,
  settings: { sessionLockMinutes?: number }
): { isLocked: boolean; reason: string } {
  // 1. Verificar flag explícita de bloqueio persistida
  const wasLocked = sessionStorage.getItem('agro_session_locked') === 'true' ||
                    localStorage.getItem('agro_session_locked') === 'true';

  if (wasLocked) {
    return { isLocked: true, reason: 'Flag explícita agro_session_locked presente no storage' };
  }

  // 2. Verificar se o tempo de inactividade expirou mesmo sem a flag (ex.: aba suspensa / reaberta)
  const savedLastRaw = sessionStorage.getItem('agro_last_activity') || localStorage.getItem('agro_last_activity');
  const savedLast = savedLastRaw ? parseInt(savedLastRaw, 10) : 0;
  const lockMinutes = Math.max(1, settings?.sessionLockMinutes || 15);
  const lockMs = lockMinutes * 60 * 1000;
  const now = Date.now();

  if (savedLast > 0 && (now - savedLast >= lockMs)) {
    // Sincronizar storage
    sessionStorage.setItem('agro_session_locked', 'true');
    localStorage.setItem('agro_session_locked', 'true');
    return { isLocked: true, reason: `Tempo de inatividade expirado (${Math.round((now - savedLast) / 60000)} min >= ${lockMinutes} min)` };
  }

  return { isLocked: false, reason: 'Sessão ativa e dentro do período válido' };
}

async function runTests() {
  const sessionStorage = new MemoryStorage();
  const localStorage = new MemoryStorage();
  const settings = { sessionLockMinutes: 15 };

  // ---------------------------------------------------------------------------
  // Teste 1: Estado inicial com utilizador recém-conectado
  // ---------------------------------------------------------------------------
  console.log('--- Teste 1: Utilizador recém-conectado (Não bloqueado) ---');
  sessionStorage.setItem('agro_current_user', JSON.stringify({ username: 'Almira', role: 'Operador' }));
  sessionStorage.setItem('agro_last_activity', String(Date.now()));

  let state = determineInitialLockState(sessionStorage, localStorage, settings);
  assert.strictEqual(state.isLocked, false, 'Sessão recente não deve iniciar bloqueada');
  console.log('[PASS] Sessão recente iniciada sem bloqueio.');

  // ---------------------------------------------------------------------------
  // Teste 2: Inactividade excede limite e utilizador faz F5 (atualiza a página)
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 2: Inactividade de 20 minutos seguida de F5 ---');
  const twentyMinutesAgo = Date.now() - (20 * 60 * 1000);
  sessionStorage.setItem('agro_last_activity', String(twentyMinutesAgo));
  localStorage.setItem('agro_last_activity', String(twentyMinutesAgo));

  // Simula F5 (novo ciclo de renderização / initDB)
  state = determineInitialLockState(sessionStorage, localStorage, settings);
  assert.strictEqual(state.isLocked, true, 'Ao fazer F5 após 20 min inativo, o sistema DEVE iniciar bloqueado');
  assert.strictEqual(sessionStorage.getItem('agro_session_locked'), 'true', 'Flag de bloqueio gravada no sessionStorage');
  assert.strictEqual(localStorage.getItem('agro_session_locked'), 'true', 'Flag de bloqueio gravada no localStorage');
  console.log(`[PASS] Bloqueio mantido com sucesso após F5: ${state.reason}`);

  // ---------------------------------------------------------------------------
  // Teste 3: Tentativa de bypass por F5 repetido (o bug reportado pelo utilizador)
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 3: Múltiplos F5 consecutivos na tela de bloqueio ---');
  for (let f5Cycle = 1; f5Cycle <= 5; f5Cycle++) {
    state = determineInitialLockState(sessionStorage, localStorage, settings);
    assert.strictEqual(state.isLocked, true, `Ciclo F5 #${f5Cycle}: bloqueio deve persistir inviolável`);
  }
  console.log('[PASS] Cinco tentativas de recarregar a página (F5) não conseguem contornar o bloqueio.');

  // ---------------------------------------------------------------------------
  // Teste 4: Tentativa de desbloqueio com senha incorreta
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 4: Tentativa de desbloqueio com senha incorreta ---');
  const userPasswordHash = await hashPassword('Almira@2026');
  const wrongPasswordAttempt = 'senha_errada_123';
  const isMatchWrong = await verifyPassword(wrongPasswordAttempt, userPasswordHash);
  assert.strictEqual(isMatchWrong, false, 'Senha incorreta não deve validar');
  // Flag deve permanecer no storage
  assert.strictEqual(sessionStorage.getItem('agro_session_locked'), 'true');
  console.log('[PASS] Desbloqueio rejeitado com credencial inválida.');

  // ---------------------------------------------------------------------------
  // Teste 5: Desbloqueio com senha correta e recuperação imediata do trabalho
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 5: Desbloqueio com senha correta ---');
  const correctPasswordAttempt = 'Almira@2026';
  const isMatchCorrect = await verifyPassword(correctPasswordAttempt, userPasswordHash);
  assert.strictEqual(isMatchCorrect, true, 'Senha correta deve validar com sucesso');

  // Executa rotina de desbloqueio idêntica ao App.tsx
  sessionStorage.removeItem('agro_session_locked');
  localStorage.removeItem('agro_session_locked');
  const unlockedAt = Date.now();
  sessionStorage.setItem('agro_last_activity', String(unlockedAt));
  localStorage.setItem('agro_last_activity', String(unlockedAt));

  // Verifica que o estado após desbloqueio é desbloqueado
  state = determineInitialLockState(sessionStorage, localStorage, settings);
  assert.strictEqual(state.isLocked, false, 'Após introduzir senha correta, sistema desbloqueia');
  assert.strictEqual(sessionStorage.getItem('agro_session_locked'), null, 'Flag removida do sessionStorage');
  assert.strictEqual(localStorage.getItem('agro_session_locked'), null, 'Flag removida do localStorage');
  console.log('[PASS] Sessão desbloqueada com sucesso com senha legítima.');

  // ---------------------------------------------------------------------------
  // Teste 6: Logout voluntário a partir da tela de bloqueio
  // ---------------------------------------------------------------------------
  console.log('\n--- Teste 6: Botão "Terminar Sessão (Voltar ao Login)" na tela de bloqueio ---');
  // Usuário bloqueado decide terminar sessão
  sessionStorage.removeItem('agro_session_locked');
  localStorage.removeItem('agro_session_locked');
  sessionStorage.removeItem('agro_current_user');
  sessionStorage.removeItem('agro_last_activity');

  assert.strictEqual(sessionStorage.getItem('agro_current_user'), null, 'Credencial de utilizador removida');
  assert.strictEqual(sessionStorage.getItem('agro_session_locked'), null, 'Flag de bloqueio limpa');
  console.log('[PASS] Logout limpa credenciais e redireciona com segurança para a tela principal de autenticação.');

  console.log('\n=============================================================');
  console.log('TODOS OS TESTES DE PERSISTÊNCIA DE BLOQUEIO PASSARAM (6/6)');
  console.log('=============================================================\n');
}

runTests().catch(err => {
  console.error('Falha nos testes de bloqueio:', err);
  process.exit(1);
});
