import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
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

  it('aplica descontos distintos ao saco e ao quilo e grava o total líquido da venda antiga', async () => {
    store.__seed('products', [{
      id: 'prod-hybrid', code: '5600000000028', name: 'Milho Híbrido', category: 'Cereais',
      stockQty: 200, stockQtyBulk: 4, stockQtyRetail: 50, conversionRate: 50,
      parentUnit: 'Sacos', baseUnit: 'Kg', buyingPrice: 30, buyingPriceBulk: 1500,
      sellingPrice: 50, sellingPriceBulk: 2000
    }]);
    render(<PDVModule currentUser={{ username: 'Mazive', role: 'Técnico', roles: ['Técnico'] }} />);
    await waitFor(() => expect(screen.getAllByText(/Milho Híbrido/).length).toBeGreaterThan(0), { timeout: 8000 });

    await act(async () => { fireEvent.click(await screen.findByTitle('Lançamento retroactivo / Vendas manuais sem energia')); });
    const modal = screen.getByText('Registo de Venda Antiga').closest('.fixed') as HTMLElement;
    const view = within(modal);
    await act(async () => {
      fireEvent.click(view.getByTitle(/Vender em Sacos/));
      fireEvent.click(view.getByTitle(/Vender em Kg/));
    });

    const bulkType = view.getByRole('combobox', { name: 'Tipo de desconto: Milho Híbrido (Sacos)' });
    const bulkValue = view.getByRole('spinbutton', { name: 'Valor do desconto: Milho Híbrido (Sacos)' });
    const retailType = view.getByRole('combobox', { name: 'Tipo de desconto: Milho Híbrido (Kg)' });
    const retailValue = view.getByRole('spinbutton', { name: 'Valor do desconto: Milho Híbrido (Kg)' });
    await act(async () => {
      fireEvent.change(bulkType, { target: { value: 'per_unit' } });
      fireEvent.change(bulkValue, { target: { value: '200' } });
      fireEvent.change(retailType, { target: { value: 'percent_total' } });
      fireEvent.change(retailValue, { target: { value: '10' } });
    });

    expect(view.getByText(/Desconto: -205 MT/)).toBeTruthy();
    await act(async () => { fireEvent.click(view.getByText(/Finalizar Registo Retroativo/)); });
    await waitFor(() => expect(store.__dump().sales?.length).toBe(1), { timeout: 8000 });
    const sale = store.__dump().sales[0];
    expect(sale.subtotal).toBe(2050);
    expect(sale.discount).toBe(205);
    expect(sale.total).toBe(1845);
    expect(sale.items.find((item: any) => item.sellingUnit === 'Bulk')).toMatchObject({ discountType: 'per_unit', discountValue: 200, totalPrice: 1800 });
    expect(sale.items.find((item: any) => item.sellingUnit === 'Retail')).toMatchObject({ discountType: 'percent_total', discountValue: 10, totalPrice: 45 });
  });
});
