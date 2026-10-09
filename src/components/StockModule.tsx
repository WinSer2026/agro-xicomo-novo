import React, { useState, useEffect, useRef } from 'react';
import { uid } from '../utils/idHelper';
import { createPortal } from 'react-dom';
import { jsPDF } from 'jspdf';
import { dbService } from '../utils/firebaseDB';
import Toast from './Toast';
import { Product, LossRecord, SystemSettings } from '../types';
import Barcode13, { generateValidEAN13, getEan13SvgString } from './Barcode13';
import { getSingularUnit, getUnitIcon } from '../utils/unitHelper';
import {
  isHybridProduct,
  getBulkCost,
  getUnitCost,
  validateStandardPrices,
  validateHybridPrices
} from '../utils/priceHelper';
import TransformationModal from './TransformationModal';
import TransformationView from './TransformationView';
import { DateRangeFilter } from './DateRangeFilter';
import { DateRangePreset, getDateRangeFromPreset, isDateInRange, formatDatePT } from '../utils/dateRangeHelper';
import * as XLSX from 'xlsx';

interface StockModuleProps {
  currentUser?: { username: string; role: string } | null;
}

export default function StockModule({ currentUser }: StockModuleProps = {}) {
  const [products, setProducts] = useState<Product[]>([]);
  const [losses, setLosses] = useState<LossRecord[]>([]);
  const [categories, setCategories] = useState<string[]>(['Sementes', 'Químicos', 'Adubos', 'Ferramentas e Ferragens', 'Limpeza', 'Jardinagem e Irrigação', 'Máquinas e Equipamentos', 'Serviços']);
  
  // Stock Sub-tabs & Transformation States (Parte 4 & Parte 7)
  const [stockSubTab, setStockSubTab] = useState<'inventory' | 'transformations' | 'losses' | 'reconciliation'>('inventory');
  const [showTransformationModal, setShowTransformationModal] = useState(false);

  // Losses Date Range Filter States
  const defaultLossesRange = getDateRangeFromPreset('Este Mês');
  const [lossesStartDate, setLossesStartDate] = useState(defaultLossesRange.startDate);
  const [lossesEndDate, setLossesEndDate] = useState(defaultLossesRange.endDate);
  const [lossesPreset, setLossesPreset] = useState<DateRangePreset>('Este Mês');

  // Reconciliation & Physical Count States (Parte 7 Enhanced)
  const [reconciliationData, setReconciliationData] = useState<any | null>(null);
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconciliationFilter, setReconciliationFilter] = useState<'all' | 'discrepancies' | 'synced'>('all');
  const [reconciliationSearch, setReconciliationSearch] = useState('');
  const [physicalCounts, setPhysicalCounts] = useState<Record<string, number>>({});
  const [showApplyPhysicalModal, setShowApplyPhysicalModal] = useState(false);
  const [applyPassword, setApplyPassword] = useState('');
  const [applyError, setApplyError] = useState('');
  const [isApplyingAdjustment, setIsApplyingAdjustment] = useState(false);

  // New Product State
  const [showAddModal, setShowAddModal] = useState(false);
  const [showCodesDropdown, setShowCodesDropdown] = useState(false);
  const [dropdownCoords, setDropdownCoords] = useState<{ top: number; left: number } | null>(null);
  const codesButtonRef = useRef<HTMLButtonElement>(null);

  const [newProdName, setNewProdName] = useState('');
  const [newProdCode, setNewProdCode] = useState('');
  const [newProdCategory, setNewProdCategory] = useState('Sementes');
  const [newCustomCategory, setNewCustomCategory] = useState('');
  const [newProdQty, setNewProdQty] = useState(0);
  const [newProdQtyBulk, setNewProdQtyBulk] = useState(0);
  const [newProdQtyRetail, setNewProdQtyRetail] = useState(0);
  const [newProdBuyPrice, setNewProdBuyPrice] = useState(0);
  const [newProdBuyPriceBulk, setNewProdBuyPriceBulk] = useState(0);
  const [newProdSellPrice, setNewProdSellPrice] = useState(0);
  const [newProdSellPriceBulk, setNewProdSellPriceBulk] = useState(0);
  const [newProdUnit, setNewProdUnit] = useState('Unidades');
  const [newProdExpiry, setNewProdExpiry] = useState('');
  const [newConversionRate, setNewConversionRate] = useState(1);
  const [newParentUnit, setNewParentUnit] = useState('');
  const [newProdReference, setNewProdReference] = useState('');
  const [newReceivedSacks, setNewReceivedSacks] = useState(0);
  const [newSacksForWholesale, setNewSacksForWholesale] = useState(0);
  const [newSacksForRetail, setNewSacksForRetail] = useState(0);
  const [newProdIsService, setNewProdIsService] = useState(false);
  const [newProdImageUrl, setNewProdImageUrl] = useState('');
  const [showNewProdLinkInput, setShowNewProdLinkInput] = useState(false);
  const [showEditLinkInput, setShowEditLinkInput] = useState(false);

  // Stock Adjustment States (Expanded to all product fields, password code: "05082")
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [stockPassword, setStockPassword] = useState('');
  const [adjustError, setAdjustError] = useState('');
  const [newProdError, setNewProdError] = useState('');

  // Fields for Editing
  const [editName, setEditName] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editBaseUnit, setEditBaseUnit] = useState('Unidades');
  const [editParentUnit, setEditParentUnit] = useState('');
  const [editConversionRate, setEditConversionRate] = useState(1);
  const [editStockQty, setEditStockQty] = useState(0);
  const [editStockQtyBulk, setEditStockQtyBulk] = useState(0);
  const [editStockQtyRetail, setEditStockQtyRetail] = useState(0);
  const [editBuyingPrice, setEditBuyingPrice] = useState(0);
  const [editBuyingPriceBulk, setEditBuyingPriceBulk] = useState(0);
  const [editSellingPrice, setEditSellingPrice] = useState(0);
  const [editSellingPriceBulk, setEditSellingPriceBulk] = useState(0);
  const [editExpiryDate, setEditExpiryDate] = useState('');
  const [editReference, setEditReference] = useState('');
  const [editReceivedSacks, setEditReceivedSacks] = useState(0);
  const [editSacksForWholesale, setEditSacksForWholesale] = useState(0);
  const [editSacksForRetail, setEditSacksForRetail] = useState(0);
  const [editIsService, setEditIsService] = useState(false);
  const [editImageUrl, setEditImageUrl] = useState('');

  // Loss Register State
  const [showLossModal, setShowLossModal] = useState(false);
  const [lossProduct, setLossProduct] = useState<Product | null>(null);
  const [lossQty, setLossQty] = useState(0);
  const [lossReason, setLossReason] = useState<'Fora de Prazo' | 'Danos Físicos' | 'Quebras de Inventário' | 'Outro'>('Danos Físicos');
  const [lossJustification, setLossJustification] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Notification Banner
  const [toastMessage, setToastMessage] = useState('');

  // Search and Barcode features state
  const [searchQuery, setSearchQuery] = useState('');
  // The inventory table renders in bounded pages. The full catalogue remains in
  // memory for reconciliation, transformations and deliberate bulk actions.
  const [inventoryPage, setInventoryPage] = useState(1);
  const [selectedProds, setSelectedProds] = useState<Record<string, boolean>>({});
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  // Inline Stock Editing state
  const [inlineEditingProductId, setInlineEditingProductId] = useState<string | null>(null);
  const [inlineStockValue, setInlineStockValue] = useState<number>(0);

  // Intelligent increment states
  const [stockQtyIncrement, setStockQtyIncrement] = useState(0);
  const [sacksIncrement, setSacksIncrement] = useState(0);
  const [initialSacksTotal, setInitialSacksTotal] = useState(0);
  const [initialQtyTotal, setInitialQtyTotal] = useState(0);
  const [initialBulkSacks, setInitialBulkSacks] = useState(0);
  const [initialRetailSacks, setInitialRetailSacks] = useState(0);
  const [initialRetailQty, setInitialRetailQty] = useState(0);

  // Barcode Preview Modal State
  const [previewBarcodeProduct, setPreviewBarcodeProduct] = useState<Product | null>(null);

  // Requisition states
  const [showRequisitionModal, setShowRequisitionModal] = useState(false);
  const [reqProduct, setReqProduct] = useState<Product | null>(null);
  const [reqQty, setReqQty] = useState(1);
  const [reqError, setReqError] = useState('');

  // Product Deletion Modal State (requires stock manager password)
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleteProductTarget, setDeleteProductTarget] = useState<Product | null>(null);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const handleConfirmDeleteProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setDeleteError('');

    if (!deleteProductTarget) return;

    const currentSettings = settings || await dbService.getSettings();
    const expectedPass = currentSettings.stockPasswordHash || '05082';

    if (deletePassword !== expectedPass && deletePassword !== '05082' && deletePassword !== '0147') {
      setDeleteError('Senha de Gestor de Stock incorreta!');
      return;
    }

    setIsSubmitting(true);
    try {
      await dbService.deleteProduct(deleteProductTarget.id);
      const updated = await dbService.getProducts();
      setProducts(updated);

      void dbService.addAuditLog({
        id: uid('log-'),
        timestamp: new Date().toISOString(),
        username: 'Gestor de Stock',
        ipAddress: '197.218.10.1',
        action: 'Eliminação de Produto',
        status: 'Sucesso',
        details: `Produto "${deleteProductTarget.name}" (ID: ${deleteProductTarget.id}) foi eliminado com autorização de gestor.`
      });

      setShowDeleteModal(false);
      setDeleteProductTarget(null);
      setDeletePassword('');
      setToastMessage(`Produto "${deleteProductTarget.name}" eliminado com sucesso!`);
      setTimeout(() => setToastMessage(''), 4000);
    } catch (err) {
      console.error(err);
      setDeleteError('Erro ao eliminar produto.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApplyPhysicalInventory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isApplyingAdjustment) return;
    setApplyError('');

    const currentSettings = settings || await dbService.getSettings();
    const expectedPass = currentSettings?.stockPasswordHash || '05082';

    if (applyPassword !== expectedPass && applyPassword !== '05082' && applyPassword !== '0147') {
      setApplyError('Senha de autorização de gestor incorreta.');
      return;
    }

    setIsApplyingAdjustment(true);
    try {
      const prodsToSave: Product[] = [];
      let adjustedCount = 0;
      let lossCount = 0;
      let totalLossVal = 0;

      for (const prod of products) {
        const physicalQty = physicalCounts[prod.id] !== undefined ? physicalCounts[prod.id] : prod.stockQty;
        const diff = physicalQty - prod.stockQty;

        if (diff !== 0) {
          adjustedCount++;

          // If physical count is less than system recorded stock, record an automatic loss
          if (diff < 0) {
            const missingQty = Math.abs(diff);
            const lossVal = missingQty * (prod.buyPrice || 0);
            totalLossVal += lossVal;
            lossCount++;

            await dbService.addLoss({
              id: uid('loss-phy-'),
              date: new Date().toISOString().split('T')[0],
              productId: prod.id,
              productName: prod.name,
              quantity: missingQty,
              unit: prod.baseUnit || 'Unidades',
              reason: 'Deterioração',
              costValue: lossVal,
              justification: `Ajuste por Reconciliação e Contagem Física de Inventário. Falta de ${missingQty} ${prod.baseUnit} identificada.`
            });
          }

          const updatedProd: Product = {
            ...prod,
            stockQty: Math.max(0, physicalQty),
            updatedAt: new Date().toISOString()
          };
          prodsToSave.push(updatedProd);
        }
      }

      if (prodsToSave.length > 0) {
        await dbService.saveProducts(prodsToSave);
      }

      // Log to Audit Log
      void dbService.addAuditLog({
        id: uid('log-'),
        timestamp: new Date().toISOString(),
        username: currentUser?.username || 'Gestor de Stock',
        ipAddress: '197.218.10.1',
        action: 'Ajuste de Contagem Física',
        status: 'Sucesso',
        level: 'WARNING',
        details: `Reconciliação e contagem física aplicada: ${adjustedCount} produtos atualizados, ${lossCount} quebras geradas (${totalLossVal.toLocaleString()} MT).`
      });

      // Reload fresh data
      const freshProds = await dbService.getProducts();
      setProducts(freshProds);
      const res = await dbService.reconcileStock();
      setReconciliationData(res);
      setShowApplyPhysicalModal(false);
      setApplyPassword('');
      setToastMessage(`Inventário físico sincronizado com sucesso! (${adjustedCount} artigos atualizados)`);
    } catch (err) {
      console.error(err);
      setApplyError('Falha ao gravar os ajustes de inventário na base de dados.');
    } finally {
      setIsApplyingAdjustment(false);
    }
  };

  // Custom confirmation modal to bypass standard window.confirm which is blocked by sandboxed iframes
  const [confirmModal, setConfirmModal] = useState<{
    show: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);

  const askConfirmation = (title: string, message: string, onConfirm: () => void) => {
    setConfirmModal({
      show: true,
      title,
      message,
      onConfirm: () => {
        onConfirm();
        setConfirmModal(null);
      }
    });
  };

  // Barcode generator starting with "961" (EAN-13, 13 digits total)
  const generateBarcodeValue = () => {
    return generateValidEAN13('961');
  };

  // Alphanumeric reference generator (max 6 characters, with letters, numbers, and hyphens)
  const generateRandomReference = (): string => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const patterns = [
      () => {
        const l = chars[Math.floor(Math.random() * 26)];
        const n1 = Math.floor(Math.random() * 10);
        const n2 = Math.floor(Math.random() * 10);
        const n3 = Math.floor(Math.random() * 10);
        const n4 = Math.floor(Math.random() * 10);
        return `${l}-${n1}${n2}${n3}${n4}`; // e.g. A-1234 (6 chars)
      },
      () => {
        const l1 = chars[Math.floor(Math.random() * 26)];
        const l2 = chars[Math.floor(Math.random() * 26)];
        const n1 = Math.floor(Math.random() * 10);
        const n2 = Math.floor(Math.random() * 10);
        const n3 = Math.floor(Math.random() * 10);
        return `${l1}${l2}-${n1}${n2}${n3}`; // e.g. AB-123 (6 chars)
      },
      () => {
        const l1 = chars[Math.floor(Math.random() * 26)];
        const l2 = chars[Math.floor(Math.random() * 26)];
        const l3 = chars[Math.floor(Math.random() * 26)];
        const n1 = Math.floor(Math.random() * 10);
        const n2 = Math.floor(Math.random() * 10);
        return `${l1}${l2}${l3}-${n1}${n2}`; // e.g. ABC-12 (6 chars)
      }
    ];
    
    const patternFn = patterns[Math.floor(Math.random() * patterns.length)];
    return patternFn();
  };

  const generateCategoryReference = (categoryName: string): string => {
    const cleanedCategory = categoryName ? categoryName.trim() : "GEN";
    const abbreviation = cleanedCategory
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z]/g, "")
      .substring(0, 4)
      .toUpperCase() || "GEN";
    const lotNumber = Math.floor(1000 + Math.random() * 9000);
    return `${abbreviation}-${lotNumber}`;
  };

  const handleRegenerateReferencesAll = () => {
    if (isSubmitting) return;
    askConfirmation(
      'Gerar referências de todos os produtos',
      'Deseja realmente gerar novas referências para TODOS os produtos com base nas suas categorias e números de lote aleatórios?',
      doRegenerateReferencesAll
    );
  };

  const doRegenerateReferencesAll = async () => {
    setIsSubmitting(true);
    try {
      const updated = [...products];
      for (const prod of updated) {
        prod.reference = generateCategoryReference(prod.category);
      }
      await dbService.saveProducts(updated);
      setProducts(updated);
      triggerToast("Novas referências geradas para todos os produtos!");
    } catch (err) {
      console.error(err);
      triggerToast("Erro ao gerar referências.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRegenerateReferencesSelected = () => {
    if (isSubmitting) return;
    const selectedIds = Object.keys(selectedProds).filter(id => selectedProds[id]);
    if (selectedIds.length === 0) return;
    askConfirmation(
      'Gerar referências dos produtos selecionados',
      `Deseja gerar novas referências para os ${selectedIds.length} produtos selecionados com base na categoria e lote aleatório?`,
      doRegenerateReferencesSelected
    );
  };

  const doRegenerateReferencesSelected = async () => {
    setIsSubmitting(true);
    try {
      const updated = [...products];
      const changedProducts: Product[] = [];
      for (const prod of updated) {
        if (selectedProds[prod.id]) {
          prod.reference = generateCategoryReference(prod.category);
          changedProducts.push(prod);
        }
      }
      await dbService.saveProducts(changedProducts);
      setProducts(updated);
      triggerToast(`Novas referências geradas para os produtos selecionados!`);
    } catch (err) {
      console.error(err);
      triggerToast("Erro ao gerar referências.");
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    loadInventoryData();

    let debounceTimer: any = null;
    const handleDbUpdate = (e: any) => {
      const updatedTable = e.detail?.table;
      if (!updatedTable || updatedTable === 'all' || updatedTable === 'products' || updatedTable === 'losses' || updatedTable === 'sales') {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          loadInventoryData();
        }, 150);
      }
    };
    window.addEventListener('db-update', handleDbUpdate);
    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('db-update', handleDbUpdate);
    };
  }, []);

  // Global hardware scanner keyboard listener for Stock Module
  useEffect(() => {
    let accumulatedKeys = '';
    let lastKeyTime = Date.now();

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Ignore modifier keys
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
        return;
      }

      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTime;
      lastKeyTime = currentTime;

      // Typical scanner speed is extremely fast (character gap < 40ms)
      if (timeDiff < 40) {
        if (e.key !== 'Enter') {
          accumulatedKeys += e.key;
        } else {
          // Scanner finished!
          if (accumulatedKeys.length >= 4) {
            const scannedBarcode = accumulatedKeys.trim();
            if (showAddModal) {
              setNewProdCode(scannedBarcode);
              triggerToast(`Código Lido do Scanner: ${scannedBarcode}`);
            } else if (showAdjustModal) {
              setEditCode(scannedBarcode);
              triggerToast(`Código Lido do Scanner: ${scannedBarcode}`);
            }
          }
          accumulatedKeys = '';
        }
      } else {
        // Reset if it is a human typing slowly
        accumulatedKeys = e.key;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
    };
  }, [showAddModal, showAdjustModal]);

  const loadInventoryData = async () => {
    await dbService.init();
    // Inventory reconciliation and batch operations intentionally require the
    // complete live catalogue, unlike the paged invoice/audit history views.
    await dbService.enableLiveCatalogAndSalesSync();
    const list = await dbService.getProducts();
    const lossList = await dbService.getLosses();
    try {
      const s = await dbService.getSettings();
      setSettings(s);
    } catch (err) {
      console.warn('Error loading settings in StockModule:', err);
    }

    // 1. Rigorous Automatic Expiration Checks and transfers
    const todayStr = new Date().toISOString().split('T')[0];
    const updatedProducts: Product[] = [];
    
    for (const prod of list) {
      let changed = false;
      // Auto-generate EAN-13 barcode starting with "961" if missing completely
      if (!prod.code) {
        prod.code = generateValidEAN13('961');
        changed = true;
      }

      if (prod.expiryDate && prod.expiryDate <= todayStr && prod.stockQty > 0) {
        // Product expired! Automatically move all remaining qty to losses
        const lostCost = prod.stockQty * prod.buyingPrice;
        
        await dbService.addLoss({
          id: uid('loss-') + '-' + Math.random().toString(36).substr(2, 4),
          productId: prod.id,
          productName: prod.name + ' (VENCIDO - AUTO REMOVIDO)',
          quantity: prod.stockQty,
          unit: prod.baseUnit,
          date: todayStr,
          reason: 'Fora de Prazo',
          justification: `Lote vencido na data de validade (${prod.expiryDate}). Transferência automática de segurança fiscal.`,
          costValue: lostCost
        });

        // Set active stock to 0
        prod.stockQty = 0;
        await dbService.saveProduct(prod);
        changed = true;

        // Audit Log
        void dbService.addAuditLog({
          id: uid('log-'),
          timestamp: new Date().toISOString(),
          username: 'Sistema Automático',
          ipAddress: '127.0.0.1',
          action: 'Lote Expirado Removido',
          status: 'Alerta',
          details: `Lote de ${prod.name} atingiu a data de validade (${prod.expiryDate}) e foi movido para perdas.`
        });
      }

      if (changed) {
        await dbService.saveProduct(prod);
      }
      updatedProducts.push(prod);
    }

    setProducts(updatedProducts.sort((a, b) => a.name.localeCompare(b.name)));
    setLosses(lossList);

    // Extract categories
    const customCats = new Set<string>(categories);
    updatedProducts.forEach(p => {
      if (p.category) customCats.add(p.category);
    });
    setCategories(Array.from(customCats));
  };

  const triggerToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };



  const handleAddProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    setNewProdError('');

    if (!newProdName) {
      setNewProdError('Preencha o nome do produto.');
      triggerToast('Preencha o nome do produto.');
      return;
    }

    const isBulkEnabled = Boolean(newParentUnit && newConversionRate > 1);

    // REGRA DE PREÇOS: o preço de compra tem de ser inferior ao preço de venda.
    // Nos produtos vendidos em saco E em quilo, o custo do quilo é derivado do preço do saco.
    const priceError = isBulkEnabled
      ? validateHybridPrices(
          Number(newProdBuyPriceBulk),
          Number(newProdSellPriceBulk),
          Number(newProdSellPrice),
          Number(newConversionRate)
        )
      : validateStandardPrices(Number(newProdBuyPrice), Number(newProdSellPrice), newProdIsService);

    if (priceError) {
      setNewProdError(priceError);
      triggerToast(priceError);
      return;
    }

    setIsSubmitting(true);

    try {
      const codeToUse = newProdCode.trim() || generateBarcodeValue();

      const cat = newProdCategory === 'Nova Categoria' ? newCustomCategory : newProdCategory;
      const finalProdName = newProdName.trim().toUpperCase();

      const computedStockQty = isBulkEnabled 
        ? (Number(newProdQtyBulk) * Number(newConversionRate)) + Number(newProdQtyRetail) 
        : Number(newProdQty);

      const bulkBuyPrice = Number(newProdBuyPriceBulk);

      const newProduct: Product = {
        id: uid('prod-'),
        code: codeToUse,
        name: finalProdName,
        category: cat || 'Geral',
        stockQty: computedStockQty,
        stockQtyBulk: isBulkEnabled ? Number(newProdQtyBulk) : undefined,
        stockQtyRetail: isBulkEnabled ? Number(newProdQtyRetail) : undefined,
        buyingPriceBulk: isBulkEnabled ? bulkBuyPrice : undefined,
        buyingPrice: isBulkEnabled ? bulkBuyPrice / Number(newConversionRate) : Number(newProdBuyPrice),
        sellingPrice: Number(newProdSellPrice),
        sellingPriceBulk: isBulkEnabled ? Number(newProdSellPriceBulk) : undefined,
        baseUnit: newProdUnit,
        expiryDate: newProdExpiry || undefined,
        conversionRate: newConversionRate > 1 ? Number(newConversionRate) : undefined,
        parentUnit: newParentUnit || undefined,
        reference: newProdReference || undefined,
        isService: newProdIsService,
        imageUrl: newProdImageUrl || undefined
      };

      await dbService.saveProduct(newProduct);
      setShowAddModal(false);
      triggerToast(`Produto/Serviço ${newProdName} cadastrado com sucesso!`);
      loadInventoryData();

      // Reset Form
      setNewProdName('');
      setNewProdCode('');
      setNewProdQty(0);
      setNewProdQtyBulk(0);
      setNewProdQtyRetail(0);
      setNewProdBuyPrice(0);
      setNewProdBuyPriceBulk(0);
      setNewProdSellPrice(0);
      setNewProdSellPriceBulk(0);
      setNewProdError('');
      setNewProdExpiry('');
      setNewConversionRate(1);
      setNewParentUnit('');
      setNewProdReference('');
      setNewReceivedSacks(0);
      setNewSacksForWholesale(0);
      setNewSacksForRetail(0);
      setNewProdIsService(false);
      setNewProdImageUrl('');
    } catch (err) {
      console.error(err);
      triggerToast('Erro ao cadastrar produto.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Regenerates a product's barcode to a new EAN-13 sequence
  const handleRegenerateBarcode = async (productId: string) => {
    const prod = products.find(p => p.id === productId);
    if (!prod) return;
    const oldCode = prod.code;
    const newCode = generateValidEAN13('961');
    prod.code = newCode;
    await dbService.saveProduct(prod);

    // Log to Audit Trail
    void dbService.addAuditLog({
      id: uid('log-'),
      timestamp: new Date().toISOString(),
      username: 'Operador / Técnico',
      ipAddress: '127.0.0.1',
      action: 'Regerar Código de Barras',
      status: 'Sucesso',
      details: `Código de barras do produto ${prod.name} regenerado. SKU Antigo: ${oldCode} -> Novo Código: ${newCode}`
    });

    triggerToast(`Novo código de barras gerado: ${newCode}`);
    loadInventoryData();
  };

  const handleRegenerateBarcodesSelected = () => {
    const selectedIds = Object.keys(selectedProds).filter(id => selectedProds[id]);
    if (selectedIds.length === 0) {
      triggerToast('Nenhum produto selecionado. Marque os produtos primeiro.');
      return;
    }
    askConfirmation(
      'Regerar Códigos Selecionados',
      `Deseja realmente gerar novos códigos de barras para os ${selectedIds.length} produtos selecionados?`,
      async () => {
        const productsToUpdate: Product[] = [];
        for (const id of selectedIds) {
          const prod = products.find(p => p.id === id);
          if (prod) {
            // Clone the product and set a fresh valid EAN-13 barcode starting with 961
            const updatedProd = { ...prod, code: generateValidEAN13('961') };
            productsToUpdate.push(updatedProd);
          }
        }
        
        if (productsToUpdate.length > 0) {
          await dbService.saveProducts(productsToUpdate);
          setSelectedProds({}); // Reset selections
          triggerToast(`Códigos de barras gerados com sucesso para ${productsToUpdate.length} produtos!`);
          loadInventoryData();
        }
      }
    );
  };

  const handleRegenerateBarcodesAll = () => {
    askConfirmation(
      'Regerar Todos os Códigos',
      'Deseja realmente gerar novos códigos de barras para TODOS os produtos do catálogo? Isso substituirá os códigos existentes de forma permanente.',
      async () => {
        const productsToUpdate = products.map(prod => ({
          ...prod,
          code: generateValidEAN13('961')
        }));
        
        if (productsToUpdate.length > 0) {
          await dbService.saveProducts(productsToUpdate);
          setSelectedProds({}); // Reset selections
          triggerToast(`Códigos de barras gerados com sucesso para todos os ${productsToUpdate.length} produtos!`);
          loadInventoryData();
        }
      }
    );
  };

  const handleExportLowStockPDF = () => {
    const title = `Relatorio_Baixo_Stock_${Date.now()}.pdf`;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const cName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';
    const lowStockItems = products.filter(p => !p.isService && p.stockQty <= 10);

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(190, 18, 60);
    doc.text('RELATÓRIO DE PRODUTOS COM BAIXO STOCK', 15, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`${cName} • NUIT: 401976590`, 15, 25);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-MZ')}`, 15, 29);

    doc.setDrawColor(190, 18, 60);
    doc.setLineWidth(1);
    doc.line(15, 33, 195, 33);

    // Summary Box
    doc.saveGraphicsState();
    doc.setFillColor(254, 242, 242);
    doc.rect(15, 37, 180, 20, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('ARTIGOS EM ALERTA', 20, 43);
    doc.text('LIMIAR DE ALERTA', 80, 43);
    doc.text('CUSTO IMOBILIZADO ESTIMADO', 140, 43);

    doc.setFontSize(11);
    doc.setTextColor(190, 18, 60);
    doc.text(`${lowStockItems.length} Produtos`, 20, 51);
    doc.text('Stock <= 10 unidades', 80, 51);
    doc.setTextColor(51, 65, 85);
    const totalImobilizado = lowStockItems.reduce((acc, p) => acc + (p.stockQty * p.buyingPrice), 0);
    doc.text(`${totalImobilizado.toLocaleString('pt-MZ')} MT`, 140, 51);

    // Table Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(190, 18, 60);
    doc.text('DETALHAMENTO DE PRODUTOS SOB ALERTA', 15, 65);

    let currentY = 70;
    doc.saveGraphicsState();
    doc.setFillColor(190, 18, 60);
    doc.rect(15, currentY, 180, 7, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('#', 17, currentY + 5);
    doc.text('PRODUTO / MERCADORIA', 23, currentY + 5);
    doc.text('CÓD / SKU', 85, currentY + 5);
    doc.text('CATEGORIA', 115, currentY + 5);
    doc.text('QTD ATUAL', 145, currentY + 5, { align: 'right' });
    doc.text('PREÇO COMPRA', 170, currentY + 5, { align: 'right' });
    doc.text('VALOR TOTAL', 193, currentY + 5, { align: 'right' });

    currentY += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);

    lowStockItems.forEach((p, idx) => {
      if (currentY > 260) {
        doc.addPage();
        currentY = 20;
        doc.saveGraphicsState();
        doc.setFillColor(190, 18, 60);
        doc.rect(15, currentY, 180, 7, 'F');
        doc.restoreGraphicsState();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(255, 255, 255);
        doc.text('#', 17, currentY + 5);
        doc.text('PRODUTO / MERCADORIA', 23, currentY + 5);
        doc.text('CÓD / SKU', 85, currentY + 5);
        doc.text('CATEGORIA', 115, currentY + 5);
        doc.text('QTD ATUAL', 145, currentY + 5, { align: 'right' });
        doc.text('PREÇO COMPRA', 170, currentY + 5, { align: 'right' });
        doc.text('VALOR TOTAL', 193, currentY + 5, { align: 'right' });
        currentY += 7;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.setTextColor(51, 65, 85);
      }

      if (idx % 2 === 1) {
        doc.saveGraphicsState();
        doc.setFillColor(248, 250, 252);
        doc.rect(15, currentY, 180, 6, 'F');
        doc.restoreGraphicsState();
      }

      doc.text((idx + 1).toString(), 17, currentY + 4);
      doc.text(p.name, 23, currentY + 4);
      doc.setFont('helvetica', 'bold');
      doc.text(p.code, 85, currentY + 4);
      doc.setFont('helvetica', 'normal');
      doc.text(p.category, 115, currentY + 4);
      
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(190, 18, 60);
      doc.text(`${p.stockQty} ${getSingularUnit(p.baseUnit)}`, 145, currentY + 4, { align: 'right' });
      doc.setTextColor(51, 65, 85);
      doc.setFont('helvetica', 'normal');

      doc.text(`${p.buyingPrice.toLocaleString('pt-MZ')} MT`, 170, currentY + 4, { align: 'right' });
      doc.setFont('helvetica', 'bold');
      doc.text(`${(p.stockQty * p.buyingPrice).toLocaleString('pt-MZ')} MT`, 193, currentY + 4, { align: 'right' });
      doc.setFont('helvetica', 'normal');

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      doc.line(15, currentY + 6, 195, currentY + 6);
      currentY += 6;
    });

    // Totais row in Table
    doc.saveGraphicsState();
    doc.setFillColor(241, 245, 249);
    doc.rect(15, currentY, 180, 7, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.text('TOTAL IMOBILIZADO EM CRÍTICO', 17, currentY + 5);
    doc.setTextColor(190, 18, 60);
    doc.text(`${totalImobilizado.toLocaleString('pt-MZ')} MT`, 193, currentY + 5, { align: 'right' });

    doc.save(title);
    triggerToast('Relatório de Baixo Stock descarregado com sucesso!');
  };

  const handleExportRecentlyAlteredPDF = async () => {
    const title = `Relatorio_Alteracoes_Stock_${Date.now()}.pdf`;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const cName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';
    
    // Fetch audit logs
    const allLogs = await dbService.getAuditLogs();
    // Filter for stock or product actions
    const stockLogs = allLogs.filter(log => 
      log.action.toLowerCase().includes('ajuste') ||
      log.action.toLowerCase().includes('stock') ||
      log.action.toLowerCase().includes('produto') ||
      log.action.toLowerCase().includes('perda') ||
      log.details.toLowerCase().includes('produto') ||
      log.details.toLowerCase().includes('stock')
    ).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(0, 106, 78);
    doc.text('RELATÓRIO DE PRODUTOS ALTERADOS RECENTEMENTE', 15, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`${cName} • NUIT: 401976590`, 15, 25);
    doc.text(`Gerado em: ${new Date().toLocaleString('pt-MZ')}`, 15, 29);

    doc.setDrawColor(0, 106, 78);
    doc.setLineWidth(1);
    doc.line(15, 33, 195, 33);

    // Summary Box
    doc.saveGraphicsState();
    doc.setFillColor(240, 253, 244);
    doc.rect(15, 37, 180, 20, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text('REGISTOS DE ALTERAÇÃO', 20, 43);
    doc.text('SISTEMA ORIGEM', 80, 43);
    doc.text('ÚLTIMA ATIVIDADE REGISTADA', 140, 43);

    doc.setFontSize(11);
    doc.setTextColor(0, 106, 78);
    doc.text(`${stockLogs.length} Alterações`, 20, 51);
    doc.text('Segurança de Stock S.A.', 80, 51);
    doc.setTextColor(51, 65, 85);
    const lastDate = stockLogs[0] ? new Date(stockLogs[0].timestamp).toLocaleDateString('pt-MZ') : 'N/A';
    doc.text(lastDate, 140, 51);

    // Table Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(0, 106, 78);
    doc.text('DETALHAMENTO DE AJUSTES E ALTERAÇÕES RECENTES', 15, 65);

    let currentY = 70;
    doc.saveGraphicsState();
    doc.setFillColor(0, 106, 78);
    doc.rect(15, currentY, 180, 7, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('DATA / HORA', 17, currentY + 5);
    doc.text('UTILIZADOR', 45, currentY + 5);
    doc.text('AÇÃO', 75, currentY + 5);
    doc.text('DETALHES DA ALTERAÇÃO', 110, currentY + 5);

    currentY += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(51, 65, 85);

    stockLogs.slice(0, 30).forEach((log, idx) => {
      if (currentY > 260) {
        doc.addPage();
        currentY = 20;
        doc.saveGraphicsState();
        doc.setFillColor(0, 106, 78);
        doc.rect(15, currentY, 180, 7, 'F');
        doc.restoreGraphicsState();
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        doc.setTextColor(255, 255, 255);
        doc.text('DATA / HORA', 17, currentY + 5);
        doc.text('UTILIZADOR', 45, currentY + 5);
        doc.text('AÇÃO', 75, currentY + 5);
        doc.text('DETALHES DA ALTERAÇÃO', 110, currentY + 5);
        currentY += 7;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(51, 65, 85);
      }

      if (idx % 2 === 1) {
        doc.saveGraphicsState();
        doc.setFillColor(248, 250, 252);
        doc.rect(15, currentY, 180, 6, 'F');
        doc.restoreGraphicsState();
      }

      const formattedDate = new Date(log.timestamp).toLocaleDateString('pt-MZ') + ' ' + new Date(log.timestamp).toLocaleTimeString('pt-MZ', { hour: '2-digit', minute: '2-digit' });
      doc.text(formattedDate, 17, currentY + 4);
      doc.text(log.username, 45, currentY + 4);
      doc.setFont('helvetica', 'bold');
      doc.text(log.action, 75, currentY + 4);
      doc.setFont('helvetica', 'normal');
      
      // Wrap details text nicely
      const wrappedDetails = doc.splitTextToSize(log.details, 80);
      doc.text(wrappedDetails, 110, currentY + 4);

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      const rowHeight = Math.max(6, 4 + wrappedDetails.length * 3);
      doc.line(15, currentY + rowHeight, 195, currentY + rowHeight);
      currentY += rowHeight;
    });

    doc.save(title);
    triggerToast('Relatório de Alterações Recentes descarregado com sucesso!');
  };

  const handleExportGroupedByCategoryPDF = () => {
    const title = `Inventario_Agrupado_Categorias_${Date.now()}.pdf`;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const cName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';
    const cNuit = settings?.companyNuit || '401976590';

    // Group products by category
    const categoryMap: { [cat: string]: Product[] } = {};
    products.forEach(p => {
      const catName = (p.category || 'Sem Categoria').trim();
      if (!categoryMap[catName]) {
        categoryMap[catName] = [];
      }
      categoryMap[catName].push(p);
    });

    const sortedCategories = Object.keys(categoryMap).sort();

    // Overall Totals
    const totalProductsCount = products.length;
    const totalStockUnits = products.reduce((acc, p) => acc + (p.isService ? 0 : p.stockQty), 0);
    const totalCostValue = products.reduce((acc, p) => acc + (p.isService ? 0 : (p.stockQty * p.buyingPrice)), 0);
    const totalSellValue = products.reduce((acc, p) => acc + (p.isService ? 0 : (p.stockQty * p.sellingPrice)), 0);

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(0, 106, 78);
    doc.text('INVENTÁRIO GERAL AGRUPADO POR CATEGORIAS', 15, 18);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100, 116, 139);
    doc.text(`${cName} • NUIT: ${cNuit}`, 15, 23);
    doc.text(`Emissão: ${new Date().toLocaleString('pt-MZ')} • Total de Categorias: ${sortedCategories.length}`, 15, 27);

    doc.setDrawColor(0, 106, 78);
    doc.setLineWidth(1);
    doc.line(15, 30, 195, 30);

    // Summary Box
    doc.saveGraphicsState();
    doc.setFillColor(240, 253, 244);
    doc.rect(15, 33, 180, 18, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 116, 139);
    doc.text('TOTAL ARTIGOS', 20, 38);
    doc.text('UNIDADES EM STOCK', 65, 38);
    doc.text('VALOR TOTAL (CUSTO)', 110, 38);
    doc.text('VALOR TOTAL (VENDA)', 155, 38);

    doc.setFontSize(10);
    doc.setTextColor(0, 106, 78);
    doc.text(`${totalProductsCount} Itens`, 20, 45);
    doc.text(`${totalStockUnits.toLocaleString('pt-MZ')} Unid.`, 65, 45);
    doc.text(`${totalCostValue.toLocaleString('pt-MZ')} MT`, 110, 45);
    doc.text(`${totalSellValue.toLocaleString('pt-MZ')} MT`, 155, 45);

    let currentY = 56;

    sortedCategories.forEach((catName) => {
      const catProducts = categoryMap[catName];
      const catTotalQty = catProducts.reduce((acc, p) => acc + (p.isService ? 0 : p.stockQty), 0);
      const catTotalCost = catProducts.reduce((acc, p) => acc + (p.isService ? 0 : (p.stockQty * p.buyingPrice)), 0);
      const catTotalSell = catProducts.reduce((acc, p) => acc + (p.isService ? 0 : (p.stockQty * p.sellingPrice)), 0);

      // Check page height before category banner
      if (currentY > 250) {
        doc.addPage();
        currentY = 20;
      }

      // Category Section Banner
      doc.saveGraphicsState();
      doc.setFillColor(0, 106, 78);
      doc.rect(15, currentY, 180, 6.5, 'F');
      doc.restoreGraphicsState();

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(255, 255, 255);
      doc.text(`CATEGORIA: ${catName.toUpperCase()} (${catProducts.length} ${catProducts.length === 1 ? 'Produto' : 'Produtos'})`, 18, currentY + 4.5);
      doc.text(`Subtotal Venda: ${catTotalSell.toLocaleString('pt-MZ')} MT`, 192, currentY + 4.5, { align: 'right' });

      currentY += 6.5;

      // Table Column Headers
      doc.saveGraphicsState();
      doc.setFillColor(226, 232, 240);
      doc.rect(15, currentY, 180, 5.5, 'F');
      doc.restoreGraphicsState();

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(51, 65, 85);
      doc.text('#', 17, currentY + 4);
      doc.text('CÓD / SKU', 23, currentY + 4);
      doc.text('NOME DO PRODUTO / SERVIÇO', 52, currentY + 4);
      doc.text('STOCK', 122, currentY + 4, { align: 'right' });
      doc.text('P. CUSTO', 145, currentY + 4, { align: 'right' });
      doc.text('P. VENDA', 168, currentY + 4, { align: 'right' });
      doc.text('TOTAL VENDA', 192, currentY + 4, { align: 'right' });

      currentY += 5.5;

      // Category Rows
      catProducts.forEach((p, idx) => {
        if (currentY > 265) {
          doc.addPage();
          currentY = 20;

          // Repeat Header for category on new page
          doc.saveGraphicsState();
          doc.setFillColor(0, 106, 78);
          doc.rect(15, currentY, 180, 6, 'F');
          doc.restoreGraphicsState();
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8);
          doc.setTextColor(255, 255, 255);
          doc.text(`CATEGORIA: ${catName.toUpperCase()} (Continuação)`, 18, currentY + 4);
          currentY += 6;

          doc.saveGraphicsState();
          doc.setFillColor(226, 232, 240);
          doc.rect(15, currentY, 180, 5.5, 'F');
          doc.restoreGraphicsState();
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7);
          doc.setTextColor(51, 65, 85);
          doc.text('#', 17, currentY + 4);
          doc.text('CÓD / SKU', 23, currentY + 4);
          doc.text('NOME DO PRODUTO / SERVIÇO', 52, currentY + 4);
          doc.text('STOCK', 122, currentY + 4, { align: 'right' });
          doc.text('P. CUSTO', 145, currentY + 4, { align: 'right' });
          doc.text('P. VENDA', 168, currentY + 4, { align: 'right' });
          doc.text('TOTAL VENDA', 192, currentY + 4, { align: 'right' });
          currentY += 5.5;
        }

        if (idx % 2 === 1) {
          doc.saveGraphicsState();
          doc.setFillColor(248, 250, 252);
          doc.rect(15, currentY, 180, 5, 'F');
          doc.restoreGraphicsState();
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(51, 65, 85);

        doc.text((idx + 1).toString(), 17, currentY + 3.5);
        doc.setFont('helvetica', 'bold');
        doc.text(p.code || 'N/A', 23, currentY + 3.5);
        doc.setFont('helvetica', 'normal');

        const truncName = p.name.length > 38 ? p.name.substring(0, 36) + '...' : p.name;
        doc.text(truncName, 52, currentY + 3.5);

        const stockText = p.isService ? 'Serviço' : `${p.stockQty} ${getSingularUnit(p.baseUnit)}`;
        doc.text(stockText, 122, currentY + 3.5, { align: 'right' });

        doc.text(`${p.buyingPrice.toLocaleString('pt-MZ')} MT`, 145, currentY + 3.5, { align: 'right' });
        doc.text(`${p.sellingPrice.toLocaleString('pt-MZ')} MT`, 168, currentY + 3.5, { align: 'right' });

        const itemTotalSell = p.isService ? p.sellingPrice : (p.stockQty * p.sellingPrice);
        doc.setFont('helvetica', 'bold');
        doc.text(`${itemTotalSell.toLocaleString('pt-MZ')} MT`, 192, currentY + 3.5, { align: 'right' });

        doc.setDrawColor(241, 245, 249);
        doc.setLineWidth(0.3);
        doc.line(15, currentY + 5, 195, currentY + 5);
        currentY += 5;
      });

      // Subtotal Category Row
      if (currentY > 265) {
        doc.addPage();
        currentY = 20;
      }

      doc.saveGraphicsState();
      doc.setFillColor(241, 245, 249);
      doc.rect(15, currentY, 180, 5.5, 'F');
      doc.restoreGraphicsState();

      doc.setFont('helvetica', 'bold');
      doc.setFontSize(7);
      doc.setTextColor(15, 23, 42);
      doc.text(`SUBTOTAL CATEGORIA ${catName.toUpperCase()}`, 17, currentY + 3.8);
      doc.text(`${catTotalQty.toLocaleString('pt-MZ')} Unid.`, 122, currentY + 3.8, { align: 'right' });
      doc.text(`${catTotalCost.toLocaleString('pt-MZ')} MT`, 145, currentY + 3.8, { align: 'right' });
      doc.text(`${catTotalSell.toLocaleString('pt-MZ')} MT`, 192, currentY + 3.8, { align: 'right' });

      currentY += 8; // Spacing before next category
    });

    // Grand Total Box at end of report
    if (currentY > 250) {
      doc.addPage();
      currentY = 20;
    }

    doc.saveGraphicsState();
    doc.setFillColor(0, 106, 78);
    doc.rect(15, currentY, 180, 8, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(255, 255, 255);
    doc.text('TOTAL GERAL DO INVENTÁRIO (TODAS AS CATEGORIAS)', 18, currentY + 5.2);
    doc.text(`VALOR TOTAL EM VENDA: ${totalSellValue.toLocaleString('pt-MZ')} MT`, 192, currentY + 5.2, { align: 'right' });

    // Page Numbering Footer
    const totalPages = doc.getNumberOfPages();
    for (let i = 1; i <= totalPages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(148, 163, 184);
      doc.setDrawColor(226, 232, 240);
      doc.line(15, 282, 195, 282);
      doc.text(`${cName} • Documento de Gestão Interna de Inventário por Categoria`, 15, 286);
      doc.text(`Página ${i} de ${totalPages}`, 195, 286, { align: 'right' });
    }

    doc.save(title);
    triggerToast('Inventário agrupado por categorias descarregado em PDF com sucesso!');
  };

  // Exports visual, scan-ready barcodes in a beautiful sticker layout as HTML/PDF
  const handleExportBarcodesPDF = (selectedOnly: boolean) => {
    const productsToExport = selectedOnly 
      ? products.filter(p => selectedProds[p.id])
      : products;

    if (productsToExport.length === 0) {
      triggerToast(selectedOnly ? 'Nenhum produto selecionado. Marque os produtos que deseja descarregar.' : 'Nenhum produto em catálogo.');
      return;
    }

    const title = `ETIQUETAS_CODIGO_BARRAS_${selectedOnly ? 'SELECIONADOS' : 'TODOS'}_${Date.now()}.html`;

    let stickersHtml = '';
    productsToExport.forEach(p => {
      stickersHtml += `
        <div class="sticker">
          <div class="company">AGRO - XICOMO & SERVIÇOS, LDA • NUIT: 401976590</div>
          <div class="prod-name">${p.name}</div>
          <div class="category">${p.category}</div>
          <div class="barcode-container">
            ${getEan13SvgString(p.code, 180, 80)}
          </div>
          <div class="price">Preço: ${p.sellingPrice.toLocaleString()} MT</div>
        </div>
      `;
    });

    const htmlContent = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8" />
        <title>Etiquetas de Código de Barras - AGRO - XICOMO & SERVIÇOS, LDA</title>
        <style>
          @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Libre+Barcode+39&display=swap');
          
          body {
            font-family: 'Inter', sans-serif;
            background-color: #f8fafc;
            margin: 0;
            padding: 24px;
            color: #1e293b;
          }
          
          .no-print-bar {
            background-color: #b91c1c;
            color: white;
            padding: 16px 24px;
            border-radius: 12px;
            margin-bottom: 24px;
            display: flex;
            justify-content: space-between;
            align-items: center;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
          }
          
          .btn-print {
            background-color: white;
            color: #b91c1c;
            border: none;
            padding: 10px 20px;
            font-weight: bold;
            border-radius: 8px;
            cursor: pointer;
            box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
            transition: all 0.2s;
            font-size: 13px;
          }
          .btn-print:hover {
            background-color: #f1f5f9;
            transform: translateY(-1px);
          }

          .grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
            gap: 16px;
          }
          
          .sticker {
            background: white;
            border: 2px dashed #cbd5e1;
            border-radius: 12px;
            padding: 16px;
            text-align: center;
            box-sizing: border-box;
            background-color: #fff;
            page-break-inside: avoid;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            height: 200px;
            box-shadow: 0 1px 3px rgba(0,0,0,0.02);
          }
          
          .company {
            font-size: 8px;
            font-weight: 700;
            text-transform: uppercase;
            color: #b91c1c;
            letter-spacing: 0.5px;
          }
          
          .prod-name {
            font-size: 12px;
            font-weight: 700;
            margin: 6px 0 3px 0;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            text-overflow: ellipsis;
            line-height: 1.25;
            color: #0f172a;
          }
          
          .category {
            font-size: 8px;
            color: #64748b;
            text-transform: uppercase;
            font-weight: 600;
          }
          
          .barcode-container {
            margin: 6px auto;
            display: flex;
            justify-content: center;
            align-items: center;
          }
          
          .price {
            font-size: 12px;
            font-weight: 800;
            color: #b91c1c;
            border-top: 1px solid #f1f5f9;
            margin-top: 8px;
            padding-top: 6px;
          }
          
          @media print {
            .no-print-bar {
              display: none !important;
            }
            body {
              background-color: white;
              padding: 0;
              margin: 0;
            }
            .grid {
              gap: 12px;
            }
            .sticker {
              border: 1.5px dashed #475569;
              box-shadow: none;
            }
          }
        </style>
      </head>
      <body>
        <div class="no-print-bar">
          <div>
            <h2 style="margin: 0; font-size: 18px; font-weight: bold;">Folha de Etiquetas Pronta a Imprimir</h2>
            <p style="margin: 4px 0 0 0; font-size: 12px;">Carregou ${productsToExport.length} etiquetas de código de barras. Pode imprimir diretamente em papel de etiquetas autocolantes A4.</p>
          </div>
          <button class="btn-print" onclick="window.print()">Imprimir / Guardar em PDF</button>
        </div>
        
        <div class="grid">
          ${stickersHtml}
        </div>
        
        <script>
          // Auto-trigger print dialog
          setTimeout(function() {
            window.print();
          }, 600);
        </script>
      </body>
      </html>
    `;

    // Download file as html that triggers auto-print when opened
    const blob = new Blob([htmlContent], { type: 'text/html;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', title);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerToast(`Folha de ${productsToExport.length} Etiquetas Descarregada!`);
  };

  // Direct Inline Adjustment helper with password dialog verification
  const adjustProductStockDirectly = async (product: Product, newQty: number) => {
    if (newQty < 0) {
      triggerToast('A quantidade em stock não pode ser negativa.');
      return;
    }

    const inputPw = (settings?.stockPasswordHash || '05082').trim();
    const pw = prompt(`Introduza a Palavra-passe de Autorização do Stock:`);
    if (!pw || (pw.trim() !== inputPw && pw.trim() !== '05082' && pw.trim() !== '0147')) {
      triggerToast('A palavra-passe de segurança do stock está incorreta ou operação cancelada.');
      return;
    }

    const prevQty = product.stockQty;
    product.stockQty = newQty;
    
    // Auto-reallocate for hybrid products
    if (product.parentUnit && product.conversionRate && product.conversionRate > 1) {
      const rate = product.conversionRate || 1;
      product.stockQtyBulk = Math.floor(newQty / rate);
      product.stockQtyRetail = newQty % rate;
    }

    await dbService.saveProduct(product);

    // Security Audit Log
    void dbService.addAuditLog({
      id: uid('log-'),
      timestamp: new Date().toISOString(),
      username: 'Operador / Técnico',
      ipAddress: '127.0.0.1',
      action: 'Ajuste de Stock Direto',
      status: 'Sucesso',
      details: `Produto: ${product.name} (SKU: ${product.code}). Quantidade de stock alterada de ${prevQty} para ${newQty}. Validação de senha inline efetuada.`
    });

    triggerToast(`Stock ajustado de ${prevQty} para ${newQty} ${product.baseUnit}!`);
    loadInventoryData();
    setInlineEditingProductId(null);
  };

  // Sack requisition flow: moves sacks from wholesale (bulk) to retail stock
  const handleExecuteRequisition = async () => {
    if (isSubmitting) return;
    if (!reqProduct) return;
    setReqError('');

    const currentBulk = reqProduct.stockQtyBulk || 0;
    if (reqQty <= 0) {
      setReqError('A quantidade requisitada deve ser maior que zero.');
      return;
    }
    if (reqQty > currentBulk) {
      setReqError(`Quantidade insuficiente no stock de revenda. Disponível: ${currentBulk} ${reqProduct.parentUnit}`);
      return;
    }

    setIsSubmitting(true);
    try {
      const rate = reqProduct.conversionRate || 1;
      const prevBulk = currentBulk;
      const prevRetail = reqProduct.stockQtyRetail || 0;

      // Deduct sacks from bulk and add to retail
      reqProduct.stockQtyBulk = prevBulk - reqQty;
      reqProduct.stockQtyRetail = prevRetail + (reqQty * rate);
      // Overall stockQty remains the same (just division shifted!)

      await dbService.saveProduct(reqProduct);

      // Audit Log
      void dbService.addAuditLog({
        id: uid('log-'),
        timestamp: new Date().toISOString(),
        username: 'Gestor de Stock',
        ipAddress: '127.0.0.1',
        action: 'Requisição de Saco para Venda a Retalho',
        status: 'Sucesso',
        details: `Produto: ${reqProduct.name}. Requisitado(s) ${reqQty} ${reqProduct.parentUnit}(s). Reduziu revenda de ${prevBulk} para ${reqProduct.stockQtyBulk} e aumentou retalho de ${prevRetail} para ${reqProduct.stockQtyRetail} ${reqProduct.baseUnit}.`
      });

      triggerToast(`Requisição concluída! ${reqQty} ${reqProduct.parentUnit}(s) transferido(s) com sucesso para venda a retalho.`);
      setShowRequisitionModal(false);
      setReqProduct(null);
      setReqQty(1);
      loadInventoryData();
    } catch (err: any) {
      setReqError('Erro ao executar a requisição: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };





  const handleResetOfficialCatalog = async () => {
    if (isSubmitting) return;
    askConfirmation(
      'RESTAURAR INVENTÁRIO OFICIAL',
      'ATENÇÃO: Esta ação irá substituir os produtos atuais pelo catálogo oficial do documento (Químicos, Sementes, Insumos, Fertilizantes e Máquinas) com preços e quantidades exatas. Deseja continuar?',
      async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        let catalogRestored = false;
        try {
          await dbService.resetProductsToInitial();
          catalogRestored = true;
          try {
            await loadInventoryData();
          } catch (refreshError) {
            // The catalogue is already persisted. A later refresh must not
            // turn that completed action into an apparent failure.
            console.warn('Catálogo restaurado, mas a atualização visual falhou:', refreshError);
          }
          triggerToast('Inventário oficial restaurado com sucesso!');
        } catch (err) {
          console.error('Erro ao restaurar catálogo:', err);
          triggerToast(catalogRestored
            ? 'Inventário oficial restaurado. A atualização visual será tentada novamente.'
            : 'Erro ao restaurar catálogo oficial.');
        } finally {
          setIsSubmitting(false);
        }
      }
    );
  };



  // Secure Manual Stock Adjustments (Requires secondary code: "05082")
  const handleAdjustStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setAdjustError('');

    const inputPw = (stockPassword || '').trim();
    const targetPw = (settings?.stockPasswordHash || '05082').trim();
    if (inputPw !== targetPw && inputPw !== '05082' && inputPw !== '0147') {
      setAdjustError('A palavra-passe de segurança do stock está incorreta.');
      return;
    }

    if (!selectedProduct) return;

    const isBulkEnabled = Boolean(editParentUnit && editConversionRate > 1);

    // REGRA DE PREÇOS: nunca gravar sem preço de compra e de venda e o preço de compra
    // tem de ser inferior ao preço de venda (nunca igual). Para produtos vendidos em saco
    // e em quilo, o custo do quilo é derivado do preço de compra do saco.
    const priceError = isBulkEnabled
      ? validateHybridPrices(
          Number(editBuyingPriceBulk),
          Number(editSellingPriceBulk),
          Number(editSellingPrice),
          Number(editConversionRate)
        )
      : validateStandardPrices(Number(editBuyingPrice), Number(editSellingPrice), editIsService);

    if (priceError) {
      setAdjustError(priceError);
      triggerToast(priceError);
      return;
    }

    setIsSubmitting(true);
    try {
      const computedStockQty = isBulkEnabled 
        ? (Number(editStockQtyBulk) * Number(editConversionRate)) + Number(editStockQtyRetail) 
        : Number(editStockQty);

      const prevQty = selectedProduct.stockQty;
      
      const codeToUse = editCode.trim() || selectedProduct.code || generateBarcodeValue();

      // Update all properties
      selectedProduct.name = editName;
      selectedProduct.code = codeToUse;
      selectedProduct.category = editCategory;
      selectedProduct.baseUnit = editBaseUnit;
      selectedProduct.parentUnit = editParentUnit || undefined;
      selectedProduct.conversionRate = editConversionRate > 1 ? Number(editConversionRate) : undefined;
      selectedProduct.stockQty = computedStockQty;
      selectedProduct.stockQtyBulk = isBulkEnabled ? Number(editStockQtyBulk) : undefined;
      selectedProduct.stockQtyRetail = isBulkEnabled ? Number(editStockQtyRetail) : undefined;
      selectedProduct.buyingPriceBulk = isBulkEnabled ? Number(editBuyingPriceBulk) : undefined;
      selectedProduct.buyingPrice = isBulkEnabled
        ? Number(editBuyingPriceBulk) / Number(editConversionRate)
        : Number(editBuyingPrice);
      selectedProduct.sellingPrice = Number(editSellingPrice);
      selectedProduct.sellingPriceBulk = isBulkEnabled ? Number(editSellingPriceBulk) : undefined;
      selectedProduct.expiryDate = editExpiryDate || undefined;
      selectedProduct.reference = editReference || undefined;
      selectedProduct.isService = editIsService;
      selectedProduct.imageUrl = editImageUrl || undefined;

      await dbService.saveProduct(selectedProduct);

      void dbService.addAuditLog({
        id: uid('log-'),
        timestamp: new Date().toISOString(),
        username: 'Operador / Técnico',
        ipAddress: '127.0.0.1',
        action: 'Ajuste Completo de Produto',
        status: 'Sucesso',
        details: `Produto: ${editName} (SKU: ${editCode}). Alteração geral realizada. Qtd anterior: ${prevQty} -> Nova Qtd: ${editStockQty}. Validação por senha bem-sucedida.`
      });

      setShowAdjustModal(false);
      setSelectedProduct(null);
      setStockPassword('');
      setEditReceivedSacks(0);
      setEditSacksForWholesale(0);
      setEditSacksForRetail(0);
      setEditIsService(false);
      triggerToast(`Artigo ${editName} e stock ajustados com sucesso!`);
      loadInventoryData();
    } catch (err) {
      setAdjustError('Erro ao gravar alteração.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Explicit Loss Log Handlers
  const handleRegisterLoss = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!lossProduct || lossQty <= 0 || !lossJustification) {
      triggerToast('Preencha todos os campos do registo de quebra.');
      return;
    }

    if (lossQty > lossProduct.stockQty) {
      triggerToast('A quantidade de quebra excede o stock ativo disponível.');
      return;
    }

    setIsSubmitting(true);
    try {
      const costLost = lossQty * lossProduct.buyingPrice;

      // Deduct stock quantity
      if (typeof (dbService as any).deductProductStock === 'function') {
        await (dbService as any).deductProductStock([{
          productId: lossProduct.id,
          hasConversion: false,
          qtyToReduce: lossQty
        }]);
      } else {
        lossProduct.stockQty = Math.max(0, lossProduct.stockQty - lossQty);
        await dbService.saveProduct(lossProduct);
      }

      // Register loss
      await dbService.addLoss({
        id: uid('loss-'),
        productId: lossProduct.id,
        productName: lossProduct.name,
        quantity: Number(lossQty),
        unit: lossProduct.baseUnit,
        date: new Date().toISOString().split('T')[0],
        reason: lossReason,
        justification: lossJustification,
        costValue: costLost
      });

    // Security Audit Log
    void dbService.addAuditLog({
      id: uid('log-'),
      timestamp: new Date().toISOString(),
      username: 'Operador',
      ipAddress: '127.0.0.1',
      action: 'Registo de Quebra/Perda',
      status: 'Alerta',
      details: `Quebra de ${lossQty} de ${lossProduct.name} devido a ${lossReason}. Valor do prejuízo: ${costLost}MT.`
    });

    setShowLossModal(false);
    setLossProduct(null);
    setLossQty(0);
    setLossJustification('');
    triggerToast('Quebra física registada com sucesso.');
    loadInventoryData();
    } catch (err) {
      console.error(err);
      triggerToast('Erro ao registar quebra.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const getExpiryBadge = (expiryStr?: string) => {
    if (!expiryStr) return null;

    const today = new Date();
    const expDate = new Date(expiryStr);
    const timeDiff = expDate.getTime() - today.getTime();
    const daysDiff = Math.ceil(timeDiff / (1000 * 3600 * 24));

    if (daysDiff <= 0) return <span className="bg-red-200 text-red-900 text-[10px] px-2 py-0.5 rounded font-black">VENCIDO</span>;
    if (daysDiff === 1) return <span className="bg-red-100 text-red-800 text-[10px] px-2 py-0.5 rounded font-bold animate-pulse">Vence em 1 Dia</span>;
    if (daysDiff <= 2) return <span className="bg-red-100 text-red-800 text-[10px] px-2 py-0.5 rounded font-bold">Vence em 2 Dias</span>;
    if (daysDiff <= 7) return <span className="bg-orange-200 text-orange-900 text-[10px] px-2 py-0.5 rounded font-bold">Vence em 7 Dias</span>;
    if (daysDiff <= 15) return <span className="bg-orange-100 text-orange-800 text-[10px] px-2 py-0.5 rounded font-bold">Vence em 15 Dias</span>;
    if (daysDiff <= 30) return <span className="bg-yellow-100 text-yellow-800 text-[10px] px-2 py-0.5 rounded font-bold">Vence em 30 Dias</span>;

    return <span className="bg-green-100 text-green-800 text-[10px] px-2 py-0.5 rounded">{daysDiff} Dias Restantes</span>;
  };

  const filteredProducts = products.filter(p => {
    const q = searchQuery.toLowerCase();
    return (
      p.name.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q) ||
      p.code.toLowerCase().includes(q) ||
      (p.reference && p.reference.toLowerCase().includes(q))
    );
  });
  const inventoryPageSize = 50;
  const totalInventoryPages = Math.max(1, Math.ceil(filteredProducts.length / inventoryPageSize));
  const boundedInventoryPage = Math.min(inventoryPage, totalInventoryPages);
  const visibleInventoryProducts = filteredProducts.slice(
    (boundedInventoryPage - 1) * inventoryPageSize,
    boundedInventoryPage * inventoryPageSize
  );

  useEffect(() => {
    setInventoryPage(1);
  }, [searchQuery]);

  useEffect(() => {
    if (inventoryPage > totalInventoryPages) {
      setInventoryPage(totalInventoryPages);
    }
  }, [inventoryPage, totalInventoryPages]);

  return (
    <div className="space-y-6" id="stock_module">
      {/* Toast global (portal z-[9999]): visível sobre qualquer modal */}
      <Toast message={toastMessage} type={/erro|falha|inválid|não foi/i.test(toastMessage) ? 'error' : 'success'} onDismiss={() => setToastMessage('')} />

      {/* RENDER IN PORTAL (TOP HEADER ACTIONS, SIDE OF DATE) */}
      {typeof document !== 'undefined' && document.getElementById('module-header-actions') && createPortal(
        <div className="flex items-center gap-2 max-w-full overflow-x-auto no-scrollbar py-1">
          
          {/* Substituir pesquisa global pela pesquisa dos produtos em stock */}
          <div className="relative w-28 sm:w-32 md:w-40">
            <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-600 text-[14px] sm:text-[16px]">search</span>
            <input
              id="stock-search-input"
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Pesquisar..."
              className="w-full pl-7 pr-6 py-1 bg-slate-50 border border-emerald-500/30 rounded-xl text-[10px] font-semibold focus:outline-none focus:border-emerald-600 focus:bg-white transition-all shadow-2xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[12px]">close</span>
              </button>
            )}
          </div>

          {/* Os blocos da gestão de stock moved here */}
          <div className="flex items-center gap-1 shrink-0">
            {/* 1. Restaurar Lista Anexo */}
            <button
              onClick={handleResetOfficialCatalog}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-800 hover:bg-emerald-900 text-white rounded-lg text-[10px] font-bold transition-all shadow-xs cursor-pointer shrink-0"
              title="Recarregar a lista oficial de produtos, preços e quantidades em anexo"
            >
              <span className="material-symbols-outlined text-[13px]">inventory_2</span>
              Restaurar Lista
            </button>

            {/* 2. Dropdown de Códigos e Etiquetas */}
            <div className="relative inline-block text-left shrink-0">
              <button
                ref={codesButtonRef}
                onClick={() => {
                  if (!showCodesDropdown && codesButtonRef.current) {
                    const rect = codesButtonRef.current.getBoundingClientRect();
                    setDropdownCoords({
                      top: rect.bottom,
                      left: rect.left,
                    });
                  }
                  setShowCodesDropdown(!showCodesDropdown);
                }}
                className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold transition-all shadow-xs cursor-pointer"
                title="Gerir Códigos de Barras, Referências e Etiquetas"
              >
                <span className="material-symbols-outlined text-[13px]">barcode</span>
                Códigos & Etiquetas
                <span className="material-symbols-outlined text-[10px]">arrow_drop_down</span>
              </button>
              {showCodesDropdown && (
                <>
                  <div 
                    className="fixed inset-0 z-30" 
                    onClick={() => setShowCodesDropdown(false)} 
                  />
                  <div 
                    style={{
                      position: 'fixed',
                      top: dropdownCoords ? `${dropdownCoords.top}px` : 'auto',
                      left: dropdownCoords ? `${dropdownCoords.left}px` : 'auto',
                    }}
                    className="mt-1 w-48 rounded-md shadow-lg bg-white ring-1 ring-black ring-opacity-5 z-40 focus:outline-none text-[10px]"
                  >
                    <div className="py-1" role="menu" aria-orientation="vertical">
                      <div className="px-3 py-1.5 bg-amber-50 text-amber-800 text-[8px] font-black uppercase text-center border-b border-amber-100 flex items-center gap-1 justify-center rounded-t">
                        <span className="material-symbols-outlined text-[12px] text-amber-600">warning</span>
                        Módulo em Testes / Instável
                      </div>
                      <div className="px-3 py-1 text-[8px] font-bold text-gray-400 uppercase tracking-wider mt-1">Códigos de Barras</div>
                      <button
                        type="button"
                        onClick={() => { handleRegenerateBarcodesAll(); setShowCodesDropdown(false); }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center gap-1.5 text-gray-700 font-medium cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[12px] text-red-500">sync</span>
                        Gerar Códs (Todos)
                      </button>
                      <button
                        type="button"
                        onClick={() => { handleRegenerateBarcodesSelected(); setShowCodesDropdown(false); }}
                        disabled={Object.values(selectedProds).filter(Boolean).length === 0}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center gap-1.5 text-gray-700 font-medium disabled:opacity-50 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[12px] text-amber-500">sync_alt</span>
                        Gerar Códs (Sel.)
                      </button>
                      <button
                        type="button"
                        onClick={() => { handleExportBarcodesPDF(false); setShowCodesDropdown(false); }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center gap-1.5 text-gray-700 font-medium cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[12px] text-slate-800">barcode_reader</span>
                        Imprimir Barras (Todos)
                      </button>
                      <button
                        type="button"
                        onClick={() => { handleExportBarcodesPDF(true); setShowCodesDropdown(false); }}
                        disabled={Object.values(selectedProds).filter(Boolean).length === 0}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center gap-1.5 text-gray-700 font-medium disabled:opacity-50 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[12px] text-indigo-600">print</span>
                        Imprimir Barras (Sel.)
                      </button>

                      <div className="border-t border-gray-100 my-1"></div>
                      <div className="px-3 py-1 text-[8px] font-bold text-gray-400 uppercase tracking-wider">Códigos de Referência</div>
                      <button
                        type="button"
                        onClick={() => { handleRegenerateReferencesAll(); setShowCodesDropdown(false); }}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center gap-1.5 text-gray-700 font-medium cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[12px] text-emerald-600">sync</span>
                        Gerar Ref. (Todos)
                      </button>
                      <button
                        type="button"
                        onClick={() => { handleRegenerateReferencesSelected(); setShowCodesDropdown(false); }}
                        disabled={Object.values(selectedProds).filter(Boolean).length === 0}
                        className="w-full text-left px-3 py-1.5 hover:bg-slate-100 flex items-center gap-1.5 text-gray-700 font-medium disabled:opacity-50 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[12px] text-amber-500">sync_alt</span>
                        Gerar Ref. (Sel.)
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* 3. Relatório Baixo Stock */}
            <button
              onClick={handleExportLowStockPDF}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-[10px] font-bold transition-all shadow-xs cursor-pointer shrink-0"
              title="Descarregar relatório em PDF dos produtos com stock crítico ou nulo"
            >
              <span className="material-symbols-outlined text-[13px]">warning</span>
              Baixo Stock
            </button>

            {/* 4. Alterações Recentes */}
            <button
              onClick={handleExportRecentlyAlteredPDF}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[10px] font-bold transition-all shadow-xs cursor-pointer shrink-0"
              title="Descarregar registo de alterações recentes de inventário"
            >
              <span className="material-symbols-outlined text-[13px]">history</span>
              Alterações
            </button>

            {/* 5. Inventário por Categorias (PDF) */}
            <button
              onClick={handleExportGroupedByCategoryPDF}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white rounded-lg text-[10px] font-bold transition-all shadow-xs cursor-pointer shrink-0"
              title="Descarregar inventário completo agrupado por categorias em formato PDF"
            >
              <span className="material-symbols-outlined text-[13px]">category</span>
              Inv. Categorias
            </button>

            {/* 6. Novo Produto */}
            <button
              onClick={() => {
                setNewProdCode(generateBarcodeValue());
                setNewProdReference(generateCategoryReference('Sementes'));
                setNewProdIsService(false);
                setShowAddModal(true);
              }}
              className="flex items-center gap-1 px-2.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white rounded-lg text-[10px] font-black shadow-xs transition-all cursor-pointer hover:scale-[1.01] shrink-0"
            >
              <span className="material-symbols-outlined text-[13px]">add_box</span>
              Novo Produto
            </button>
          </div>
        </div>,
        document.getElementById('module-header-actions')!
      )}

      {/* Stock Sub-Tab Segmented Selector (Parte 4 & Parte 7) */}
      <div className="flex flex-wrap gap-1 bg-slate-100 p-1.5 rounded-2xl border border-slate-200">
        <button
          type="button"
          onClick={() => setStockSubTab('inventory')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            stockSubTab === 'inventory'
              ? 'bg-white text-emerald-800 shadow-sm font-black'
              : 'text-slate-600 hover:bg-white/50 hover:text-slate-900'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">inventory_2</span>
          Inventário de Produtos ({products.length})
        </button>

        <button
          type="button"
          onClick={() => setStockSubTab('transformations')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            stockSubTab === 'transformations'
              ? 'bg-white text-emerald-800 shadow-sm font-black'
              : 'text-slate-600 hover:bg-white/50 hover:text-slate-900'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">call_split</span>
          Transformação & Fracionamento
        </button>

        <button
          type="button"
          onClick={() => setStockSubTab('losses')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            stockSubTab === 'losses'
              ? 'bg-white text-red-700 shadow-sm font-black'
              : 'text-slate-600 hover:bg-white/50 hover:text-slate-900'
          }`}
        >
          <span className="material-symbols-outlined text-[18px] text-red-500">warning</span>
          Quebras & Perdas ({losses.length})
        </button>

        <button
          type="button"
          onClick={() => setStockSubTab('reconciliation')}
          className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer ${
            stockSubTab === 'reconciliation'
              ? 'bg-white text-indigo-700 shadow-sm font-black'
              : 'text-slate-600 hover:bg-white/50 hover:text-slate-900'
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">fact_check</span>
          Reconciliação de Stock
        </button>
      </div>

      {/* --- SUB-TAB 1: INVENTÁRIO GERAL DE PRODUTOS --- */}
      {stockSubTab === 'inventory' && (
      <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="min-w-[1320px] w-full text-left border-collapse">
            <thead className="bg-gray-50 text-gray-600 font-label-md text-[11px] uppercase tracking-wider border-b border-gray-200">
              <tr>
                <th className="pl-3 pr-1 py-3.5 w-8 text-center">
                  <input
                    type="checkbox"
                    checked={visibleInventoryProducts.length > 0 && visibleInventoryProducts.every(p => selectedProds[p.id])}
                    onChange={() => {
                      const allSelected = visibleInventoryProducts.length > 0 && visibleInventoryProducts.every(p => selectedProds[p.id]);
                      const updated = { ...selectedProds };
                      visibleInventoryProducts.forEach(p => {
                        updated[p.id] = !allSelected;
                      });
                      setSelectedProds(updated);
                    }}
                    className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                  />
                </th>
                <th className="px-6 py-3.5 min-w-[280px]">SKU / Produto</th>
                <th className="px-8 py-3.5 min-w-[180px]">Categoria</th>
                <th className="px-8 py-3.5 text-right min-w-[160px]">Preço Venda</th>
                <th className="px-8 py-3.5 text-right font-bold text-slate-700 min-w-[180px]">Stock Grosso</th>
                <th className="px-8 py-3.5 text-right font-bold text-slate-700 min-w-[240px]">Total Venda</th>
                <th className="px-8 py-3.5 min-w-[180px]">Validade Lote</th>
                <th className="px-8 py-3.5 text-right min-w-[180px] w-48">
                  <div className="block text-[9px] font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-md inline-block mb-0.5 text-center whitespace-nowrap leading-none">
                    {filteredProducts.length} {filteredProducts.length === 1 ? 'Prod.' : 'Prods.'} · Pág. {boundedInventoryPage}/{totalInventoryPages}
                  </div>
                  <div className="block font-black">Ações</div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 text-xs">
              {filteredProducts.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center text-gray-400 py-12 italic bg-gray-50">
                    Nenhum produto encontrado correspondente aos critérios de pesquisa.
                  </td>
                </tr>
              ) : (
                visibleInventoryProducts.map(prod => (
                  <tr key={prod.id} className="hover:bg-emerald-50/70 hover:shadow-md hover:z-10 transition-all group border-b border-gray-100">
                    {/* Checkbox */}
                    <td className="pl-3 pr-1 py-4 text-center w-8">
                      <input
                        type="checkbox"
                        checked={!!selectedProds[prod.id]}
                        onChange={() => {
                          setSelectedProds(prev => ({
                            ...prev,
                            [prod.id]: !prev[prod.id]
                          }));
                        }}
                        className="rounded border-gray-300 text-primary focus:ring-primary h-4 w-4 cursor-pointer"
                      />
                    </td>

                    {/* Name & Code */}
                    <td className="px-6 py-4">
                      <div className="font-bold text-gray-800 text-sm">{prod.name}</div>
                      <div className="flex items-center gap-2 mt-1">
                        <div
                          onClick={() => setPreviewBarcodeProduct(prod)}
                          className="text-[10px] text-gray-600 font-mono flex items-center gap-1 bg-gray-100 hover:bg-gray-200 hover:text-primary px-2 py-0.5 rounded border border-gray-200 cursor-pointer transition-all"
                          title="Clique para visualizar o código de barras real"
                        >
                          <span className="material-symbols-outlined text-[11px]">barcode</span>
                          {prod.code}
                        </div>
                        <button
                          onClick={() => handleRegenerateBarcode(prod.id)}
                          className="p-1 text-gray-400 hover:text-red-600 hover:bg-gray-200 rounded transition-all"
                          title="Gerar novo código de barras"
                        >
                          <span className="material-symbols-outlined text-[13px] block">cached</span>
                        </button>
                      </div>
                    </td>

                    {/* Category */}
                    <td className="px-8 py-4">
                      <span className="bg-gray-100 text-gray-700 px-2.5 py-0.5 rounded-full text-[10px] font-semibold">
                        {prod.category}
                      </span>
                    </td>

                    {/* Selling Price */}
                    <td className="px-8 py-4 text-right font-bold font-mono text-slate-800">
                      {prod.sellingPrice.toLocaleString()} MT
                    </td>

                    {/* Quantidade em Sacos Column */}
                    <td className="px-8 py-4 text-right">
                      {prod.isService ? (
                        <span className="text-gray-400 italic font-medium">-</span>
                      ) : prod.parentUnit && prod.conversionRate && prod.conversionRate > 1 ? (
                        <div className="inline-flex items-center gap-1 px-2.5 py-1 bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-lg font-bold font-mono">
                          {prod.stockQtyBulk || 0} {prod.parentUnit}
                        </div>
                      ) : (
                        <span className="text-gray-400 text-[10px] italic">N/A (Não-híbrido)</span>
                      )}
                    </td>

                    {/* Quantidade em Quilos Column */}
                    <td className="px-8 py-4 text-right">
                      {prod.isService ? (
                        <span className="text-gray-400 italic font-medium">Ilimitado</span>
                      ) : (
                        <div className="flex flex-col items-end gap-1">
                          <div className="flex items-center gap-2 justify-end">
                            {prod.stockQty <= 0 ? (
                              <span className="bg-red-50 text-red-600 border border-red-200 rounded px-2.5 py-0.5 font-bold text-[10px] uppercase tracking-wider">
                                Esgotado
                              </span>
                            ) : (
                              <span className="font-bold text-slate-800 text-sm font-mono">
                                {prod.stockQty} {prod.baseUnit}
                              </span>
                            )}
                          </div>

                          {/* Beautiful dynamic unit conversion equivalence if configured, calculated on-the-fly */}
                          {prod.stockQty > 0 && prod.parentUnit && prod.conversionRate && prod.conversionRate > 1 && (
                            <div className="text-[10px] font-bold text-orange-700 bg-orange-50/70 border border-orange-100 px-2 py-0.5 rounded-md flex items-center gap-1 leading-none shadow-xs">
                              <span>Retalho: {prod.stockQtyRetail || 0} {prod.baseUnit}</span>
                            </div>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Expiry Badge */}
                    <td className="px-8 py-4">
                      {prod.expiryDate ? (
                        <div className="space-y-1">
                          <p className="font-mono">{prod.expiryDate}</p>
                          {getExpiryBadge(prod.expiryDate)}
                        </div>
                      ) : (
                        <span className="text-gray-400 italic">Sem expiração</span>
                      )}
                    </td>

                    {/* Actions Column */}
                    <td className="px-8 py-4 text-right w-48">
                      <div className="flex flex-col items-end gap-1.5">
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => {
                              setSelectedProduct(prod);
                              setEditName(prod.name);
                              setEditCode(prod.code);
                              setEditCategory(prod.category);
                              setEditBaseUnit(prod.baseUnit);
                              setEditParentUnit(prod.parentUnit || '');
                              setEditConversionRate(prod.conversionRate || 1);
                              setEditStockQty(prod.stockQty);
                              const initialBulk = prod.stockQtyBulk || 0;
                              const initialConvRate = prod.conversionRate || 1;
                              const initialRetail = prod.stockQtyRetail || 0;
                              const initialSacksForRetail = initialConvRate > 1 ? Math.round(initialRetail / initialConvRate) : 0;
                              setEditStockQtyBulk(initialBulk);
                              setEditStockQtyRetail(initialRetail);
                              setEditSacksForWholesale(initialBulk);
                              setEditSacksForRetail(initialSacksForRetail);
                              setEditReceivedSacks(initialBulk + initialSacksForRetail);
                              setEditBuyingPrice(prod.buyingPrice);
                              setEditBuyingPriceBulk(getBulkCost(prod));
                              setEditSellingPrice(prod.sellingPrice);
                              setEditSellingPriceBulk(prod.sellingPriceBulk || 0);
                              setEditExpiryDate(prod.expiryDate || '');
                              setEditReference(prod.reference || generateRandomReference());
                              setEditIsService(!!prod.isService);
                              setEditImageUrl(prod.imageUrl || '');
                              
                              // Intelligent increment baseline
                              setStockQtyIncrement(0);
                              setSacksIncrement(0);
                              setInitialSacksTotal(initialBulk + initialSacksForRetail);
                              setInitialQtyTotal(prod.stockQty);
                              setInitialBulkSacks(initialBulk);
                              setInitialRetailSacks(initialSacksForRetail);
                              setInitialRetailQty(initialRetail);

                              setShowAdjustModal(true);
                            }}
                            className="px-2 py-0.5 text-[10px] bg-primary-container text-white rounded hover:opacity-95 font-bold cursor-pointer w-[72px] text-center"
                            title="Ajustar e editar artigo"
                          >
                            Ajustar
                          </button>
                          {!prod.isService ? (
                            <button
                              onClick={() => {
                                setLossProduct(prod);
                                setShowLossModal(true);
                              }}
                              className="px-2 py-0.5 text-[10px] bg-red-50 text-red-700 border border-red-200 rounded hover:bg-red-100 font-bold cursor-pointer w-[72px] text-center"
                              title="Registar perda por quebra"
                            >
                              Quebras
                            </button>
                          ) : (
                            <div className="w-[72px]" />
                          )}
                        </div>
                        <div className="flex gap-1.5">
                          {prod.parentUnit && prod.conversionRate && prod.conversionRate > 1 ? (
                            <button
                              onClick={() => {
                                setReqProduct(prod);
                                setReqQty(1);
                                setReqError('');
                                setShowRequisitionModal(true);
                              }}
                              className="px-2 py-0.5 text-[10px] bg-emerald-50 text-emerald-800 border border-emerald-200 rounded hover:bg-emerald-100 font-black cursor-pointer w-[72px] text-center animate-pulse"
                              title={`Requisitar abertura de ${getSingularUnit(prod.parentUnit).toLowerCase()} para empacotamento e venda a retalho`}
                            >
                              Requisitar
                            </button>
                          ) : (
                            <div className="w-[72px]" />
                          )}
                          <button
                            onClick={() => {
                              setDeleteProductTarget(prod);
                              setDeletePassword('');
                              setDeleteError('');
                              setShowDeleteModal(true);
                            }}
                            className="px-2 py-0.5 text-[10px] bg-red-600 hover:bg-red-700 text-white rounded font-bold cursor-pointer w-[72px] text-center"
                            title="Eliminar produto (requer senha de gestor)"
                          >
                            Eliminar
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        {filteredProducts.length > 0 && (
          <div className="border-t border-slate-100 bg-slate-50 px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3">
            <p className="text-[10px] text-slate-500 text-center sm:text-left">
              A mostrar {visibleInventoryProducts.length} de {filteredProducts.length} produto(s). A seleção geral aplica-se apenas à página visível.
            </p>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setInventoryPage(page => Math.max(1, page - 1))}
                disabled={boundedInventoryPage <= 1}
                className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                Anterior
              </button>
              <span className="text-[10px] font-black text-slate-500 min-w-16 text-center">Página {boundedInventoryPage} / {totalInventoryPages}</span>
              <button
                type="button"
                onClick={() => setInventoryPage(page => Math.min(totalInventoryPages, page + 1))}
                disabled={boundedInventoryPage >= totalInventoryPages}
                className="px-3 py-1.5 text-[11px] font-bold rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100 disabled:opacity-45 disabled:cursor-not-allowed"
              >
                Seguinte
              </button>
            </div>
          </div>
        )}
      </div>
      )}

      {/* --- SUB-TAB 2: TRANSFORMAÇÃO & FRACIONAMENTO DE PRODUTOS (PARTE 4) --- */}
      {stockSubTab === 'transformations' && (
        <TransformationView
          products={products}
          currentUser={currentUser || { username: 'Gestor', role: 'Gestor de Stock' }}
          settings={settings}
          onOpenNewModal={() => setShowTransformationModal(true)}
        />
      )}

      {/* --- SUB-TAB 3: QUEBRAS & PERDAS REGISTADAS COM FILTRO DE PERÍODO --- */}
      {stockSubTab === 'losses' && (
        <div className="space-y-6">
          {/* Date Range Filter for Losses */}
          <DateRangeFilter
            title="Período de Análise de Quebras & Perdas"
            startDate={lossesStartDate}
            endDate={lossesEndDate}
            preset={lossesPreset}
            onRangeChange={(start, end, preset) => {
              setLossesStartDate(start);
              setLossesEndDate(end);
              setLossesPreset(preset);
            }}
            onExportPDF={() => {
              const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
              const cName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';
              const nuit = settings?.companyNuit || '401976590';
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(14);
              doc.setTextColor(185, 28, 28);
              doc.text('MAPA DE QUEBRAS E PERDAS DE STOCK', 15, 20);
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(9);
              doc.setTextColor(100, 116, 139);
              doc.text(`${cName} • NUIT: ${nuit}`, 15, 25);
              doc.text(`Período: ${formatDatePT(lossesStartDate)} até ${formatDatePT(lossesEndDate)}`, 15, 29);
              doc.setDrawColor(185, 28, 28);
              doc.line(15, 33, 195, 33);
              let y = 45;
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(8);
              doc.text('DATA', 15, y);
              doc.text('PRODUTO', 45, y);
              doc.text('QTD', 110, y);
              doc.text('MOTIVO', 130, y);
              doc.text('PREJUÍZO (MT)', 165, y);
              y += 6;
              doc.setFont('helvetica', 'normal');
              const filtered = losses.filter(l => isDateInRange(l.date, lossesStartDate, lossesEndDate));
              filtered.forEach(loss => {
                if (y > 275) { doc.addPage(); y = 20; }
                doc.text(formatDatePT(loss.date), 15, y);
                doc.text((loss.productName || '').substring(0, 30), 45, y);
                doc.text(`${loss.quantity} ${loss.unit}`, 110, y);
                doc.text((loss.reason || '').substring(0, 15), 130, y);
                doc.text(`${(loss.costValue || 0).toLocaleString()} MT`, 165, y);
                y += 6;
              });
              doc.save(`Mapa_Quebras_${lossesStartDate}_${lossesEndDate}.pdf`);
              setToastMessage('Relatório PDF de Quebras gerado com sucesso!');
            }}
            onExportExcel={() => {
              const filtered = losses.filter(l => isDateInRange(l.date, lossesStartDate, lossesEndDate));
              const data = filtered.map(l => ({
                'Data': formatDatePT(l.date),
                'Produto': l.productName,
                'Quantidade': `${l.quantity} ${l.unit}`,
                'Motivo': l.reason,
                'Prejuízo (MT)': l.costValue,
                'Justificação': l.justification || ''
              }));
              const ws = XLSX.utils.json_to_sheet(data);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'Quebras_Perdas');
              XLSX.writeFile(wb, `Quebras_Stock_${lossesStartDate}_a_${lossesEndDate}.xlsx`);
              setToastMessage('Planilha Excel de Quebras descarregada com sucesso!');
            }}
          />

          {/* Loss Summary Bento Cards */}
          {(() => {
            const filtered = losses.filter(l => isDateInRange(l.date, lossesStartDate, lossesEndDate));
            const totalQty = filtered.reduce((s, l) => s + (l.quantity || 0), 0);
            const totalVal = filtered.reduce((s, l) => s + (l.costValue || 0), 0);
            return (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white p-5 border border-slate-200 rounded-2xl shadow-sm space-y-1">
                  <span className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Registo de Ocorrências</span>
                  <p className="text-2xl font-black text-slate-900 font-mono mt-1">{filtered.length}</p>
                  <p className="text-[10px] text-slate-400">Total de quebras no período</p>
                </div>
                <div className="bg-white p-5 border border-amber-200 rounded-2xl shadow-sm space-y-1">
                  <span className="text-[10px] uppercase font-black text-amber-800 tracking-wider">Artigos Perdidos</span>
                  <p className="text-2xl font-black text-amber-900 font-mono mt-1">{totalQty.toLocaleString()} unid.</p>
                  <p className="text-[10px] text-amber-700">Volume físico deduzido</p>
                </div>
                <div className="bg-white p-5 border border-red-200 rounded-2xl shadow-sm space-y-1">
                  <span className="text-[10px] uppercase font-black text-red-800 tracking-wider">Prejuízo Financeiro Total</span>
                  <p className="text-2xl font-black text-red-900 font-mono mt-1">{totalVal.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT</p>
                  <p className="text-[10px] text-red-700">Valor de custo das perdas</p>
                </div>
              </div>
            );
          })()}

          {/* Losses and Damages historic list */}
          <div className="bg-white border border-gray-200 rounded-2xl shadow-sm p-6 space-y-4">
            <div>
              <h4 className="font-headline-md text-headline-md text-gray-800 font-bold">Histórico de Quebras e Perdas de Stock</h4>
              <p className="text-xs text-gray-500">
                Registo obrigatório e justificado de perdas comerciais e físicas para efeitos de dedução fiscal.
              </p>
            </div>

            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                  <tr>
                    <th className="p-3">Data</th>
                    <th className="p-3">Produto</th>
                    <th className="p-3">Quantidade Perdida</th>
                    <th className="p-3">Motivo</th>
                    <th className="p-3">Prejuízo (MT)</th>
                    <th className="p-3">Justificação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(() => {
                    const filtered = losses.filter(l => isDateInRange(l.date, lossesStartDate, lossesEndDate));
                    if (filtered.length === 0) {
                      return (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-gray-400 italic">
                            Nenhum registo de quebra ativo no período selecionado.
                          </td>
                        </tr>
                      );
                    }
                    return filtered.map(loss => (
                      <tr key={loss.id} className="hover:bg-red-50/70 hover:shadow-md transition-all border-b border-gray-100">
                        <td className="p-3 font-mono text-[11px]">{formatDatePT(loss.date)}</td>
                        <td className="p-3 font-bold text-gray-800">{loss.productName}</td>
                        <td className="p-3 font-semibold">{loss.quantity} {loss.unit}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            loss.reason === 'Fora de Prazo' ? 'bg-red-100 text-red-800' : 'bg-orange-100 text-orange-800'
                          }`}>
                            {loss.reason}
                          </span>
                        </td>
                        <td className="p-3 font-mono font-bold text-red-600">{(loss.costValue || 0).toLocaleString()} MT</td>
                        <td className="p-3 text-gray-500 italic truncate max-w-xs" title={loss.justification}>
                          {loss.justification}
                        </td>
                      </tr>
                    ));
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* --- SUB-TAB 4: CONTAGEM FÍSICA E RECONCILIAÇÃO DE STOCK (PARTE 7 ENHANCED) --- */}
      {stockSubTab === 'reconciliation' && (() => {
        // Compute live physical vs system metrics
        const totalProducts = products.length;
        const totalSystemVal = products.reduce((acc, p) => acc + ((p.stockQty || 0) * (p.buyPrice || 0)), 0);
        const totalPhysicalVal = products.reduce((acc, p) => {
          const physQty = physicalCounts[p.id] !== undefined ? physicalCounts[p.id] : (p.stockQty || 0);
          return acc + (physQty * (p.buyPrice || 0));
        }, 0);
        const totalFinancialDiff = totalPhysicalVal - totalSystemVal;
        
        const auditedItems = products.map(p => {
          const systemQty = p.stockQty || 0;
          const physicalQty = physicalCounts[p.id] !== undefined ? physicalCounts[p.id] : systemQty;
          const buyPrice = p.buyPrice || 0;
          const sellPrice = p.sellPrice || 0;
          const systemValue = systemQty * buyPrice;
          const physicalValue = physicalQty * buyPrice;
          const qtyDiff = physicalQty - systemQty;
          const financialDiff = qtyDiff * buyPrice;
          const isAligned = qtyDiff === 0;

          return {
            productId: p.id,
            productName: p.name,
            code: p.code || '',
            category: p.category || '',
            unit: p.baseUnit || 'Unidades',
            buyPrice,
            sellPrice,
            systemQty,
            systemValue,
            physicalQty,
            physicalValue,
            qtyDiff,
            financialDiff,
            isAligned
          };
        });

        const discrepanciesCount = auditedItems.filter(i => !i.isAligned).length;
        const alignedCount = totalProducts - discrepanciesCount;

        const filteredAudited = auditedItems.filter(item => {
          if (reconciliationFilter === 'discrepancies' && item.isAligned) return false;
          if (reconciliationFilter === 'synced' && !item.isAligned) return false;
          if (reconciliationSearch.trim()) {
            const q = reconciliationSearch.toLowerCase();
            return (
              item.productName.toLowerCase().includes(q) ||
              item.code.toLowerCase().includes(q) ||
              item.category.toLowerCase().includes(q)
            );
          }
          return true;
        });

        return (
          <div className="space-y-6 animate-fade-in">
            {/* Header & Control Bar */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-4">
              <div>
                <h4 className="text-lg font-black text-slate-900 flex items-center gap-2">
                  <span className="material-symbols-outlined text-indigo-700">fact_check</span>
                  Contagem Física de Inventário & Reconciliação
                </h4>
                <p className="text-xs text-slate-500 mt-1 max-w-3xl">
                  Introduza as quantidades físicas reais contadas nas prateleiras ou armazém. O sistema calcula instantaneamente o valor monetário físico, as sobras, faltas e o desvio financeiro total em relação à base de dados.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    const preset: Record<string, number> = {};
                    products.forEach(p => {
                      preset[p.id] = p.stockQty || 0;
                    });
                    setPhysicalCounts(preset);
                    setToastMessage('Saldos do sistema copiados para a contagem física!');
                  }}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Preenche todas as contagens com as quantidades atuais do sistema"
                >
                  <span className="material-symbols-outlined text-[16px]">content_copy</span>
                  Copiar Saldos do Sistema
                </button>

                <button
                  type="button"
                  onClick={() => {
                    const reset: Record<string, number> = {};
                    products.forEach(p => {
                      reset[p.id] = 0;
                    });
                    setPhysicalCounts(reset);
                    setToastMessage('Campos de contagem física zerados!');
                  }}
                  className="px-3 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 transition-colors cursor-pointer"
                  title="Zera todas as quantidades para nova contagem cega"
                >
                  <span className="material-symbols-outlined text-[16px]">restart_alt</span>
                  Zerar Contagens
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setApplyPassword('');
                    setApplyError('');
                    setShowApplyPhysicalModal(true);
                  }}
                  className="px-4 py-2 bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-md transition-all cursor-pointer hover:scale-[1.01]"
                >
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  Aplicar Ajustes ao Inventário
                </button>
              </div>
            </div>

            {/* 4 Financial & Inventory Summary Bento Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Card 1: Total Artigos */}
              <div className="bg-white p-5 border border-slate-200 rounded-2xl shadow-sm space-y-1">
                <span className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Artigos no Catálogo</span>
                <p className="text-2xl font-black text-slate-900 font-mono mt-1">{totalProducts}</p>
                <p className="text-[10px] text-slate-400">
                  {alignedCount} alinhados • {discrepanciesCount} com divergência
                </p>
              </div>

              {/* Card 2: Valor Sistema */}
              <div className="bg-white p-5 border border-slate-200 rounded-2xl shadow-sm space-y-1">
                <span className="text-[10px] uppercase font-black text-slate-500 tracking-wider">Valor em Sistema (Custo)</span>
                <p className="text-2xl font-black text-slate-900 font-mono mt-1">
                  {totalSystemVal.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT
                </p>
                <p className="text-[10px] text-slate-400">Património registado em base de dados</p>
              </div>

              {/* Card 3: Valor Físico Contado */}
              <div className="bg-white p-5 border border-indigo-200 rounded-2xl shadow-sm space-y-1">
                <span className="text-[10px] uppercase font-black text-indigo-700 tracking-wider">Valor Físico Real (Custo)</span>
                <p className="text-2xl font-black text-indigo-900 font-mono mt-1">
                  {totalPhysicalVal.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT
                </p>
                <p className="text-[10px] text-indigo-600">Património físico apurado na contagem</p>
              </div>

              {/* Card 4: Desvio Financeiro */}
              <div className={`p-5 border rounded-2xl shadow-sm space-y-1 ${
                totalFinancialDiff === 0 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : totalFinancialDiff < 0 
                    ? 'bg-red-50 border-red-200 text-red-950'
                    : 'bg-blue-50 border-blue-200 text-blue-950'
              }`}>
                <span className="text-[10px] uppercase font-black tracking-wider">
                  Desvio Financeiro Global
                </span>
                <p className="text-2xl font-black font-mono mt-1">
                  {totalFinancialDiff > 0 ? `+${totalFinancialDiff.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : totalFinancialDiff.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT
                </p>
                <p className="text-[10px] font-bold">
                  {totalFinancialDiff === 0 
                    ? '100% ALINHADO / SEM DESVIO ✓'
                    : totalFinancialDiff < 0 
                      ? `QUEBRA TOTAL: ${Math.abs(totalFinancialDiff).toLocaleString()} MT`
                      : `SOBRA TOTAL: +${totalFinancialDiff.toLocaleString()} MT`}
                </p>
              </div>
            </div>

            {/* Main Interactive Inventory Count Table */}
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-150 pb-3">
                <div>
                  <h4 className="font-black text-slate-900 text-sm uppercase tracking-tight">
                    Tabela de Contagem Física & Comparação de Saldos
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Altere os campos da coluna <strong>"Qtd Física Contada"</strong> para calcular as divergências e o valor financeiro em tempo real.
                  </p>
                </div>

                {/* Export Buttons */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      const data = auditedItems.map(i => ({
                        'Produto': i.productName,
                        'Código/SKU': i.code,
                        'Categoria': i.category,
                        'Preço Custo (MT)': i.buyPrice,
                        'Preço Venda (MT)': i.sellPrice,
                        'Stock Sistema': i.systemQty,
                        'Valor Sistema (MT)': i.systemValue,
                        'Stock Físico Contado': i.physicalQty,
                        'Valor Físico (MT)': i.physicalValue,
                        'Divergência Qtd': i.qtyDiff,
                        'Impacto Financeiro (MT)': i.financialDiff,
                        'Estado': i.isAligned ? 'Alinhado' : (i.qtyDiff > 0 ? `Sobra (+${i.qtyDiff})` : `Quebra (${i.qtyDiff})`)
                      }));
                      const ws = XLSX.utils.json_to_sheet(data);
                      const wb = XLSX.utils.book_new();
                      XLSX.utils.book_append_sheet(wb, ws, 'Contagem_Fisica_Stock');
                      XLSX.writeFile(wb, `Contagem_Fisica_Inventario_${new Date().toISOString().split('T')[0]}.xlsx`);
                      setToastMessage('Planilha de Contagem Física exportada com sucesso!');
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">table_view</span>
                    Excel
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
                      const cName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';
                      const nuit = settings?.companyNuit || '401976590';
                      doc.setFont('helvetica', 'bold');
                      doc.setFontSize(14);
                      doc.setTextColor(67, 56, 202);
                      doc.text('MAPA OFICIAL DE CONTAGEM FÍSICA E RECONCILIAÇÃO DE INVENTÁRIO', 15, 18);
                      doc.setFont('helvetica', 'normal');
                      doc.setFontSize(9);
                      doc.setTextColor(100, 116, 139);
                      doc.text(`${cName} • NUIT: ${nuit} • Data de Emissão: ${new Date().toLocaleString('pt-MZ')}`, 15, 24);
                      doc.text(`Valor Sistema: ${totalSystemVal.toLocaleString()} MT | Valor Físico: ${totalPhysicalVal.toLocaleString()} MT | Desvio: ${totalFinancialDiff.toLocaleString()} MT`, 15, 29);

                      doc.setDrawColor(67, 56, 202);
                      doc.line(15, 33, 282, 33);

                      let y = 41;
                      doc.setFont('helvetica', 'bold');
                      doc.setFontSize(8);
                      doc.text('PRODUTO / SKU', 15, y);
                      doc.text('P. CUSTO', 85, y);
                      doc.text('STK SISTEMA', 115, y);
                      doc.text('VAL SISTEMA', 145, y);
                      doc.text('STK FÍSICO', 178, y);
                      doc.text('VAL FÍSICO', 208, y);
                      doc.text('DESVIO (MT)', 240, y);
                      doc.text('ESTADO', 265, y);

                      y += 6;
                      doc.setFont('helvetica', 'normal');
                      auditedItems.forEach(i => {
                        if (y > 190) { doc.addPage(); y = 20; }
                        doc.text(i.productName.substring(0, 35), 15, y);
                        doc.text(`${i.buyPrice.toLocaleString()} MT`, 85, y);
                        doc.text(String(i.systemQty), 115, y);
                        doc.text(`${i.systemValue.toLocaleString()} MT`, 145, y);
                        doc.text(String(i.physicalQty), 178, y);
                        doc.text(`${i.physicalValue.toLocaleString()} MT`, 208, y);
                        doc.text(`${i.financialDiff > 0 ? `+${i.financialDiff.toLocaleString()}` : i.financialDiff.toLocaleString()} MT`, 240, y);
                        doc.text(i.isAligned ? '100% OK' : (i.qtyDiff > 0 ? `+${i.qtyDiff}` : String(i.qtyDiff)), 265, y);
                        y += 6;
                      });

                      doc.save(`Mapa_Contagem_Fisica_${new Date().toISOString().split('T')[0]}.pdf`);
                      setToastMessage('Relatório PDF de Contagem Física gerado!');
                    }}
                    className="px-3 py-1.5 bg-indigo-700 hover:bg-indigo-800 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
                  >
                    <span className="material-symbols-outlined text-[16px]">picture_as_pdf</span>
                    PDF
                  </button>
                </div>
              </div>

              {/* Search & Filter pills */}
              <div className="flex flex-col sm:flex-row items-center gap-2">
                <div className="relative flex-1 w-full">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-[18px]">search</span>
                  <input
                    type="text"
                    value={reconciliationSearch}
                    onChange={(e) => setReconciliationSearch(e.target.value)}
                    placeholder="Pesquisar por nome do produto, SKU ou categoria..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:bg-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div className="flex gap-1 bg-slate-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setReconciliationFilter('all')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      reconciliationFilter === 'all' ? 'bg-white text-indigo-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Todos ({totalProducts})
                  </button>
                  <button
                    type="button"
                    onClick={() => setReconciliationFilter('discrepancies')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      reconciliationFilter === 'discrepancies' ? 'bg-red-600 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Divergências ({discrepanciesCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setReconciliationFilter('synced')}
                    className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                      reconciliationFilter === 'synced' ? 'bg-emerald-700 text-white shadow-xs' : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    Alinhados ({alignedCount})
                  </button>
                </div>
              </div>

              {/* Table Data */}
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-700 font-black border-b border-slate-200 text-[10px] uppercase">
                      <th className="p-3">Artigo / Código</th>
                      <th className="p-3 text-right">P. Custo Unit.</th>
                      <th className="p-3 text-right">Stock Sistema (BD)</th>
                      <th className="p-3 text-right">Valor Sistema</th>
                      <th className="p-3 text-center w-44">Qtd Física Contada</th>
                      <th className="p-3 text-right">Valor Físico</th>
                      <th className="p-3 text-right">Diferença Qtd</th>
                      <th className="p-3 text-right">Impacto Fin. (MT)</th>
                      <th className="p-3 text-center">Estado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-150">
                    {filteredAudited.length === 0 ? (
                      <tr>
                        <td colSpan={9} className="p-8 text-center text-slate-400 italic">
                          Nenhum artigo encontrado com os critérios de pesquisa.
                        </td>
                      </tr>
                    ) : (
                      filteredAudited.map(item => {
                        const currentPhysical = physicalCounts[item.productId] !== undefined ? physicalCounts[item.productId] : item.systemQty;

                        return (
                          <tr key={item.productId} className="hover:bg-indigo-50/40 transition-colors">
                            {/* Product & SKU */}
                            <td className="p-3">
                              <p className="font-bold text-slate-900">{item.productName}</p>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] font-mono text-slate-400">{item.code || 'S/REF'}</span>
                                <span className="text-[9px] bg-slate-100 text-slate-600 px-1.5 py-0.2 rounded font-semibold">
                                  {item.category}
                                </span>
                              </div>
                            </td>

                            {/* Buy Price */}
                            <td className="p-3 text-right font-mono font-bold text-slate-700">
                              {item.buyPrice.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
                            </td>

                            {/* System Stock */}
                            <td className="p-3 text-right font-mono font-bold text-slate-900">
                              {item.systemQty} {item.unit}
                            </td>

                            {/* System Value */}
                            <td className="p-3 text-right font-mono font-black text-slate-800">
                              {item.systemValue.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
                            </td>

                            {/* Physical Count Interactive Input */}
                            <td className="p-2 text-center">
                              <div className="inline-flex items-center gap-1 bg-white border border-indigo-200 rounded-xl p-1 shadow-xs">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextVal = Math.max(0, currentPhysical - 1);
                                    setPhysicalCounts(prev => ({ ...prev, [item.productId]: nextVal }));
                                  }}
                                  className="w-6 h-6 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold flex items-center justify-center cursor-pointer text-xs"
                                >
                                  -
                                </button>
                                <input
                                  type="number"
                                  min="0"
                                  value={currentPhysical}
                                  onChange={(e) => {
                                    const val = Math.max(0, parseInt(e.target.value, 10) || 0);
                                    setPhysicalCounts(prev => ({ ...prev, [item.productId]: val }));
                                  }}
                                  className="w-16 text-center font-mono font-black text-xs text-indigo-950 focus:outline-none"
                                />
                                <button
                                  type="button"
                                  onClick={() => {
                                    const nextVal = currentPhysical + 1;
                                    setPhysicalCounts(prev => ({ ...prev, [item.productId]: nextVal }));
                                  }}
                                  className="w-6 h-6 rounded-lg bg-indigo-100 hover:bg-indigo-200 text-indigo-800 font-bold flex items-center justify-center cursor-pointer text-xs"
                                >
                                  +
                                </button>
                              </div>
                            </td>

                            {/* Physical Value */}
                            <td className="p-3 text-right font-mono font-black text-indigo-950">
                              {item.physicalValue.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT
                            </td>

                            {/* Qty Diff */}
                            <td className="p-3 text-right font-mono font-black">
                              {item.qtyDiff === 0 ? (
                                <span className="text-slate-400">0</span>
                              ) : item.qtyDiff > 0 ? (
                                <span className="text-blue-700">+{item.qtyDiff}</span>
                              ) : (
                                <span className="text-red-700">{item.qtyDiff}</span>
                              )}
                            </td>

                            {/* Financial Diff */}
                            <td className="p-3 text-right font-mono font-black">
                              {item.financialDiff === 0 ? (
                                <span className="text-slate-400">0.00 MT</span>
                              ) : item.financialDiff > 0 ? (
                                <span className="text-blue-700 font-black">+{item.financialDiff.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT</span>
                              ) : (
                                <span className="text-red-700 font-black">{item.financialDiff.toLocaleString('pt-PT', { minimumFractionDigits: 2 })} MT</span>
                              )}
                            </td>

                            {/* Status */}
                            <td className="p-3 text-center">
                              {item.isAligned ? (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-emerald-100 text-emerald-800">
                                  ✓ Alinhado
                                </span>
                              ) : item.qtyDiff > 0 ? (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-blue-100 text-blue-900">
                                  +{item.qtyDiff} Sobra
                                </span>
                              ) : (
                                <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase bg-red-100 text-red-900">
                                  {item.qtyDiff} Falta
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* --- Modal for Applying Physical Stock Adjustment (Requires Manager Code) --- */}
            {showApplyPhysicalModal && (
              <div className="fixed inset-0 bg-black/60 z-50 p-4 flex items-center justify-center backdrop-blur-xs">
                <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200 animate-in fade-in zoom-in-95">
                  <div className="bg-indigo-800 p-4 text-white font-bold flex justify-between items-center">
                    <span className="flex items-center gap-2">
                      <span className="material-symbols-outlined">verified_user</span>
                      Confirmar Ajuste Físico de Inventário
                    </span>
                    <button onClick={() => setShowApplyPhysicalModal(false)} className="text-white hover:opacity-80">
                      <span className="material-symbols-outlined">close</span>
                    </button>
                  </div>

                  <form onSubmit={handleApplyPhysicalInventory} className="p-6 space-y-4">
                    <div className="bg-indigo-50 border border-indigo-200 text-indigo-900 p-3.5 rounded-xl text-xs space-y-1.5">
                      <p className="font-bold flex items-center gap-1 text-sm text-indigo-950">
                        <span className="material-symbols-outlined text-[18px]">info</span>
                        Resumo da Operação de Reconciliação
                      </p>
                      <p>
                        Artigos com divergência: <strong>{discrepanciesCount} produtos</strong>.
                      </p>
                      <p>
                        Impacto financeiro apurado: <strong className={totalFinancialDiff < 0 ? 'text-red-700' : 'text-emerald-700'}>
                          {totalFinancialDiff > 0 ? `+${totalFinancialDiff.toLocaleString()}` : totalFinancialDiff.toLocaleString()} MT
                        </strong>.
                      </p>
                      <p className="text-[11px] text-indigo-700">
                        Os artigos com falta de stock física gerarão automaticamente registos no histórico de quebras/perdas para dedução fiscal.
                      </p>
                    </div>

                    {applyError && (
                      <div className="bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">error</span>
                        {applyError}
                      </div>
                    )}

                    <div>
                      <label className="block text-xs font-black uppercase text-slate-700 mb-1">
                        Senha de Autorização de Gestor <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="password"
                        value={applyPassword}
                        onChange={(e) => setApplyPassword(e.target.value)}
                        placeholder="Digite a palavra-passe do gestor (ex: 05082)..."
                        className="w-full border border-slate-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-600 focus:ring-1 focus:ring-indigo-600"
                        required
                        autoFocus
                      />
                      <p className="text-[11px] text-slate-500 mt-1">
                        Insira a senha de validação de gestor (código: 05082 ou 0147) para autorizar a sincronização definitiva.
                      </p>
                    </div>

                    <div className="flex gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => setShowApplyPhysicalModal(false)}
                        className="flex-1 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl text-xs cursor-pointer"
                      >
                        Cancelar
                      </button>
                      <button
                        type="submit"
                        disabled={isApplyingAdjustment}
                        className="flex-1 py-2.5 bg-indigo-700 hover:bg-indigo-800 text-white font-bold rounded-xl text-xs flex items-center justify-center gap-1 shadow-md cursor-pointer disabled:opacity-50"
                      >
                        {isApplyingAdjustment ? 'A Processar...' : 'Confirmar e Sincronizar'}
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {/* --- Transformation Modal Component (Parte 4) --- */}
      <TransformationModal
        isOpen={showTransformationModal}
        onClose={() => setShowTransformationModal(false)}
        products={products}
        currentUser={currentUser || { username: 'Gestor', role: 'Gestor de Stock' }}
        settings={settings}
        onTransformationComplete={async () => {
          const prods = await dbService.getProducts();
          setProducts(prods);
          setShowTransformationModal(false);
          setToastMessage('Transformação concluída e stock atualizado!');
        }}
      />

      {/* --- Delete Product Confirmation Modal --- */}
      {showDeleteModal && deleteProductTarget && (
        <div className="fixed inset-0 bg-black/60 z-50 p-4 flex items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-gray-200">
            <div className="bg-red-700 p-4 text-white font-bold flex justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined">delete_forever</span>
                Eliminar Produto do Stock
              </span>
              <button onClick={() => setShowDeleteModal(false)} className="text-white hover:opacity-80">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleConfirmDeleteProduct} className="p-6 space-y-4">
              <div className="bg-red-50 border border-red-200 text-red-800 p-3 rounded text-xs space-y-1">
                <p className="font-bold flex items-center gap-1 text-sm">
                  <span className="material-symbols-outlined text-[18px]">warning</span>
                  Atenção: Eliminação Definitiva
                </p>
                <p>
                  Está a tentar eliminar o produto <strong>{deleteProductTarget.name}</strong> (Código: {deleteProductTarget.code || deleteProductTarget.id}).
                </p>
                <p className="text-[11px] text-red-600">
                  Esta ação removerá o artigo do catálogo e não poderá ser desfeita.
                </p>
              </div>

              {deleteError && (
                <div className="bg-red-100 border border-red-300 text-red-700 px-3 py-2 rounded text-xs font-bold flex items-center gap-1">
                  <span className="material-symbols-outlined text-[16px]">error</span>
                  {deleteError}
                </div>
              )}

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Senha de Gestor de Stock <span className="text-red-500">*</span>
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  placeholder="Digite a palavra-passe do gestor..."
                  className="w-full border border-gray-300 rounded px-3 py-2.5 text-sm focus:outline-none focus:border-red-600 focus:ring-1 focus:ring-red-600"
                  required
                  autoFocus
                />
                <p className="text-[11px] text-gray-500 mt-1">
                  Insira a senha de validação de gestor (ex: 05082) para autorizar a remoção.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded text-xs"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-red-700 hover:bg-red-800 text-white font-bold rounded text-xs flex items-center justify-center gap-1 shadow-sm"
                >
                  <span className="material-symbols-outlined text-[16px]">delete</span>
                  Confirmar Eliminação
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- Add Product Modal --- */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/60 z-50 overflow-y-auto p-2 sm:p-4 flex min-h-full items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[92vh] my-auto flex flex-col overflow-hidden border border-gray-200">
            <div className="bg-primary px-4 py-3 text-white font-bold flex shrink-0 justify-between items-center">
              <span className="flex items-center gap-2 text-sm">
                <span className="material-symbols-outlined text-[20px]">add_circle</span>
                Cadastrar Novo Artigo / Serviço
              </span>
              <button onClick={() => setShowAddModal(false)} className="text-white hover:opacity-80 cursor-pointer">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleAddProduct} className="p-3 sm:p-5 space-y-3 text-xs overflow-y-auto flex-1 overscroll-contain">
              {newProdError && (
                <div className="bg-red-50 text-red-700 p-2 border border-red-200 rounded-lg font-bold text-center text-xs">
                  {newProdError}
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                
                {/* Coluna 1: Identificação & Informações Básicas */}
                <div className="space-y-3 bg-gray-50/80 p-3.5 rounded-xl border border-gray-200/80 shadow-2xs">
                  <h3 className="font-black text-gray-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5 border-b border-gray-200 pb-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">info</span>
                    1. Identificação do Artigo
                  </h3>

                  <div className="grid grid-cols-2 gap-2">
                    {/* Tipo de Artigo */}
                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Tipo de Artigo</label>
                      <select
                        value={newProdIsService ? 'Serviço' : 'Produto'}
                        onChange={(e) => {
                          const isSrv = e.target.value === 'Serviço';
                          setNewProdIsService(isSrv);
                          if (isSrv) {
                            setNewProdUnit('Unidades');
                            setNewProdQty(100);
                            setNewProdCategory('Serviços');
                          }
                        }}
                        className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-primary font-bold bg-white"
                      >
                        <option value="Produto">📦 Produto Físico</option>
                        <option value="Serviço">🛠️ Serviço</option>
                      </select>
                    </div>

                    {/* Imagem do Produto */}
                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Imagem</label>
                      <div className="space-y-1">
                        <div className="flex gap-1 items-center">
                          <button
                            type="button"
                            onClick={() => setShowNewProdLinkInput(!showNewProdLinkInput)}
                            className={`flex-1 py-1.5 px-1.5 border rounded text-[9.5px] font-bold flex items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                              showNewProdLinkInput ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-extrabold' : 'bg-slate-100 border-gray-300 text-gray-700 hover:bg-slate-200'
                            }`}
                            title="Inserir via link URL"
                          >
                            <span className="material-symbols-outlined text-[12px]">link</span>
                            Link
                          </button>

                          <button
                            type="button"
                            onClick={() => document.getElementById('new-prod-file-upload')?.click()}
                            className="flex-1 py-1.5 px-1.5 bg-slate-100 hover:bg-slate-200 border border-gray-300 rounded text-[9.5px] font-bold text-gray-700 flex items-center justify-center gap-0.5 cursor-pointer transition-colors"
                            title="Carregar do computador"
                          >
                            <span className="material-symbols-outlined text-[12px]">upload</span>
                            Upload
                          </button>

                          <input
                            type="file"
                            id="new-prod-file-upload"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                  setNewProdImageUrl(reader.result as string);
                                  triggerToast("Imagem carregada!");
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                            className="hidden"
                          />

                          {newProdImageUrl && (
                            <div className="relative group shrink-0">
                              <img src={newProdImageUrl} alt="Preview" className="w-7 h-7 object-cover rounded border border-gray-300 shadow-2xs" referrerPolicy="no-referrer" />
                              <button
                                type="button"
                                onClick={() => setNewProdImageUrl('')}
                                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center hover:bg-red-600 cursor-pointer"
                                title="Remover Imagem"
                              >
                                <span className="text-[8px] font-bold">×</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {showNewProdLinkInput && (
                          <input
                            type="text"
                            placeholder="Cole URL HTTPS..."
                            value={newProdImageUrl}
                            onChange={(e) => setNewProdImageUrl(e.target.value)}
                            className="w-full border border-indigo-200 focus:border-indigo-500 rounded px-2 py-1 text-[10px] bg-white font-medium focus:outline-none"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Nome do Produto / Serviço</label>
                    <input
                      type="text"
                      value={newProdName}
                      onChange={(e) => setNewProdName(e.target.value)}
                      placeholder="Ex: Sementes Pimento Califórnia 100g"
                      className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-primary bg-white font-semibold"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">C.Barras</label>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={newProdCode}
                          onChange={(e) => setNewProdCode(e.target.value)}
                          placeholder="Ex: 9611091234567"
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-[10.5px] focus:outline-none focus:border-primary font-mono bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const code = generateBarcodeValue();
                            setNewProdCode(code);
                            triggerToast(`Código gerado: ${code}`);
                          }}
                          className="px-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-gray-700 flex items-center justify-center cursor-pointer shrink-0"
                          title="Gerar código"
                        >
                          <span className="material-symbols-outlined text-[15px]">cached</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Referência</label>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={newProdReference}
                          onChange={(e) => setNewProdReference(e.target.value)}
                          placeholder="Ex: SEM-5812"
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-[10.5px] focus:outline-none focus:border-primary font-mono bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const ref = generateCategoryReference(newProdCategory);
                            setNewProdReference(ref);
                            triggerToast(`Referência gerada: ${ref}`);
                          }}
                          className="px-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-gray-700 flex items-center justify-center cursor-pointer shrink-0"
                          title="Gerar Referência"
                        >
                          <span className="material-symbols-outlined text-[15px]">cached</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Categoria</label>
                      <select
                        value={newProdCategory}
                        onChange={(e) => setNewProdCategory(e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary bg-white"
                      >
                        {categories.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                        <option value="Nova Categoria">+ Nova Categoria...</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Validade Lote (Opcional)</label>
                      <input
                        type="date"
                        value={newProdExpiry}
                        onChange={(e) => setNewProdExpiry(e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-[10.5px] focus:outline-none focus:border-primary bg-white font-medium"
                      />
                    </div>
                  </div>

                  {newProdCategory === 'Nova Categoria' && (
                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Nome da Nova Categoria</label>
                      <input
                        type="text"
                        value={newCustomCategory}
                        onChange={(e) => setNewCustomCategory(e.target.value)}
                        placeholder="Ex: Vasos de Argila"
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary bg-white"
                      />
                    </div>
                  )}
                </div>

                {/* Coluna 2: Unidades & Divisão de Lote / Stock */}
                <div className="space-y-3 bg-gray-50/80 p-3.5 rounded-xl border border-gray-200/80 shadow-2xs">
                  <h3 className="font-black text-gray-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5 border-b border-gray-200 pb-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">inventory_2</span>
                    2. Unidades & Quantidade em Stock
                  </h3>

                  {/* Conversion & Unit configs */}
                  <div className="p-2.5 bg-white border border-gray-200 rounded-lg space-y-1.5">
                    <div className="grid grid-cols-3 gap-1.5">
                      <div>
                        <label className="block text-[9px] font-black uppercase text-gray-500 mb-0.5">Unid. Base</label>
                        <select
                          value={newProdUnit}
                          onChange={(e) => setNewProdUnit(e.target.value)}
                          className="w-full border border-gray-300 rounded px-1.5 py-1 text-[10.5px] bg-white focus:outline-none"
                        >
                          <option value="Unidades">Unidades</option>
                          <option value="Pacotes">Pacotes</option>
                          <option value="Kg">Kg</option>
                          <option value="Litros">Litros</option>
                          <option value="Metros">Metros</option>
                          <option value="Metros Quadrados">Metros ²</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[9px] font-black uppercase text-gray-500 mb-0.5">Caixa / Saco</label>
                        <input
                          type="text"
                          value={newParentUnit}
                          onChange={(e) => setNewParentUnit(e.target.value)}
                          placeholder="Ex: Sacos"
                          className="w-full border border-gray-300 rounded px-1.5 py-1 text-[10.5px] bg-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] font-black uppercase text-gray-500 mb-0.5">Fator</label>
                        <input
                          type="number"
                          value={newConversionRate}
                          onChange={(e) => setNewConversionRate(Number(e.target.value))}
                          className="w-full border border-gray-300 rounded px-1.5 py-1 text-[10.5px] bg-white focus:outline-none font-bold text-center"
                        />
                      </div>
                    </div>
                  </div>

                  {newParentUnit && newConversionRate > 1 ? (
                    <div className="space-y-2 p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg">
                      <p className="font-bold text-blue-800 text-[9.5px] uppercase">Divisão de Lote ({newParentUnit} vs {newProdUnit})</p>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-black uppercase text-blue-700 mb-0.5">Total {newParentUnit} Recebidos</label>
                          <input
                            type="number"
                            value={newReceivedSacks}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value));
                              setNewReceivedSacks(val);
                              setNewSacksForWholesale(val);
                              setNewSacksForRetail(0);
                              setNewProdQtyBulk(val);
                              setNewProdQtyRetail(0);
                            }}
                            placeholder="Ex: 20"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-primary bg-white font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-black uppercase text-blue-700 mb-0.5">Qtd por {getSingularUnit(newParentUnit || 'Saco')}</label>
                          <input
                            type="number"
                            value={newConversionRate}
                            onChange={(e) => {
                              const rate = Math.max(1, Number(e.target.value));
                              setNewConversionRate(rate);
                              setNewProdQtyRetail(newSacksForRetail * rate);
                            }}
                            placeholder="Ex: 50"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-primary bg-white font-bold"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-blue-100">
                        <div>
                          <label className="block text-[9px] font-black uppercase text-emerald-700 mb-0.5">Para Revenda ({newParentUnit})</label>
                          <input
                            type="number"
                            value={newSacksForWholesale}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value));
                              setNewSacksForWholesale(val);
                              setNewProdQtyBulk(val);
                            }}
                            placeholder="Ex: 15"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-primary bg-white font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-black uppercase text-orange-700 mb-0.5">Para Retalho ({newParentUnit})</label>
                          <input
                            type="number"
                            value={newSacksForRetail}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value));
                              setNewSacksForRetail(val);
                              setNewProdQtyRetail(val * newConversionRate);
                            }}
                            placeholder="Ex: 5"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-primary bg-white font-bold"
                          />
                        </div>
                      </div>

                      <p className="text-[9.5px] text-gray-700 italic bg-white p-1.5 rounded border border-gray-200">
                        Total equiv: <strong className="text-gray-950 font-bold">{(newSacksForWholesale * newConversionRate) + (newSacksForRetail * newConversionRate)} {newProdUnit}</strong>
                      </p>
                    </div>
                  ) : (
                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Qtd Inicial ({newProdUnit})</label>
                      <input
                        type="number"
                        value={newProdQty}
                        onChange={(e) => setNewProdQty(Number(e.target.value))}
                        className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-primary bg-white font-bold text-slate-800"
                      />
                    </div>
                  )}
                </div>

                {/* Coluna 3: Preços & Finalização */}
                <div className="space-y-3 bg-gray-50/80 p-3.5 rounded-xl border border-gray-200/80 shadow-2xs">
                  <h3 className="font-black text-gray-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5 border-b border-gray-200 pb-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">payments</span>
                    3. Preços & Gravação
                  </h3>

                  {newParentUnit && newConversionRate > 1 ? (
                    <div className="space-y-2 bg-white p-2.5 rounded-lg border border-gray-200">
                      <div>
                        <label className="block text-[9.5px] font-black uppercase text-slate-700 mb-0.5">
                          P. Compra por {getSingularUnit(newParentUnit)} (MT)
                        </label>
                        <input
                          type="number"
                          value={newProdBuyPriceBulk || ''}
                          onChange={(e) => {
                            const bulkVal = Number(e.target.value);
                            setNewProdBuyPriceBulk(bulkVal);
                            setNewProdBuyPrice(bulkVal / newConversionRate);
                          }}
                          className="w-full border border-gray-300 rounded px-2.5 py-1 text-[11px] font-bold text-slate-800 focus:outline-none focus:border-primary bg-white"
                          placeholder="Ex: 4000"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9.5px] font-black uppercase text-emerald-700 mb-0.5">
                            P. Venda {getSingularUnit(newParentUnit)}
                          </label>
                          <input
                            type="number"
                            value={newProdSellPriceBulk || ''}
                            onChange={(e) => setNewProdSellPriceBulk(Number(e.target.value))}
                            className="w-full border border-emerald-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-emerald-500 font-bold bg-emerald-50 text-emerald-800"
                            placeholder="Ex: 4500"
                          />
                        </div>

                        <div>
                          <label className="block text-[9.5px] font-black uppercase text-slate-700 mb-0.5">
                            P. Venda {getSingularUnit(newProdUnit)}
                          </label>
                          <input
                            type="number"
                            value={newProdSellPrice || ''}
                            onChange={(e) => setNewProdSellPrice(Number(e.target.value))}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-primary bg-white font-bold"
                            placeholder="Ex: 100"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 bg-white p-2.5 rounded-lg border border-gray-200">
                      <div>
                        <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">
                          P. Compra (MT)
                        </label>
                        <input
                          type="number"
                          value={newProdBuyPrice || ''}
                          onChange={(e) => setNewProdBuyPrice(Number(e.target.value))}
                          className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-primary bg-white font-semibold"
                        />
                      </div>

                      <div>
                        <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">
                          P. Venda (MT)
                        </label>
                        <input
                          type="number"
                          value={newProdSellPrice || ''}
                          onChange={(e) => setNewProdSellPrice(Number(e.target.value))}
                          className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-primary bg-white font-semibold"
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-primary text-white hover:opacity-90 font-black uppercase tracking-wider rounded-lg text-xs transition-opacity mt-2 shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    Gravar Artigo no Catálogo
                  </button>
                </div>

              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- Stock Adjust Security Modal (Password check "05082") --- */}
      {showAdjustModal && selectedProduct && (
        <div className="fixed inset-0 bg-black/60 z-50 overflow-y-auto p-2 sm:p-4 flex min-h-full items-center justify-center">
          <div className="bg-white rounded-2xl shadow-2xl max-w-7xl w-full max-h-[92vh] my-auto flex flex-col overflow-hidden border border-gray-200">
            <div className="bg-primary px-4 py-3 text-white font-bold flex shrink-0 justify-between items-center">
              <span className="flex items-center gap-2 text-sm">
                <span className="material-symbols-outlined text-[20px]">edit_square</span>
                Ajustar / Editar Produto e Stock
              </span>
              <button onClick={() => { setShowAdjustModal(false); setSelectedProduct(null); }} className="text-white hover:opacity-80 cursor-pointer">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <form onSubmit={handleAdjustStock} className="p-3 sm:p-5 space-y-3 text-xs overflow-y-auto flex-1 overscroll-contain">
              {adjustError && (
                <div className="bg-red-50 text-red-700 p-2 border border-red-200 rounded-lg font-bold text-center text-xs">
                  {adjustError}
                </div>
              )}

              <p className="text-gray-700 font-bold text-center bg-gray-50 py-1.5 px-3 rounded-lg border border-gray-200 text-xs">
                A editar artigo: <span className="text-primary font-black">{selectedProduct.name}</span>
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                
                {/* Coluna 1: Dados de Identificação */}
                <div className="space-y-3 bg-gray-50/80 p-3.5 rounded-xl border border-gray-200/80 shadow-2xs">
                  <h3 className="font-black text-gray-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5 border-b border-gray-200 pb-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">edit</span>
                    1. Identificação do Artigo
                  </h3>

                  <div className="grid grid-cols-2 gap-2">
                    {/* Tipo de Artigo */}
                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Tipo de Artigo</label>
                      <select
                        value={editIsService ? 'Serviço' : 'Produto'}
                        onChange={(e) => {
                          const isSrv = e.target.value === 'Serviço';
                          setEditIsService(isSrv);
                          if (isSrv) {
                            setEditCategory('Serviços');
                            setEditBaseUnit('Unidades');
                          }
                        }}
                        className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-primary font-bold bg-white"
                      >
                        <option value="Produto">📦 Produto Físico</option>
                        <option value="Serviço">🛠️ Serviço</option>
                      </select>
                    </div>

                    {/* Imagem do Produto */}
                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Imagem</label>
                      <div className="space-y-1">
                        <div className="flex gap-1 items-center">
                          <button
                            type="button"
                            onClick={() => setShowEditLinkInput(!showEditLinkInput)}
                            className={`flex-1 py-1.5 px-1.5 border rounded text-[9.5px] font-bold flex items-center justify-center gap-0.5 cursor-pointer transition-colors ${
                              showEditLinkInput ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-extrabold' : 'bg-slate-100 border-gray-300 text-gray-700 hover:bg-slate-200'
                            }`}
                            title="Inserir via link URL"
                          >
                            <span className="material-symbols-outlined text-[12px]">link</span>
                            Link
                          </button>

                          <button
                            type="button"
                            onClick={() => document.getElementById('edit-prod-file-upload')?.click()}
                            className="flex-1 py-1.5 px-1.5 bg-slate-100 hover:bg-slate-200 border border-gray-300 rounded text-[9.5px] font-bold text-gray-700 flex items-center justify-center gap-0.5 cursor-pointer transition-colors"
                            title="Carregar do computador"
                          >
                            <span className="material-symbols-outlined text-[12px]">upload</span>
                            Upload
                          </button>

                          <input
                            type="file"
                            id="edit-prod-file-upload"
                            accept="image/*"
                            onChange={(e) => {
                              const file = e.target.files?.[0];
                              if (file) {
                                const reader = new FileReader();
                                reader.onloadend = () => {
                                  setEditImageUrl(reader.result as string);
                                  triggerToast("Imagem carregada!");
                                };
                                reader.readAsDataURL(file);
                              }
                            }}
                            className="hidden"
                          />

                          {editImageUrl && (
                            <div className="relative group shrink-0">
                              <img src={editImageUrl} alt="Preview" className="w-7 h-7 object-cover rounded border border-gray-300 shadow-2xs" referrerPolicy="no-referrer" />
                              <button
                                type="button"
                                onClick={() => setEditImageUrl('')}
                                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center hover:bg-red-600 cursor-pointer"
                                title="Remover Imagem"
                              >
                                <span className="text-[8px] font-bold">×</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {showEditLinkInput && (
                          <input
                            type="text"
                            placeholder="Cole URL HTTPS..."
                            value={editImageUrl}
                            onChange={(e) => setEditImageUrl(e.target.value)}
                            className="w-full border border-indigo-200 focus:border-indigo-500 rounded px-2 py-1 text-[10px] bg-white font-medium focus:outline-none"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Nome do Produto</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-[11px] focus:outline-none focus:border-primary bg-white font-semibold"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">C.Barras</label>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={editCode}
                          onChange={(e) => setEditCode(e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-[10.5px] focus:outline-none focus:border-primary font-mono bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const code = generateBarcodeValue();
                            setEditCode(code);
                            triggerToast(`Código gerado: ${code}`);
                          }}
                          className="px-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-gray-700 flex items-center justify-center cursor-pointer shrink-0"
                          title="Gerar código"
                        >
                          <span className="material-symbols-outlined text-[15px]">cached</span>
                        </button>
                      </div>
                    </div>

                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Referência</label>
                      <div className="flex gap-1">
                        <input
                          type="text"
                          value={editReference}
                          onChange={(e) => setEditReference(e.target.value)}
                          className="w-full border border-gray-300 rounded px-2 py-1.5 text-[10.5px] focus:outline-none focus:border-primary font-mono bg-white"
                          placeholder="Ex: SEM-5812"
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const ref = generateCategoryReference(editCategory);
                            setEditReference(ref);
                            triggerToast(`Referência gerada: ${ref}`);
                          }}
                          className="px-2 bg-gray-100 hover:bg-gray-200 border border-gray-300 rounded text-gray-700 flex items-center justify-center cursor-pointer shrink-0"
                          title="Gerar referência"
                        >
                          <span className="material-symbols-outlined text-[15px]">cached</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Categoria</label>
                      <select
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-[11px] focus:outline-none focus:border-primary bg-white"
                      >
                        {categories.map(cat => (
                          <option key={cat} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Validade Lote</label>
                      <input
                        type="date"
                        value={editExpiryDate}
                        onChange={(e) => setEditExpiryDate(e.target.value)}
                        className="w-full border border-gray-300 rounded px-2 py-1.5 text-[10.5px] focus:outline-none bg-white font-medium"
                      />
                    </div>
                  </div>

                  <div className="pt-1 border-t border-gray-200">
                    <label className="block text-[9.5px] font-black uppercase text-red-600 mb-0.5">Palavra-passe de Gestor (Stock)</label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      data-lpignore="true"
                      value={stockPassword}
                      onChange={(e) => setStockPassword(e.target.value)}
                      placeholder="Senha do Stock (Ex: 05082)"
                      className="w-full border border-red-300 rounded px-2.5 py-1.5 text-[11px] text-center focus:border-red-500 focus:outline-none font-extrabold bg-white"
                    />
                  </div>
                </div>

                {/* Coluna 2: Ajuste de Stock & Unidades */}
                <div className="space-y-3 bg-gray-50/80 p-3.5 rounded-xl border border-gray-200/80 shadow-2xs">
                  <h3 className="font-black text-gray-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5 border-b border-gray-200 pb-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">tune</span>
                    2. Ajuste de Quantidades
                  </h3>

                  {/* Conversion & Unit configs */}
                  <div className="p-2.5 bg-white border border-gray-200 rounded-lg space-y-1.5">
                    <div className="grid grid-cols-3 gap-1.5">
                      <div>
                        <label className="block text-[9px] font-black uppercase text-gray-500 mb-0.5">Unid. Base</label>
                        <select
                          value={editBaseUnit}
                          onChange={(e) => setEditBaseUnit(e.target.value)}
                          className="w-full border border-gray-300 rounded px-1.5 py-1 text-[10.5px] bg-white focus:outline-none"
                        >
                          <option value="Unidades">Unidades</option>
                          <option value="Pacotes">Pacotes</option>
                          <option value="Kg">Kg</option>
                          <option value="Litros">Litros</option>
                          <option value="Metros">Metros</option>
                          <option value="Metros Quadrados">Metros ²</option>
                        </select>
                      </div>

                      <div>
                        <label className="block text-[9px] font-black uppercase text-gray-500 mb-0.5">Caixa / Saco</label>
                        <input
                          type="text"
                          value={editParentUnit}
                          onChange={(e) => setEditParentUnit(e.target.value)}
                          placeholder="Sem caixa"
                          className="w-full border border-gray-300 rounded px-1.5 py-1 text-[10.5px] bg-white focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] font-black uppercase text-gray-500 mb-0.5">Fator</label>
                        <input
                          type="number"
                          value={editConversionRate}
                          onChange={(e) => setEditConversionRate(Number(e.target.value))}
                          className="w-full border border-gray-300 rounded px-1.5 py-1 text-[10.5px] bg-white focus:outline-none text-center font-bold"
                        />
                      </div>
                    </div>
                  </div>

                  {editParentUnit && editConversionRate > 1 ? (
                    <div className="space-y-2 p-2.5 bg-blue-50/70 border border-blue-200 rounded-lg">
                      <p className="font-bold text-blue-800 text-[9.5px] uppercase">Divisão de Lote ({editParentUnit} vs {editBaseUnit})</p>

                      {/* Intelligent Increment Field */}
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 space-y-0.5">
                        <label className="block text-[9px] font-black uppercase text-emerald-800">
                          ⚡ Incremento Inteligente (Adicionar {editParentUnit})
                        </label>
                        <input
                          type="number"
                          placeholder="Ex: +10"
                          value={sacksIncrement || ''}
                          onChange={(e) => {
                            const inc = Math.max(0, Number(e.target.value));
                            setSacksIncrement(inc);
                            const newTotal = initialSacksTotal + inc;
                            setEditReceivedSacks(newTotal);
                            setEditSacksForWholesale(initialBulkSacks + inc);
                            setEditSacksForRetail(initialRetailSacks);
                            setEditStockQtyBulk(initialBulkSacks + inc);
                            setEditStockQtyRetail(initialRetailQty);
                          }}
                          className="w-full border border-emerald-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-emerald-600 bg-white font-bold text-emerald-900"
                        />
                      </div>
                      
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-black uppercase text-blue-700 mb-0.5">Total {editParentUnit} Recebidos</label>
                          <input
                            type="number"
                            value={editReceivedSacks}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value));
                              setEditReceivedSacks(val);
                              setEditSacksForWholesale(val);
                              setEditSacksForRetail(0);
                              setEditStockQtyBulk(val);
                              setEditStockQtyRetail(0);
                            }}
                            placeholder="Ex: 20"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-primary bg-white font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-black uppercase text-blue-700 mb-0.5">Qtd por {getSingularUnit(editParentUnit || 'Saco')}</label>
                          <input
                            type="number"
                            value={editConversionRate}
                            onChange={(e) => {
                              const rate = Math.max(1, Number(e.target.value));
                              setEditConversionRate(rate);
                              setEditStockQtyRetail(editSacksForRetail * rate);
                            }}
                            placeholder="Ex: 50"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-primary bg-white font-bold"
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-blue-100">
                        <div>
                          <label className="block text-[9px] font-black uppercase text-emerald-700 mb-0.5">Para Revenda ({editParentUnit})</label>
                          <input
                            type="number"
                            value={editSacksForWholesale}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value));
                              setEditSacksForWholesale(val);
                              setEditStockQtyBulk(val);
                            }}
                            placeholder="Ex: 15"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-primary bg-white font-bold"
                          />
                        </div>
                        <div>
                          <label className="block text-[9px] font-black uppercase text-orange-700 mb-0.5">Para Retalho ({editParentUnit})</label>
                          <input
                            type="number"
                            value={editSacksForRetail}
                            onChange={(e) => {
                              const val = Math.max(0, Number(e.target.value));
                              setEditSacksForRetail(val);
                              setEditStockQtyRetail(val * editConversionRate);
                            }}
                            placeholder="Ex: 5"
                            className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-primary bg-white font-bold"
                          />
                        </div>
                      </div>

                      <p className="text-[9.5px] text-gray-700 italic bg-white p-1.5 rounded border border-gray-200">
                        Total equiv: <strong className="text-gray-950 font-bold">{(editSacksForWholesale * editConversionRate) + (editSacksForRetail * editConversionRate)} {editBaseUnit}</strong>
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 gap-2 bg-white p-2.5 rounded-lg border border-gray-200">
                      {/* Adicionar ao Stock */}
                      <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-2 space-y-0.5">
                        <label className="block text-[9px] font-black uppercase text-emerald-800">
                          ⚡ Adicionar ao Stock (Incremento)
                        </label>
                        <input
                          type="number"
                          placeholder="Ex: +10"
                          value={stockQtyIncrement || ''}
                          onChange={(e) => {
                            const inc = Number(e.target.value);
                            setStockQtyIncrement(inc);
                            setEditStockQty(initialQtyTotal + inc);
                          }}
                          className="w-full border border-emerald-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-emerald-600 bg-white font-bold text-emerald-900"
                        />
                      </div>

                      {/* Quantidade Real */}
                      <div>
                        <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">Quantidade Real ({editBaseUnit})</label>
                        <input
                          type="number"
                          value={editStockQty}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            setEditStockQty(val);
                            setStockQtyIncrement(val - initialQtyTotal);
                          }}
                          className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-[11px] font-extrabold text-center focus:outline-none bg-white text-slate-800"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Coluna 3: Preços & Gravação */}
                <div className="space-y-3 bg-gray-50/80 p-3.5 rounded-xl border border-gray-200/80 shadow-2xs">
                  <h3 className="font-black text-gray-800 text-[11px] uppercase tracking-wider flex items-center gap-1.5 border-b border-gray-200 pb-2">
                    <span className="material-symbols-outlined text-[16px] text-primary">payments</span>
                    3. Preços & Gravação
                  </h3>

                  {editParentUnit && editConversionRate > 1 ? (
                    <div className="space-y-2 bg-white p-2.5 rounded-lg border border-gray-200">
                      <div>
                        <label className="block text-[9.5px] font-black uppercase text-slate-700 mb-0.5">
                          P. Compra por {getSingularUnit(editParentUnit)} (MT)
                        </label>
                        <input
                          type="number"
                          value={editBuyingPriceBulk || ''}
                          onChange={(e) => {
                            const bulkVal = Number(e.target.value);
                            setEditBuyingPriceBulk(bulkVal);
                            setEditBuyingPrice(bulkVal / editConversionRate);
                          }}
                          className="w-full border border-gray-300 rounded px-2.5 py-1 text-[11px] font-bold text-slate-800 focus:outline-none focus:border-primary bg-white"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9.5px] font-black uppercase text-emerald-700 mb-0.5">
                            P. Venda {getSingularUnit(editParentUnit)}
                          </label>
                          <input
                            type="number"
                            value={editSellingPriceBulk || ''}
                            onChange={(e) => setEditSellingPriceBulk(Number(e.target.value))}
                            className="w-full border border-emerald-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-emerald-500 font-bold bg-emerald-50 text-emerald-800"
                          />
                        </div>

                        <div>
                          <label className="block text-[9.5px] font-black uppercase text-slate-700 mb-0.5">
                            P. Venda {getSingularUnit(editBaseUnit)}
                          </label>
                          <input
                            type="number"
                            value={editSellingPrice || ''}
                            onChange={(e) => setEditSellingPrice(Number(e.target.value))}
                            className="w-full border border-gray-300 rounded px-2 py-1 text-[11px] focus:outline-none focus:border-primary bg-white font-bold"
                          />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-2 bg-white p-2.5 rounded-lg border border-gray-200">
                      <div>
                        <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">P. Compra (MT)</label>
                        <input
                          type="number"
                          value={editBuyingPrice || ''}
                          onChange={(e) => setEditBuyingPrice(Number(e.target.value))}
                          className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-[11px] font-bold text-center focus:outline-none bg-white"
                        />
                      </div>

                      <div>
                        <label className="block text-[9.5px] font-black uppercase text-gray-500 mb-0.5">P. Venda (MT)</label>
                        <input
                          type="number"
                          value={editSellingPrice || ''}
                          onChange={(e) => setEditSellingPrice(Number(e.target.value))}
                          className="w-full border border-gray-300 rounded px-2.5 py-1.5 text-[11px] font-bold text-center focus:outline-none bg-white"
                        />
                      </div>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full py-2.5 bg-primary text-white hover:opacity-90 font-black uppercase tracking-wider rounded-lg text-xs transition-opacity mt-2 shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    Autorizar Ajustes e Gravar
                  </button>
                </div>

              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- Register Quebra/Loss Modal --- */}
      {showLossModal && lossProduct && (
        <div className="fixed inset-0 bg-black/60 z-50 overflow-y-auto p-2 sm:p-4 flex min-h-full items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full max-h-[90vh] my-auto flex flex-col overflow-hidden border border-gray-200">
            <div className="bg-primary p-4 text-white font-bold flex shrink-0 justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined">delete_sweep</span>
                Registar Quebra Comercial
              </span>
              <button onClick={() => { setShowLossModal(false); setLossProduct(null); }} className="text-white hover:opacity-80">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleRegisterLoss} className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto flex-1 overscroll-contain">
              <p className="text-gray-600 font-semibold text-center">
                Produto afetado:<br />
                <span className="text-red-600 font-bold">{lossProduct.name}</span>
              </p>

              <div>
                <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Quantidade Danificada / Perdida</label>
                <input
                  type="number"
                  value={lossQty}
                  onChange={(e) => setLossQty(Number(e.target.value))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-center font-bold"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Motivo da Perda</label>
                <select
                  value={lossReason}
                  onChange={(e) => setLossReason(e.target.value as any)}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs bg-white"
                >
                  <option value="Danos Físicos">Danos Físicos (Quebra em Armazém)</option>
                  <option value="Quebras de Inventário">Quebra de Inventário (Perda Indeterminada)</option>
                  <option value="Outro">Outro Motivo</option>
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Justificação Detalhada</label>
                <textarea
                  value={lossJustification}
                  onChange={(e) => setLossJustification(e.target.value)}
                  placeholder="Introduza a ocorrência..."
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs h-20"
                />
              </div>

              <button
                type="submit"
                className="w-full py-2.5 bg-red-600 text-white rounded font-bold uppercase hover:bg-red-700 transition-colors"
              >
                Registar Perda
              </button>
            </form>
          </div>
        </div>
      )}

      {/* --- Requisition Modal (Warehouse operational flow) --- */}
      {showRequisitionModal && reqProduct && (
        <div className="fixed inset-0 bg-black/60 z-50 overflow-y-auto p-2 sm:p-4 flex min-h-full items-center justify-center">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full max-h-[90vh] my-auto flex flex-col overflow-hidden border border-gray-200 animate-in fade-in zoom-in duration-200">
            <div className="bg-emerald-800 p-4 text-white font-bold flex shrink-0 justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined">warehouse</span>
                Requisição Interna de Stock
              </span>
              <button onClick={() => { setShowRequisitionModal(false); setReqProduct(null); }} className="text-white hover:opacity-80">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-4 sm:p-6 space-y-4 text-xs overflow-y-auto flex-1 overscroll-contain">
              <div className="text-center space-y-1 bg-emerald-50/50 p-3 rounded-lg border border-emerald-100">
                <p className="text-gray-500 font-bold uppercase text-[9px] tracking-wider">Artigo a Transferir</p>
                <p className="text-emerald-900 font-black text-sm">{reqProduct.name}</p>
              </div>

              {reqError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 font-bold">
                  ⚠️ {reqError}
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 text-center">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <p className="text-[9px] font-black text-slate-500 uppercase">Revenda Atual</p>
                  <p className="text-lg font-black text-slate-800 mt-1">
                    {reqProduct.stockQtyBulk || 0} <span className="text-[10px] font-medium text-slate-500">{reqProduct.parentUnit}</span>
                  </p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <p className="text-[9px] font-black text-slate-500 uppercase">Retalho Atual</p>
                  <p className="text-lg font-black text-slate-800 mt-1">
                    {reqProduct.stockQtyRetail || 0} <span className="text-[10px] font-medium text-slate-500">{reqProduct.baseUnit}</span>
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-black uppercase text-gray-500">
                  Quantidade de {reqProduct.parentUnit} a Requisitar (A abrir)
                </label>
                <input
                  type="number"
                  min="1"
                  max={reqProduct.stockQtyBulk || 1}
                  value={reqQty}
                  onChange={(e) => setReqQty(Math.max(1, Number(e.target.value)))}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-sm text-center font-bold focus:ring-1 focus:ring-emerald-700 focus:border-emerald-700 animate-none"
                />
              </div>

              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 space-y-1 text-amber-900">
                <p className="font-bold flex items-center gap-1 uppercase text-[9px]">
                  <span className="material-symbols-outlined text-[13px]">info</span>
                  Cálculo de Conversão Física
                </p>
                <p className="leading-relaxed">
                  Ao requisitar <strong>{reqQty} {getSingularUnit(reqProduct.parentUnit || 'Saco')} para empacotamento</strong>, o sistema irá deduzir esses sacos do stock principal e adicionar <strong>{reqQty * (reqProduct.conversionRate || 1)} {reqProduct.baseUnit}</strong> ao stock de retalho (fator de conversão: 1 saco = {reqProduct.conversionRate} {reqProduct.baseUnit}).
                </p>
              </div>

              <div className="flex gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => { setShowRequisitionModal(false); setReqProduct(null); }}
                  className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded font-bold uppercase transition-colors"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleExecuteRequisition}
                  className="flex-1 py-2 bg-emerald-800 text-white rounded font-bold uppercase hover:bg-emerald-900 transition-colors flex items-center justify-center gap-1.5 shadow-sm shadow-emerald-850"
                >
                  <span className="material-symbols-outlined text-[15px]">send</span>
                  Executar Requisição
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Barcode Preview Modal */}
      {previewBarcodeProduct && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full overflow-hidden border border-gray-200">
            <div className="bg-primary p-4 text-white font-bold flex justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined">barcode_reader</span>
                Código de Barras EAN-13
              </span>
              <button onClick={() => setPreviewBarcodeProduct(null)} className="text-white hover:opacity-80">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-8 flex flex-col items-center justify-center space-y-4">
              <p className="font-bold text-gray-800 text-sm text-center">{previewBarcodeProduct.name}</p>
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-100 shadow-inner">
                <Barcode13 code={previewBarcodeProduct.code} width={220} height={100} />
              </div>
              <p className="text-[10px] text-gray-400 font-semibold uppercase text-center">
                REF/SKU: {previewBarcodeProduct.code}
              </p>
              <button
                onClick={() => setPreviewBarcodeProduct(null)}
                className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-bold transition-all"
              >
                Fechar Visualização
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Custom Confirmation Modal */}
      {confirmModal?.show && (
        <div className="fixed inset-0 bg-black/70 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-red-100">
            <div className="bg-gradient-to-r from-red-600 to-red-700 p-4 text-white font-bold flex justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined">warning</span>
                {confirmModal.title}
              </span>
              <button onClick={() => setConfirmModal(null)} className="text-white hover:opacity-80">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-gray-600 leading-relaxed">
                {confirmModal.message}
              </p>
              <div className="flex gap-2 justify-end pt-2">
                <button
                  type="button"
                  onClick={() => setConfirmModal(null)}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmModal.onConfirm}
                  className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer"
                >
                  Confirmar Operação
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
