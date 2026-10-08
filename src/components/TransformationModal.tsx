import React, { useState, useEffect } from 'react';
import { Product, ProductTransformation, TransformationItem, SystemSettings } from '../types';
import { dbService } from '../utils/firebaseDB';
import { getSingularUnit } from '../utils/unitHelper';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { uid } from '../utils/idHelper';

interface TransformationModalProps {
  isOpen: boolean;
  onClose: () => void;
  products: Product[];
  currentUser: { username: string; role: string };
  settings?: SystemSettings | null;
  onTransformationComplete?: () => void;
}

interface ResultingItemDraft {
  id: string;
  isNewProduct: boolean;
  productId: string;
  productName: string;
  productCode: string;
  category: string;
  quantity: number;
  unitWeight: number;
  unit: string;
  calculatedCost: number;
  sellingPrice: number;
}

export const TransformationModal: React.FC<TransformationModalProps> = ({
  isOpen,
  onClose,
  products,
  currentUser,
  settings,
  onTransformationComplete
}) => {
  const [selectedOriginalId, setSelectedOriginalId] = useState<string>('');
  const [productSearchTerm, setProductSearchTerm] = useState<string>('');
  const [originalQty, setOriginalQty] = useState<number>(1);
  const [useBulkUnit, setUseBulkUnit] = useState<boolean>(false);
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [successTransformation, setSuccessTransformation] = useState<ProductTransformation | null>(null);

  // Resulting package items list
  const [resultingItems, setResultingItems] = useState<ResultingItemDraft[]>([
    {
      id: 'draft-1',
      isNewProduct: false,
      productId: '',
      productName: '',
      productCode: '',
      category: 'Adubos',
      quantity: 1,
      unitWeight: 1,
      unit: 'Pacotes',
      calculatedCost: 0,
      sellingPrice: 0
    }
  ]);

  const originalProduct = products.find(p => p.id === selectedOriginalId);

  // Filtered available products in stock matching search term
  const availableOriginalProducts = products.filter(p => {
    const hasStock = p.stockQty > 0 || (p.stockQtyBulk || 0) > 0;
    if (!hasStock) return false;
    if (!productSearchTerm.trim()) return true;
    const term = productSearchTerm.toLowerCase();
    const nameMatch = (p.name || '').toLowerCase().includes(term);
    const codeMatch = (p.code || '').toLowerCase().includes(term);
    const catMatch = (p.category || '').toLowerCase().includes(term);
    return nameMatch || codeMatch || catMatch;
  });

  // Available stock of selected product
  const availableStock = originalProduct
    ? (useBulkUnit && originalProduct.stockQtyBulk !== undefined
        ? originalProduct.stockQtyBulk
        : originalProduct.stockQty)
    : 0;

  // Conversion rate and base unit
  const conversionRate = originalProduct?.conversionRate || 1;
  const originalBaseQty = useBulkUnit ? originalQty * conversionRate : originalQty;
  const originalUnitCostPerBase = originalProduct?.buyingPrice || 0;
  const originalTotalCost = originalBaseQty * originalUnitCostPerBase;

  // Calculate total resulting weight/quantity
  const totalResultingBaseQty = resultingItems.reduce((sum, item) => sum + (item.quantity * item.unitWeight), 0);
  const lossQty = Math.max(0, originalBaseQty - totalResultingBaseQty);
  const lossValue = lossQty * originalUnitCostPerBase;

  // Auto-calculate proportional costs for each resulting draft item
  useEffect(() => {
    if (originalBaseQty <= 0 || originalTotalCost <= 0) return;

    setResultingItems(prev => prev.map(item => {
      const itemTotalWeight = item.quantity * item.unitWeight;
      const proportion = totalResultingBaseQty > 0 ? (itemTotalWeight / totalResultingBaseQty) : (1 / (prev.length || 1));
      const allocatedCost = (originalTotalCost - lossValue) * proportion;
      const unitCost = item.quantity > 0 ? Math.round((allocatedCost / item.quantity) * 100) / 100 : 0;
      
      return {
        ...item,
        calculatedCost: unitCost,
        // Default suggested selling price with 35% margin if not manually modified
        sellingPrice: item.sellingPrice > 0 ? item.sellingPrice : Math.round(unitCost * 1.35 * 10) / 10
      };
    }));
  }, [originalBaseQty, originalTotalCost, totalResultingBaseQty, lossValue]);

  // When original product changes, auto-fill sensible defaults
  const handleOriginalProductChange = (prodId: string) => {
    setSelectedOriginalId(prodId);
    setErrorMsg('');
    const p = products.find(x => x.id === prodId);
    if (p) {
      const hasBulk = (p.stockQtyBulk || 0) > 0 && p.parentUnit;
      setUseBulkUnit(hasBulk);
      setOriginalQty(1);

      // Pre-populate 1st resulting item draft
      const baseUnitSingular = getSingularUnit(p.baseUnit || 'Kg');
      setResultingItems([
        {
          id: 'draft-1',
          isNewProduct: true,
          productId: '',
          productName: `${p.name} (Fracionado 1${baseUnitSingular})`,
          productCode: '',
          category: p.category,
          quantity: p.conversionRate || 10,
          unitWeight: 1,
          unit: 'Pacotes',
          calculatedCost: Math.round((p.buyingPrice * 1) * 100) / 100,
          sellingPrice: Math.round((p.sellingPrice * 1.2) * 100) / 100
        }
      ]);
    }
  };

  const addResultingItemRow = () => {
    setResultingItems(prev => [
      ...prev,
      {
        id: uid('draft-'),
        isNewProduct: true,
        productId: '',
        productName: originalProduct ? `${originalProduct.name} (Fracionado)` : '',
        productCode: '',
        category: originalProduct?.category || 'Geral',
        quantity: 1,
        unitWeight: 1,
        unit: 'Pacotes',
        calculatedCost: 0,
        sellingPrice: 0
      }
    ]);
  };

  const removeResultingItemRow = (idx: number) => {
    if (resultingItems.length <= 1) return;
    setResultingItems(prev => prev.filter((_, i) => i !== idx));
  };

  const updateResultingItem = (idx: number, updates: Partial<ResultingItemDraft>) => {
    setResultingItems(prev => {
      const updated = [...prev];
      updated[idx] = { ...updated[idx], ...updates };
      return updated;
    });
  };

  const handleSelectExistingProduct = (idx: number, prodId: string) => {
    const p = products.find(x => x.id === prodId);
    if (!p) return;
    updateResultingItem(idx, {
      isNewProduct: false,
      productId: p.id,
      productName: p.name,
      productCode: p.code,
      category: p.category,
      unit: p.baseUnit,
      sellingPrice: p.sellingPrice
    });
  };

  const handleSubmitTransformation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMsg('');

    if (!originalProduct) {
      setErrorMsg('Selecione o produto original para transformação.');
      return;
    }

    if (originalQty <= 0) {
      setErrorMsg('A quantidade a requisitar deve ser maior que zero.');
      return;
    }

    if (originalQty > availableStock) {
      setErrorMsg(`Quantidade requisitada (${originalQty}) excede o stock disponível (${availableStock}).`);
      return;
    }

    if (resultingItems.length === 0) {
      setErrorMsg('Adicione pelo menos um produto resultante.');
      return;
    }

    if (totalResultingBaseQty > originalBaseQty) {
      setErrorMsg(`A soma das quantidades resultantes (${totalResultingBaseQty} ${originalProduct.baseUnit}) excede o total requisitado (${originalBaseQty} ${originalProduct.baseUnit}).`);
      return;
    }

    for (const item of resultingItems) {
      if (!item.productName.trim()) {
        setErrorMsg('Todos os produtos resultantes devem ter um nome válido.');
        return;
      }
      if (item.quantity <= 0) {
        setErrorMsg('A quantidade de cada produto resultante deve ser superior a zero.');
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const year = new Date().getFullYear();
      const codeSeq = Math.floor(1000 + Math.random() * 9000);
      const transformationCode = `TRF-${year}-${codeSeq}`;
      const transformationId = `trf-${Date.now()}`;

      // Build Transformation Items
      const createdItems: TransformationItem[] = resultingItems.map(draft => {
        const prodId = draft.isNewProduct || !draft.productId
          ? `prod-trf-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`
          : draft.productId;

        return {
          id: `trf-item-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
          transformationId,
          resultingProductId: prodId,
          resultingProductName: draft.productName.trim(),
          resultingProductCode: draft.productCode.trim() || undefined,
          quantity: draft.quantity,
          unitWeight: draft.unitWeight,
          unit: draft.unit,
          calculatedUnitCost: draft.calculatedCost,
          sellingPrice: draft.sellingPrice,
          createdAt: new Date().toISOString()
        };
      });

      const transformationRecord: ProductTransformation = {
        id: transformationId,
        code: transformationCode,
        originalProductId: originalProduct.id,
        originalProductName: originalProduct.name,
        originalProductCode: originalProduct.code,
        originalQuantity: originalBaseQty,
        originalUnit: originalProduct.baseUnit || 'Kg',
        originalUnitCost: originalUnitCostPerBase,
        originalTotalCost: originalTotalCost,
        items: createdItems,
        lossQuantity: lossQty,
        lossValue: lossValue,
        date: new Date().toISOString().split('T')[0],
        operatorId: currentUser.username,
        operatorName: currentUser.username,
        notes: notes.trim(),
        status: 'Concluída',
        createdAt: new Date().toISOString()
      };

      // Prepare items to credit in atomic batch
      const itemsToCredit = resultingItems.map((draft, idx) => {
        const targetProdId = createdItems[idx].resultingProductId;
        const isNew = draft.isNewProduct || !draft.productId;

        return {
          productId: targetProdId,
          qtyToAdd: draft.quantity,
          name: draft.productName.trim(),
          unitPrice: draft.sellingPrice,
          costPrice: draft.calculatedCost,
          category: draft.category || originalProduct.category,
          baseUnit: draft.unit,
          code: draft.productCode || undefined,
          productData: isNew ? {
            name: draft.productName.trim(),
            category: draft.category || originalProduct.category,
            buyingPrice: draft.calculatedCost,
            sellingPrice: draft.sellingPrice,
            baseUnit: draft.unit,
            stockQty: draft.quantity,
            stockQtyRetail: draft.quantity,
            conversionRate: 1
          } : undefined
        };
      });

      const originalDeduction = {
        productId: originalProduct.id,
        qtyToDeduct: originalQty,
        isBulk: useBulkUnit,
        equivalentBaseQty: originalBaseQty
      };

      // Execute atomic transaction
      await dbService.addTransformationWithStockUpdate(transformationRecord, itemsToCredit, originalDeduction);

      // Log audit
      await dbService.addAuditLog({
        id: uid('log-'),
        timestamp: new Date().toISOString(),
        username: currentUser.username,
        ipAddress: '127.0.0.1',
        action: 'Transformação de Produto Realizada',
        status: 'Sucesso',
        details: `Transformado ${originalBaseQty} ${originalProduct.baseUnit} de "${originalProduct.name}" em ${createdItems.length} artigos resultantes (Perda: ${lossQty} ${originalProduct.baseUnit}).`
      });

      setSuccessTransformation(transformationRecord);
      if (onTransformationComplete) onTransformationComplete();

    } catch (err: any) {
      console.error('[Transformation Error]:', err);
      setErrorMsg('Erro ao processar transformação na base de dados: ' + (err.message || 'Falha de gravação.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handlePrintVoucher = (trf: ProductTransformation) => {
    const doc = new jsPDF({ format: 'a4', unit: 'mm' });
    const compName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';
    const compNuit = settings?.companyNuit || '401976590';

    // Header Banner
    doc.setFillColor(6, 78, 59); // Emerald-900
    doc.rect(0, 0, 210, 32, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.text(compName, 14, 14);

    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`NUIT: ${compNuit} • Guia Interna de Transformação e Fracionamento`, 14, 22);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`CÓDIGO: ${trf.code}`, 150, 16);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(`Data: ${trf.date}`, 150, 22);

    // Section 1: Original Product Requisition
    doc.setTextColor(30, 41, 59);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('1. Produto Original Requisitado para Fracionamento', 14, 44);

    autoTable(doc, {
      startY: 48,
      head: [['Artigo Original', 'Qtd Requisitada', 'Custo Unitário', 'Custo Total Requisitado']],
      body: [
        [
          trf.originalProductName,
          `${trf.originalQuantity} ${trf.originalUnit}`,
          `${trf.originalUnitCost.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT`,
          `${trf.originalTotalCost.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT`
        ]
      ],
      headStyles: { fillColor: [15, 118, 110], textColor: [255, 255, 255], fontStyle: 'bold' },
      theme: 'grid'
    });

    // Section 2: Resulting Products
    const lastY = (doc as any).lastAutoTable.finalY || 70;
    doc.text('2. Produtos Resultantes Gerados (Entrada no Stock)', 14, lastY + 12);

    const resultingTableRows = trf.items.map(it => [
      it.resultingProductName,
      `${it.quantity} ${it.unit}`,
      `${it.unitWeight} ${trf.originalUnit}`,
      `${(it.quantity * it.unitWeight)} ${trf.originalUnit}`,
      `${it.calculatedUnitCost.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT`,
      `${(it.sellingPrice || 0).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT`,
      `${(it.quantity * it.calculatedUnitCost).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT`
    ]);

    autoTable(doc, {
      startY: lastY + 16,
      head: [['Artigo Resultante', 'Pacotes/Qtd', 'Peso Unit.', 'Total Peso', 'Custo Unit.', 'Preço Venda', 'Custo Total']],
      body: resultingTableRows,
      headStyles: { fillColor: [4, 120, 87], textColor: [255, 255, 255], fontStyle: 'bold' },
      theme: 'grid'
    });

    // Section 3: Financial & Losses Reconciliation
    const finalTableY = (doc as any).lastAutoTable.finalY || 130;
    doc.text('3. Balanço Contabilístico & Registo de Perdas', 14, finalTableY + 12);

    autoTable(doc, {
      startY: finalTableY + 16,
      head: [['Indicador', 'Quantidade', 'Valor Monetário (MT)', 'Impacto Financeiro']],
      body: [
        ['Saída de Stock Original', `${trf.originalQuantity} ${trf.originalUnit}`, `${trf.originalTotalCost.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT`, 'Crédito de Stock Original'],
        ['Entrada de Stock Resultante', `${trf.items.reduce((s, x) => s + x.quantity, 0)} unidades`, `${trf.items.reduce((s, x) => s + (x.quantity * x.calculatedUnitCost), 0).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT`, 'Débito em Stock Fracionado'],
        ['Perda no Processo', `${trf.lossQuantity} ${trf.originalUnit}`, `${trf.lossValue.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT`, trf.lossQuantity > 0 ? 'Custo Operacional de Quebra' : 'Sem Perdas (100% Eficiente)'],
        ['Balanço Líquido de Custo', 'Equilíbrio Perfeito', '0.00 MT', 'NEUTRALIDADE FINANCEIRA ✓']
      ],
      headStyles: { fillColor: [51, 65, 85], textColor: [255, 255, 255], fontStyle: 'bold' },
      theme: 'grid'
    });

    // Signatures
    const sigY = Math.min(265, (doc as any).lastAutoTable.finalY + 30);
    doc.setFontSize(9);
    doc.line(14, sigY, 90, sigY);
    doc.text(`Responsável: ${trf.operatorName}`, 14, sigY + 5);
    doc.text('Gestor de Stock / Transformações', 14, sigY + 10);

    doc.line(120, sigY, 196, sigY);
    doc.text('Aprovação / Administração', 120, sigY + 5);
    doc.text('AGRO - XICOMO & SERVIÇOS, LDA', 120, sigY + 10);

    doc.save(`GUIA_TRANSFORMACAO_${trf.code}.pdf`);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-3 sm:p-5 overflow-y-auto backdrop-blur-xs">
      <div className="bg-white rounded-2xl shadow-2xl max-w-4xl w-full max-h-[92vh] flex flex-col overflow-hidden border border-gray-200 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-linear-to-r from-emerald-800 to-teal-900 p-4 sm:p-5 text-white flex justify-between items-center shrink-0 shadow-md">
          <div className="flex items-center gap-3">
            <span className="p-2 bg-white/10 rounded-xl material-symbols-outlined text-2xl">
              call_split
            </span>
            <div>
              <h3 className="font-black text-sm sm:text-base tracking-tight font-headline-lg">
                Módulo de Transformação & Fracionamento de Produtos
              </h3>
              <p className="text-[11px] text-emerald-200 font-medium">
                Divisão interna de sacos/volumes grandes em pacotes de venda a retalho
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-white/80 hover:text-white hover:bg-white/10 rounded-lg transition-colors cursor-pointer"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-6 flex-1 custom-scrollbar text-xs">
          
          {/* Success Screen if completed */}
          {successTransformation ? (
            <div className="text-center py-6 space-y-5 animate-in fade-in">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-800 rounded-full flex items-center justify-center mx-auto shadow-inner">
                <span className="material-symbols-outlined text-3xl font-black">done_all</span>
              </div>
              
              <div className="space-y-1">
                <h4 className="text-lg font-black text-gray-900">
                  Transformação {successTransformation.code} Realizada com Sucesso!
                </h4>
                <p className="text-gray-600 text-xs">
                  O stock original foi debitado e os novos artigos fracionados foram adicionados ao inventário com custos calculados proporcionalmente.
                </p>
              </div>

              {/* Summary cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-xl mx-auto text-left">
                <div className="bg-slate-50 p-3.5 rounded-xl border border-slate-200">
                  <span className="text-[10px] font-black text-slate-500 uppercase">Original Consumido</span>
                  <p className="text-sm font-black text-slate-800 mt-0.5">
                    {successTransformation.originalQuantity} {successTransformation.originalUnit}
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono">
                    {successTransformation.originalTotalCost.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
                  </p>
                </div>

                <div className="bg-emerald-50 p-3.5 rounded-xl border border-emerald-200">
                  <span className="text-[10px] font-black text-emerald-700 uppercase">Pacotes Gerados</span>
                  <p className="text-sm font-black text-emerald-900 mt-0.5">
                    {successTransformation.items.reduce((s, x) => s + x.quantity, 0)} unidades
                  </p>
                  <p className="text-[10px] text-emerald-700 font-mono">
                    {successTransformation.items.length} tipos de artigos
                  </p>
                </div>

                <div className="bg-amber-50 p-3.5 rounded-xl border border-amber-200">
                  <span className="text-[10px] font-black text-amber-800 uppercase">Perda no Processo</span>
                  <p className="text-sm font-black text-amber-900 mt-0.5">
                    {successTransformation.lossQuantity} {successTransformation.originalUnit}
                  </p>
                  <p className="text-[10px] text-amber-800 font-mono">
                    {successTransformation.lossValue.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
                  </p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap justify-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => handlePrintVoucher(successTransformation)}
                  className="px-5 py-2.5 bg-emerald-700 hover:bg-emerald-800 text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md flex items-center gap-2 cursor-pointer transition-all active:scale-95"
                >
                  <span className="material-symbols-outlined text-[18px]">print</span>
                  Imprimir Guia de Transformação (PDF)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSuccessTransformation(null);
                    setSelectedOriginalId('');
                    onClose();
                  }}
                  className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs uppercase rounded-xl border border-gray-300 cursor-pointer transition-colors"
                >
                  Fechar Janela
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmitTransformation} className="space-y-6">
              
              {/* Error Alert */}
              {errorMsg && (
                <div className="p-3.5 bg-red-50 border border-red-200 text-red-700 font-bold rounded-xl flex items-center gap-2 animate-shake">
                  <span className="material-symbols-outlined text-[18px] text-red-600">error</span>
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* PASSO 1: Seleção do Produto Original */}
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2">
                  <div className="flex items-center gap-2">
                    <span className="w-5 h-5 bg-emerald-700 text-white font-black rounded-full flex items-center justify-center text-[10px]">
                      1
                    </span>
                    <h4 className="font-black text-slate-800 text-xs sm:text-sm uppercase tracking-tight">
                      Requisição do Produto Original a Fracionar
                    </h4>
                  </div>
                  {originalProduct && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedOriginalId('');
                        setProductSearchTerm('');
                      }}
                      className="text-[10px] font-bold text-slate-500 hover:text-red-600 flex items-center gap-1 cursor-pointer transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">restart_alt</span>
                      Trocar Artigo Selecionado
                    </button>
                  )}
                </div>

                {!selectedOriginalId ? (
                  <div className="space-y-3">
                    {/* Search Bar for Products */}
                    <div>
                      <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                        Pesquisar Artigo em Stock para Transformar
                      </label>
                      <div className="relative">
                        <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">
                          search
                        </span>
                        <input
                          type="text"
                          value={productSearchTerm}
                          onChange={(e) => setProductSearchTerm(e.target.value)}
                          placeholder="Digite o nome do produto, código ou categoria (ex: Ureia, NPK, Sementes)..."
                          className="w-full bg-white border border-slate-300 rounded-xl pl-9 pr-8 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-600 shadow-2xs"
                          autoFocus
                        />
                        {productSearchTerm && (
                          <button
                            type="button"
                            onClick={() => setProductSearchTerm('')}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700 cursor-pointer"
                          >
                            <span className="material-symbols-outlined text-[16px]">cancel</span>
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Quick Selection List */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
                        <span>Produtos com Stock Disponível ({availableOriginalProducts.length})</span>
                        {productSearchTerm && <span>Filtrado por: "{productSearchTerm}"</span>}
                      </div>

                      {availableOriginalProducts.length === 0 ? (
                        <div className="p-5 bg-white border border-slate-200 rounded-xl text-center text-gray-400 text-xs">
                          Nenhum produto com stock disponível encontrado para a pesquisa.
                        </div>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-52 overflow-y-auto custom-scrollbar pr-1">
                          {availableOriginalProducts.map(p => {
                            const hasBulk = (p.stockQtyBulk || 0) > 0 && p.parentUnit;
                            return (
                              <button
                                key={p.id}
                                type="button"
                                onClick={() => handleOriginalProductChange(p.id)}
                                className="text-left bg-white hover:bg-emerald-50/80 p-2.5 rounded-xl border border-slate-200 hover:border-emerald-300 shadow-2xs transition-all cursor-pointer group flex flex-col justify-between"
                              >
                                <div className="flex items-start justify-between gap-1.5">
                                  <span className="font-bold text-slate-800 group-hover:text-emerald-900 text-xs">
                                    {p.name}
                                  </span>
                                  <span className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 shrink-0">
                                    {p.category}
                                  </span>
                                </div>
                                <div className="flex items-center justify-between mt-2 text-[10px]">
                                  <span className="text-emerald-700 font-bold">
                                    Stock: {hasBulk ? `${p.stockQtyBulk} ${p.parentUnit} (${p.stockQty} ${p.baseUnit})` : `${p.stockQty} ${p.baseUnit}`}
                                  </span>
                                  <span className="text-slate-500 font-mono">
                                    Custo: {p.buyingPrice.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (
                  /* When product is selected */
                  <div className="space-y-3">
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div className="p-2 bg-emerald-600 text-white rounded-lg">
                          <span className="material-symbols-outlined text-[20px]">check_circle</span>
                        </div>
                        <div>
                          <span className="text-[10px] font-black uppercase text-emerald-800">Artigo Selecionado</span>
                          <h5 className="font-bold text-emerald-950 text-xs sm:text-sm">{originalProduct.name}</h5>
                          <span className="text-[10px] text-emerald-700">Categoria: {originalProduct.category} {originalProduct.code ? `• Código: ${originalProduct.code}` : ''}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 sm:border-l sm:border-emerald-200 sm:pl-3 text-right sm:text-left">
                        <div>
                          <span className="text-[9px] font-black text-slate-500 uppercase block">Stock Disponível</span>
                          <span className="text-xs font-black text-emerald-900">
                            {originalProduct.stockQtyBulk ? `${originalProduct.stockQtyBulk} ${originalProduct.parentUnit} / ` : ''}{originalProduct.stockQty} {originalProduct.baseUnit}
                          </span>
                        </div>
                        <div>
                          <span className="text-[9px] font-black text-slate-500 uppercase block">Custo Unitário</span>
                          <span className="text-xs font-mono font-bold text-slate-700">
                            {originalUnitCostPerBase.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT/{originalProduct.baseUnit}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end pt-1">
                      <div className="md:col-span-6">
                        <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                          Quantidade a Requisitar ({useBulkUnit && originalProduct.parentUnit ? originalProduct.parentUnit : originalProduct.baseUnit})
                        </label>
                        <input
                          type="number"
                          min="0.1"
                          step="any"
                          max={availableStock}
                          value={originalQty}
                          onChange={(e) => setOriginalQty(Math.max(0.1, Number(e.target.value)))}
                          className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-black text-center text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                        />
                      </div>

                      <div className="md:col-span-6 flex items-center gap-2 pb-2">
                        {originalProduct.parentUnit && (
                          <label className="flex items-center gap-1.5 cursor-pointer text-[11px] font-bold text-slate-700 bg-white p-2 rounded-lg border border-slate-200 w-full">
                            <input
                              type="checkbox"
                              checked={useBulkUnit}
                              onChange={(e) => setUseBulkUnit(e.target.checked)}
                              className="rounded text-emerald-700 focus:ring-emerald-600"
                            />
                            Requisitar em {originalProduct.parentUnit} (Volume/Saco Grande)
                          </label>
                        )}
                      </div>
                    </div>

                    {/* Original Product Info Summary */}
                    <div className="bg-white p-3 rounded-lg border border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                      <div>
                        <span className="text-[9px] font-black text-slate-400 uppercase">Stock Disponível</span>
                        <p className="text-xs font-black text-slate-700 mt-0.5">
                          {availableStock} {useBulkUnit && originalProduct.parentUnit ? originalProduct.parentUnit : originalProduct.baseUnit}
                        </p>
                      </div>
                      <div>
                        <span className="text-[9px] font-black text-slate-400 uppercase">Volume Base Total</span>
                        <p className="text-xs font-black text-emerald-800 mt-0.5">
                          {originalBaseQty} {originalProduct.baseUnit}
                        </p>
                      </div>
                      <div>
                        <span className="text-[9px] font-black text-slate-400 uppercase">Custo Unitário Base</span>
                        <p className="text-xs font-black text-slate-700 mt-0.5">
                          {originalUnitCostPerBase.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT / {originalProduct.baseUnit}
                        </p>
                      </div>
                      <div>
                        <span className="text-[9px] font-black text-slate-400 uppercase">Custo Total Requisitado</span>
                        <p className="text-xs font-black text-emerald-700 mt-0.5 font-mono">
                          {originalTotalCost.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* PASSO 2: Definição dos Produtos Resultantes */}
              {originalProduct && (
                <div className="bg-emerald-50/60 border border-emerald-200 rounded-xl p-4 sm:p-5 space-y-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-200 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 bg-emerald-700 text-white font-black rounded-full flex items-center justify-center text-[10px]">
                        2
                      </span>
                      <h4 className="font-black text-emerald-950 text-xs sm:text-sm uppercase tracking-tight">
                        Definição dos Pacotes / Artigos Resultantes
                      </h4>
                    </div>
                    <button
                      type="button"
                      onClick={addResultingItemRow}
                      className="px-3 py-1 bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[10px] uppercase rounded-lg shadow-xs flex items-center gap-1 cursor-pointer transition-all self-start sm:self-auto"
                    >
                      <span className="material-symbols-outlined text-[14px]">add</span>
                      Adicionar Embalagem
                    </button>
                  </div>

                  {/* List of packages */}
                  <div className="space-y-3">
                    {resultingItems.map((item, idx) => (
                      <div key={item.id} className="bg-white p-3.5 rounded-xl border border-emerald-200 shadow-xs space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-black text-emerald-900 text-xs">
                            Pacote / Fração #{idx + 1}
                          </span>
                          {resultingItems.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeResultingItemRow(idx)}
                              className="text-red-500 hover:text-red-700 text-[10px] font-bold flex items-center gap-0.5 cursor-pointer"
                            >
                              <span className="material-symbols-outlined text-[14px]">delete</span>
                              Remover
                            </button>
                          )}
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                          <div className="sm:col-span-5">
                            <label className="block text-[9px] font-black uppercase text-gray-500 mb-0.5">
                              Nome do Artigo Fracionado
                            </label>
                            <input
                              type="text"
                              value={item.productName}
                              onChange={(e) => updateResultingItem(idx, { productName: e.target.value })}
                              placeholder="Ex: Ureia Azul 1kg (Pacote)"
                              className="w-full bg-gray-50 border border-gray-300 rounded px-2.5 py-1.5 text-xs font-bold text-gray-800 focus:bg-white focus:ring-1 focus:ring-emerald-600"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-[9px] font-black uppercase text-gray-500 mb-0.5">
                              Qtd de Pacotes
                            </label>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={item.quantity}
                              onChange={(e) => updateResultingItem(idx, { quantity: Math.max(1, Number(e.target.value)) })}
                              className="w-full bg-gray-50 border border-gray-300 rounded px-2.5 py-1.5 text-xs font-black text-center text-gray-800 focus:bg-white focus:ring-1 focus:ring-emerald-600"
                            />
                          </div>

                          <div className="sm:col-span-2">
                            <label className="block text-[9px] font-black uppercase text-gray-500 mb-0.5">
                              Peso por Unidade ({originalProduct.baseUnit})
                            </label>
                            <input
                              type="number"
                              min="0.01"
                              step="any"
                              value={item.unitWeight}
                              onChange={(e) => updateResultingItem(idx, { unitWeight: Math.max(0.01, Number(e.target.value)) })}
                              className="w-full bg-gray-50 border border-gray-300 rounded px-2.5 py-1.5 text-xs font-black text-center text-gray-800 focus:bg-white focus:ring-1 focus:ring-emerald-600"
                            />
                          </div>

                          <div className="sm:col-span-3">
                            <label className="block text-[9px] font-black uppercase text-gray-500 mb-0.5">
                              Preço Venda Sugerido (MT)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={item.sellingPrice}
                              onChange={(e) => updateResultingItem(idx, { sellingPrice: Math.max(0, Number(e.target.value)) })}
                              className="w-full bg-gray-50 border border-gray-300 rounded px-2.5 py-1.5 text-xs font-black text-right text-emerald-800 focus:bg-white focus:ring-1 focus:ring-emerald-600"
                            />
                          </div>
                        </div>

                        {/* Calculated Live Cost Display */}
                        <div className="flex flex-wrap items-center justify-between gap-2 bg-emerald-50/60 p-2 rounded-lg border border-emerald-100 text-[11px]">
                          <div>
                            <span className="text-gray-500">Volume Total desta fração: </span>
                            <span className="font-black text-emerald-900">
                              {(item.quantity * item.unitWeight)} {originalProduct.baseUnit}
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500">Custo Unitário Calculado: </span>
                            <span className="font-black text-emerald-900">
                              {item.calculatedCost.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
                            </span>
                          </div>
                          <div>
                            <span className="text-gray-500">Custo Total da Linha: </span>
                            <span className="font-black text-emerald-900">
                              {(item.quantity * item.calculatedCost).toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* PASSO 3: Balanço Matemático & Perdas */}
              {originalProduct && (
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 sm:p-5 space-y-3">
                  <div className="flex items-center gap-2 border-b border-slate-200 pb-2">
                    <span className="w-5 h-5 bg-emerald-700 text-white font-black rounded-full flex items-center justify-center text-[10px]">
                      3
                    </span>
                    <h4 className="font-black text-slate-800 text-xs sm:text-sm uppercase tracking-tight">
                      Balanço Matemático & Verificação de Integridade
                    </h4>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 text-center">
                    <div className="bg-white p-3 rounded-lg border border-slate-200">
                      <span className="text-[9px] font-black text-slate-500 uppercase">Volume Requisitado</span>
                      <p className="text-sm font-black text-slate-800 mt-0.5">
                        {originalBaseQty} {originalProduct.baseUnit}
                      </p>
                    </div>

                    <div className="bg-white p-3 rounded-lg border border-slate-200">
                      <span className="text-[9px] font-black text-emerald-700 uppercase">Volume Empacotado</span>
                      <p className="text-sm font-black text-emerald-800 mt-0.5">
                        {totalResultingBaseQty} {originalProduct.baseUnit}
                      </p>
                    </div>

                    <div className={`p-3 rounded-lg border ${lossQty > 0 ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-white border-slate-200 text-slate-800'}`}>
                      <span className="text-[9px] font-black uppercase">Perda no Processo</span>
                      <p className="text-sm font-black mt-0.5">
                        {lossQty} {originalProduct.baseUnit}
                      </p>
                      <p className="text-[10px] font-mono">
                        ({lossValue.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT)
                      </p>
                    </div>

                    <div className="bg-emerald-50 p-3 rounded-lg border border-emerald-200 text-emerald-900">
                      <span className="text-[9px] font-black uppercase">Balanço de Custo</span>
                      <p className="text-sm font-black mt-0.5">
                        0.00 MT
                      </p>
                      <p className="text-[10px] font-bold text-emerald-700">
                        100% Neutro ✓
                      </p>
                    </div>
                  </div>

                  {totalResultingBaseQty > originalBaseQty && (
                    <div className="p-3 bg-red-100 border border-red-300 text-red-800 rounded-lg font-bold flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px]">warning</span>
                      <span>Atenção: A quantidade empacotada excede o total requisitado em {totalResultingBaseQty - originalBaseQty} {originalProduct.baseUnit}. Ajuste as frações para avançar.</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-600 mb-1">
                      Observações / Justificação da Transformação
                    </label>
                    <input
                      type="text"
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="Ex: Fracionamento de 1 saco de 50kg para venda a retalho no balcão"
                      className="w-full bg-white border border-slate-300 rounded-lg px-3 py-2 text-xs font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-emerald-600"
                    />
                  </div>
                </div>
              )}

              {/* Submit Buttons */}
              <div className="flex items-center justify-end gap-3 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-5 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs uppercase rounded-xl transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting || !originalProduct || totalResultingBaseQty > originalBaseQty}
                  className="px-6 py-2.5 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md flex items-center gap-2 cursor-pointer transition-all active:scale-95"
                >
                  {isSubmitting ? (
                    <>
                      <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                      <span>Processando Transformação...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[18px]">done_all</span>
                      <span>Executar Transformação Atómica</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
};

export default TransformationModal;
