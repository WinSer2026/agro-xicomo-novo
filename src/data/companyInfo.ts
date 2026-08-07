/**
 * Informações Oficiais da Empresa
 * AGRO - XICOMO & SERVIÇOS, LDA
 *
 * Estas constantes são a fonte única de verdade para todos os módulos do sistema.
 * Qualquer atualização aos dados da empresa deve ser feita aqui.
 */

export const COMPANY_INFO = {
  name: 'AGRO - XICOMO & SERVIÇOS, LDA',
  nuit: '401976590',
  address: 'Maputo, Bairro do Zimpeto, Av. de Moçambique, Parcela: 654 R/C',
  email: 'agroxicomo1@gmail.com',
  phone1: '84 94 23 241',
  phone2: '86 36 99900',
  phone3: '8451970702',
  city: 'Maputo – Moçambique',
} as const;

export const COMPANY_BANK = {
  bank1: 'First Capital Bank, S.A.',
  account1: '99466610001',
  nib1: '001000000099466610196',
} as const;

export const COMPANY_DEFAULTS = {
  companyName: COMPANY_INFO.name,
  companyNuit: COMPANY_INFO.nuit,
  companyAddress: COMPANY_INFO.address,
  email: COMPANY_INFO.email,
  vodacom1: COMPANY_INFO.phone3,
  vodacom2: COMPANY_INFO.phone1,
  movitel1: COMPANY_INFO.phone2,
  banco: COMPANY_BANK.bank1,
  numero_conta: COMPANY_BANK.account1,
  nib: COMPANY_BANK.nib1,
  // Apenas transferência bancária
  paymentMethodsInvoice: ['Transferência Bancária'],
} as const;
