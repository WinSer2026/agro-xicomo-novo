import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

vi.mock('firebase/app', async () => (await import('./firestoreMock')).firestoreMock);
vi.mock('firebase/firestore', async () => (await import('./firestoreMock')).firestoreMock);

const store = await import('./firestoreMock');
const { default: TechnicalModule } = await import('../src/components/TechnicalModule');

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


const EXISTING_USER = {
  id: 'usr-admin',
  username: 'admin',
  passwordHash: 'sha256:AXadmin2026:ffe6646a86429864a103ddd12a441381390e88eee2e1d639268c4360b0e67e02',
  role: 'Técnico',
  roles: ['Técnico'],
  mfaEnabled: false,
  mustChangePassword: false,
  passwordResetVersion: 2
};

describe('Painel Técnico — gravação de utilizadores', () => {
  beforeEach(() => {
    resetDb();
    store.__seed('credentials', [EXISTING_USER]);
  });

  it('cria um novo utilizador', async () => {
    render(<TechnicalModule />);
    await act(async () => { fireEvent.click(screen.getByText('Utilizadores')); });

    await waitFor(() => expect(screen.getByText('Admitir Novo Utilizador')).toBeTruthy(), { timeout: 8000 });

    const usernameInput = screen.getByPlaceholderText('Ex: operador3');
    const pwdInput = screen.getByPlaceholderText('4 a 6 caracteres (letras ou números)');

    await act(async () => {
      fireEvent.change(usernameInput, { target: { value: 'operador9' } });
      fireEvent.change(pwdInput, { target: { value: '1234' } });
    });

    await act(async () => { fireEvent.click(screen.getByText('Admitir Utilizador')); });

    await waitFor(() => {
      const creds = store.__dump().credentials || [];
      expect(creds.some((c: any) => c.username === 'operador9')).toBe(true);
    }, { timeout: 8000 });
  });

  it('edita um utilizador existente sem alterar a palavra-passe', async () => {
    render(<TechnicalModule />);
    await act(async () => { fireEvent.click(screen.getByText('Utilizadores')); });

    await waitFor(() => expect(screen.getByText('Utilizadores e Perfis Registados')).toBeTruthy(), { timeout: 8000 });

    const editBtns = screen.getAllByText('EDITAR');
    await act(async () => { fireEvent.click(editBtns[0]); });

    await waitFor(() => expect(screen.getByText('Atualizar Utilizador')).toBeTruthy(), { timeout: 8000 });

    const pwdInput = screen.getByPlaceholderText('Deixe em branco para manter a actual') as HTMLInputElement;
    expect(pwdInput.value).toBe('');

    await act(async () => { fireEvent.click(screen.getByText('Guardar Alterações')); });

    await waitFor(() => {
      const creds = store.__dump().credentials || [];
      expect(creds.length).toBe(1);
      expect(creds[0].passwordHash).toBe(EXISTING_USER.passwordHash);
    }, { timeout: 8000 });
  });
});
