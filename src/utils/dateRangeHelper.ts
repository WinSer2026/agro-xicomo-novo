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
 * Check if a date string falls inside the [startDate, endDate] range inclusive.
 * Handles ISO strings ("2026-09-27T10:30:00Z"), standard date strings ("2026-09-27"), and Timestamps.
 */
export function isDateInRange(targetDateStr: string | undefined | null, startDate: string, endDate: string): boolean {
  if (!targetDateStr) return false;
  if (!startDate && !endDate) return true;

  // Extract YYYY-MM-DD
  let targetClean = '';
  if (targetDateStr.includes('T')) {
    targetClean = targetDateStr.split('T')[0];
  } else if (targetDateStr.length >= 10 && targetDateStr.charAt(4) === '-' && targetDateStr.charAt(7) === '-') {
    targetClean = targetDateStr.substring(0, 10);
  } else {
    try {
      const parsed = new Date(targetDateStr);
      if (!isNaN(parsed.getTime())) {
        targetClean = formatDateToISO(parsed);
      } else {
        return false;
      }
    } catch {
      return false;
    }
  }

  if (startDate && targetClean < startDate) return false;
  if (endDate && targetClean > endDate) return false;

  return true;
}
