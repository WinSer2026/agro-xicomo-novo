import React from 'react';
import { DateRangePreset, getDateRangeFromPreset } from '../utils/dateRangeHelper';

interface DateRangeFilterProps {
  startDate: string; // YYYY-MM-DD
  endDate: string; // YYYY-MM-DD
  preset: DateRangePreset;
  onRangeChange: (startDate: string, endDate: string, preset: DateRangePreset) => void;
  onGenerateReport?: () => void;
  onPrint?: () => void;
  onExportPDF?: () => void;
  onExportExcel?: () => void;
  title?: string;
  className?: string;
  showExportButtons?: boolean;
  showAllHistory?: boolean;
}

export const DateRangeFilter: React.FC<DateRangeFilterProps> = ({
  startDate,
  endDate,
  preset,
  onRangeChange,
  onGenerateReport,
  onPrint,
  onExportPDF,
  onExportExcel,
  className = '',
  showExportButtons = true,
  showAllHistory = false
}) => {
  const presets: { id: DateRangePreset; label: string }[] = [
    ...(showAllHistory ? [{ id: 'Todo o Histórico' as const, label: 'Todo o Histórico' }] : []),
    { id: 'Hoje', label: 'Hoje' },
    { id: 'Esta Semana', label: 'Esta Semana' },
    { id: 'Este Mês', label: 'Este Mês' },
    { id: 'Mês Passado', label: 'Mês Passado' },
    { id: 'Este Ano', label: 'Este Ano' }
  ];

  const handlePresetClick = (p: DateRangePreset) => {
    if (p === 'Personalizado') {
      onRangeChange(startDate, endDate, 'Personalizado');
    } else {
      const range = getDateRangeFromPreset(p);
      onRangeChange(range.startDate, range.endDate, p);
    }
  };

  const handleStartDateChange = (val: string) => {
    const end = val && endDate && val > endDate ? val : endDate;
    onRangeChange(val, end, 'Personalizado');
  };

  const handleEndDateChange = (val: string) => {
    const start = val && startDate && val < startDate ? val : startDate;
    onRangeChange(start, val, 'Personalizado');
  };

  return (
    <div className={`bg-white border border-slate-200 rounded-xl px-3 py-2 shadow-xs flex flex-wrap items-center justify-between gap-2.5 ${className}`}>
      {/* Left: Date inputs */}
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="material-symbols-outlined text-emerald-700 text-[18px]">calendar_month</span>
        <input
          type="date"
          value={startDate}
          onChange={(e) => handleStartDateChange(e.target.value)}
          className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600 font-mono transition-colors"
          title="Data Início"
        />
        <span className="text-slate-400 font-bold text-xs">→</span>
        <input
          type="date"
          value={endDate}
          onChange={(e) => handleEndDateChange(e.target.value)}
          className="bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-2 py-1 text-xs font-bold text-slate-800 focus:bg-white focus:outline-none focus:ring-1 focus:ring-emerald-600 font-mono transition-colors"
          title="Data Fim"
        />
      </div>

      {/* Center: Clean Preset Buttons */}
      <div className="flex flex-wrap items-center gap-1 bg-slate-100 p-0.5 rounded-lg border border-slate-200">
        {presets.map((p) => {
          const isActive = preset === p.id;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePresetClick(p.id)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-all cursor-pointer whitespace-nowrap ${
                isActive
                  ? 'bg-emerald-700 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {/* Right: Export buttons */}
      {showExportButtons && (
        <div className="flex items-center gap-1.5 shrink-0 ml-auto">
          {onGenerateReport && (
            <button
              type="button"
              onClick={onGenerateReport}
              className="px-2.5 py-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[14px]">search</span>
              <span>Filtrar</span>
            </button>
          )}
          {onExportPDF && (
            <button
              type="button"
              onClick={onExportPDF}
              className="px-2.5 py-1 bg-slate-800 hover:bg-slate-900 text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1 cursor-pointer"
              title="Exportar PDF"
            >
              <span className="material-symbols-outlined text-[14px]">picture_as_pdf</span>
              <span>PDF</span>
            </button>
          )}
          {onExportExcel && (
            <button
              type="button"
              onClick={onExportExcel}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-all flex items-center gap-1 cursor-pointer"
              title="Exportar Excel"
            >
              <span className="material-symbols-outlined text-[14px]">table_view</span>
              <span>Excel</span>
            </button>
          )}
          {onPrint && (
            <button
              type="button"
              onClick={onPrint}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-xs rounded-lg border border-slate-300 transition-all flex items-center gap-1 cursor-pointer"
              title="Imprimir"
            >
              <span className="material-symbols-outlined text-[14px]">print</span>
              <span>Imprimir</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};

export default DateRangeFilter;
