/**
 * Turnos de caixa — abertura e fecho (requisito do dono, 09/11/2026).
 *
 * O que se está a proteger:
 *  - o botão "Fechar turno e abrir o seguinte" grava o fecho E abre o turno
 *    seguinte com o dinheiro CONTADO (transporte, sem fundo inventado);
 *  - o botão "Só fechar o turno" grava o fecho e NÃO abre nada — a caixa fica
 *    fechada até alguém abrir o próximo turno de propósito;
 *  - em ambos os casos a contagem, a diferença e as assinaturas ficam gravadas;
 *  - um turno fechado não se fecha outra vez.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('firebase/app', async () => (await import('./firestoreMock')).firestoreMock);
vi.mock('firebase/firestore', async () => (await import('./firestoreMock')).firestoreMock);

const store = await import('./firestoreMock');
const { dbService } = await import('../src/utils/firebaseDB');
const { openShift, closeShift } = await import('../src/utils/shifts');

function resetDb() {
  store.__resetStore();
  try { localStorage.clear(); } catch { /* sem storage no teste */ }
  const anyDb = dbService as any;
  ['cashSessionsCache', 'salesCache', 'productsCache', 'settingsCache', 'credentialsCache']
    .forEach(k => { anyDb[k] = null; });
  anyDb.initPromise = null;
  store.__setMode({ hangWrites: false, failWrites: false });
}

const TURNO_ABERTO = {
  id: 'turno-1',
  number: 1,
  status: 'Aberto',
  openedAt: '2026-11-09T08:00:00.000Z',
  openedBy: 'Ana',
  day: '2026-11-09',
  openingCounts: { Dinheiro: 2000 },
  isFirstSession: true
};

const VENDA_DINHEIRO = {
  id: 'sale-1',
  invoiceNumber: 'FT-1',
  date: '2026-11-09T09:00:00.000Z',
  customerName: 'Cliente Geral',
  items: [],
  subtotal: 1000,
  discount: 0,
  total: 1000,
  paymentMethod: 'Dinheiro',
  status: 'Paga',
  cashSessionId: 'turno-1'
};

function sessoes() {
  return (store.__dump()['cash_sessions'] || []) as any[];
}

describe('Fecho de turno — com e sem abertura automática', () => {
  beforeEach(() => {
    resetDb();
    store.__seed('cash_sessions', [TURNO_ABERTO]);
    store.__seed('sales', [VENDA_DINHEIRO]);
  });

  it('fecha e abre o turno seguinte com o dinheiro contado', async () => {
    const resultado = await closeShift({
      session: TURNO_ABERTO as any,
      countedBy: 'Ana',
      verifiedBy: 'Carlos',
      counted: { Dinheiro: 3000 },
      openNext: true
    });

    expect(resultado.ok).toBe(true);
    expect(resultado.difference).toBe(0);
    expect(resultado.next).toBeTruthy();

    const lista = sessoes();
    expect(lista.length).toBe(2);

    const fechado = lista.find(s => s.id === 'turno-1');
    expect(fechado.status).toBe('Fechado');
    expect(fechado.countedBy).toBe('Ana');
    expect(fechado.verifiedBy).toBe('Carlos');
    expect(fechado.difference).toBe(0);

    const novo = lista.find(s => s.status === 'Aberto');
    expect(novo.number).toBe(2);
    // Transporte: 3.000 contados, não os 2.000 de abertura nem os 3.000 esperados por acaso.
    expect(novo.openingCounts.Dinheiro).toBe(3000);
  });

  it('"só fechar" grava o fecho e não abre nenhum turno novo', async () => {
    const resultado = await closeShift({
      session: TURNO_ABERTO as any,
      countedBy: 'Ana',
      verifiedBy: 'Carlos',
      counted: { Dinheiro: 3000 },
      openNext: false
    });

    expect(resultado.ok).toBe(true);
    expect(resultado.next).toBeUndefined();

    const lista = sessoes();
    expect(lista.length).toBe(1);
    expect(lista[0].status).toBe('Fechado');
    expect(lista[0].closingCounts.Dinheiro).toBe(3000);
    expect(lista[0].countedBy).toBe('Ana');
    expect(lista[0].verifiedBy).toBe('Carlos');

    // A caixa fica fechada: não há turno aberto para vender.
    const aberto = await dbService.getOpenCashSession();
    expect(aberto).toBeNull();
  });

  it('depois de "só fechar", abrir de novo continua a numeração', async () => {
    await closeShift({
      session: TURNO_ABERTO as any,
      countedBy: 'Ana',
      verifiedBy: 'Ana',
      counted: { Dinheiro: 3000 },
      openNext: false
    });
    // Ana contou e conferiu sozinha: fica registado, mas é aceite.
    expect(sessoes()[0].countedSamePerson).toBe(true);

    const novo = await openShift({
      openedBy: 'Carlos',
      openingCounts: { Dinheiro: 3000 },
      isFirstSession: false
    });
    expect(novo.number).toBe(2);
    expect(novo.status).toBe('Aberto');
  });

  it('diferença sem justificação é recusada e nada é gravado', async () => {
    const resultado = await closeShift({
      session: TURNO_ABERTO as any,
      countedBy: 'Ana',
      verifiedBy: 'Carlos',
      counted: { Dinheiro: 2900 },
      openNext: false
    });

    expect(resultado.ok).toBe(false);
    expect(resultado.errors.length).toBeGreaterThan(0);
    expect(sessoes().length).toBe(1);
    expect(sessoes()[0].status).toBe('Aberto');
  });

  it('com justificação a diferença é aceite e fica registada', async () => {
    const resultado = await closeShift({
      session: TURNO_ABERTO as any,
      countedBy: 'Ana',
      verifiedBy: 'Carlos',
      counted: { Dinheiro: 2900 },
      justification: 'Faltou troco de 100 MT entregue a cliente sem registo',
      openNext: true
    });

    expect(resultado.ok).toBe(true);
    expect(resultado.difference).toBe(-100);
    const fechado = sessoes().find(s => s.id === 'turno-1');
    expect(fechado.justification).toContain('Faltou troco');
  });

  it('um turno já fechado não se fecha outra vez', async () => {
    store.__seed('cash_sessions', [{ ...TURNO_ABERTO, status: 'Fechado' }]);
    const resultado = await closeShift({
      session: { ...TURNO_ABERTO, status: 'Fechado' } as any,
      countedBy: 'Ana',
      verifiedBy: 'Carlos',
      counted: { Dinheiro: 3000 },
      openNext: false
    });
    expect(resultado.ok).toBe(false);
  });
});
