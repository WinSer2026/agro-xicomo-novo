/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Retenção na Fonte de IRPS (Moçambique)
 * Progressive withholding brackets for single/married employees based on monthly salary (tax base).
 * Formula: Tax = (Taxable Income * Bracket Rate) - Fixed Deduction.
 */
export function calculateIRPS(
  baseSalary: number, 
  dependents: number, 
  isMarried: boolean
): number {
  // Subtract INSS (3%) to get the taxable base income
  const inss = baseSalary * 0.03;
  const taxableBase = Math.max(0, baseSalary - inss);

  if (taxableBase <= 20250) {
    // Escala 1: até 20.250,00 MT
    const rate = 0.10;
    const deduction = 1350.00;
    // Apply dependent relief (reduce rate or flat rebate, simulated realistically)
    const rebate = dependents * 150;
    return Math.max(0, (taxableBase * rate) - (deduction / 10) - rebate);
  } else if (taxableBase <= 33750) {
    // Escala 2: de 20.250,01 a 33.750,00 MT
    const rate = 0.15;
    const deduction = 2362.50;
    const rebate = dependents * 200 + (isMarried ? 150 : 0);
    return Math.max(0, (taxableBase * rate) - deduction - rebate);
  } else if (taxableBase <= 60750) {
    // Escala 3: de 33.750,01 a 60.750,00 MT
    const rate = 0.20;
    const deduction = 4050.00;
    const rebate = dependents * 250 + (isMarried ? 200 : 0);
    return Math.max(0, (taxableBase * rate) - deduction - rebate);
  } else if (taxableBase <= 148500) {
    // Escala 4: de 60.750,01 a 148.500,00 MT
    const rate = 0.25;
    const deduction = 7087.50;
    const rebate = dependents * 300 + (isMarried ? 300 : 0);
    return Math.max(0, (taxableBase * rate) - deduction - rebate);
  } else {
    // Escala 5: acima de 148.500,00 MT
    const rate = 0.32;
    const deduction = 17482.50;
    const rebate = dependents * 400 + (isMarried ? 400 : 0);
    return Math.max(0, (taxableBase * rate) - deduction - rebate);
  }
}

/**
 * Calculadora de INSS (Moçambique)
 * 3% Desconto Trabalhador, 4% Encargo Entidade Patronal
 */
export function calculateINSS(salaryAndCommissions: number) {
  return {
    worker: Math.round(salaryAndCommissions * 0.03 * 100) / 100,
    employer: Math.round(salaryAndCommissions * 0.04 * 100) / 100,
    total: Math.round(salaryAndCommissions * 0.07 * 100) / 100
  };
}

/**
 * Desconto de Faltas Injustificadas
 * Formula legal: Desconto = (Salário Base / 30) * Dias de Falta
 */
export function calculateAbsenceDeduction(baseSalary: number, absentDays: number): number {
  return Math.round(((baseSalary / 30) * absentDays) * 100) / 100;
}

/**
 * Cálculo de Horas Extraordinárias e Trabalho Noturno
 * Horas normais: Salário base mensal dividido por 173.33 (Média de horas mensais para 40h/semana) ou 190.66 (44h/semana).
 */
export function calculateExtraHoursAndNightShift(
  baseSalary: number,
  weeklyHoursLimit: 44 | 48,
  nightHours: number,
  overtimeWeekdayHours: number,
  overtimeWeekendHolidayHours: number
) {
  const averageMonthlyHours = weeklyHoursLimit === 44 ? 190.66 : 208.00;
  const normalHourlyRate = baseSalary / averageMonthlyHours;

  // Subsídio de trabalho noturno: +25% do salário base por hora
  const nightShiftPay = nightHours * (normalHourlyRate * 0.25);

  // Horas Extraordinárias: +50% em dias úteis
  const overtimeWeekdayPay = overtimeWeekdayHours * (normalHourlyRate * 1.5);

  // Horas Extraordinárias: +100% em dias de descanso / feriados
  const overtimeWeekendHolidayPay = overtimeWeekendHolidayHours * (normalHourlyRate * 2.0);

  return {
    normalHourlyRate: Math.round(normalHourlyRate * 100) / 100,
    nightShiftPay: Math.round(nightShiftPay * 100) / 100,
    overtimeWeekdayPay: Math.round(overtimeWeekdayPay * 100) / 100,
    overtimeWeekendHolidayPay: Math.round(overtimeWeekendHolidayPay * 100) / 100,
    totalAdditions: Math.round((nightShiftPay + overtimeWeekdayPay + overtimeWeekendHolidayPay) * 100) / 100
  };
}

/**
 * Calculo de Férias Moçambique
 * 12 dias no 1º ano (2 dias por mês de trabalho após 6 meses)
 * 30 dias subsequentes
 */
export function calculateVacationDays(monthsWorked: number, yearsWorked: number): number {
  if (yearsWorked >= 1) {
    return 30;
  }
  if (monthsWorked >= 6) {
    return monthsWorked * 2;
  }
  return 0;
}

/**
 * Foreigners Quota Assessment
 * size of enterprise:
 * - Grande Empresa (>100 workers): max 8% foreigners
 * - Média Empresa (11-100 workers): max 10% foreigners
 * - Pequena Empresa (1-10 workers): max 15% foreigners
 */
export function checkForeignerQuota(totalEmployees: number, foreignCount: number) {
  let maxPercent = 0.15;
  let enterpriseSize = 'Pequena';

  if (totalEmployees > 100) {
    maxPercent = 0.08;
    enterpriseSize = 'Grande';
  } else if (totalEmployees > 10) {
    maxPercent = 0.10;
    enterpriseSize = 'Média';
  }

  const allowedForeigners = Math.floor(totalEmployees * maxPercent);
  const compliant = foreignCount <= allowedForeigners || totalEmployees === 0;

  return {
    enterpriseSize,
    maxPercent: maxPercent * 100,
    allowedForeigners,
    compliant
  };
}
