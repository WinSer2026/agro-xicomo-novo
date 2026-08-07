import { jsPDF } from 'jspdf';
import { Sale, SystemSettings } from '../types';
import { numeroParaExtenso } from './numberToWords';

/**
 * Gerador de PDFs profissionais para AGRO - XICOMO & SERVIÇOS, LDA.
 * Replica fielmente os modelos de:
 *   1. Factura Definitiva / Proforma (estilo Afritool)
 *   2. Recibo A4 (estilo clássico moçambicano)
 *   3. Recibo Térmico XP-80C (80mm)
 */

// ============================================================================
// HELPERS
// ============================================================================

async function getLogoBase64(url: string): Promise<string | null> {
  if (!url) return null;
  if (url.startsWith('data:image/svg+xml') || url.includes('svg+xml')) {
    try {
      return new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'Anonymous';
        img.onload = () => {
          const canvas = document.createElement('canvas');
          canvas.width = 800;
          canvas.height = 400;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            resolve(canvas.toDataURL('image/png'));
          } else { resolve(url); }
        };
        img.onerror = () => resolve(url);
        img.src = url;
      });
    } catch { return url; }
  }
  if (url.startsWith('data:')) return url;
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function getCompanyDefaults(settings: SystemSettings) {
  return {
    name: settings.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA',
    nuit: settings.companyNuit || '401976590',
    address: settings.companyAddress || 'Maputo, Bairro do Zimpeto, Av. de Moçambique, Parcela: 654 R/C',
    email: settings.email || 'agroxicomo1@gmail.com',
    phone1: settings.vodacom1 || '84 94 23 241',
    phone2: settings.vodacom2 || '86 36 99900',
    phone3: settings.movitel1 || '8451970702',
    mpesa: settings.mpesa || '',
    emola: settings.emola || '',
    bank1: settings.banco || 'First Capital Bank, S.A.',
    acc1: settings.numero_conta || '99466610001',
    nib1: settings.nib || '001000000099466610196',
    bank2: settings.banco2 || '',
    acc2: settings.numero_conta2 || '',
    nib2: settings.nib2 || '',
  };
}

function getDocTitle(invoice: Sale, isReceipt = false, forcedTitle?: string): string {
  if (forcedTitle) return forcedTitle;
  const docType = invoice.documentType || 'FaturaDefinitiva';
  if (docType === 'Cotacao' || docType === 'FaturaProforma') return 'FACTURA PROFORMA';
  if (invoice.paymentMethod === 'Crédito') return 'FACTURA A CRÉDITO';
  return isReceipt ? 'RECIBO' : 'FACTURA DEFINITIVA';
}

function fmtMT(val: number): string {
  return val.toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(isoStr: string): string {
  const d = new Date(isoStr);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// ============================================================================
// 1. FACTURA DEFINITIVA / PROFORMA A4 (estilo Afritool)
// ============================================================================

export async function downloadInvoiceA4(invoice: Sale, settings: SystemSettings, showAsReceipt = false, forcedTitle?: string) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const co = getCompanyDefaults(settings);
  const logoBase64 = await getLogoBase64(settings.logoUrl || '/logo.png');

  const items = invoice.items;
  const pages: typeof items[] = [];
  let chunk: typeof items = [];
  for (let i = 0; i < items.length; i++) {
    const limit = pages.length === 0 ? 12 : 20;
    chunk.push(items[i]);
    if (chunk.length === limit || i === items.length - 1) {
      pages.push(chunk);
      chunk = [];
    }
  }

  const totalPages = pages.length;
  const docTitle = getDocTitle(invoice, showAsReceipt, forcedTitle);
  const isReceipt = showAsReceipt;

  pages.forEach((pageItems, pageIdx) => {
    if (pageIdx > 0) doc.addPage();
    const isFirst = pageIdx === 0;
    const isLast = pageIdx === totalPages - 1;
    const pg = pageIdx + 1;

    // ── HEADER (first page only) ──────────────────────────────────────
    if (isFirst) {
      // Logo (canto superior esquerdo)
      if (logoBase64) {
        try {
          doc.addImage(logoBase64, 'PNG', 15, 10, 60, 35);
        } catch (e) {
          try { doc.addImage(logoBase64, 'JPEG', 15, 10, 60, 35); }
          catch (e2) { console.warn('Logo error:', e2); }
        }
      }

      // Company info below logo
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(14, 98, 49); // Primary color
      doc.text(co.name.toUpperCase(), 15, 52);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(80, 80, 80);
      doc.text(`${co.address.split(',')[0]}, Moçambique • NUIT: ${co.nuit}`, 15, 56);
      
      const contacts = [co.phone3, co.phone1, co.phone2].filter(Boolean).slice(0, 2).join(' / ');
      doc.text(`Email: ${co.email} | Contacto: ${contacts || '+258 84 123 4567'}`, 15, 60);

      // Document title and info (right side)
      // Badge
      doc.setFillColor(14, 98, 49);
      doc.rect(130, 10, 65, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text(docTitle, 162.5, 15.5, { align: 'center' });

      // Document Number and Date
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(50, 50, 50);
      doc.text(`Nº: ${invoice.invoiceNumber}`, 195, 24, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(`Data: ${new Date(invoice.date).toLocaleString('pt-MZ')}`, 195, 29, { align: 'right' });
      doc.text(`Forma de Pagamento: ${(invoice.paymentMethod || 'Dinheiro').toUpperCase()}`, 195, 34, { align: 'right' });

      // Border line separator
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.3);
      doc.line(15, 64, 195, 64);

      // Client / Operator Box (from y=67 to y=87)
      doc.setFillColor(248, 249, 250);
      doc.rect(15, 67, 180, 20, 'F');
      doc.setDrawColor(225, 228, 230);
      doc.setLineWidth(0.25);
      doc.rect(15, 67, 180, 20, 'S');

      // Left Column (Faturado a)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(120, 120, 120);
      doc.text('FATURADO A', 18, 71);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(0, 0, 0);
      doc.text(invoice.customerName || 'Cliente Geral', 18, 75.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 100, 100);
      doc.text(invoice.customerAddress || 'Província de Maputo, Moçambique', 18, 79.5);
      if (invoice.customerNuit) {
        doc.text(`NUIT: ${invoice.customerNuit}`, 18, 83.5);
      }

      // Right Column (Operador de Registo)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(120, 120, 120);
      doc.text('OPERADOR DE REGISTO', 120, 71);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(0, 0, 0);
      doc.text(invoice.operatorName || 'Sistema', 120, 75.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 100, 100);
      doc.text('Sessão Local Validada', 120, 79.5);
    } else {
      // ── CONTINUATION PAGE ──
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(14, 98, 49);
      doc.text(`${co.name.toUpperCase()}`, 15, 12);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text(`FATURA COMERCIAL - CONTINUAÇÃO (Pág ${pg}/${totalPages})`, 15, 17);
      doc.text(`Nº: ${invoice.invoiceNumber} | Data: ${fmtDate(invoice.date)}`, 195, 17, { align: 'right' });
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.3);
      doc.line(15, 20, 195, 20);
    }

    // Table Header Y
    const thY = isFirst ? 92 : 23;

    // Items table header
    doc.setFillColor(14, 98, 49); // Primary green
    doc.rect(15, thY, 180, 6, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('Item', 17, thY + 4.5);
    doc.text('Qtd', 115, thY + 4.5, { align: 'right' });
    doc.text('Unidade', 120, thY + 4.5);
    doc.text('P. Unitário (MT)', 160, thY + 4.5, { align: 'right' });
    doc.text('Total (MT)', 193, thY + 4.5, { align: 'right' });

    let itemY = thY + 6;

    // Item rows
    pageItems.forEach((item, idx) => {
      const rowY = itemY + (idx * 7);
      const descText = item.name.length > 65 ? item.name.substring(0, 62) + '...' : item.name;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(50, 50, 50);
      doc.text(descText, 17, rowY + 5);

      doc.setFont('helvetica', 'normal');
      doc.text(fmtMT(item.quantity), 115, rowY + 5, { align: 'right' });
      doc.text(item.unit || 'UN', 120, rowY + 5);
      doc.text(fmtMT(item.unitPrice), 160, rowY + 5, { align: 'right' });
      
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(14, 98, 49);
      doc.text(fmtMT(item.totalPrice), 193, rowY + 5, { align: 'right' });

      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.15);
      doc.line(15, rowY + 7, 195, rowY + 7);
    });

    if (isLast) {
      renderInvoiceFooter(doc, invoice, settings, co, pageItems.length, thY, isReceipt, pg, totalPages);
    } else {
      // Continuation indicator on intermediate pages
      const footerStartY = itemY + (pageItems.length * 7) + 4;
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.3);
      doc.line(15, footerStartY, 195, footerStartY);

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      doc.text(`Fatura Comercial Nº: ${invoice.invoiceNumber}`, 15, footerStartY + 5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(14, 98, 49);
      doc.text(`Continua na página seguinte... (Pág ${pg} de ${totalPages})`, 195, footerStartY + 5, { align: 'right' });
    }

    // Page footer at the absolute bottom
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(150, 150, 150);
    doc.text(`Documento Processado por Computador / © ${co.name} /`, 15, 289);
    doc.text(`Pág. ${pg}/${totalPages}`, 185, 289, { align: 'right' });
    doc.text('Maputo', 195, 289, { align: 'right' });
  });

  let prefix = 'FATURA';
  if (invoice.documentType === 'Cotacao' || invoice.documentType === 'FaturaProforma') prefix = 'PROFORMA';
  else if (invoice.paymentMethod === 'Crédito') prefix = 'FATURA_CREDITO';
  else if (showAsReceipt) prefix = 'RECIBO';
  doc.save(`${prefix}_${invoice.invoiceNumber}.pdf`);
}

function renderInvoiceFooter(
  doc: jsPDF,
  invoice: Sale,
  _settings: SystemSettings,
  co: ReturnType<typeof getCompanyDefaults>,
  itemCount: number,
  tableStartY: number,
  _isReceipt: boolean,
  _pageNum: number,
  _totalPages: number,
) {
  const footerStartY = Math.max(tableStartY + (itemCount * 7) + 8, 170);

  // Draw divider line
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.3);
  doc.line(15, footerStartY, 195, footerStartY);

  // Left Column: Coordenadas Bancárias & POS (x=15 to x=115)
  const boxY = footerStartY + 4;
  doc.setFillColor(248, 249, 250);
  doc.rect(15, boxY, 105, 30, 'F');
  doc.setDrawColor(225, 228, 230);
  doc.setLineWidth(0.2);
  doc.rect(15, boxY, 105, 30, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(14, 98, 49); // Primary color
  doc.text('COORDENADAS BANCÁRIAS & POS', 18, boxY + 5.5);

  doc.setFontSize(7.5);
  doc.setTextColor(80, 80, 80);
  
  doc.setFont('helvetica', 'normal');
  doc.text(`Banco: ${co.bank1 || 'First Capital Bank, S.A.'}`, 18, boxY + 11.5);
  doc.text(`Nº de Conta: ${co.acc1 || '99466610001'} | NIB: ${co.nib1 || '001000000099466610196'}`, 18, boxY + 16.5);
  
  let mpesaStr = co.mpesa || '84 123 4567';
  let emolaStr = co.emola || '86 123 4567';
  doc.text(`M-Pesa: ${mpesaStr} | E-Mola: ${emolaStr}`, 18, boxY + 21.5);

  doc.setFont('helvetica', 'bold');
  doc.text(`NUIT da Empresa: ${co.nuit}`, 18, boxY + 26.5);

  // Right Column: Summary Totals (x=130 to x=195)
  const totalsY = footerStartY + 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(80, 80, 80);

  doc.text('Subtotal:', 130, totalsY);
  doc.text(`${fmtMT(invoice.subtotal)} MT`, 195, totalsY, { align: 'right' });

  doc.text('Desconto:', 130, totalsY + 5);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(200, 0, 0); // red for discount
  doc.text(`-${fmtMT(invoice.discount)} MT`, 195, totalsY + 5, { align: 'right' });

  // Divider for totals
  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.2);
  doc.line(130, totalsY + 8, 195, totalsY + 8);

  // Total Pago
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.setTextColor(0, 0, 0);
  doc.text('Total Pago:', 130, totalsY + 13);
  doc.setTextColor(14, 98, 49); // Primary green
  doc.text(`${fmtMT(invoice.total)} MT`, 195, totalsY + 13, { align: 'right' });

  // Forma de pagamento box
  const payY = totalsY + 17;
  doc.setFillColor(245, 245, 245);
  doc.rect(130, payY, 65, 8, 'F');
  doc.setDrawColor(220, 220, 220);
  doc.rect(130, payY, 65, 8, 'S');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(80, 80, 80);
  doc.text('Forma de Pagamento:', 132, payY + 5);
  doc.setTextColor(14, 98, 49);
  doc.setFontSize(7.5);
  doc.text((invoice.paymentMethod || 'Dinheiro').toUpperCase(), 193, payY + 5, { align: 'right' });

  // Disclaimer / Stamp
  const bLineY = Math.max(258, footerStartY + 40);
  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.5);
  doc.setLineDashPattern([2, 2], 0); // Dashed line
  doc.line(15, bLineY, 195, bLineY);
  doc.setLineDashPattern([], 0); // Reset to solid line

  doc.setFont('helvetica', 'italic');
  doc.setFontSize(8.5);
  doc.setTextColor(100, 100, 100);
  const disclaimerText = invoice.documentType === 'FaturaProforma' 
    ? '"Esta fatura proforma tem a validade de 30 dias a contar da data da sua emissão."'
    : '"Esta fatura tem validade até à reposição de stock"';
  doc.text(disclaimerText, 105, bLineY + 5, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(150, 150, 150);
  doc.text('PROCESSADO POR COMPUTADOR • LICENCIADO PARA VERCEL/FIREBASE FREE TIERS', 105, bLineY + 9, { align: 'center' });
}

export async function downloadReceiptA4(invoice: Sale, settings: SystemSettings) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const co = getCompanyDefaults(settings);
  const logoBase64 = await getLogoBase64(settings.logoUrl || '/logo.png');

  const items = invoice.items;
  const pages: typeof items[] = [];
  const limit = 8;
  for (let i = 0; i < items.length; i += limit) {
    pages.push(items.slice(i, i + limit));
  }

  const totalPages = pages.length;

  pages.forEach((pageItems, pageIdx) => {
    if (pageIdx > 0) doc.addPage();
    const isFirst = pageIdx === 0;
    const isLast = pageIdx === totalPages - 1;
    const pg = pageIdx + 1;

    // ── HEADER (first page only) ──────────────────────────────────────
    if (isFirst) {
      // Logo (canto superior esquerdo)
      if (logoBase64) {
        try {
          doc.addImage(logoBase64, 'PNG', 15, 10, 60, 35);
        } catch (e) {
          try { doc.addImage(logoBase64, 'JPEG', 15, 10, 60, 35); }
          catch (e2) { console.warn('Logo error:', e2); }
        }
      }

      // Company info below logo
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.setTextColor(14, 98, 49); // Primary color
      doc.text(co.name.toUpperCase(), 15, 52);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8.5);
      doc.setTextColor(80, 80, 80);
      doc.text(`${co.address.split(',')[0]}, Moçambique • NUIT: ${co.nuit}`, 15, 56);
      
      const contacts = [co.phone3, co.phone1, co.phone2].filter(Boolean).slice(0, 2).join(' / ');
      doc.text(`Email: ${co.email} | Contacto: ${contacts || '+258 84 123 4567'}`, 15, 60);

      // Document title and info (right side)
      // Badge RECIBO
      doc.setFillColor(14, 98, 49);
      doc.rect(130, 10, 65, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(255, 255, 255);
      doc.text('RECIBO', 162.5, 15.5, { align: 'center' });

      // Receipt number
      const recNumber = invoice.receiptNumber || (invoice.invoiceNumber.startsWith('Fact-') ? invoice.invoiceNumber.replace('Fact-', 'Rec-') : invoice.invoiceNumber.startsWith('FAC-') ? invoice.invoiceNumber.replace('FAC-', 'REC-') : `Rec-2026-${invoice.invoiceNumber}`);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(9);
      doc.setTextColor(50, 50, 50);
      doc.text(`Recibo Nº: ${recNumber}`, 195, 24, { align: 'right' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(`Referente à Fatura Nº: ${invoice.invoiceNumber}`, 195, 29, { align: 'right' });
      doc.text(`Data de Emissão: ${new Date(invoice.date).toLocaleString('pt-MZ')}`, 195, 34, { align: 'right' });
      doc.text(`Forma de Pagamento: ${(invoice.paymentMethod || 'Dinheiro').toUpperCase()}`, 195, 39, { align: 'right' });

    } else {
      // ── CONTINUATION PAGE HEADER ──
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(14, 98, 49);
      doc.text(`${co.name.toUpperCase()}`, 15, 12);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text(`RECIBO DE PAGAMENTO - CONTINUAÇÃO (Pág ${pg}/${totalPages})`, 15, 17);
      doc.text(`Ref Fatura: ${invoice.invoiceNumber}`, 195, 17, { align: 'right' });
      
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.3);
      doc.line(15, 20, 195, 20);
    }

    // Border line separator (first page only)
    if (isFirst) {
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.3);
      doc.line(15, 64, 195, 64);

      // Client / Operator Box (from y=67 to y=87)
      doc.setFillColor(248, 249, 250);
      doc.rect(15, 67, 180, 20, 'F');
      doc.setDrawColor(225, 228, 230);
      doc.setLineWidth(0.25);
      doc.rect(15, 67, 180, 20, 'S');

      // Left Column (Dados do Cliente)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(120, 120, 120);
      doc.text('DADOS DO CLIENTE', 18, 71);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(0, 0, 0);
      doc.text(invoice.customerName || 'Cliente Geral', 18, 75.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 100, 100);
      doc.text(`Endereço: ${invoice.customerAddress || 'N/D'}`, 18, 79.5);
      doc.text(`NUIT: ${invoice.customerNuit || 'Consumidor Final'}`, 18, 83.5);

      // Right Column (Dados do Operador)
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(120, 120, 120);
      doc.text('DADOS DO OPERADOR', 120, 71);

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(0, 0, 0);
      doc.text(invoice.operatorName || 'Operador Autorizado', 120, 75.5);

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(100, 100, 100);
      doc.text('Autenticado no Caixa POS', 120, 79.5);
      doc.text('Maputo, Moçambique', 120, 83.5);
    }

    // Table Header Y
    const thY = isFirst ? 92 : 23;

    // Items table header
    doc.setFillColor(14, 98, 49); // Primary green
    doc.rect(15, thY, 180, 6, 'F');
    
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('Item / Serviço', 17, thY + 4.5);
    doc.text('Qtd', 115, thY + 4.5, { align: 'right' });
    doc.text('Unidade', 120, thY + 4.5);
    doc.text('P. Unitário (MT)', 160, thY + 4.5, { align: 'right' });
    doc.text('Total (MT)', 193, thY + 4.5, { align: 'right' });

    let itemY = thY + 6;

    // Item rows
    pageItems.forEach((item, idx) => {
      const rowY = itemY + (idx * 7);
      const descText = item.name.length > 65 ? item.name.substring(0, 62) + '...' : item.name;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(50, 50, 50);
      doc.text(descText, 17, rowY + 5);

      doc.setFont('helvetica', 'normal');
      doc.text(fmtMT(item.quantity), 115, rowY + 5, { align: 'right' });
      doc.text(item.unit || 'UN', 120, rowY + 5);
      doc.text(fmtMT(item.unitPrice), 160, rowY + 5, { align: 'right' });
      
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(14, 98, 49);
      doc.text(fmtMT(item.totalPrice), 193, rowY + 5, { align: 'right' });

      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.15);
      doc.line(15, rowY + 7, 195, rowY + 7);
    });

    // ── FOOTER SECTION (only on last page) ──
    if (isLast) {
      const footerStartY = Math.max(itemY + (pageItems.length * 7) + 8, 170);

      // Divider line
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.3);
      doc.line(15, footerStartY, 195, footerStartY);

      // Left-side disclaimer note
      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8.5);
      doc.setTextColor(100, 100, 100);
      doc.text('*Este recibo serve como prova oficial de liquidação total da fatura acima referenciada.', 15, footerStartY + 6, { maxWidth: 105 });

      // Right Column: Summary Totals
      const totalsY = footerStartY + 6;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);

      doc.text('Subtotal:', 130, totalsY);
      doc.text(`${fmtMT(invoice.subtotal)} MT`, 195, totalsY, { align: 'right' });

      doc.text('Desconto:', 130, totalsY + 5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(200, 0, 0); // red for discount
      doc.text(`-${fmtMT(invoice.discount)} MT`, 195, totalsY + 5, { align: 'right' });

      // Divider for totals
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.2);
      doc.line(130, totalsY + 8, 195, totalsY + 8);

      // Total Pago
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10.5);
      doc.setTextColor(0, 0, 0);
      doc.text('Total Pago:', 130, totalsY + 13.5);
      doc.setTextColor(14, 98, 49); // Primary green
      doc.text(`${fmtMT(invoice.total)} MT`, 195, totalsY + 13.5, { align: 'right' });

      // Brand / License box at the bottom
      const bLineY = Math.max(258, footerStartY + 42);
      doc.setFillColor(248, 249, 250);
      doc.rect(15, bLineY, 180, 22, 'F');
      doc.setDrawColor(220, 220, 220);
      doc.rect(15, bLineY, 180, 22, 'S');

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8);
      doc.setTextColor(50, 50, 50);
      doc.text(co.name.toUpperCase(), 105, bLineY + 5, { align: 'center' });

      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7);
      doc.setTextColor(100, 100, 100);
      doc.text(`Maputo, Moçambique • NUIT: ${co.nuit}`, 105, bLineY + 9, { align: 'center' });
      const contacts = [co.phone3, co.phone1, co.phone2].filter(Boolean).slice(0, 2).join(' / ');
      doc.text(`Email: ${co.email} • Tel: ${contacts || '+258 84 123 4567'}`, 105, bLineY + 13, { align: 'center' });
      
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(6.5);
      doc.setTextColor(120, 120, 120);
      doc.text('PROCESSADO POR COMPUTADOR • IMPRESSO AUTOMÁTICO VIA EPSON L3250 / POS', 105, bLineY + 18, { align: 'center' });

    } else {
      // Continuation indicator on intermediate pages
      const footerStartY = itemY + (pageItems.length * 7) + 4;
      doc.setDrawColor(220, 220, 220);
      doc.setLineWidth(0.3);
      doc.line(15, footerStartY, 195, footerStartY);

      doc.setFont('helvetica', 'italic');
      doc.setFontSize(8);
      doc.setTextColor(120, 120, 120);
      const recNumber = invoice.receiptNumber || (invoice.invoiceNumber.startsWith('Fact-') ? invoice.invoiceNumber.replace('Fact-', 'Rec-') : invoice.invoiceNumber.startsWith('FAC-') ? invoice.invoiceNumber.replace('FAC-', 'REC-') : `Rec-2026-${invoice.invoiceNumber}`);
      doc.text(`Recibo Nº: ${recNumber}`, 15, footerStartY + 5);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(14, 98, 49);
      doc.text(`Continua na página seguinte... (Pág ${pg} de ${totalPages})`, 195, footerStartY + 5, { align: 'right' });
    }

    // Page footer at the absolute bottom
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6.5);
    doc.setTextColor(150, 150, 150);
    doc.text(`Documento Oficial de Recibo / © ${co.name} /`, 15, 289);
    doc.text(`Pág. ${pg}/${totalPages}`, 185, 289, { align: 'right' });
    doc.text('Maputo', 195, 289, { align: 'right' });
  });

  doc.save(`RECIBO_${invoice.invoiceNumber}.pdf`);
}

// ============================================================================
// 3. RECIBO TÉRMICO XP-80C (80mm, letras escuras, dados dinâmicos)
// ============================================================================

export async function downloadThermalReceipt(invoice: Sale, settings: SystemSettings) {
  const co = getCompanyDefaults(settings);
  const logoBase64 = await getLogoBase64(settings.logoUrl || '/logo.png');
  const items = invoice.items;

  // Calculate dynamic height
  const logoHeight = logoBase64 ? 28 : 0;
  const headerHeight = 115;
  const itemsHeight = items.length * 11;
  const footerHeight = 90;
  const breakdownHeight = (invoice.paymentBreakdown?.length || 0) * 7;
  const totalHeight = Math.max(200, logoHeight + headerHeight + itemsHeight + footerHeight + breakdownHeight);

  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: [80, totalHeight]
  });

  // Force ALL text to pure black for maximum thermal contrast
  const setBlack = () => doc.setTextColor(0, 0, 0);

  let y = 6;

  // ── Logo (optional) ──
  if (logoBase64) {
    try {
      const format = logoBase64.includes('image/png') ? 'PNG' : 'JPEG';
      doc.addImage(logoBase64, format, 20, y, 40, 25);
      y += 28;
    } catch {
      try {
        doc.addImage(logoBase64, 'PNG', 20, y, 40, 25);
        y += 28;
      } catch { /* skip */ }
    }
  }

  // Set default font to helvetica bold for ALL text to ensure high contrast and match image
  doc.setFont('helvetica', 'bold');
  setBlack();

  // ── Company Header (Centered, exactly as image) ──
  doc.setFontSize(11);
  const nameLines = doc.splitTextToSize(co.name.toUpperCase(), 72);
  nameLines.forEach((line: string) => {
    doc.text(line, 40, y, { align: 'center' });
    y += 5;
  });

  doc.setFontSize(8);
  doc.text(`Maputo, Moçambique • NUIT: ${co.nuit}`, 40, y, { align: 'center' });
  y += 4.5;
  doc.text(`Email: ${co.email}`, 40, y, { align: 'center' });
  y += 4.5;

  const phoneVoda = co.phone3 && co.phone3.length > 5 
    ? `${co.phone3} / ${co.phone1}` 
    : '845197072 / 84 94 23 241';
  doc.text(`Vodacom: ${phoneVoda}`, 40, y, { align: 'center' });
  y += 4.5;

  const phoneMovi = co.phone2 || '86 36 99900';
  doc.text(`Movitel: ${phoneMovi}`, 40, y, { align: 'center' });
  y += 6;

  // ── Banner Box: RECIBO DE PAGAMENTO POS ──
  doc.setFillColor(245, 245, 245);
  doc.rect(3, y, 74, 8, 'F');
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.line(3, y, 77, y);
  doc.line(3, y + 8, 77, y + 8);
  doc.setFontSize(10);
  doc.text('RECIBO DE PAGAMENTO POS', 40, y + 5.5, { align: 'center' });
  y += 14;

  // ── Details (Left label, right value) ──
  doc.setFontSize(8.5);
  doc.text('FATURA Nº:', 4, y);
  doc.text(invoice.invoiceNumber, 76, y, { align: 'right' });
  y += 4.5;

  doc.text('DATA:', 4, y);
  const formattedDate = new Date(invoice.date).toLocaleString('pt-MZ').replace(/\//g, '/');
  doc.text(formattedDate, 76, y, { align: 'right' });
  y += 4.5;

  doc.text('OPERADOR:', 4, y);
  doc.text((invoice.operatorName || 'MAZIVE').toUpperCase(), 76, y, { align: 'right' });
  y += 4.5;

  doc.text('CLIENTE:', 4, y);
  doc.text((invoice.customerName || 'CLIENTE GERAL').toUpperCase(), 76, y, { align: 'right' });
  y += 6;

  // Dashed separator
  doc.setLineWidth(0.4);
  doc.setLineDashPattern([1.5, 1.5], 0);
  doc.line(3, y, 77, y);
  y += 5;

  // Items Header
  doc.setFontSize(8.5);
  doc.text('ARTIGO / QTD X PREÇO', 4, y);
  doc.text('TOTAL (MT)', 76, y, { align: 'right' });
  y += 5;

  // Items List
  items.forEach(item => {
    // Write item name on its own line
    const itemLines = doc.splitTextToSize(item.name.toUpperCase(), 72);
    itemLines.forEach((line: string) => {
      doc.text(line, 4, y);
      y += 4.5;
    });

    // Write quantities and total price
    const unitStr = item.unit || 'Pacotes';
    const qtyPriceStr = `${item.quantity} ${unitStr} x ${fmtMT(item.unitPrice)} MT`;
    doc.text(qtyPriceStr, 4, y);
    doc.text(`${fmtMT(item.totalPrice)} MT`, 76, y, { align: 'right' });
    y += 5.5;
  });

  // Dashed separator
  doc.line(3, y, 77, y);
  y += 5;

  // SUBTOTAL
  doc.setFontSize(9);
  doc.text('SUBTOTAL:', 4, y);
  doc.text(`${fmtMT(invoice.subtotal)} MT`, 76, y, { align: 'right' });
  y += 5;

  // Dashed separator
  doc.line(3, y, 77, y);
  y += 5;

  // TOTAL PAGO (Highlight)
  doc.setFontSize(11);
  doc.text('TOTAL PAGO:', 4, y);
  doc.text(`${fmtMT(invoice.total)} MT`, 76, y, { align: 'right' });
  y += 5.5;

  // Dashed separator
  doc.setFontSize(9);
  doc.line(3, y, 77, y);
  y += 5;

  // FORMA PAGAMENTO
  doc.text('FORMA PAGAMENTO:', 4, y);
  doc.text((invoice.paymentMethod || 'DINHEIRO').toUpperCase(), 76, y, { align: 'right' });
  y += 5;

  // Additional Payment breakdown if any
  if (invoice.paymentBreakdown && invoice.paymentBreakdown.length > 0) {
    invoice.paymentBreakdown.forEach(b => {
      doc.text(` ${b.method.toUpperCase()}:`, 4, y);
      doc.text(`${fmtMT(b.amount)} MT`, 76, y, { align: 'right' });
      y += 5;
    });
  }

  // Dashed separator
  doc.line(3, y, 77, y);
  doc.setLineDashPattern([], 0); // Reset
  y += 7;

  // Footer / Greeting
  doc.setFontSize(8.5);
  doc.text('OBRIGADO PELA SUA PREFERÊNCIA!', 40, y, { align: 'center' });
  y += 4.5;

  const disclaimerText = invoice.documentType === 'FaturaProforma' 
    ? '"ESTA FATURA PROFORMA TEM A VALIDADE DE 30 DIAS"'
    : '"VALIDADE ATÉ À REPOSIÇÃO DE STOCK"';
  doc.text(disclaimerText, 40, y, { align: 'center' });
  y += 7;

  // Software & Barcode
  doc.setFontSize(6.5);
  doc.setTextColor(50, 50, 50);
  doc.text('PROCESSADO POR SOFTWARE AGROGESTÃO', 40, y, { align: 'center' });
  y += 3.5;
  doc.text('|||| | |||| ||| | ||||| |||| | ||', 40, y, { align: 'center' });

  doc.save(`RECIBO_POS_${invoice.invoiceNumber}.pdf`);
}

// ============================================================================
// 4. FACTURA DUPLICADA A4 (2 cópias por página)
// ============================================================================

export async function downloadDuplicatedInvoiceA4(invoice: Sale, settings: SystemSettings) {
  // Use the standard A4 invoice generator, adding a second copy
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const co = getCompanyDefaults(settings);

  const docTitle = getDocTitle(invoice);
  const invNum = invoice.invoiceNumber;

  // Top Copy: ORIGINAL
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(148, 163, 184);
  doc.text(`--- VIA ORIGINAL ---`, 105, 6, { align: 'center' });

  renderCompactInvoice(doc, invoice, settings, co, 8, docTitle);

  // Perforation line
  doc.setDrawColor(148, 163, 184);
  doc.setLineWidth(0.5);
  doc.setLineDashPattern([2, 2], 0);
  doc.line(10, 148, 200, 148);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(148, 163, 184);
  doc.text('DOBRAR / DESTACAR AQUI', 105, 147, { align: 'center' });
  doc.setLineDashPattern([], 0);

  // Bottom Copy: DUPLICADO
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.text(`--- VIA DUPLICADO ---`, 105, 153, { align: 'center' });

  renderCompactInvoice(doc, invoice, settings, co, 155, docTitle);

  // Footer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6);
  doc.setTextColor(100, 100, 100);
  doc.text(`Documento Processado por Computador / © ${co.name} /`, 15, 289);
  doc.text('Pág. 1/1', 195, 289, { align: 'right' });

  doc.save(`DUPLICADO_${invNum}.pdf`);
}

// Compact invoice renderer for duplicated A4
function renderCompactInvoice(
  doc: jsPDF,
  invoice: Sale,
  _settings: SystemSettings,
  co: ReturnType<typeof getCompanyDefaults>,
  startY: number,
  docTitle: string
) {
  const scale = 0.68;
  const s = (v: number) => v * scale;
  let y = startY;

  // Header line
  doc.setDrawColor(14, 98, 49);
  doc.setLineWidth(0.8);
  doc.line(85, y, 195, y);
  doc.setFillColor(14, 98, 49);
  doc.triangle(195, y, 192, y - 1.5, 192, y + 1.5, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(s(13));
  doc.setTextColor(14, 98, 49);
  doc.text(co.name.toUpperCase(), 88, y - 1);

  // Company info
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(s(7));
  doc.setTextColor(80, 80, 80);
  doc.text(`NUIT: ${co.nuit} | ${co.email}`, 15, y + s(5));

  // Doc title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(s(11));
  doc.setTextColor(14, 98, 49);
  doc.text(`${docTitle} Nº ${invoice.invoiceNumber}`, 195, y + s(10), { align: 'right' });

  // Client
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(s(8));
  doc.setTextColor(0, 0, 0);
  doc.text(`Cliente: ${invoice.customerName} | Data: ${fmtDate(invoice.date)}`, 15, y + s(14));

  // Items
  y += s(20);
  doc.setFillColor(14, 98, 49);
  doc.rect(15, y, 180, s(6), 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(s(7.5));
  doc.setTextColor(255, 255, 255);
  doc.text('Descrição', 17, y + s(4));
  doc.text('Qtd', 110, y + s(4), { align: 'right' });
  doc.text('P.Unit', 140, y + s(4), { align: 'right' });
  doc.text('Total', 193, y + s(4), { align: 'right' });
  y += s(6);

  const maxItems = 8;
  const displayItems = invoice.items.slice(0, maxItems);
  displayItems.forEach(item => {
    y += s(6);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(s(7));
    doc.setTextColor(50, 50, 50);
    doc.text(item.name.substring(0, 40), 17, y);

    doc.setFont('helvetica', 'normal');
    doc.text(String(item.quantity), 110, y, { align: 'right' });
    doc.text(fmtMT(item.unitPrice), 140, y, { align: 'right' });
    doc.text(fmtMT(item.totalPrice), 193, y, { align: 'right' });

    doc.setDrawColor(230, 230, 230);
    doc.setLineWidth(0.1);
    doc.line(15, y + s(2), 195, y + s(2));
  });

  if (invoice.items.length > maxItems) {
    y += s(5);
    doc.setFont('helvetica', 'italic');
    doc.text(`... e mais ${invoice.items.length - maxItems} item(ns)`, 17, y);
  }

  // Totals
  y += s(8);
  doc.setDrawColor(0, 0, 0);
  doc.line(130, y, 195, y);
  y += s(5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(s(10));
  doc.setTextColor(0, 0, 0);
  doc.text('TOTAL:', 130, y);
  doc.text(`${fmtMT(invoice.total)} MT`, 193, y, { align: 'right' });
}

// ============================================================================
// 5. RELATÓRIO DE VENDAS (PDF A4)
// ============================================================================

export async function downloadSalesReportPDF(
  sales: Sale[],
  settings: SystemSettings,
  startDate?: string,
  endDate?: string
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const co = getCompanyDefaults(settings);
  const logoBase64 = await getLogoBase64(settings.logoUrl || '/logo.png');

  if (logoBase64) {
    try {
      doc.addImage(logoBase64, 'PNG', 15, 5, 60, 45);
    } catch {
      try { doc.addImage(logoBase64, 'JPEG', 15, 5, 60, 45); }
      catch (e) { console.warn('Logo error:', e); }
    }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(14, 98, 49);
  doc.text('MAPA DE PRESTAÇÃO DE CONTAS - VENDAS', 80, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(co.name.toUpperCase(), 80, 22);
  doc.text(`NUIT: ${co.nuit}`, 80, 26);

  const periodText = startDate && endDate
    ? `Período: de ${startDate} até ${endDate}`
    : 'Período Geral Acumulado';
  doc.text(periodText, 80, 30);
  doc.text(`Emissão: ${new Date().toLocaleDateString('pt-MZ')}`, 195, 22, { align: 'right' });

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(15, 53, 195, 53);

  // Table header
  let itemY = 58;
  doc.setFillColor(241, 245, 249);
  doc.rect(15, itemY, 180, 8, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(15, 23, 42);
  doc.text('Fatura Nº', 17, itemY + 5.5);
  doc.text('Data', 45, itemY + 5.5);
  doc.text('Cliente', 80, itemY + 5.5);
  doc.text('Método', 135, itemY + 5.5);
  doc.text('Estado', 160, itemY + 5.5);
  doc.text('Total', 193, itemY + 5.5, { align: 'right' });

  itemY += 8;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(51, 65, 85);

  let totalAcc = 0;
  let pageNum = 1;

  sales.forEach((sale, idx) => {
    if (itemY > 265) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(6.5);
      doc.setTextColor(100, 100, 100);
      doc.text(`${co.name} • NUIT: ${co.nuit}`, 15, 285);
      doc.text(`Pág. ${pageNum}`, 195, 285, { align: 'right' });
      doc.addPage();
      pageNum++;
      itemY = 20;

      doc.setFillColor(241, 245, 249);
      doc.rect(15, itemY, 180, 8, 'F');
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7.5);
      doc.setTextColor(15, 23, 42);
      doc.text('Fatura Nº', 17, itemY + 5.5);
      doc.text('Data', 45, itemY + 5.5);
      doc.text('Cliente', 80, itemY + 5.5);
      doc.text('Método', 135, itemY + 5.5);
      doc.text('Estado', 160, itemY + 5.5);
      doc.text('Total', 193, itemY + 5.5, { align: 'right' });
      itemY += 8;
      doc.setFont('helvetica', 'normal');
    }

    if (idx % 2 === 1) {
      doc.setFillColor(248, 250, 252);
      doc.rect(15, itemY, 180, 7, 'F');
    }

    doc.setTextColor(51, 65, 85);
    doc.text(sale.invoiceNumber, 17, itemY + 4.5);
    doc.text(fmtDate(sale.date), 45, itemY + 4.5);
    doc.text(sale.customerName.substring(0, 25), 80, itemY + 4.5);
    doc.text(sale.paymentMethod, 135, itemY + 4.5);

    if (sale.status === 'Paga') {
      doc.setTextColor(16, 124, 65);
      doc.text('PAGO', 160, itemY + 4.5);
    } else if (sale.status === 'Cancelada') {
      doc.setTextColor(220, 38, 38);
      doc.text('CANCELADO', 160, itemY + 4.5);
    } else {
      doc.setTextColor(217, 119, 6);
      doc.text('PENDENTE', 160, itemY + 4.5);
    }

    doc.setTextColor(51, 65, 85);
    doc.text(`${fmtMT(sale.total)} MT`, 193, itemY + 4.5, { align: 'right' });
    if (sale.status !== 'Cancelada') totalAcc += sale.total;

    doc.setDrawColor(241, 245, 249);
    doc.setLineWidth(0.3);
    doc.line(15, itemY + 7, 195, itemY + 7);
    itemY += 7;
  });

  // Summary
  if (itemY > 250) {
    doc.addPage();
    itemY = 20;
  }
  itemY += 5;
  doc.setFillColor(240, 249, 244);
  doc.setDrawColor(186, 230, 218);
  doc.rect(15, itemY, 180, 15, 'FD');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(14, 98, 49);
  doc.text('VALOR TOTAL LÍQUIDO:', 20, itemY + 9.5);
  doc.text(`${fmtMT(totalAcc)} MT`, 193, itemY + 9.5, { align: 'right' });

  // Footer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text(`${co.name} • NUIT: ${co.nuit}`, 15, 285);
  doc.text(`Pág. ${pageNum}`, 195, 285, { align: 'right' });

  doc.save(`MAPA_VENDAS_${new Date().toISOString().split('T')[0]}.pdf`);
}

// ============================================================================
// 6. RELATÓRIO DIÁRIO DE VENDAS (PDF A4)
// ============================================================================

export async function downloadDailySalesReportPDF(
  selectedDate: string,
  sales: Sale[],
  settings: SystemSettings
) {
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const co = getCompanyDefaults(settings);
  const logoBase64 = await getLogoBase64(settings.logoUrl || '/logo.png');

  const isSameDay = (dateStr: string, targetDateStr: string) => {
    if (!dateStr || !targetDateStr) return false;
    if (dateStr.startsWith(targetDateStr)) return true;
    try {
      const d = new Date(dateStr);
      if (!isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}` === targetDateStr;
      }
    } catch {}
    return false;
  };

  const dailySales = sales.filter(s => {
    if (s.status === 'Cancelada') return false;
    if (!s.date) return false;
    return isSameDay(s.date, selectedDate);
  });

  let totalRevenue = 0;
  let totalNumerario = 0;
  let totalMPesa = 0;
  let totalEMola = 0;
  let totalTransferencia = 0;
  let totalCredito = 0;

  const productAgg: Record<string, { name: string; category: string; qty: number; unit: string; revenue: number }> = {};

  dailySales.forEach(sale => {
    totalRevenue += sale.total;
    const pm = (sale.paymentMethod || '').trim().toLowerCase();
    if (pm === 'dinheiro' || pm === 'numerario' || pm === 'cash') {
      totalNumerario += sale.total;
    } else if (pm === 'm-pesa' || pm === 'mpesa') {
      totalMPesa += sale.total;
    } else if (pm === 'e-mola' || pm === 'emola') {
      totalEMola += sale.total;
    } else if (pm === 'transferência' || pm === 'transferencia' || pm === 'banco') {
      totalTransferencia += sale.total;
    } else if (pm === 'crédito' || pm === 'credit') {
      totalCredito += sale.total;
    } else if (pm === 'múltiplo' || pm === 'multiplo') {
      if (sale.paymentBreakdown && Array.isArray(sale.paymentBreakdown)) {
        sale.paymentBreakdown.forEach(b => {
          const bpm = (b.method || '').trim().toLowerCase();
          if (bpm === 'dinheiro' || bpm === 'numerario' || bpm === 'cash') totalNumerario += b.amount;
          else if (bpm === 'm-pesa' || bpm === 'mpesa') totalMPesa += b.amount;
          else if (bpm === 'e-mola' || bpm === 'emola') totalEMola += b.amount;
          else if (bpm === 'transferência' || bpm === 'transferencia' || bpm === 'banco') totalTransferencia += b.amount;
          else if (bpm === 'crédito' || bpm === 'credit') totalCredito += b.amount;
          else totalNumerario += b.amount;
        });
      } else {
        totalNumerario += sale.total;
      }
    } else {
      totalNumerario += sale.total;
    }

    sale.items.forEach(item => {
      const key = item.productId || item.name;
      if (!productAgg[key]) {
        productAgg[key] = { name: item.name, category: item.isService ? 'Serviço' : 'Produto', qty: 0, unit: item.unit || 'UN', revenue: 0 };
      }
      productAgg[key].qty += item.quantity;
      productAgg[key].revenue += item.totalPrice;
    });
  });

  const dateParts = selectedDate.split('-');
  const formattedDate = dateParts.length === 3 ? `${dateParts[2]}/${dateParts[1]}/${dateParts[0]}` : selectedDate;

  // Header
  if (logoBase64) {
    try { doc.addImage(logoBase64, 'JPEG', 15, 8, 25, 12); } catch { /* skip */ }
  }

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(14, 98, 49);
  doc.text('RELATÓRIO DIÁRIO DE VENDAS', 50, 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100, 116, 139);
  doc.text(co.name.toUpperCase(), 50, 19);
  doc.text(`NUIT: ${co.nuit} • ${co.email}`, 50, 23);
  doc.text(`Dia de Referência: ${formattedDate}`, 50, 27);
  doc.text(`Emissão: ${new Date().toLocaleString('pt-MZ')}`, 195, 14, { align: 'right' });

  doc.setDrawColor(200, 200, 200);
  doc.setLineWidth(0.5);
  doc.line(15, 31, 195, 31);

  // Summary box
  let cy = 37;
  doc.setFillColor(248, 250, 252);
  doc.setDrawColor(226, 232, 240);
  doc.rect(15, cy, 180, 24, 'FD');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text('RESUMO FINANCEIRO DO DIA', 20, cy + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.text('Total Faturado:', 20, cy + 11);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(14, 98, 49);
  doc.text(`${fmtMT(totalRevenue)} MT`, 55, cy + 11);

  const methods = [
    ['Dinheiro:', fmtMT(totalNumerario)],
    ['M-Pesa:', fmtMT(totalMPesa)],
    ['E-Mola:', fmtMT(totalEMola)],
    ['Transferência:', fmtMT(totalTransferencia)],
    ['Crédito:', fmtMT(totalCredito)],
  ];
  methods.forEach((m, i) => {
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100, 116, 139);
    doc.text(m[0], 110, cy + 5 + (i * 3.8));
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 23, 42);
    doc.text(`${m[1]} MT`, 160, cy + 5 + (i * 3.8));
  });

  // Products table
  cy += 31;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(14, 98, 49);
  doc.text('PRODUTOS E SERVIÇOS VENDIDOS NO DIA', 15, cy);

  cy += 4;
  doc.setFillColor(241, 245, 249);
  doc.rect(15, cy, 180, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(15, 23, 42);
  doc.text('PRODUTO / SERVIÇO', 17, cy + 4.5);
  doc.text('CATEG.', 105, cy + 4.5);
  doc.text('QTD', 140, cy + 4.5, { align: 'right' });
  doc.text('UNID', 155, cy + 4.5);
  doc.text('TOTAL', 193, cy + 4.5, { align: 'right' });

  cy += 7;
  const list = Object.values(productAgg).sort((a, b) => b.revenue - a.revenue);

  if (list.length === 0) {
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(148, 163, 184);
    doc.text('Nenhuma venda registada para este dia.', 105, cy + 10, { align: 'center' });
  } else {
    list.forEach(item => {
      if (cy > 260) {
        doc.addPage();
        cy = 20;
      }
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(51, 65, 85);
      doc.text(item.name.substring(0, 50), 17, cy + 4.5);
      doc.text(item.category, 105, cy + 4.5);
      doc.text(item.qty.toLocaleString('pt-MZ'), 140, cy + 4.5, { align: 'right' });
      doc.text(item.unit, 155, cy + 4.5);
      doc.text(`${fmtMT(item.revenue)} MT`, 193, cy + 4.5, { align: 'right' });
      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.3);
      doc.line(15, cy + 7, 195, cy + 7);
      cy += 7;
    });
  }

  // Footer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.setTextColor(100, 100, 100);
  doc.text(`${co.name} • NUIT: ${co.nuit}`, 15, 285);
  doc.text('Pág. 1', 195, 285, { align: 'right' });

  doc.save(`RELATORIO_VENDAS_${selectedDate}.pdf`);
}

// ============================================================================
// WRAPPER: downloadInvoicePDF (used by FaturasModule and PDVModule)
// ============================================================================

export async function downloadInvoicePDF(invoice: Sale, settings: SystemSettings, printerType: string = 'A4') {
  if (printerType === 'Thermal') {
    return downloadThermalReceipt(invoice, settings);
  } else if (printerType === 'ReciboA4') {
    return downloadReceiptA4(invoice, settings);
  } else if (printerType === 'FaturaProforma') {
    return downloadInvoiceA4(invoice, settings, false);
  } else {
    // 'A4' = Factura Definitiva
    return downloadInvoiceA4(invoice, settings, false);
  }
}
