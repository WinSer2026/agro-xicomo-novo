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
  /** Data/hora ISO da última actualização do registo (ajustes, contagens, correcções). */
  updatedAt?: string;
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
}

export interface PaymentBreakdown {
  method: string;
  amount: number;
}

export interface Sale {
  id: string;
  invoiceNumber: string; // Sequencial fac/rec (e.g., "FAC-2026-0001")
  date: string; // Real transaction date (ISO String or YYYY-MM-DD)
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
  status: 'Paga' | 'Pendente' | 'Cancelada' | 'Crédito';
  documentType?: 'FaturaDefinitiva' | 'FaturaProforma' | 'Cotacao';
  operatorId: string;
  operatorName: string;
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
}

export interface LossRecord {
  id: string;
  productId: string;
  productName: string;
  quantity: number;
  unit: string;
  date: string;
  reason: 'Fora de Prazo' | 'Danos Físicos' | 'Deterioração' | 'Quebras de Inventário' | 'Perda em Transformação' | 'Outro';
  responsibleEmployeeId?: string;
  justification: string;
  costValue: number; // total cost lost in MT
  transformationId?: string;
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
  deviceId?: string;
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
  /** Minutos de inactividade antes de bloquear a sessão de balcão (predefinição: 15). */
  sessionLockMinutes?: number;
  /** Aviso exibido no ecrã de login (ex.: credenciais temporárias de instalação nova). */
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
