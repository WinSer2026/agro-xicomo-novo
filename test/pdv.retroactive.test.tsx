import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import React from 'react';

vi.mock('firebase/app', async () => (await import('./firestoreMock')).firestoreMock);
vi.mock('firebase/firestore', async () => (await import('./firestoreMock')).firestoreMock);

const store = await import('./firestoreMock');
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

describe('PDV — Registo de Venda Antiga (lançamento retroactivo)', () => {
  beforeEach(() => {
    resetDb();
    store.__seed('products', [PRODUCT]);
    if (!document.getElementById('module-header-actions')) {
      const host = document.createElement('div');
      host.id = 'module-header-actions';
      document.body.appendChild(host);
    }
  });

  it('grava a venda quando o operador clica em "Finalizar Registo Retroativo"', async () => {
    render(<PDVModule currentUser={{ username: 'Mazive', role: 'Técnico', roles: ['Técnico'] }} />);

    // wait for the catalogue to load
    await waitFor(() => expect(screen.getAllByText(/Milho Granel Kg/).length).toBeGreaterThan(0), { timeout: 8000 });

    // open the retroactive modal
    const openBtn = await screen.findByTitle('Lançamento retroactivo / Vendas manuais sem energia');
    await act(async () => { fireEvent.click(openBtn); });

    const modalTitle = await screen.findByText('Registo de Venda Antiga');
    expect(modalTitle).toBeTruthy();

    // add the product to the retroactive cart (the catalogue row inside the modal)
    const rows = screen.getAllByText('Milho Granel Kg');
    let clicked = false;
    for (const r of rows) {
      const row = r.closest('div[class*="cursor-pointer"]');
      if (row) {
        await act(async () => { fireEvent.click(row); });
        clicked = true;
        break;
      }
    }
    expect(clicked).toBe(true);

    const finalizeBtn = screen.getByText(/Finalizar Registo Retroativo/);
    await act(async () => { fireEvent.click(finalizeBtn); });

    await waitFor(() => {
      const dump = store.__dump();
      expect((dump.sales || []).length).toBe(1);
    }, { timeout: 8000 });

    const dump = store.__dump();
    expect(dump.sales[0].total).toBe(45);
    expect(dump.sales[0].paymentMethod).toBe('Dinheiro');
    // stock must have been deducted
    expect(dump.products.find((p: any) => p.id === 'prod-1').stockQty).toBe(99);

    // Let the post-commit flow finish: a completed sale must not produce a success toast.
    await screen.findByText(/Recibo nº/);
    await act(async () => {
      await new Promise(resolve => window.setTimeout(resolve, 100));
    });
    expect(screen.queryByRole('status')).toBeNull();
  });
});
