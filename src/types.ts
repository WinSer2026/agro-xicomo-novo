/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export interface Product {
  id: string;
  code: string; // Barcode or SKU
  reference?: string; // Product reference/SKU variant
  name: string;
  category: string;
  stockQty: number; // In base unit
  stockQtyBulk?: number; // Quantity in parentUnit (e.g. Sacos) for wholesale/resale
  stockQtyRetail?: number; // Quantity in baseUnit (e.g. Kg) for retail sale
  buyingPrice: number; // Cost price per base unit in MT (for hybrid products it is the derived cost of the base unit, e.g. KG)
  buyingPriceBulk?: number; // Cost price per bulk/parent unit (e.g. Saco) in MT — the price actually paid to the supplier
  sellingPrice: number; // Sell price per base unit in MT
  sellingPriceBulk?: number; // Sell price per bulk unit (e.g. Saco) in MT
  baseUnit: string; // 'Kg', 'Pacotes', 'Litros', 'Sacos', 'Caixas', 'Unidades', 'Metros', 'Metros Quadrados'
  conversionRate?: number; // Conversion factor (e.g., 1 Bag = 50 Kg, rate = 50)
  parentUnit?: string; // 'Sacos', 'Bidões', 'Caixas'
  expiryDate?: string; // ISO date YYYY-MM-DD
  imageUrl?: string;
  isService?: boolean;
  /** Taxa de IVA aplicável, em percentagem (omissão: 16%). */
  taxRate?: number;
  /**
   * ES-37: artigo desactivado (fora de venda) em vez de apagado.
   * Ausente = activo — os artigos antigos continuam válidos sem migração.
   */
  isActive?: boolean;
  deactivatedAt?: string;
  deactivatedBy?: string;
  deactivationReason?: string;
}

export interface SaleItem {
  productId: string;
  name: string;
  /** Categoria preservada no documento para relatórios históricos. */
  category?: string;
  quantity: number;
  unit: string;
  unitPrice: number; // in MT
  costPrice?: number; // Buying cost per unit in MT at the time of sale (permanent snapshot)
  buyingPrice?: number; // Alias for costPrice
  totalPrice: number; // in MT
  isService?: boolean;
  discountType?: 'per_unit' | 'line_total' | 'percent_unit' | 'percent_total';
  discountValue?: number;
  sellingUnit?: 'Bulk' | 'Retail'; // 'Bulk' for wholesale/sacks, 'Retail' for kilograms/units
  /** Taxa de IVA aplicada à linha, em percentagem (omissão: 16%). */
  taxRate?: number;
  /**
   * Factor de conversão do produto no momento da venda.
   *
   * D-04: a anulação repunha o stock com o factor ACTUAL do catálogo. Se a
   * conversão tivesse mudado (1 saco = 50 kg → 25 kg), o estorno devolvia a
   * quantidade errada. Fica gravada a conversão usada.
   */
  conversionRate?: number;
}

export interface PaymentBreakdown {
  method: string;
  amount: number;
}

export interface Sale {
  id: string;
  invoiceNumber: string; // Sequencial fac/rec (e.g., "FAC-2026-0001")
  date: string; // Real transaction date (ISO String or YYYY-MM-DD)
  /** Dia de calendário local (Africa/Maputo) a que a venda pertence. */
  dateKey?: string;
  createdAt?: string; // Timestamp when record was created in system
  customerName: string;
  customerNuit?: string;
  customerAddress?: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  total: number;
  paymentMethod: 'Dinheiro' | 'Transferência' | 'M-Pesa' | 'E-Mola' | 'Crédito' | 'Múltiplo' | string;
  paymentBreakdown?: PaymentBreakdown[];
  /** Numerário entregue pelo cliente. Guardado para auditoria do troco. */
  amountReceived?: number;
  /** Troco devolvido ao cliente. Guardado para auditoria do troco. */
  changeGiven?: number;
  /**
   * Turno de caixa em que a venda entrou.
   * Ausente = venda anterior à existência de turnos; o fecho do turno trata-a
   * pela hora (ver utils/cashSessions.ts) e nunca a reatribui a um turno antigo.
   */
  cashSessionId?: string;
  /** Estado anterior ao cancelamento, para que o restauro seja fiel. */
  previousStatus?: 'Paga' | 'Pendente' | 'Crédito';
  /** Número da nota de crédito emitida aquando da anulação (E-06). */
  creditNoteNumber?: string;
  /**
   * O stock foi devolvido ao anular?
   * `true`  — anulação clássica, a mercadoria volta ao inventário.
   * `false` — corte de inventário: a contagem física já foi lançada e o produto
   *           já não estava lá; devolver inflacionaria o saldo.
   * Ausente — vendas antigas, tratadas como devolvidas.
   */
  stockReturned?: boolean;
  /** Momento da anulação, para rasto documental. */
  cancelledAt?: string;
  /** Quem autorizou a anulação (utilizador que introduziu a palavra-passe). */
  cancelledBy?: string;
  /** Momento em que a factura foi efectivamente liquidada. */
  paidAt?: string;
  /** Quanto o cliente já pagou (vendas a crédito e cobranças parciais). */
  amountPaid?: number;
  /** Data limite de pagamento (vendas a crédito/pendentes). */
  dueDate?: string;
  /** Utilizador que registou a liquidação. */
  paidBy?: string;
  /**
   * Meio pelo qual a dívida foi paga (dinheiro, transferência, M-Pesa...).
   * Distinto de `paymentMethod`: uma factura emitida a crédito mantém
   * "Crédito" no documento original, e o recibo diz por onde o dinheiro entrou.
   */
  settledPaymentMethod?: string;
  /** Nº da factura cancelada que esta factura substitui (reemissão). */
  reissuedFrom?: string;
  /** Nº da factura definitiva emitida a partir desta proforma. */
  convertedToInvoice?: string;
  /** 'Proforma' = documento comercial sem efeito fiscal nem financeiro. */
  status: 'Paga' | 'Pendente' | 'Cancelada' | 'Crédito' | 'Proforma';
  documentType?: 'FaturaDefinitiva' | 'FaturaProforma' | 'Cotacao';
  operatorId: string;
  operatorName: string;
  /** Posto/caixa que emitiu a venda (B-05). */
  terminalId?: string;
  synced: boolean; // For Online/Local dual mode syncing tracking
  includeIva?: boolean;
  ivaAmount?: number;
  receiptNumber?: string; // Sequencial Rec-YYYY-N para recibos A4 e térmicos
  manualReceiptReference?: string; // Para recibos manuscritos / vendas sem energia
  notes?: string;
}

export interface Customer {
  id: string;
  name: string;
  nuit?: string;
  address?: string;
  phone?: string;
}

export interface PausedSale {
  id: string;
  date: string;
  /** Timestamp de criação; ausente nos rascunhos legados. */
  createdAt?: string;
  customerName: string;
  customerNuit?: string;
  customerAddress?: string;
  items: SaleItem[];
  paymentMethod: 'Dinheiro' | 'Transferência' | 'M-Pesa' | 'E-Mola' | 'Crédito';
  documentType: 'FaturaDefinitiva' | 'FaturaProforma' | 'Cotacao';
  includeIva: boolean;
  customSubtotalDiscount: number;
  /** Quem pausou a venda (G-02: a pausa não tinha autor). */
  operatorId?: string;
  operatorName?: string;
  /** Posto onde a venda foi pausada. */
  terminalId?: string;
}

export interface LossRecord {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  date: string;
  reason:
    | 'Fora de Prazo'
    | 'Danos Físicos'
    | 'Deterioração'
    | 'Quebras de Inventário'
    | 'Perda em Transformação'
    | 'Diferença de Inventário'
    | 'Outro';
  responsibleEmployeeId?: string;
  justification: string;
  costValue: number; // total cost lost in MT
  transformationId?: string;
  /**
   * ES-42: uma perda anulada (ex.: transformação revertida) não se apaga —
   * fica com a marca e sai das somas. A prova de que existiu mantém-se.
   */
  annulled?: boolean;
  annulledAt?: string;
  annulledBy?: string;
  annulledReason?: string;
}

// --- Product Transformation Module Types (Parte 4) ---
export interface TransformationItem {
  id: string;
  transformationId: string;
  resultingProductId: string;
  resultingProductName: string;
  resultingProductCode?: string;
  quantity: number; // e.g. 20 packages
  unitWeight: number; // weight or volume per unit e.g. 1 (kg)
  unit: string; // 'Kg', 'Pacotes', 'Unidades', 'Litros', etc.
  calculatedUnitCost: number; // in MT
  sellingPrice?: number; // suggested selling price in MT
  createdAt: string;
}

export interface ProductTransformation {
  id: string;
  code: string; // Sequencial (e.g., "TRF-2026-0001")
  originalProductId: string;
  originalProductName: string;
  originalProductCode?: string;
  originalQuantity: number;
  originalUnit: string;
  originalUnitCost: number; // cost per original unit
  originalTotalCost: number; // total requisition cost
  items: TransformationItem[];
  lossQuantity: number; // e.g. 2 kg lost during process
  lossValue: number; // monetary value of loss
  date: string; // Date of transformation (YYYY-MM-DD or ISO)
  operatorId: string;
  operatorName: string;
  notes?: string;
  status: 'Concluída' | 'Pendente' | 'Cancelada';
  createdAt: string;
  updatedAt?: string;
}

export type ContractType = 
  | 'Prazo Certo' 
  | 'Prazo Indeterminado' 
  | 'Prazo Incerto' 
  | 'Teletrabalho' 
  | 'Trabalho Intermitente';

export interface DisciplinaryAction {
  id: string;
  employeeId: string;
  employeeName?: string;
  infractionDate: string; // YYYY-MM-DD
  chargeNoteDate?: string; // YYYY-MM-DD (must be within 30 days)
  status: 'Iniciado' | 'Nota de Culpa Notificada' | 'Defesa Recebida' | 'Decidido' | 'Arquivado';
  severity: 'Leve' | 'Grave' | 'Gravíssima';
  outcome?: string;
  notes: string;
}

export interface MaterialDeduction {
  id: string;
  employeeId: string;
  description: string;
  totalValue: number;
  remainingValue: number;
  monthlyInstallment: number; // limited to 1/3 of net wage
  active: boolean;
}

export interface EmployeeDamage {
  id: string;
  damagedItem: string;         // bem danificado
  totalDamageValue: number;    // valor total de dano
  totalToPayValue: number;     // valor total a ser pago
  deductionPerSalary: number;  // valor a ser descontado por salario
  remainingValue: number;      // valor que falta ser pago
  startDate: string;           // data de início de pagamento (YYYY-MM-DD)
  endDate: string;             // data do fim de pagamento (YYYY-MM-DD)
  active: boolean;
}

export interface PerformanceRecord {
  id: string;
  date: string; // YYYY-MM-DD
  evaluator: string;
  rating: number; // 1 to 5
  feedback: string;
  goals?: string;
}

export interface Employee {
  id: string;
  name: string;
  contact?: string; // Phone number or email
  contractType: ContractType;
  nuit: string; // Mozambique tax ID (9 digits)
  inssNumber: string; // National Social Security
  iban: string; // International Bank Account Number
  isForeigner: boolean;
  baseSalary: string; // Salary in MT
  commissionRate: number; // % commission on sales (0 if none)
  workingHoursLimit: 44 | 48; // Legal weekly limits
  photoUrl?: string;
  documentUrl?: string;
  resumeUrl?: string;
  hiredDate: string; // YYYY-MM-DD
  gender: 'Masculino' | 'Feminino';
  dependentsCount: number; // used for IRPS calculations
  maritalStatus: 'Solteiro' | 'Casado' | 'Divorciado' | 'Viúvo';
  damages?: EmployeeDamage[];
  performanceHistory?: PerformanceRecord[];
  vacationStart?: string; // YYYY-MM-DD
  vacationEnd?: string; // YYYY-MM-DD
}

export interface Attendance {
  id: string;
  employeeId: string;
  employeeName?: string;
  date: string; // YYYY-MM-DD
  clockIn?: string; // HH:MM
  clockOut?: string; // HH:MM
  regularHours?: number;
  nightHours: number; // 20:00 - 06:00
  overtimeWeekday: number; // +50%
  overtimeWeekendHoliday: number; // +100%
  absent: boolean;
  absentReason?: 'Justificada' | 'Injustificada' | 'Licença Maternidade' | 'Licença Paternidade' | 'Férias';
}

export interface PayrollPayment {
  id: string; // e.g., "payroll-{employeeId}-{month}"
  employeeId: string;
  employeeName: string;
  month: string; // YYYY-MM
  baseSalary: number;
  additions: number;
  manualAddition: number;
  additionDescription?: string;
  deductions: number;
  manualCut: number;
  cutDescription?: string;
  inss: number;
  irps: number;
  absencesDiscount: number;
  finalNetWage: number;
  paymentDate: string;
  /** Data legada usada por alguns registos importados antes de paymentDate. */
  date?: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  username: string;
  ipAddress: string;
  action: string; // e.g., "Tentativa de login falhada", "Login bem sucedido", "Alteração de stock", "Transformação de Produto"
  status: 'Sucesso' | 'Falha' | 'Alerta';
  level?: 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';
  details: string;
  entity?: string;
}

export type AppRole = 'Técnico' | 'Gestor Geral' | 'Operador' | 'Gestor de Stock' | 'Gestor de RH' | 'Contabilista';

export interface ActiveSession {
  id: string;
  username: string;
  role: string;
  roles?: AppRole[];
  loginTime: string;
  ipAddress: string;
  /** Identificador do computador/posto (para encerrar sessões antigas). */
  deviceId?: string;
  /** Último sinal de vida — usado no bloqueio automático por inactividade. */
  lastHeartbeat?: string;
}

export interface PaymentInfo {
  banco: string;
  numeroConta: string;
  nib: string;
  banco2?: string;
  numeroConta2?: string;
  nib2?: string;
  mpesa: string;
  emola: string;
  numerario: boolean;
}

export interface SystemSettings {
  mode: 'Online' | 'Local';
  companyName: string;
  logoUrl?: string;
  stockPasswordHash: string;
  banco?: string;
  numero_conta?: string;
  nib?: string;
  banco2?: string;
  numero_conta2?: string;
  nib2?: string;
  mpesa?: string;
  emola?: string;
  vodacom1?: string;
  vodacom2?: string;
  vodacom3?: string;
  movitel1?: string;
  movitel2?: string;
  movitel3?: string;
  fixo1?: string;
  fixo2?: string;
  email?: string;
  companyNuit?: string;
  companyAddress?: string;
  criticalStockLevel?: number;
  /** Minutos de inactividade até o ecrã bloquear (0 = desligado). */
  sessionLockMinutes?: number;
  /** Aviso mostrado ao arrancar (ex.: dia de inventário). */
  bootstrapNotice?: string;
  printerA4?: string;
  printerThermal?: string;
  theme?: 'light' | 'dark';
  barcodePrefix?: string;
  barcodeSuffix?: string;
  /** Versão da lista de contagem física de stock já aplicada (evita reaplicações). */
  stockListVersion?: number;
}

export interface UserCredentials {
  id: string;
  username: string;
  passwordHash: string; // simulated encrypted/hashed
  role: string; // string e.g. "Operador, Gestor de Stock" or single role
  roles?: AppRole[];
  mfaEnabled: boolean;
  mfaSecret?: string;
  /** When true, the operator is forced to define a new password on the next login (credential reset flow). */
  mustChangePassword?: boolean;
  /** Version of the credential reset already applied to this account (idempotency guard). */
  passwordResetVersion?: number;
}


/**
 * Movimento de stock (F-05).
 *
 * O sistema alterava `stockQty` sem deixar rasto da razão: quando o saldo
 * divergia, não havia forma de saber o que o moveu. Cada alteração passa a
 * gravar aqui uma linha com o delta em unidades base.
 */
export interface StockMovement {
  id: string;
  date: string;
  productId: string;
  productName: string;
  /** Venda | Estorno | Quebra | Ajuste | Transformação | Entrada */
  type: 'Venda' | 'Estorno' | 'Quebra' | 'Ajuste' | 'Transformação' | 'Entrada';
  /** Delta em unidades base, com sinal (negativo = saída). */
  qtyDelta: number;
  unit: string;
  /** Documento que originou o movimento (fatura, quebra, transformação). */
  reference?: string;
  operatorName?: string;
  terminalId?: string;
  note?: string;
}

/**
 * Movimento de caixa.
 *
 * Porque existe: até aqui, tudo o que saía de dinheiro do estabelecimento tinha
 * documento — venda, recibo, nota de crédito, quebra. O reembolso ao cliente não
 * tinha nenhum. O caixa fechava com falta exatamente igual ao devolvido e não
 * havia forma de provar que saiu, para onde, nem com que autorização. Uma nota
 * de crédito sem saída de caixa correspondente é, para um inspector, ou um
 * cliente que não foi pago (NC falsa) ou um pagamento feito fora do sistema.
 */
export interface CashMovement {
  id: string;
  /** Momento do movimento (ISO). */
  date: string;
  /** Dia local de Maputo (AAAA-MM-DD), para relatórios por dia. */
  day: string;
  /**
   * Reembolso = dinheiro que sai para o cliente.
   * Sangria = retirada do operador. Entrada/Fundo = reposição.
   */
  type: 'Reembolso' | 'Sangria' | 'Entrada' | 'Fundo';
  /** Valor em MT. Positivo entra, negativo sai. */
  amount: number;
  method: string;
  operator: string;
  /** Quem autorizou com a palavra-passe de gestor. */
  authorizedBy?: string;
  /** Factura que originou o movimento. */
  reference?: string;
  creditNoteNumber?: string;
  receiptNumber?: string;
  notes?: string;
  terminalId?: string;
  /** Turno de caixa em que o movimento entrou (ver types CashSession). */
  cashSessionId?: string;
}

/**
 * Turno de caixa (sessão de operação da gaveta).
 *
 * Porque existe: o fecho era por dia, assinado por uma só pessoa e comparado
 * contra um saldo calculado a partir de vendas — sem contar o que estava
 * realmente na gaveta. Não havia como provar quem abriu, quem contou, quem
 * conferiu, nem quanto transitou para o turno seguinte.
 *
 * Regras (decisão D5 do dono):
 *  - fecho POR TURNO, obrigatório;
 *  - sem fundo de maneio fixo: o dinheiro que fica é o CONTADO no fecho anterior;
 *  - sem tolerância: qualquer diferença é registada e justificada;
 *  - assinado por quem conta e por quem confere;
 *  - contagem por método de pagamento;
 *  - reembolsos descontam; salários não passam por aqui.
 *
 * O fecho é imutável: depois de gravado não se corrige o documento; corrige-se
 * com um movimento contrário e uma nota.
 */
export type CashSessionStatus = 'Aberto' | 'Fechado';

/** Contagem por método de pagamento, em MT. Ex.: { Dinheiro: 4500, 'M-Pesa': 1200 }. */
export type CashCounts = Record<string, number>;

export interface CashSession {
  id: string;
  /** Número sequencial do turno (1, 2, 3…) para o pessoal falar a mesma língua. */
  number: number;
  status: CashSessionStatus;
  openedAt: string;
  openedBy: string;
  /** Dia local de Maputo do fecho (AAAA-MM-DD) — usado se o turno atravessar a meia-noite. */
  day: string;
  /**
   * Valores com que a gaveta começou, por método. Para o dinheiro, é o contado
   * no fecho do turno anterior; no primeiro turno do sistema, é a contagem
   * física assinada (não se inventa um fundo).
   */
  openingCounts: CashCounts;
  /** Primeiro turno alguma vez aberto nesta instalação? Exige contagem física. */
  isFirstSession?: boolean;
  openingNote?: string;
  closedAt?: string;
  closedBy?: string;
  /** Quem contou o dinheiro no fecho. */
  countedBy?: string;
  /** Quem conferiu a contagem. Pode ser a mesma pessoa — fica registado. */
  verifiedBy?: string;
  countedSamePerson?: boolean;
  /** Contagem física no fecho, por método. */
  closingCounts?: CashCounts;
  /** O que o sistema esperava, por método, no momento do fecho. */
  expectedCounts?: CashCounts;
  /** Contado − esperado, por método. Negativo = falta; positivo = sobra. */
  differenceCounts?: CashCounts;
  /** Diferença total (soma dos métodos). Zero é o normal. */
  difference?: number;
  /** Obrigatória sempre que a diferença não é zero (sem tolerância). */
  justification?: string;
  terminalId?: string;
  /** Turno seguinte criado automaticamente no fecho (se houver). */
  nextSessionId?: string;
}

/**
 * Dívida de cliente.
 *
 * Porque existe: uma venda a crédito ficava marcada com `status: 'Crédito'` e
 * nada mais. Não havia prazo, nem histórico de cobranças parciais, nem forma de
 * saber quem estava atrasado — a dívida existia só na cabeça de quem vendia.
 *
 * Um registo por factura em dívida, com o prazo e todos os pagamentos.
 */
export interface DebtPayment {
  id: string;
  date: string;
  amount: number;
  method: string;
  operator: string;
  receiptNumber?: string;
  note?: string;
}

export interface Debt {
  /** Igual ao id da venda: uma dívida por factura, sem duplicados. */
  id: string;
  saleId: string;
  invoiceNumber: string;
  customerName: string;
  customerNuit?: string;
  /** Data de emissão. */
  date: string;
  /** Prazo de pagamento. */
  dueDate: string;
  total: number;
  paidAmount: number;
  payments: DebtPayment[];
  /** Derivado na leitura; gravado para consulta rápida. */
  status: 'Aberta' | 'Paga' | 'Anulada';
  operator: string;
  notes?: string;
}
