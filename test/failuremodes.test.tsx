import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

vi.mock('firebase/app', async () => (await import('./firestoreMock')).firestoreMock);
vi.mock('firebase/firestore', async () => (await import('./firestoreMock')).firestoreMock);

const store = await import('./firestoreMock');
const { default: TechnicalModule } = await import('../src/components/TechnicalModule');
const { default: PDVModule } = await import('../src/components/PDVModule');

const { dbService } = await import('../src/utils/firebaseDB');

/** Limpa a store falsa E as caches em memória do dbService singleton entre testes. */
function resetDb() {
  store.__resetStore();
  try { localStorage.clear(); } catch (e) {}
  const anyDb = dbService as any;
  ['productsCache','salesCache','customersCache','credentialsCache','activeSessionsCache',
   'transformationsCache','settingsCache','lossesCache','payrollCache','pausedSalesCache',
   'employeesCache','attendanceCache'].forEach(k => { anyDb[k] = null; });
  anyDb.initPromise = null;
  store.__setMode({ hangWrites: false, failWrites: false });
}


const PRODUCT = {
  id: 'prod-1',
  code: '5600000000011',
  name: 'Milho Granel Kg',
  category: 'Cereais',
  stockQty: 100,
  buyingPrice: 30,
  sellingPrice: 45,
  baseUnit: 'Kg',
};

const LEGACY_USER = {
  id: 'usr-legacy',
  username: 'operador1',
  passwordHash: '0508221975', // legacy plain-text (> 6 chars)
  role: 'Operador',
  roles: ['Operador'],
  mfaEnabled: false,
  mustChangePassword: false
};

function headerHost() {
  if (!document.getElementById('module-header-actions')) {
    const host = document.createElement('div');
    host.id = 'module-header-actions';
    document.body.appendChild(host);
  }
}

async function openRetroactive() {
  const openBtn = await screen.findByTitle('Lançamento retroactivo / Vendas manuais sem energia');
  await act(async () => { fireEvent.click(openBtn); });
  await screen.findByText('Registo de Venda Antiga');
  const rows = screen.getAllByText('Milho Granel Kg');
  for (const r of rows) {
    const row = r.closest('div[class*="cursor-pointer"]');
    if (row) { await act(async () => { fireEvent.click(row); }); break; }
  }
}

describe('Regressões corrigidas — lançamento retroactivo e utilizadores', () => {
  beforeEach(() => {
    resetDb();
    store.__seed('products', [PRODUCT]);
    headerHost();
  });
  afterEach(() => {
    store.__setMode({ hangWrites: false, failWrites: false });
  });

  it('B) Escrita rejeitada: o erro aparece DENTRO do modal (não apenas atrás dele)', async () => {
    store.__setMode({ failWrites: true });
    render(<PDVModule currentUser={{ username: 'Mazive', role: 'Técnico', roles: ['Técnico'] }} />);
    await waitFor(() => expect(screen.getAllByText(/Milho Granel Kg/).length).toBeGreaterThan(0), { timeout: 8000 });
    await openRetroactive();

    await act(async () => { fireEvent.click(screen.getByText(/Finalizar Registo Retroativo/)); });

    // mensagem accionável visível dentro do modal
    await waitFor(() => expect(document.body.textContent).toMatch(/permissão/i), { timeout: 8000 });
    // e o botão volta a ficar disponível (não fica preso em "A gravar...")
    await waitFor(() => expect(screen.getByText(/Finalizar Registo Retroativo/)).toBeTruthy(), { timeout: 8000 });
  });

  it('B2) O toast é renderizado fora do modal (portal no <body>, z acima dos modais)', async () => {
    store.__setMode({ failWrites: true });
    render(<PDVModule currentUser={{ username: 'Mazive', role: 'Técnico', roles: ['Técnico'] }} />);
    await waitFor(() => expect(screen.getAllByText(/Milho Granel Kg/).length).toBeGreaterThan(0), { timeout: 8000 });
    await openRetroactive();
    await act(async () => { fireEvent.click(screen.getByText(/Finalizar Registo Retroativo/)); });

    await waitFor(() => {
      const toasts = Array.from(document.querySelectorAll('[role="status"]'));
      expect(toasts.length).toBeGreaterThan(0);
      const el = toasts[0] as HTMLElement;
      expect(el.parentElement).toBe(document.body);      // portado para o body
      expect(el.className).toContain('z-[9999]');        // acima dos modais (z-50)
    }, { timeout: 8000 });
  });

  it('C) Editar utilizador com password legacy NÃO volta a bloquear a gravação', async () => {
    store.__seed('credentials', [LEGACY_USER]);
    render(<TechnicalModule />);
    await act(async () => { fireEvent.click(screen.getByText('Utilizadores')); });
    await waitFor(() => expect(screen.getByText('Utilizadores e Perfis Registados')).toBeTruthy(), { timeout: 8000 });

    await act(async () => { fireEvent.click(screen.getAllByText('EDITAR')[0]); });
    await waitFor(() => expect(screen.getByText('Atualizar Utilizador')).toBeTruthy(), { timeout: 8000 });

    const pwdInput = screen.getByPlaceholderText('Deixe em branco para manter a actual') as HTMLInputElement;
    expect(pwdInput.value).toBe(''); // o hash NUNCA é carregado para o campo

    await act(async () => { fireEvent.click(screen.getByText('Guardar Alterações')); });

    await waitFor(() => {
      const creds = store.__dump().credentials || [];
      expect(creds.length).toBe(1);
      expect(creds[0].passwordHash).toBe(LEGACY_USER.passwordHash); // senha antiga preservada
    }, { timeout: 8000 });
  });

  it('D) Username duplicado é recusado (antes criava duas contas iguais)', async () => {
    store.__seed('credentials', [{
      id: 'usr-x', username: 'Maria', passwordHash: 'sha256:abc:def', role: 'Operador', roles: ['Operador'], mfaEnabled: false
    }]);
    render(<TechnicalModule />);
    await act(async () => { fireEvent.click(screen.getByText('Utilizadores')); });
    await waitFor(() => expect(screen.getByText('Admitir Novo Utilizador')).toBeTruthy(), { timeout: 8000 });

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText('Ex: operador3'), { target: { value: 'maria' } });
      fireEvent.change(screen.getByPlaceholderText('4 a 6 caracteres (letras ou números)'), { target: { value: '1234' } });
    });
    await act(async () => { fireEvent.click(screen.getByText('Admitir Utilizador')); });

    await waitFor(() => expect(document.body.textContent).toMatch(/Já existe o utilizador/i), { timeout: 8000 });
    const creds = store.__dump().credentials || [];
    expect(creds.filter((c: any) => String(c.username).toLowerCase() === 'maria').length).toBe(1);
  });

  it('E) Sem rede: o operador recebe aviso visível em vez de "nada acontecer"', async () => {
    store.__setMode({ hangWrites: true });
    render(<PDVModule currentUser={{ username: 'Mazive', role: 'Técnico', roles: ['Técnico'] }} />);
    await waitFor(() => expect(screen.getAllByText(/Milho Granel Kg/).length).toBeGreaterThan(0), { timeout: 8000 });
    await openRetroactive();

    await act(async () => { fireEvent.click(screen.getByText(/Finalizar Registo Retroativo/)); });

    // o botão passa a "A gravar..." e fica bloqueado
    await waitFor(() => expect(document.body.textContent).toContain('A gravar...'), { timeout: 8000 });
    // passados 8s o watchdog avisa que a ligação está lenta
    await waitFor(() => expect(document.body.textContent).toMatch(/ligação pode estar lenta/i), { timeout: 20000 });
  });
});
