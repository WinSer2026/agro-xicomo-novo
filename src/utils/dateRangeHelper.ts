/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

export type DateRangePreset = 
  | 'Hoje' 
  | 'Ontem' 
  | 'Esta Semana' 
  | 'Semana Passada' 
  | 'Este Mês' 
  | 'Mês Passado' 
  | 'Este Ano' 
  | 'Personalizado';

export interface DateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  preset: DateRangePreset;
}

/**
 * Format a Date to YYYY-MM-DD local string
 */
export function formatDateToISO(d: Date): string {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Format YYYY-MM-DD to DD/MM/YYYY for Mozambican / Portuguese display
 */
export function formatDatePT(dateStr: string): string {
  if (!dateStr) return '';
  const clean = dateStr.split('T')[0];
  const parts = clean.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

/**
 * Get date range for a given preset
 */
export function getDateRangeFromPreset(preset: DateRangePreset): { startDate: string; endDate: string } {
  const now = new Date();
  const todayStr = formatDateToISO(now);

  switch (preset) {
    case 'Hoje':
      return { startDate: todayStr, endDate: todayStr };

    case 'Ontem': {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yStr = formatDateToISO(yesterday);
      return { startDate: yStr, endDate: yStr };
    }

    case 'Esta Semana': {
      // Monday of current week
      const d = new Date(now);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
      d.setDate(diff);
      return { startDate: formatDateToISO(d), endDate: todayStr };
    }

    case 'Semana Passada': {
      // Monday of last week to Sunday of last week
      const d = new Date(now);
      const day = d.getDay();
      const diff = d.getDate() - day + (day === 0 ? -6 : 1) - 7;
      const monday = new Date(d.setDate(diff));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { startDate: formatDateToISO(monday), endDate: formatDateToISO(sunday) };
    }

    case 'Este Mês': {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: formatDateToISO(firstDay), endDate: todayStr };
    }

    case 'Mês Passado': {
      const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      return { startDate: formatDateToISO(firstDayLastMonth), endDate: formatDateToISO(lastDayLastMonth) };
    }

    case 'Este Ano': {
      const firstDayYear = new Date(now.getFullYear(), 0, 1);
      return { startDate: formatDateToISO(firstDayYear), endDate: todayStr };
    }

    case 'Personalizado':
    default:
      return { startDate: formatDateToISO(new Date(now.getFullYear(), now.getMonth(), 1)), endDate: todayStr };
  }
}

/**
 * Fuso horário operacional da empresa. Maputo é UTC+2 durante todo o ano
 * (Moçambique não aplica horário de verão), pelo que o desvio é constante.
 */
export const OPERATIONAL_TIME_ZONE = 'Africa/Maputo';
const OPERATIONAL_UTC_OFFSET = '+02:00';

const localDayFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: OPERATIONAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/**
 * Devolve o dia de calendário LOCAL (YYYY-MM-DD) de um timestamp.
 *
 * É a peça que faltava para o PDV: `date` é gravado em UTC, e cortar a string
 * ("2026-11-08T22:30Z".slice(0,10)) dá o dia anterior a uma venda feita às
 * 00:30 em Maputo. Esta função converte o instante para o dia local.
 */
export function toLocalDateKey(value?: string | null): string {
  if (!value) return '';
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw; // já é um dia de calendário

  const parsed = new Date(raw);
  if (isNaN(parsed.getTime())) return raw.slice(0, 10);

  const parts = localDayFormatter.formatToParts(parsed);
  const year = parts.find(part => part.type === 'year')?.value ?? '';
  const month = parts.find(part => part.type === 'month')?.value ?? '';
  const day = parts.find(part => part.type === 'day')?.value ?? '';
  return year && month && day ? `${year}-${month}-${day}` : raw.slice(0, 10);
}

/** Início (00:00:00.000) do dia local, expresso em UTC ISO. */
export function localDayStartUtcIso(dateKey: string): string {
  return new Date(`${dateKey}T00:00:00.000${OPERATIONAL_UTC_OFFSET}`).toISOString();
}

/** Fim (23:59:59.999) do dia local, expresso em UTC ISO. */
export function localDayEndUtcIso(dateKey: string): string {
  return new Date(`${dateKey}T23:59:59.999${OPERATIONAL_UTC_OFFSET}`).toISOString();
}

/**
 * Check if a date string falls inside the [startDate, endDate] range inclusive.
 * Handles ISO strings ("2026-09-27T10:30:00Z"), standard date strings ("2026-09-27"), and Timestamps.
 */
export function isDateInRange(
  targetDateStr: string | undefined | null,
  startDate: string,
  endDate: string,
  /** Dia local já calculado (evita reconverter em listas grandes). */
  knownDateKey?: string
): boolean {
  if (!targetDateStr && !knownDateKey) return false;
  if (!startDate && !endDate) return true;

  // O dia de calendário é o dia LOCAL, nunca o prefixo da string UTC.
  const targetClean = knownDateKey || toLocalDateKey(targetDateStr);
  if (!targetClean) return false;

  if (startDate && targetClean < startDate) return false;
  if (endDate && targetClean > endDate) return false;

  return true;
}
