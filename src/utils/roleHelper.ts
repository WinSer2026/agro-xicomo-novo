import { AppRole } from '../types';

export const AVAILABLE_ROLES: { id: AppRole; label: string; desc: string }[] = [
  { id: 'Operador', label: 'Operador de Caixa', desc: 'Acesso a Vendas, PDV e Faturas' },
  { id: 'Gestor de Stock', label: 'Gestor de Stock', desc: 'Acesso ao Inventário, Stock e Entrada/Saída' },
  { id: 'Gestor de RH', label: 'Gestor de Recursos Humanos', desc: 'Acesso a Funcionários, Assiduidade e Salários' },
  { id: 'Contabilista', label: 'Contabilista e Financeiro', desc: 'Acesso à Contabilidade, Caixa e Relatórios' },
  { id: 'Gestor Geral', label: 'Gestor Geral', desc: 'Acesso a PDV, Stock, RH e Finanças' },
  { id: 'Técnico', label: 'Técnico', desc: 'Acesso total incluindo Painel Técnico e Manutenção' },
];

export function getUserRoles(user: { role?: string; roles?: AppRole[] } | null | undefined): AppRole[] {
  if (!user) return [];
  if (user.roles && user.roles.length > 0) {
    return user.roles;
  }
  if (user.role) {
    return user.role
      .split(',')
      .map(r => r.trim() as AppRole)
      .filter(Boolean);
  }
  return [];
}
