import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import Toast from '../src/components/Toast';

describe('Toast global notification policy', () => {
  it('does not render a success toast', () => {
    render(<Toast message="Venda concluída com sucesso." type="success" />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it('defaults to a silent success toast', () => {
    render(<Toast message="Operação concluída." />);

    expect(screen.queryByRole('status')).toBeNull();
  });

  it.each([
    ['error', 'Não foi possível guardar os dados.'],
    ['warning', 'Verifique os dados antes de continuar.'],
  ] as const)('continues to render %s feedback', (type, message) => {
    render(<Toast message={message} type={type} />);

    expect(screen.getByRole('status').textContent).toContain(message);
  });
});
