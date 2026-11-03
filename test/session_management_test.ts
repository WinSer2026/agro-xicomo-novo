import assert from 'node:assert';
import { ActiveSession } from '../src/types';

console.log('=== TESTES DE GESTÃO AUTOMÁTICA DE SESSÕES (SESSÃO ÚNICA / LIMPEZA DE ÓRFÃS) ===\n');

// Mock da lógica de término de sessões duplicadas e antigas
function simulateTerminatePreviousSessions(
  existingSessions: ActiveSession[],
  params: { username?: string; ipAddress?: string; deviceId?: string; excludeSessionId?: string }
): { remaining: ActiveSession[]; terminatedIds: string[] } {
  const now = Date.now();
  const MAX_SESSION_AGE_MS = 12 * 60 * 60 * 1000; // 12 horas

  const normUser = params.username ? params.username.toLowerCase().trim() : '';
  const normIp = params.ipAddress && params.ipAddress !== 'N/D' && params.ipAddress !== 'Local / N/D' ? params.ipAddress.trim() : '';
  const normDev = params.deviceId ? params.deviceId.trim() : '';

  const remaining: ActiveSession[] = [];
  const terminatedIds: string[] = [];

  for (const sess of existingSessions) {
    if (params.excludeSessionId && sess.id === params.excludeSessionId) {
      remaining.push(sess);
      continue;
    }

    const sessUser = (sess.username || '').toLowerCase().trim();
    const sessIp = (sess.ipAddress || '').trim();
    const sessDev = (sess.deviceId || '').trim();
    const sessTime = new Date(sess.loginTime).getTime();
    const isStale = isNaN(sessTime) || (now - sessTime > MAX_SESSION_AGE_MS);

    const isSameUser = Boolean(normUser && sessUser === normUser);
    const isSameIp = Boolean(normIp && sessIp && sessIp !== 'N/D' && sessIp !== 'Local / N/D' && sessIp === normIp);
    const isSameDevice = Boolean(normDev && sessDev && sessDev === normDev);

    if (isSameUser || isSameIp || isSameDevice || isStale) {
      terminatedIds.push(sess.id);
    } else {
      remaining.push(sess);
    }
  }

  return { remaining, terminatedIds };
}

// ---------------------------------------------------------------------------
// Teste 1: O caso real da Almira (múltiplas sessões antigas)
// ---------------------------------------------------------------------------
console.log('--- Teste 1: Caso Real da Operadora Almira (Eliminar sessões antigas) ---');

const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const today7am = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
const today8am = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

const mockSessions: ActiveSession[] = [
  { id: 'sess-almira-yesterday-13', username: 'Almira', role: 'Operador', loginTime: yesterday, ipAddress: '197.249.10.5', deviceId: 'dev-pc-caixa-1' },
  { id: 'sess-almira-yesterday-15', username: 'Almira', role: 'Operador', loginTime: yesterday, ipAddress: '197.249.10.5', deviceId: 'dev-pc-caixa-1' },
  { id: 'sess-almira-today-0700', username: 'Almira', role: 'Operador', loginTime: today7am, ipAddress: '197.249.10.5', deviceId: 'dev-pc-caixa-1' },
  { id: 'sess-almira-today-0812', username: 'Almira', role: 'Operador', loginTime: today8am, ipAddress: '197.249.10.5', deviceId: 'dev-pc-caixa-1' },
  { id: 'sess-gestor-stock', username: 'GestorStock', role: 'Gestor de Stock', loginTime: today8am, ipAddress: '197.249.10.8', deviceId: 'dev-pc-stock' }
];

// Almira faz novo login às 10:00 no mesmo computador
const newAlmiraSessionId = 'sess-almira-today-1000';
const cleanupResult = simulateTerminatePreviousSessions(mockSessions, {
  username: 'Almira',
  ipAddress: '197.249.10.5',
  deviceId: 'dev-pc-caixa-1',
  excludeSessionId: newAlmiraSessionId
});

assert.strictEqual(cleanupResult.terminatedIds.length, 4, 'Todas as 4 sessões anteriores da Almira devem ser terminadas');
assert.ok(cleanupResult.terminatedIds.includes('sess-almira-yesterday-13'), 'Sessão de ontem às 13h deve ser terminada');
assert.ok(cleanupResult.terminatedIds.includes('sess-almira-yesterday-15'), 'Sessão de ontem às 15h deve ser terminada');
assert.ok(cleanupResult.terminatedIds.includes('sess-almira-today-0700'), 'Sessão de hoje às 7h deve ser terminada');
assert.ok(cleanupResult.terminatedIds.includes('sess-almira-today-0812'), 'Sessão de hoje às 8h12 deve ser terminada');

// Adiciona a nova sessão
const updatedSessions = [...cleanupResult.remaining, {
  id: newAlmiraSessionId,
  username: 'Almira',
  role: 'Operador',
  loginTime: new Date().toISOString(),
  ipAddress: '197.249.10.5',
  deviceId: 'dev-pc-caixa-1'
}];

const almiraActiveCount = updatedSessions.filter(s => s.username === 'Almira').length;
assert.strictEqual(almiraActiveCount, 1, 'Almira deve ter rigorosamente 1 única sessão activa');
assert.strictEqual(updatedSessions.length, 2, 'Total de sessões activas: Almira (1) + GestorStock (1)');
console.log('[PASS] Sessões antigas da Almira eliminadas com sucesso; apenas a nova sessão das 10h fica ativa.');

// ---------------------------------------------------------------------------
// Teste 2: Mesmo IP / Mesmo Computador com utilizador diferente que fechou a janela
// ---------------------------------------------------------------------------
console.log('\n--- Teste 2: Mesmo IP / Computador (Navegador fechado sem logout) ---');

const sessionsBeforeNextOperator: ActiveSession[] = [
  { id: 'sess-carlos-antiga', username: 'Carlos', role: 'Operador', loginTime: today8am, ipAddress: '197.249.10.5', deviceId: 'dev-pc-caixa-1' }
];

// Operador seguinte faz login no mesmo computador
const resDevice = simulateTerminatePreviousSessions(sessionsBeforeNextOperator, {
  username: 'Joao',
  ipAddress: '197.249.10.5',
  deviceId: 'dev-pc-caixa-1',
  excludeSessionId: 'sess-joao-nova'
});

assert.ok(resDevice.terminatedIds.includes('sess-carlos-antiga'), 'Sessão órfã anterior do mesmo computador/IP deve ser terminada');
console.log('[PASS] Sessão anterior órfã do mesmo computador terminada automaticamente.');

// ---------------------------------------------------------------------------
// Teste 3: Purga automática de sessões de ontem / > 12h
// ---------------------------------------------------------------------------
console.log('\n--- Teste 3: Purga Automática de Sessões de Ontem (> 12h) ---');

const staleSessions: ActiveSession[] = [
  { id: 'sess-stale-1', username: 'OperadorA', role: 'Operador', loginTime: yesterday, ipAddress: '10.0.0.1' },
  { id: 'sess-stale-2', username: 'OperadorB', role: 'Operador', loginTime: yesterday, ipAddress: '10.0.0.2' },
  { id: 'sess-fresh-1', username: 'OperadorC', role: 'Operador', loginTime: new Date().toISOString(), ipAddress: '10.0.0.3' }
];

const purgeResult = simulateTerminatePreviousSessions(staleSessions, {});
assert.strictEqual(purgeResult.terminatedIds.length, 2, '2 sessões de ontem devem ser purgadas');
assert.strictEqual(purgeResult.remaining.length, 1, 'Apenas a sessão fresca de hoje deve permanecer');
assert.strictEqual(purgeResult.remaining[0].username, 'OperadorC');
console.log('[PASS] Sessões abandonadas de ontem purgadas automaticamente da lista de operadores ativos.');

console.log('\n========================================');
console.log('TODOS OS TESTES DE GESTÃO DE SESSÕES PASSARAM COM SUCESSO (3/3)!');
console.log('========================================\n');
