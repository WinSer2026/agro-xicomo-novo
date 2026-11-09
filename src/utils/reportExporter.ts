import { companyNuit, companyName } from './companyInfo';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { SystemSettings } from '../types';

export interface ReportColumn {
  header: string;
  dataKey: string;
}

export interface ReportData {
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: any[];
  fileName: string;
  footer?: string;
}

async function getLogoBase64(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:')) {
    return url;
  }
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch (e) {
    console.warn('Failed to load logo image for Report:', e);
    return null;
  }
}

/**
 * Professional PDF Exporter using jsPDF-AutoTable
 */
export async function exportToPDF(data: ReportData, settings: SystemSettings) {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const logoUrl = settings.logoUrl || '/logo.png';
  const logoBase64 = await getLogoBase64(logoUrl);

  if (logoBase64) {
    try {
      // Logo nos relatórios A4: 6cm x 4.5cm = 60mm x 45mm
      doc.addImage(logoBase64, 'PNG', 15, 5, 60, 45);
    } catch (e) {
      try { doc.addImage(logoBase64, 'JPEG', 15, 5, 60, 45); }
      catch (e2) { console.warn('Logo render failed in PDF:', e2); }
    }
  }

  const companyName = settings.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';
  const nuit = companyNuit(settings.companyNuit);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0, 106, 78); // Primary Green
  doc.text(data.title.toUpperCase(), 80, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(companyName.toUpperCase(), 80, 22);
  doc.text(`NUIT: ${nuit} • Emitido em: ${new Date().toLocaleString('pt-MZ')}`, 80, 27);
  
  if (data.subtitle) {
    doc.text(data.subtitle, 80, 32);
  }

  doc.setDrawColor(226, 232, 240);
  doc.setLineWidth(0.5);
  doc.line(15, 52, 195, 52);

  // AutoTable
  autoTable(doc, {
    startY: 55,
    head: [data.columns.map(col => col.header)],
    body: data.rows.map(row => data.columns.map(col => row[col.dataKey])),
    theme: 'striped',
    headStyles: {
      fillColor: [0, 106, 78],
      textColor: [255, 255, 255],
      fontSize: 8,
      fontStyle: 'bold',
      halign: 'left'
    },
    bodyStyles: {
      fontSize: 7.5,
      textColor: [51, 65, 85]
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252]
    },
    margin: { top: 40, left: 15, right: 15, bottom: 20 },
    didDrawPage: (dataInfo: any) => {
      // Footer
      const totalPages = doc.getNumberOfPages();
      const pageNumber = dataInfo.pageNumber;
      
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 116, 139);
      
      doc.setDrawColor(226, 232, 240);
      doc.line(15, 280, 195, 280);
      
      const footerText = data.footer || `${companyName} • NUIT: ${nuit}`;
      doc.text(footerText, 15, 285);
      doc.text(`Página ${pageNumber} de ${totalPages}`, 195, 285, { align: 'right' });
    }
  });

  doc.save(`${data.fileName}.pdf`);
}

/**
 * Professional Excel Exporter using SheetJS (xlsx)
 */
export function exportToExcel(data: ReportData) {
  // Map rows to match columns headers
  const excelData = data.rows.map(row => {
    const newRow: any = {};
    data.columns.forEach(col => {
      newRow[col.header] = row[col.dataKey];
    });
    return newRow;
  });

  const worksheet = XLSX.utils.json_to_sheet(excelData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Relatório');

  // Auto-size columns
  const maxWidths = data.columns.map(col => {
    const headerLen = col.header.length;
    const maxRowLen = data.rows.reduce((max, row) => {
      const val = String(row[col.dataKey] || '');
      return Math.max(max, val.length);
    }, 0);
    return { wch: Math.max(headerLen, maxRowLen) + 2 };
  });
  worksheet['!cols'] = maxWidths;

  XLSX.writeFile(workbook, `${data.fileName}.xlsx`);
}
