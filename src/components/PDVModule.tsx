import { safeStorage, safeSessionStorage } from "../utils/safeStorage";
import { uid } from '../utils/idHelper';
import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { dbService } from '../utils/firebaseDB';
import { checkStockAddition, lineBaseQty } from '../utils/stockGuard';
import { Product, Sale, SaleItem, PaymentInfo, SystemSettings, Customer, PausedSale, AppRole } from '../types';
import { getSingularUnit } from '../utils/unitHelper';
import { getUnitCost, isHybridProduct, getBulkSellingPrice } from '../utils/priceHelper';
import { clampItemDiscountValue, getItemDiscount, getMaxItemDiscountValue, getSaleTotals, ItemDiscountType } from '../utils/saleTotals';
import { resolveSaleStatus, validatePayment, requiresReceipt } from '../utils/checkoutRules';
import { currentShiftId } from '../utils/shifts';
import { canSellOnCredit } from '../utils/creditRules';
import CreditAuthModal from './CreditAuthModal';
import { downloadInvoiceA4, downloadDuplicatedInvoiceA4, downloadThermalReceipt, downloadReceiptA4, downloadDailySalesReportPDF, downloadPeriodSalesReportPDF } from '../utils/pdfGenerator';
import { generateNextInvoiceNumber, generateNextReceiptNumber, reserveDocumentNumber } from '../utils/sequenceHelper';
import { playChachingSound, sendCashDrawerPulse, printDirectThermalESC_POS, isSerialPrinterConnected } from '../utils/posHardware';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import { DateRangeFilter } from './DateRangeFilter';
import { DateRangePreset, getDateRangeFromPreset, isDateInRange, formatDatePT } from '../utils/dateRangeHelper';
import { runPostCommitTask, runPostCommitTasks } from '../utils/postCommit';
import { describeError } from '../utils/errorHelper';
import Toast from './Toast';
import * as XLSX from 'xlsx';

interface PDVModuleProps {
  currentUser: { username: string; role: string; roles?: AppRole[] };
}

export default function PDVModule({ currentUser }: PDVModuleProps) {
  const [products, setProducts] = useState<Product[]>([]);
  const [cart, setCart] = useState<SaleItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('Todas');
  const [customerName, setCustomerName] = useState('Cliente Geral');
  const [customerNuit, setCustomerNuit] = useState('');
  const [customerAddress, setCustomerAddress] = useState('');
  const [registeredCustomers, setRegisteredCustomers] = useState<Customer[]>([]);
  const [showCustomerModal, setShowCustomerModal] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');

  const [newCustomerName, setNewCustomerName] = useState('');
  const [newCustomerNuit, setNewCustomerNuit] = useState('');
  const [newCustomerAddress, setNewCustomerAddress] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');

  const [pausedSales, setPausedSales] = useState<PausedSale[]>([]);
  const [showPausedSalesModal, setShowPausedSalesModal] = useState(false);

  const [paymentMethod, setPaymentMethod] = useState<'Dinheiro' | 'Transferência' | 'M-Pesa' | 'E-Mola' | 'Crédito' | 'Múltiplo'>('Dinheiro');
  const [multiPaymentLines, setMultiPaymentLines] = useState<{ method: string; amount: number }[]>([
    { method: 'Dinheiro', amount: 0 },
    { method: 'Transferência', amount: 0 },
    { method: 'M-Pesa', amount: 0 },
    { method: 'E-Mola', amount: 0 },
  ]);
  const [documentType, setDocumentType] = useState<'FaturaDefinitiva' | 'FaturaProforma' | 'Cotacao'>('FaturaDefinitiva');
  const [paymentConfig, setPaymentConfig] = useState<PaymentInfo | null>(null);
  const [settings, setSettings] = useState<SystemSettings | null>(null);

  // Per-product Catalog Quantity state
  const [catalogQty, setCatalogQty] = useState<Record<string, number>>({});

  // Per-product Hybrid unit selection state (Bulk vs Retail)
  const [hybridUnits, setHybridUnits] = useState<Record<string, 'Bulk' | 'Retail'>>({});

  // Scanner Simulator States
  const [showScanner, setShowScanner] = useState(false);
  const [scannerStatus, setScannerStatus] = useState<string>('Aguardando');
  const [scanResult, setScanResult] = useState<Product | null>(null);
  const [scanQty, setScanQty] = useState<number>(1);
  const [showProductImages, setShowProductImages] = useState(true);

  // Video Streaming Refs
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const html5QrCodeRef = useRef<Html5Qrcode | null>(null);

  // Print/Invoicing Modal States
  const [invoiceToPrint, setInvoiceToPrint] = useState<Sale | null>(null);
  const [printType, setPrintType] = useState<'A4' | 'Thermal' | 'DoubleA5' | 'ReciboA4' | 'FaturaProforma' | null>(null);

  // User printer preferences
  const [defaultPrinter, setDefaultPrinter] = useState<'Thermal' | 'A4' | 'ReciboA4' | 'FaturaProforma' | 'DoubleA5'>(() => {
    return (safeStorage.getItem('pdv_default_printer') as any) || 'Thermal';
  });
  const [directPrint, setDirectPrint] = useState<boolean>(false);

  // Save printer preferences to localStorage when changed
  useEffect(() => {
    safeStorage.setItem('pdv_default_printer', defaultPrinter);
  }, [defaultPrinter]);

  useEffect(() => {
    safeStorage.setItem('pdv_direct_print', String(directPrint));
  }, [directPrint]);

  // Notification Toast
  const [toastMessage, setToastMessage] = useState('');
  const [toastType, setToastType] = useState<'success' | 'error' | 'warning'>('success');
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [isPausingSale, setIsPausingSale] = useState(false);

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

  // Cash payment state
  const [amountReceived, setAmountReceived] = useState<number | ''>('');

  // Extended POS features
  const [sales, setSales] = useState<Sale[]>([]);
  const [includeIva, setIncludeIva] = useState<boolean>(false);
  const [customSubtotalDiscount, setCustomSubtotalDiscount] = useState<number>(0);
  const [newSaleStatus, setNewSaleStatus] = useState<'Paga' | 'Pendente'>('Paga');
  const [faturasSearch, setFaturasSearch] = useState('');
  const [faturasFilter, setFaturasFilter] = useState<'Todas' | 'Pendente' | 'Paga' | 'Cancelada'>('Todas');

  // Recovery System States
  const [savedActiveCart, setSavedActiveCart] = useState<{
    cart: SaleItem[];
    customerName: string;
    paymentMethod: 'Dinheiro' | 'Transferência' | 'M-Pesa' | 'E-Mola' | 'Crédito';
    documentType: 'FaturaDefinitiva' | 'FaturaProforma' | 'Cotacao';
    includeIva: boolean;
    customSubtotalDiscount: number;
  } | null>(null);
  const isInitialLoadCompletedRef = useRef(false);

  const restoreActiveCart = () => {
    if (!savedActiveCart) return;
    setCart(savedActiveCart.cart);
    setCustomerName(savedActiveCart.customerName);
    setPaymentMethod(savedActiveCart.paymentMethod);
    setDocumentType(savedActiveCart.documentType);
    setIncludeIva(savedActiveCart.includeIva);
    setCustomSubtotalDiscount(savedActiveCart.customSubtotalDiscount);
    setSavedActiveCart(null);
    showToast('Venda anterior recuperada com sucesso!', 'success');
  };

  const discardSavedCart = async () => {
    await dbService.clearActiveCart();
    setSavedActiveCart(null);
    showToast('Rascunho de venda descartado.', 'success');
  };

  const getSavedCartTotal = () => savedActiveCart
    ? getSaleTotals(savedActiveCart.cart, savedActiveCart.customSubtotalDiscount, savedActiveCart.includeIva).total
    : 0;

  // Auto-save active cart to IndexedDB when cart or other states change
  useEffect(() => {
    if (!isInitialLoadCompletedRef.current) return;

    const saveCart = async () => {
      if (cart.length > 0) {
        await dbService.saveActiveCart({
          cart,
          customerName,
          paymentMethod,
          documentType,
          includeIva,
          customSubtotalDiscount
        });
      } else {
        await dbService.clearActiveCart();
      }
    };

    saveCart().catch(err => console.error('Error auto-saving active cart:', err));
  }, [cart, customerName, paymentMethod, documentType, includeIva, customSubtotalDiscount]);

  // Point of Sale Sub-tabs & Periodic / Daily Sales Report States
  const [pdvTab, setPdvTab] = useState<'vendas' | 'relatorios'>('vendas');
  const defaultRange = getDateRangeFromPreset('Hoje');
  const [reportStartDate, setReportStartDate] = useState(defaultRange.startDate);
  const [reportEndDate, setReportEndDate] = useState(defaultRange.endDate);
  const [reportPreset, setReportPreset] = useState<DateRangePreset>('Hoje');
  const [selectedReportDate, setSelectedReportDate] = useState(() => new Date().toISOString().split('T')[0]);

  // Retroactive Sale / Venda Sem Energia / Registo de Venda Antiga Modal States
  const [showRetroactiveModal, setShowRetroactiveModal] = useState(false);
  const [retroactiveDateTime, setRetroactiveDateTime] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  });
  const [retroactiveReceiptNo, setRetroactiveReceiptNo] = useState('');
  const [retroactiveCustomerMode, setRetroactiveCustomerMode] = useState<'manual' | 'registered'>('manual');
  const [retroactiveCustomerName, setRetroactiveCustomerName] = useState('Cliente Geral');
  const [retroactiveCustomerNuit, setRetroactiveCustomerNuit] = useState('');
  const [retroactiveCustomerAddress, setRetroactiveCustomerAddress] = useState('');
  const [retroactiveSaveCustomer, setRetroactiveSaveCustomer] = useState(false);
  const [retroactivePaymentMethod, setRetroactivePaymentMethod] = useState<'Dinheiro' | 'Transferência' | 'M-Pesa' | 'E-Mola' | 'Crédito'>('Dinheiro');
  const [retroactiveDeductStock, setRetroactiveDeductStock] = useState(true);
  const [retroactiveCart, setRetroactiveCart] = useState<SaleItem[]>([]);
  const [retroactiveProductQuery, setRetroactiveProductQuery] = useState('');
  const [selectedRegisteredCustomer, setSelectedRegisteredCustomer] = useState<string>('');
  const [retroactiveCompletedSale, setRetroactiveCompletedSale] = useState<Sale | null>(null);
  // Mostrar o progresso e erros dentro do modal, além de impedir gravações duplicadas.
  const [isFinalizingRetroactive, setIsFinalizingRetroactive] = useState(false);
  const retroactiveFinalizingRef = useRef(false);
  const [retroactiveError, setRetroactiveError] = useState('');
  const [retroactiveSlow, setRetroactiveSlow] = useState(false);
  const retroactiveTotals = getSaleTotals(retroactiveCart);

  /**
   * Lançamento retroactivo: produtos híbridos (saco + quilo) podem ser relançados
   * na unidade em que foram realmente vendidos. Sem isto, uma venda de 2 sacos seria
   * registada como 2 quilos e o stock de grosso nunca desceria.
   */
  const addProductToRetroactiveCart = (product: Product, sellingUnit: 'Bulk' | 'Retail' = 'Retail') => {
    const useBulk = sellingUnit === 'Bulk' && isHybridProduct(product);
    const effectiveUnit: 'Bulk' | 'Retail' = useBulk ? 'Bulk' : 'Retail';
    const existingIndex = retroactiveCart.findIndex(
      item => item.productId === product.id && (item.sellingUnit || 'Retail') === effectiveUnit
    );
    if (existingIndex >= 0) {
      setRetroactiveCart(prev => prev.map((item, idx) => 
        idx === existingIndex ? { ...item, quantity: item.quantity + 1, totalPrice: (item.quantity + 1) * item.unitPrice } : item
      ));
    } else {
      const unitPrice = useBulk ? getBulkSellingPrice(product) : product.sellingPrice;
      const newItem: SaleItem = {
        productId: product.id,
        name: product.name,
        quantity: 1,
        unit: useBulk ? (product.parentUnit || 'Sacos') : product.baseUnit,
        unitPrice,
        totalPrice: unitPrice,
        category: product.category || 'Outro',
        costPrice: getUnitCost(product, effectiveUnit),
        buyingPrice: getUnitCost(product, effectiveUnit),
        isService: product.isService,
        sellingUnit: effectiveUnit
      };
      setRetroactiveCart(prev => [...prev, newItem]);
    }
  };

  const updateRetroactiveCartQty = (productId: string, delta: number, sellingUnit: 'Bulk' | 'Retail' = 'Retail') => {
    setRetroactiveCart(prev => prev.map(item => {
      if (item.productId === productId && (item.sellingUnit || 'Retail') === sellingUnit) {
        const newQty = Math.max(1, item.quantity + delta);
        const updated = { ...item, quantity: newQty, totalPrice: newQty * item.unitPrice };
        return { ...updated, discountValue: clampItemDiscountValue(updated, updated.discountType || 'line_total', updated.discountValue || 0) };
      }
      return item;
    }));
  };

  const updateRetroactiveCartDiscount = (productId: string, type: ItemDiscountType, value: number, sellingUnit: 'Bulk' | 'Retail' = 'Retail') => {
    setRetroactiveCart(prev => prev.map(item =>
      item.productId === productId && (item.sellingUnit || 'Retail') === sellingUnit
        ? { ...item, discountType: type, discountValue: clampItemDiscountValue(item, type, value) }
        : item
    ));
  };

  const removeRetroactiveCartItem = (productId: string, sellingUnit: 'Bulk' | 'Retail' = 'Retail') => {
    setRetroactiveCart(prev => prev.filter(
      item => !(item.productId === productId && (item.sellingUnit || 'Retail') === sellingUnit)
    ));
  };

  const handleFinalizeRetroactiveSale = async () => {
    // Um ref bloqueia mesmo dois cliques antes do próximo render do React.
    if (retroactiveFinalizingRef.current) return;
    if (retroactiveCart.length === 0) {
      setRetroactiveError('Adicione pelo menos um produto ao carrinho da venda!');
      return;
    }

    const parsedDate = retroactiveDateTime ? new Date(retroactiveDateTime) : new Date();
    if (isNaN(parsedDate.getTime())) {
      setRetroactiveError('A data e hora da venda são inválidas. Verifique o campo "Data e Hora Real".');
      return;
    }
    if (parsedDate.getTime() > Date.now() + 60000) {
      setRetroactiveError('A data/hora da venda não pode ser no futuro. Corrija o campo "Data e Hora Real".');
      return;
    }

    retroactiveFinalizingRef.current = true;
    setIsFinalizingRetroactive(true);
    setRetroactiveError('');
    setRetroactiveSlow(false);

    // Watchdog: se a gravação demorar mais de 8 s avisamos o operador. O Firestore
    // fica pendente quando não há ligação — nunca abortamos a escrita aqui, para
    // não duplicar vendas; apenas deixamos de estar "mudos".
    const slowTimer = window.setTimeout(() => setRetroactiveSlow(true), 8000);

    let salePersisted = false;
    let completedSale: Sale | null = null;

    const closeCompletedRetroactiveSale = (sale: Sale) => {
      setShowRetroactiveModal(false);
      setRetroactiveCart([]);
      setRetroactiveReceiptNo('');
      setRetroactiveCustomerName('Cliente Geral');
      setRetroactiveCustomerNuit('');
      setRetroactiveCustomerAddress('');
      setRetroactiveSaveCustomer(false);
      setSelectedRegisteredCustomer('');
      setRetroactiveProductQuery('');
      setRetroactivePaymentMethod('Dinheiro');
      // The selected date is intentionally preserved across consecutive entries.
      setRetroactiveCompletedSale(sale);
    };

    try {
      const { subtotal: sub, discount: disc, total: tot } = retroactiveTotals;

      let finalCustomerName = retroactiveCustomerName.trim() || 'Cliente Geral';
      let finalCustomerNuit = retroactiveCustomerNuit.trim() || undefined;
      let finalCustomerAddress = retroactiveCustomerAddress.trim() || undefined;

      if (retroactiveCustomerMode === 'registered' && selectedRegisteredCustomer) {
        const found = registeredCustomers.find(c => c.id === selectedRegisteredCustomer || c.name === selectedRegisteredCustomer);
        if (found) {
          finalCustomerName = found.name;
          finalCustomerNuit = found.nuit || undefined;
          finalCustomerAddress = found.address || undefined;
        }
      }

      if (retroactiveCustomerMode === 'manual' && retroactiveSaveCustomer && finalCustomerName && finalCustomerName !== 'Cliente Geral') {
        const alreadyExists = registeredCustomers.some(
          c => c.name.trim().toLowerCase() === finalCustomerName.trim().toLowerCase()
        );
        if (!alreadyExists) {
          const newCust: Customer = {
            id: uid('cust-'),
            name: finalCustomerName,
            nuit: finalCustomerNuit,
            address: finalCustomerAddress
          };
          await dbService.saveCustomer(newCust);
          setRegisteredCustomers(prev => [...prev, newCust]);
        }
      }

      const existingSales = await dbService.getSales();
      const invoiceNum = await reserveDocumentNumber(
        generateNextInvoiceNumber(existingSales, 'FaturaDefinitiva'),
        (key, min) => dbService.nextDocumentNumber(key, min)
      );
      const manualRec = retroactiveReceiptNo.trim() || undefined;
      const receiptNum = manualRec || await reserveDocumentNumber(
        generateNextReceiptNumber(existingSales, 'Thermal'),
        (key, min) => dbService.nextDocumentNumber(key, min)
      );
      const saleDateISO = parsedDate.toISOString();

      const newSale: Sale = {
        id: uid('sale-retro-'),
        invoiceNumber: invoiceNum,
        receiptNumber: receiptNum,
        manualReceiptReference: manualRec,
        date: saleDateISO,
        createdAt: new Date().toISOString(),
        customerName: finalCustomerName,
        customerNuit: finalCustomerNuit,
        customerAddress: finalCustomerAddress,
        items: retroactiveCart.map(item => ({
          ...item,
          totalPrice: Math.round(((item.unitPrice * item.quantity) - getItemDiscount(item)) * 100) / 100
        })),
        subtotal: sub,
        discount: disc,
        total: tot,
        paymentMethod: retroactivePaymentMethod,
        status: 'Paga',
        documentType: 'FaturaDefinitiva',
        operatorId: currentUser.username,
        operatorName: currentUser.username,
        synced: settings?.mode === 'Online',
        includeIva: false,
        ivaAmount: 0,
        notes: manualRec ? `Venda Antiga / Lançamento Retroactivo — Recibo Manuscrito: ${manualRec}` : 'Venda Antiga / Lançamento Retroactivo'
      };

      if (retroactiveDeductStock) {
        for (const item of retroactiveCart) {
          const prod = products.find(product => product.id === item.productId);
          if (!prod || prod.isService || item.isService) continue;
          if (prod.stockQty < item.quantity) {
            setRetroactiveError(`Stock insuficiente para "${prod.name}" (disponível: ${prod.stockQty}, solicitado: ${item.quantity}). Desmarque "Descontar do Stock Actual" se o inventário físico já reflecte esta saída.`);
            setIsFinalizingRetroactive(false);
            return;
          }
        }
        // Mesma regra do PDV normal: saco desconta grosso + equivalente em unidade base;
        // retalho desconta retalho + unidade base.
        const deductionItems = retroactiveCart.flatMap(item => {
          const prod = products.find(product => product.id === item.productId);
          const quantity = Number(item.quantity) || 0;
          if (!prod || prod.isService || item.isService || quantity <= 0) return [];

          const hasConversion = isHybridProduct(prod);
          if (hasConversion && item.sellingUnit === 'Bulk') {
            return [{
              productId: prod.id,
              hasConversion: true,
              sellingUnit: 'Bulk' as const,
              qtyToReduce: quantity,
              equivalentBaseQty: quantity * (Number(prod.conversionRate) || 1)
            }];
          }
          return [{
            productId: prod.id,
            hasConversion,
            sellingUnit: hasConversion ? 'Retail' as const : undefined,
            qtyToReduce: quantity
          }];
        });
        // Keep the historic sale and its stock movement in one atomic batch.
        await dbService.addSaleWithStockDeduction(newSale, deductionItems);
      } else {
        await dbService.addSale(newSale);
      }

      salePersisted = true;
      completedSale = newSale;
      // Clear the form immediately after the committed write to prevent a
      // duplicate sale if printing or a refresh has a temporary problem.
      closeCompletedRetroactiveSale(newSale);

      void dbService.addAuditLog({
        id: uid('log-'),
        timestamp: new Date().toISOString(),
        username: currentUser.username,
        ipAddress: '127.0.0.1',
        action: `Venda Antiga Registada (${newSale.invoiceNumber})`,
        status: 'Sucesso',
        details: `Lançamento retroactivo de ${saleDateISO.slice(0, 10)}. Total: ${tot}MT. Recibo: ${manualRec || 'Auto'}`
      });

      await runPostCommitTasks([
        {
          label: 'atualizar o catálogo depois da venda antiga',
          task: async () => setProducts((await dbService.getProducts()).filter(p => p.isActive !== false))
        },
        {
          label: 'atualizar o histórico depois da venda antiga',
          task: async () => setSales(await dbService.getSales())
        }
      ]);

      let receiptGenerated = true;
      if (settings) {
        receiptGenerated = await runPostCommitTask({
          label: 'gerar o recibo da venda antiga',
          task: () => downloadThermalReceipt(newSale, settings)
        });
        if (isSerialPrinterConnected()) {
          void runPostCommitTask({
            label: 'enviar o recibo antigo para a impressora térmica',
            task: () => printDirectThermalESC_POS(newSale, settings)
          });
        }
      }

      if (receiptGenerated) {
        showToast(`Venda antiga de ${tot.toLocaleString('pt-PT')} MT registada com sucesso!`, 'success');
      } else {
        showToast('Venda antiga registada com sucesso. O recibo não foi gerado agora; pode reimprimir pela janela de opções.', 'warning');
      }
    } catch (err) {
      const info = describeError(err, 'Não foi possível registar a venda antiga.');
      console.error('[PDV] Error finalizing retroactive sale:', info.raw);
      if (salePersisted && completedSale) {
        closeCompletedRetroactiveSale(completedSale);
        showToast('A venda antiga foi registada com sucesso. Alguns passos posteriores falharam; confirme-a no histórico antes de repetir.', 'warning');
      } else {
        // Dupla via de feedback: o banner dentro do modal é impossível de tapar e
        // o Toast global confirma que todas as notificações usam o portal superior.
        setRetroactiveError(`${info.title} ${info.hint}`.trim());
        showToast(info.title, 'error');
      }
    } finally {
      window.clearTimeout(slowTimer);
      retroactiveFinalizingRef.current = false;
      setIsFinalizingRetroactive(false);
      setRetroactiveSlow(false);
    }
  };

  // Unrecognized Barcode States
  const [unrecognizedBarcode, setUnrecognizedBarcode] = useState<string | null>(null);
  const [selectedProductToAssociate, setSelectedProductToAssociate] = useState<string>('');
  const [associationSearch, setAssociationSearch] = useState('');

  const barcodeInputRef = useRef<HTMLInputElement>(null);
  const scannerBufferRef = useRef<string>('');
  const lastKeyTimeRef = useRef<number>(0);

  const productsRef = useRef(products);
  productsRef.current = products;

  const cartRef = useRef(cart);
  cartRef.current = cart;

  const defaultPrinterRef = useRef(defaultPrinter);
  defaultPrinterRef.current = defaultPrinter;

  const handleFinalizeSaleRef = useRef<((format: 'A4' | 'Thermal' | 'DoubleA5' | 'ReciboA4' | 'FaturaProforma') => Promise<void>) | null>(null);

  // Auto-print effect is removed in favor of automatic PDF high-fidelity downloads
  useEffect(() => {
    // Automatic native browser printing (window.print) disabled per requirements.
    // High-fidelity PDFs are downloaded automatically upon transaction finalization.
  }, [invoiceToPrint, printType]);

  // Real Camera Barcode/QR Scanner effect using html5-qrcode
  useEffect(() => {
    if (showScanner) {
      setScannerStatus('Inicializando câmara...');
      setScanResult(null);
      setScanQty(1);

      // Create a small delay to ensure the container with id 'reader-container' is rendered
      const timer = setTimeout(() => {
        try {
          const scannerInstance = new Html5Qrcode('reader-container', {
            formatsToSupport: [
              Html5QrcodeSupportedFormats.EAN_13,
              Html5QrcodeSupportedFormats.EAN_8,
              Html5QrcodeSupportedFormats.CODE_128,
              Html5QrcodeSupportedFormats.CODE_39,
              Html5QrcodeSupportedFormats.UPC_A,
              Html5QrcodeSupportedFormats.UPC_E,
              Html5QrcodeSupportedFormats.QR_CODE
            ],
            verbose: false
          });
          html5QrCodeRef.current = scannerInstance;

          scannerInstance.start(
            { facingMode: 'environment' },
            {
              fps: 15,
              qrbox: (width, height) => {
                // Focus on a horizontal strip in the center for barcodes
                return {
                  width: Math.floor(width * 0.85),
                  height: Math.min(Math.floor(height * 0.5), 200)
                };
              }
            },
            (decodedText) => {
              
              // Strict Validation: Only accept valid EAN-13 or confirmed patterns to avoid ghost scans
              const isEAN13 = /^\d{13}$/.test(decodedText);
              
              // Checksum validation for EAN-13 if it looks like one
              if (isEAN13) {
                let sum = 0;
                for (let i = 0; i < 12; i++) {
                  sum += parseInt(decodedText[i]) * (i % 2 === 0 ? 1 : 3);
                }
                const checkDigit = (10 - (sum % 10)) % 10;
                if (checkDigit !== parseInt(decodedText[12])) {
                  console.warn('[Scanner] EAN-13 Checksum failed for:', decodedText);
                  setScannerStatus('Erro: Código EAN-13 inválido (Checksum) ❌');
                  return;
                }
              }

              // Find matching product by code (case insensitive/trimmed)
              const currentProds = productsRef.current;
              const matchedProduct = currentProds.find(p => 
                p.code.trim().toLowerCase() === decodedText.trim().toLowerCase() ||
                (p.reference && p.reference.trim().toLowerCase() === decodedText.trim().toLowerCase())
              );

              if (matchedProduct) {
                setScanResult(matchedProduct);
                setScannerStatus(`Artigo Lido: ${matchedProduct.name} 🟢`);
                playScannerBeep();
              } else {
                // Product not found, let's allow user to associate it later
                const tempProduct: Product = {
                  id: 'unrecognized-' + decodedText,
                  code: decodedText,
                  name: `Artigo não cadastrado (${decodedText})`,
                  category: 'Geral',
                  stockQty: 0,
                  buyingPrice: 0,
                  sellingPrice: 0,
                  baseUnit: 'Unidades'
                };
                setScanResult(tempProduct);
                setScannerStatus(`Código ${decodedText} não cadastrado ⚠️`);
                playScannerBeep();
              }
            },
            (errorMessage) => {
              // Ignore standard reading errors to prevent console spam
            }
          ).then(() => {
            setScannerStatus('Aponte a câmara para o código de barras...');
          }).catch(err => {
            console.error('Html5Qrcode start error:', err);
            setScannerStatus('Erro ao iniciar câmara.');
          });
        } catch (e) {
          console.error('Html5Qrcode initialization error:', e);
          setScannerStatus('Erro ao inicializar scanner.');
        }
      }, 300);

      return () => {
        clearTimeout(timer);
        if (html5QrCodeRef.current) {
          const currentScanner = html5QrCodeRef.current;
          if (currentScanner.isScanning) {
            currentScanner.stop().catch(err => {
              console.error('[Real Scanner] Error stopping scanner in cleanup:', err);
            });
          }
          html5QrCodeRef.current = null;
        }
      };
    }
  }, [showScanner]);

  useEffect(() => {
    loadPDVData();

    let debounceTimer: any = null;
    const handleDbUpdate = (e: any) => {
      const updatedTable = e.detail?.table;
      if (!updatedTable || updatedTable === 'all' || updatedTable === 'products' || updatedTable === 'sales' || updatedTable === 'customers' || updatedTable === 'paused_sales') {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          loadPDVData();
        }, 150);
      }
    };
    window.addEventListener('db-update', handleDbUpdate);

    return () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('db-update', handleDbUpdate);
    };
  }, []);

  // Setup key listeners for rapid POS operations (F2 for search, F9 for checkout, F1/F3/F4/F5 for payment methods)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setPaymentMethod('Dinheiro');
        showToast('Pagamento: Dinheiro selecionado (F1)', 'success');
      }
      if (e.key === 'F2') {
        e.preventDefault();
        barcodeInputRef.current?.focus();
        showToast('Pesquisa focada para digitalização!', 'success');
      }
      if (e.key === 'F3') {
        e.preventDefault();
        setPaymentMethod('M-Pesa');
        showToast('Pagamento: M-Pesa selecionado (F3)', 'success');
      }
      if (e.key === 'F4') {
        e.preventDefault();
        setPaymentMethod('E-Mola');
        showToast('Pagamento: E-Mola selecionado (F4)', 'success');
      }
      if (e.key === 'F5') {
        e.preventDefault();
        setPaymentMethod('Transferência');
        showToast('Pagamento: Transferência selecionada (F5)', 'success');
      }
      if (e.key === 'F9') {
        e.preventDefault();
        if (handleFinalizeSaleRef.current) {
          handleFinalizeSaleRef.current(defaultPrinterRef.current);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []);

  // Global hardware barcode scanner keydown listener
  useEffect(() => {
    const handleGlobalScanner = (e: KeyboardEvent) => {
      // Ignore helper key releases or modifiers
      if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') {
        return;
      }

      const currentTime = Date.now();
      const timeDiff = currentTime - lastKeyTimeRef.current;
      lastKeyTimeRef.current = currentTime;

      // If the search/barcode input is active, allow native input flow
      if (document.activeElement === barcodeInputRef.current) {
        return;
      }

      // If typing in another input (e.g. customer name), do not process as scanner
      const isTypingInOtherInput = document.activeElement && (
        document.activeElement.tagName === 'INPUT' ||
        document.activeElement.tagName === 'TEXTAREA' ||
        document.activeElement.tagName === 'SELECT'
      );

      if (isTypingInOtherInput) {
        return;
      }

      if (timeDiff > 100) {
        // Slow key interval: Reset scanner buffer with current key
        if (e.key !== 'Enter') {
          scannerBufferRef.current = e.key;
        } else {
          scannerBufferRef.current = '';
        }
      } else {
        // Fast key interval: Accumulate keys
        if (e.key !== 'Enter') {
          scannerBufferRef.current += e.key;
        } else {
          // Scanner finished sending and sent 'Enter'
          const rawScannedCode = scannerBufferRef.current.trim();
          const scannedCode = normalizeCode(rawScannedCode);
          scannerBufferRef.current = '';
          
          if (scannedCode.length >= 4) {
            const currentProds = productsRef.current;
            const found = currentProds.find(p => {
              const codeMatch = p.code.trim().toLowerCase() === scannedCode.toLowerCase();
              const refMatch = p.reference && p.reference.trim().toLowerCase() === scannedCode.toLowerCase();
              return codeMatch || refMatch;
            });

            if (found) {
              addToCart(found, 1);
              showToast(`Scanner: ${found.name} adicionado ao carrinho!`, 'success');
            } else {
              setUnrecognizedBarcode(scannedCode);
              setSelectedProductToAssociate('');
              showToast(`Código "${scannedCode}" não encontrado. Deseja associá-lo a um produto?`, 'error');
            }
          }
        }
      }
    };

    window.addEventListener('keydown', handleGlobalScanner);
    return () => {
      window.removeEventListener('keydown', handleGlobalScanner);
    };
  }, []);

  const loadPDVData = async () => {
    await dbService.init();
    // PDV deliberately keeps a complete live catalogue and sales cache: it
    // needs them for barcode lookup, stock validation and receipt sequencing.
    await dbService.enableLiveCatalogAndSalesSync();
    // Artigos desactivados saem do balcão: ficam no histórico, não à venda.
    const prodList = (await dbService.getProducts()).filter(p => p.isActive !== false);
    setProducts(prodList);

    const config = await dbService.getSettings();
    setSettings(config);

    const salesList = await dbService.getSales();
    setSales(salesList || []);

    // Retrieve customers
    try {
      const custList = await dbService.getCustomers();
      setRegisteredCustomers(custList || []);
    } catch (err) {
      console.error('Error fetching customers:', err);
    }

    // Retrieve paused sales
    try {
      const pausedList = await dbService.getPausedSales();
      setPausedSales(pausedList || []);
    } catch (err) {
      console.error('Error fetching paused sales:', err);
    }

    // Retrieve banking info from general settings mock
    const pInfo: PaymentInfo = {
      banco: (config as any).banco || 'First Capital Bank, S.A.',
      numeroConta: (config as any).numero_conta || '99466610001',
      nib: (config as any).nib || '001000000099466610196',
      mpesa: (config as any).mpesa || '',
      emola: (config as any).emola || '',
      numerario: true
    };
    setPaymentConfig(pInfo);

    // Retrieve saved uncompleted cart
    try {
      const savedCart = await dbService.getActiveCart();
      if (savedCart && savedCart.cart && savedCart.cart.length > 0) {
        setSavedActiveCart(savedCart);
      }
    } catch (err) {
      console.error('Error fetching active cart:', err);
    }

    isInitialLoadCompletedRef.current = true;
  };

  const showToast = (msg: string, type: 'success' | 'error' | 'warning' = 'success') => {
    setToastMessage(msg);
    setToastType(type);
    // O temporizador pertence ao componente Toast. Dois temporizadores concorrentes
    // podiam apagar uma mensagem nova quando o temporizador da mensagem anterior
    // disparava, recriando uma falha silenciosa.
  };

  const handleSaveCustomer = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (isPausingSale) return;
    if (!newCustomerName.trim()) {
      showToast('Nome do cliente é obrigatório!', 'error');
      return;
    }

    const newCust: Customer = {
      id: uid('customer-'),
      name: newCustomerName.trim(),
      nuit: newCustomerNuit.trim() || undefined,
      address: newCustomerAddress.trim() || undefined,
      phone: newCustomerPhone.trim() || undefined,
    };

    setIsPausingSale(true);
    try {
      await dbService.saveCustomer(newCust);
      const custList = await dbService.getCustomers();
      setRegisteredCustomers(custList);
      
      // Select the newly created customer
      setCustomerName(newCust.name);
      setCustomerNuit(newCust.nuit || '');
      setCustomerAddress(newCust.address || '');

      // Reset form fields
      setNewCustomerName('');
      setNewCustomerNuit('');
      setNewCustomerAddress('');
      setNewCustomerPhone('');
      setShowCustomerModal(false);

      showToast(`Cliente "${newCust.name}" cadastrado com sucesso!`, 'success');
    } catch (err) {
      console.error('Error saving customer:', err);
      showToast('Erro ao cadastrar o cliente.', 'error');
    } finally {
      setIsPausingSale(false);
    }
  };

  const handleSelectCustomer = (cust: Customer) => {
    setCustomerName(cust.name);
    setCustomerNuit(cust.nuit || '');
    setCustomerAddress(cust.address || '');
    showToast(`Cliente "${cust.name}" selecionado.`, 'success');
  };

  const handlePauseCurrentSale = async () => {
    if (isPausingSale) return;
    if (cart.length === 0) {
      showToast('O carrinho está vazio! Não há venda para pausar.', 'error');
      return;
    }

    setIsPausingSale(true);

    const pausedAt = new Date().toISOString();
    const pausedObj: PausedSale = {
      id: uid('paused-'),
      date: pausedAt,
      createdAt: pausedAt,
      customerName,
      customerNuit: customerNuit || undefined,
      customerAddress: customerAddress || undefined,
      items: [...cart],
      paymentMethod,
      documentType,
      includeIva,
      customSubtotalDiscount
    };

    try {
      await dbService.savePausedSale(pausedObj);
      const pausedList = await dbService.getPausedSales();
      setPausedSales(pausedList);

      // Reset current active cart and details
      setCart([]);
      setCustomerName('Cliente Geral');
      setCustomerNuit('');
      setCustomerAddress('');
      setCustomSubtotalDiscount(0);
      setIncludeIva(false);

      showToast('Venda pausada com sucesso!', 'success');
    } catch (err) {
      console.error('Error pausing sale:', err);
      showToast('Erro ao pausar a venda.', 'error');
    } finally {
      setIsPausingSale(false);
    }
  };

  const handleResumePausedSale = async (pausedId: string) => {
    const pSale = pausedSales.find(p => p.id === pausedId);
    if (!pSale) {
      showToast('Venda pausada não encontrada.', 'error');
      return;
    }

    const doRestore = async () => {
      // Restore paused sale parameters
      setCart(pSale.items);
      setCustomerName(pSale.customerName);
      setCustomerNuit(pSale.customerNuit || '');
      setCustomerAddress(pSale.customerAddress || '');
      setPaymentMethod(pSale.paymentMethod);
      setDocumentType(pSale.documentType);
      setIncludeIva(pSale.includeIva);
      setCustomSubtotalDiscount(pSale.customSubtotalDiscount);

      // Delete from paused store
      try {
        await dbService.deletePausedSale(pausedId);
        const pausedList = await dbService.getPausedSales();
        setPausedSales(pausedList);
        setShowPausedSalesModal(false);
        showToast('Venda recuperada com sucesso!', 'success');
      } catch (err) {
        console.error('Error deleting resumed sale:', err);
      }
    };

    // If active cart has items, ask or warn the user
    if (cart.length > 0) {
      askConfirmation(
        'Pausar Carrinho Ativo?',
        'O seu carrinho atual contém itens. Deseja salvar (pausar) a venda atual para não perder os dados antes de recuperar a anterior?',
        async () => {
          // Automatically pause current sale first
          await handlePauseCurrentSale();
          await doRestore();
        }
      );
    } else {
      await doRestore();
    }
  };

  const handleDeletePausedSale = async (pausedId: string) => {
    askConfirmation(
      'Eliminar Venda Pausada',
      'Deseja realmente excluir esta venda pausada definitivamente?',
      async () => {
        try {
          await dbService.deletePausedSale(pausedId);
          const pausedList = await dbService.getPausedSales();
          setPausedSales(pausedList);
          showToast('Venda pausada excluída.', 'success');
        } catch (err) {
          console.error('Error deleting paused sale:', err);
          showToast('Erro ao excluir a venda pausada.', 'error');
        }
      }
    );
  };

  // Helper to normalize code according to settings
  const normalizeCode = (rawCode: string) => {
    let cleaned = rawCode.trim();
    if (settings) {
      if (settings.barcodePrefix && cleaned.startsWith(settings.barcodePrefix)) {
        cleaned = cleaned.substring(settings.barcodePrefix.length);
      }
      if (settings.barcodeSuffix && cleaned.endsWith(settings.barcodeSuffix)) {
        cleaned = cleaned.substring(0, cleaned.length - settings.barcodeSuffix.length);
      }
    }
    return cleaned.trim();
  };

  // Barcode / SKU Smart Reader Handler
  const handleBarcodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Crucial: Synchronously capture the latest input value directly from the DOM input
    // to bypass any React state updating/batching delay when scanning.
    const rawQuery = (barcodeInputRef.current?.value || searchQuery).trim();
    const query = normalizeCode(rawQuery);
    
    if (!query) {
      return;
    }


    // Search specifically by code or SKU (exact match first)
    const found = products.find(p => {
      const codeMatch = p.code.trim().toLowerCase() === query.toLowerCase();
      const refMatch = p.reference && p.reference.trim().toLowerCase() === query.toLowerCase();
      if (codeMatch || refMatch) {
      }
      return codeMatch || refMatch;
    });

    if (found) {
      addToCart(found);
      setSearchQuery('');
      if (barcodeInputRef.current) {
        barcodeInputRef.current.value = '';
      }
    } else {
      
      // Fallback: If query contains the code or code contains the query
      const partialFound = products.find(p => {
        const queryContainsCode = p.code.trim().length >= 4 && query.toLowerCase().includes(p.code.trim().toLowerCase());
        const codeContainsQuery = p.code.trim().length >= 4 && p.code.trim().toLowerCase().includes(query.toLowerCase());
        
        if (queryContainsCode || codeContainsQuery) {
        }
        return queryContainsCode || codeContainsQuery;
      });

      if (partialFound) {
        addToCart(partialFound);
        setSearchQuery('');
        if (barcodeInputRef.current) {
          barcodeInputRef.current.value = '';
        }
        showToast(`Encontrado por semelhança: ${partialFound.name}`, 'success');
      } else {
        console.warn(`[Manual/Scan Input Search FAILED] No products matched "${query}" even with similarity fallbacks.`);
        
        // Diagnostics of closest matches removed (debug logging cleanup).

        setUnrecognizedBarcode(query);
        setSelectedProductToAssociate('');
        showToast('Produto ou Serviço com este código não encontrado.', 'error');
      }
    }
  };

  const handleAssociateBarcode = async () => {
    if (!unrecognizedBarcode || !selectedProductToAssociate) {
      showToast('Por favor, selecione um produto do catálogo.', 'error');
      return;
    }
    
    const prod = products.find(p => p.id === selectedProductToAssociate);
    if (!prod) {
      showToast('Produto selecionado não encontrado.', 'error');
      return;
    }
    
    try {
      const updatedProd: Product = {
        ...prod,
        code: unrecognizedBarcode
      };
      
      await dbService.saveProduct(updatedProd);
      showToast(`Código "${unrecognizedBarcode}" associado com sucesso a "${prod.name}"!`, 'success');
      
      // Reload the in-memory products list
      await loadPDVData();
      
      // Add the updated product to the cart
      addToCart(updatedProd, 1);
      
      // Clear state
      setUnrecognizedBarcode(null);
      setSelectedProductToAssociate('');
    } catch (err) {
      console.error('[Barcode Association Error]', err);
      showToast('Erro ao gravar associação de código de barras.', 'error');
    }
  };

  const addToCart = async (product: Product, customQty = 1, preferredUnit?: 'Bulk' | 'Retail') => {
    // Determine default selling unit
    const hasConversion = !!(product.parentUnit && product.conversionRate && product.conversionRate > 1);
    const selectedUnit = preferredUnit || (hasConversion ? 'Retail' : 'Retail');

    const currentCartItem = cart.find(item => item.productId === product.id && item.sellingUnit === selectedUnit);
    const existingQty = currentCartItem ? currentCartItem.quantity : 0;
    const requestedQty = existingQty + customQty;

    /**
     * Stock verificado **aqui**, não só ao gravar.
     *
     * Antes a conta usava o stock da última sincronização do ecrã e, nos
     * artigos híbridos, tratava sacos e quilos como gavetas separadas. O
     * resultado era descobrir a falta no fim, com o carrinho montado, ou
     * deixar passar uma venda sem mercadoria. Agora lê-se o stock do servidor
     * neste instante e a conta é feita em unidade base.
     */
    if (!product.isService) {
      const stockServidor = await dbService.getProductStock(String(product.id));
      const outrosNoCarrinho = cart
        .filter(item => item.productId === product.id && item.sellingUnit !== selectedUnit)
        .reduce((acc, item) => acc + lineBaseQty(product, item.quantity, item.sellingUnit), 0);

      const veredicto = checkStockAddition({
        product,
        serverStock: stockServidor ?? (Number(product.stockQty) || 0),
        inCartBase: outrosNoCarrinho,
        quantity: requestedQty,
        sellingUnit: selectedUnit
      });
      if (!veredicto.allowed) {
        showToast(veredicto.message, 'error');
        return;
      }
    }

    const itemPrice = hasConversion && selectedUnit === 'Bulk'
      ? (product.sellingPriceBulk && product.sellingPriceBulk > 0 ? product.sellingPriceBulk : product.sellingPrice * (product.conversionRate || 1))
      : product.sellingPrice;

    const unitName = hasConversion && selectedUnit === 'Bulk'
      ? product.parentUnit || 'Sacos'
      : product.baseUnit;

    if (currentCartItem) {
      setCart(
        cart.map(item =>
          item.productId === product.id && item.sellingUnit === selectedUnit
            ? { ...item, quantity: requestedQty, totalPrice: requestedQty * itemPrice }
            : item
        )
      );
    } else {
      setCart([
        ...cart,
        {
          productId: product.id,
          name: product.name + (hasConversion ? (selectedUnit === 'Bulk' ? ` (Revenda - ${getSingularUnit(product.parentUnit || 'Saco')})` : ` (Retalho - ${getSingularUnit(product.baseUnit || 'Kg')})`) : ''),
          quantity: customQty,
          unit: unitName,
          unitPrice: itemPrice,
          totalPrice: customQty * itemPrice,
          isService: product.isService,
          sellingUnit: selectedUnit,
          category: product.category || 'Outro',
          costPrice: getUnitCost(product, selectedUnit),
          buyingPrice: getUnitCost(product, selectedUnit)
        }
      ]);
    }
    const critLevel = settings?.criticalStockLevel || 10;
    if (!product.isService && product.stockQty <= critLevel) {
      showToast(`${product.name} adicionado! ATENÇÃO: Item com stock crítico (${product.stockQty} ${product.baseUnit} restantes!)`, 'error');
    } else {
      showToast(`${product.name} (${unitName}) adicionado ao carrinho!`, 'success');
    }
  };

  const updateCartQty = (productId: string, newQty: number | '', sellingUnit?: 'Bulk' | 'Retail') => {
    if (newQty === '') {
      setCart(
        cart.map(item =>
          item.productId === productId && item.sellingUnit === sellingUnit
            ? { ...item, quantity: '' as any, totalPrice: 0 }
            : item
        )
      );
      return;
    }

    if (newQty <= 0) {
      setCart(cart.filter(item => !(item.productId === productId && item.sellingUnit === sellingUnit)));
      return;
    }

    const prod = products.find(p => p.id === productId);
    if (!prod) return;

    if (!prod.isService) {
      const hasConversion = !!(prod.parentUnit && prod.conversionRate && prod.conversionRate > 1);
      if (hasConversion) {
        if (sellingUnit === 'Bulk') {
          const availableBulk = prod.stockQtyBulk || 0;
          if (newQty > availableBulk) {
            showToast(`Quantidade de revenda insuficiente. Disponível: ${availableBulk} ${prod.parentUnit}`, 'error');
            return;
          }
        } else {
          const availableRetail = prod.stockQtyRetail || 0;
          if (newQty > availableRetail) {
            showToast(`Quantidade de retalho insuficiente. Disponível: ${availableRetail} ${prod.baseUnit}`, 'error');
            return;
          }
        }
      } else {
        if (newQty > prod.stockQty) {
          showToast(`Quantidade insuficiente em stock. Stock disponível: ${prod.stockQty} ${prod.baseUnit}`, 'error');
          return;
        }
      }
    }

    setCart(
      cart.map(item => {
        if (item.productId !== productId || item.sellingUnit !== sellingUnit) return item;
        const updated = { ...item, quantity: newQty, totalPrice: newQty * item.unitPrice };
        return { ...updated, discountValue: clampItemDiscountValue(updated, updated.discountType || 'line_total', updated.discountValue || 0) };
      })
    );
  };

  const removeFromCart = (productId: string, sellingUnit?: 'Bulk' | 'Retail') => {
    setCart(cart.filter(item => !(item.productId === productId && item.sellingUnit === sellingUnit)));
    showToast('Produto removido do carrinho.', 'success');
  };

  const updateCartDiscount = (productId: string, type: ItemDiscountType, value: number, sellingUnit?: 'Bulk' | 'Retail') => {
    setCart(cart.map(item =>
      item.productId === productId && item.sellingUnit === sellingUnit
        ? { ...item, discountType: type, discountValue: clampItemDiscountValue(item, type, value) }
        : item
    ));
  };

  const cartTotals = getSaleTotals(cart, customSubtotalDiscount, includeIva);
  const getSubtotal = () => cartTotals.subtotal;
  const getDiscount = () => cartTotals.discount;
  const getTotal = () => cartTotals.total;

  const playScannerBeep = () => {
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.frequency.value = 1100;
      gain.gain.setValueAtTime(0.35, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } catch (e) {
      console.warn("Audio Context beep error", e);
    }
  };

  const downloadInvoicePDF = (sale: Sale, format: 'A4' | 'Thermal' | 'DoubleA5' | 'ReciboA4' | 'FaturaProforma') => {
    const s = settings || { companyName: 'AGRO - XICOMO & SERVI\u00c7OS, LDA', companyNuit: '401976590' } as SystemSettings;
    if (format === 'Thermal') {
      downloadThermalReceipt(sale, s);
    } else if (format === 'DoubleA5') {
      downloadDuplicatedInvoiceA4(sale, s);
    } else if (format === 'ReciboA4') {
      downloadReceiptA4(sale, s);
    } else if (format === 'FaturaProforma') {
      downloadInvoiceA4(sale, s, false, 'FACTURA PROFORMA');
    } else {
      downloadInvoiceA4(sale, s, false);
    }
  };

  // Direct checkout handler
  // D3 — crédito: limite por cliente, prazo e bloqueio de dívida vencida.
  // `creditAuthOk` guarda a autorização da gerência para ESTA venda; é limpa
  // depois de a venda gravar.
  const [creditAuthOk, setCreditAuthOk] = useState(false);
  // Formato de impressão que o operador tinha escolhido quando o crédito pediu
  // autorização: sem isto, o recibo sairia no papel errado depois de autorizar.
  const creditPendingFormatRef = useRef<'A4' | 'Thermal' | 'DoubleA5' | 'ReciboA4' | 'FaturaProforma'>('A4');
  const [creditAuth, setCreditAuth] = useState<{
    show: boolean;
    reasons: string[];
    outstanding: number;
    amount: number;
  }>({ show: false, reasons: [], outstanding: 0, amount: 0 });

  const handleFinalizeSale = async (printFormat: 'A4' | 'Thermal' | 'DoubleA5' | 'ReciboA4' | 'FaturaProforma') => {
    if (isFinalizing) return;
    if (cart.length === 0) {
      showToast('O carrinho está vazio!', 'error');
      return;
    }

    // ── Venda a crédito: verificar antes de tocar em dinheiro ou stock ──
    if (paymentMethod === 'Crédito') {
      const totalCredito = getSaleTotals(cart, customSubtotalDiscount, includeIva).total;
      try {
        const dividas = await dbService.getDebts();
        const decisao = canSellOnCredit({
          customerName,
          amount: totalCredito,
          debts: dividas,
          managerAuthorized: creditAuthOk
        });
        if (!decisao.allowed) {
          if (decisao.requiresManager) {
            creditPendingFormatRef.current = printFormat;
            setCreditAuth({ show: true, reasons: decisao.reasons, outstanding: decisao.outstanding, amount: totalCredito });
            return;
          }
          showToast(decisao.reasons[0] || 'Venda a crédito não autorizada.', 'error');
          return;
        }
        // Autorização da gerência vale para ESTA venda: consome-se aqui para
        // não ficar aberta para a venda seguinte.
        if (creditAuthOk) setCreditAuthOk(false);
      } catch (erro) {
        console.error('[PDV] Falha ao verificar dívidas do cliente:', erro);
        showToast('Não foi possível verificar as dívidas deste cliente. A venda a crédito não avançou.', 'error');
        return;
      }
    }

    setIsFinalizing(true);
    let salePersisted = false;

    const clearCompletedCheckout = () => {
      setCart([]);
      setCustomerName('Cliente Geral');
      setCustomerNuit('');
      setCustomerAddress('');
      setCustomSubtotalDiscount(0);
      setIncludeIva(false);
      setNewSaleStatus('Paga');
      setAmountReceived('');
      // A autorização de crédito vale para uma venda, não para o resto do dia.
      setCreditAuthOk(false);
    };

    try {
      const sub = getSubtotal();
      const disc = getDiscount();
      const tot = getTotal();
      const iva = cartTotals.ivaAmount;

      if (paymentMethod === 'Crédito' && (!customerName || customerName.trim().toLowerCase() === 'cliente geral')) {
        showToast('Venda a Crédito exige cliente identificado (não pode ser "Cliente Geral").', 'error');
        setIsFinalizing(false);
        return;
      }

      if (sub > 0 && (disc / sub) > 0.30) {
        showToast('Descontos superiores a 30% exigem autorização prévia da gerência.', 'error');
        setIsFinalizing(false);
        return;
      }

      // Determine document type from print option
      const effectiveDocType = printFormat === 'FaturaProforma' ? 'FaturaProforma' : 'FaturaDefinitiva';

      if (effectiveDocType === 'FaturaDefinitiva') {
        for (const item of cart) {
          const prod = products.find(p => p.id === item.productId);
          if (prod && !prod.isService) {
            const hasConversion = !!(prod.parentUnit && prod.conversionRate && prod.conversionRate > 1);
            if (hasConversion && item.sellingUnit === 'Bulk') {
              const availableBulk = prod.stockQtyBulk ?? Math.floor(prod.stockQty / (prod.conversionRate || 1));
              if (item.quantity > availableBulk) {
                showToast(`Stock insuficiente de "${prod.name}" (${prod.parentUnit}): disponível ${availableBulk}, solicitado ${item.quantity}.`, 'error');
                setIsFinalizing(false);
                return;
              }
            } else {
              const availableRetail = hasConversion ? (prod.stockQtyRetail ?? prod.stockQty) : prod.stockQty;
              if (item.quantity > availableRetail) {
                showToast(`Stock insuficiente de "${prod.name}": disponível ${availableRetail} ${prod.baseUnit}, solicitado ${item.quantity}.`, 'error');
                setIsFinalizing(false);
                return;
              }
            }
          }
        }
      }
      const finalizedItems = cart.map(item => {
        const prod = products.find(p => p.id === item.productId);
        const cost = item.costPrice ?? getUnitCost(prod, item.sellingUnit) ?? (item.unitPrice * 0.6);
        const cat = item.category || prod?.category || 'Outro';
        return {
          ...item,
          category: cat,
          costPrice: cost,
          buyingPrice: cost,
          totalPrice: Math.round(((item.unitPrice * item.quantity) - getItemDiscount(item)) * 100) / 100
        };
      });

      // Estado final (D2): depende do PAGAMENTO, nunca do papel impresso.
      const finalStatus: Sale['status'] = resolveSaleStatus({
        documentType: effectiveDocType,
        paymentMethod,
        emitWithoutReceipt: false
      });

      // Validação do pagamento (NEG-02): recusa-se fechar uma venda "Paga" sem
      // que o dinheiro (ou as linhas do múltiplo) cubram o total.
      const paymentCheck = validatePayment({
        paymentMethod,
        total: tot,
        amountReceived,
        multiLines: multiPaymentLines
      });
      if (!paymentCheck.ok) {
        showToast(paymentCheck.message || 'Pagamento inválido.', 'error');
        setIsFinalizing(false);
        return;
      }

      // Números sequenciais transaccionais (FAC-2026-N / REC-...): reservados
      // atomicamente para não duplicar entre vendedores simultâneos (D-01).
      const existingSales = await dbService.getSales();
      const invoiceNum = await reserveDocumentNumber(
        generateNextInvoiceNumber(existingSales, effectiveDocType),
        (key, min) => dbService.nextDocumentNumber(key, min)
      );
      const needsReceipt = requiresReceipt(finalStatus);
      const receiptNum = needsReceipt
        ? await reserveDocumentNumber(
            generateNextReceiptNumber(existingSales, printFormat),
            (key, min) => dbService.nextDocumentNumber(key, min)
          )
        : undefined;

      const activeBreakdown = paymentMethod === 'Múltiplo'
        ? multiPaymentLines.filter(l => l.amount > 0)
        : undefined;

      // Turno de caixa: a venda fica marcada com o turno em que entrou, para o
      // fecho do turno saber exactamente o que esperar. Se não houver turno
      // aberto a venda NÃO é bloqueada — o fecho trata-a pela hora.
      const shiftId = await currentShiftId();

      const newSale: Sale = {
        id: uid('sale-'),
        invoiceNumber: invoiceNum,
        cashSessionId: shiftId,
        receiptNumber: receiptNum,
        date: new Date().toISOString(),
        customerName,
        customerNuit: customerNuit || undefined,
        customerAddress: customerAddress || undefined,
        items: finalizedItems,
        subtotal: sub,
        discount: disc,
        total: tot,
        paymentMethod,
        paymentBreakdown: activeBreakdown,
        amountReceived: paymentCheck.received,
        changeGiven: paymentCheck.change,
        status: finalStatus,
        documentType: effectiveDocType,
        operatorId: currentUser.username,
        operatorName: currentUser.username,
        synced: settings?.mode === 'Online',
        includeIva,
        ivaAmount: iva
      };

      // The definitive invoice and stock movement are one Firestore batch. Do
      // not acknowledge the sale until this critical write has completed.
      if (effectiveDocType === 'FaturaDefinitiva') {
        const deductionItems = [];
        for (const item of cart) {
          const prod = products.find(p => p.id === item.productId);
          if (prod && !prod.isService) {
            const hasConversion = !!(prod.parentUnit && prod.conversionRate && prod.conversionRate > 1);
            if (hasConversion && item.sellingUnit === 'Bulk') {
              const qtyToReduce = item.quantity;
              const equivalentBaseQty = qtyToReduce * (prod.conversionRate || 1);
              deductionItems.push({ productId: prod.id, hasConversion, sellingUnit: 'Bulk', qtyToReduce, equivalentBaseQty });
            } else if (hasConversion) {
              deductionItems.push({ productId: prod.id, hasConversion, sellingUnit: 'Retail', qtyToReduce: item.quantity });
            } else {
              deductionItems.push({ productId: prod.id, hasConversion: false, qtyToReduce: item.quantity });
            }
          }
        }
        await dbService.addSaleWithStockDeduction(newSale, deductionItems);
      } else {
        await dbService.addSale(newSale);
      }

      salePersisted = true;
      // Clear the cart as soon as the transaction is committed. A later PDF or
      // refresh issue must never tempt the operator to submit the same sale.
      clearCompletedCheckout();

      // Audit, cash drawer, printing and screen refresh are post-commit tasks.
      // Their failures are intentionally isolated from the completed sale.
      void dbService.addAuditLog({
        id: uid('log-'),
        timestamp: new Date().toISOString(),
        username: currentUser.username,
        ipAddress: '127.0.0.1',
        action: `Venda Registada (${newSale.invoiceNumber})`,
        status: 'Sucesso',
        details: `Subtotal: ${sub}MT, Método: ${paymentMethod}`
      });

      if (paymentMethod === 'Dinheiro') {
        playChachingSound();
        void runPostCommitTask({
          label: 'acionar a gaveta de caixa',
          task: () => sendCashDrawerPulse()
        });
      }

      let directPrinted = false;
      if (isSerialPrinterConnected() && printFormat === 'Thermal') {
        const activeConfig = settings || { companyName: 'AGRO - XICOMO & SERVIÇOS, LDA', companyNuit: '401976590' } as SystemSettings;
        await runPostCommitTask({
          label: 'enviar o recibo para a impressora térmica',
          task: async () => {
            directPrinted = await printDirectThermalESC_POS(newSale, activeConfig);
          }
        });
      }

      let documentGenerated = true;
      if (printFormat === 'FaturaProforma') {
        documentGenerated = await runPostCommitTask({
          label: 'gerar a fatura proforma',
          task: () => downloadInvoicePDF(newSale, 'FaturaProforma')
        });
        setInvoiceToPrint(newSale);
        setPrintType('FaturaProforma');
      } else if (directPrint) {
        setInvoiceToPrint(null);
        setPrintType(null);

        if (!directPrinted) {
          documentGenerated = await runPostCommitTask({
            label: 'gerar o documento da venda',
            task: () => downloadInvoicePDF(newSale, printFormat)
          });

          if (printFormat === 'Thermal' && documentGenerated) {
            window.setTimeout(() => {
              void runPostCommitTask({
                label: 'abrir a impressão automática',
                task: () => window.print()
              }).then(completed => {
                if (!completed) {
                  showToast('Venda gravada com sucesso. A impressão automática não foi iniciada; pode reimprimir pelo histórico.', 'warning');
                }
              });
            }, 500);
          }
        }
      } else {
        documentGenerated = await runPostCommitTask({
          label: 'gerar a pré-visualização da venda',
          task: () => downloadInvoicePDF(newSale, printFormat)
        });
        setInvoiceToPrint(newSale);
        setPrintType(printFormat);
      }

      await runPostCommitTasks([
        {
          label: 'atualizar o catálogo depois da venda',
          task: async () => setProducts((await dbService.getProducts()).filter(p => p.isActive !== false))
        },
        {
          label: 'atualizar o histórico de vendas',
          task: async () => setSales(await dbService.getSales())
        }
      ]);

      if (!documentGenerated) {
        showToast('Venda finalizada e gravada com sucesso. Não foi possível gerar o documento agora; use o histórico para reimprimir.', 'warning');
      } else if (directPrint) {
        showToast('Venda finalizada com sucesso! Documento enviado ou descarregado automaticamente.', 'success');
      } else {
        showToast('Venda finalizada com sucesso! Pré-visualização gerada.', 'success');
      }
    } catch (err) {
      const info = describeError(err, 'Não foi possível gravar a venda no sistema.');
      console.error('[PDV] Erro ao finalizar venda:', info.raw);
      if (salePersisted) {
        clearCompletedCheckout();
        showToast('A venda foi gravada com sucesso. Alguns passos posteriores não foram concluídos; consulte o histórico antes de repetir a operação.', 'warning');
      } else {
        showToast(`${info.title} ${info.hint}`.trim(), 'error');
      }
    } finally {
      setIsFinalizing(false);
    }
  };
  handleFinalizeSaleRef.current = handleFinalizeSale;

  const handlePayInvoice = (sale: Sale) => {
    askConfirmation(
      'Liquidar Fatura',
      `Deseja realmente registar o pagamento da fatura ${sale.invoiceNumber} no valor de ${sale.total.toLocaleString()} MT? Esta ação irá alterar o estado do documento para "Paga" e emitir o recibo.`,
      async () => {
        let paymentSaved = false;
        try {
          const updatedSale: Sale = { ...sale, status: 'Paga' };
          await dbService.addSale(updatedSale);
          paymentSaved = true;

          setInvoiceToPrint(updatedSale);
          setPrintType('ReciboA4');
          const receiptGenerated = await runPostCommitTask({
            label: 'gerar o recibo da fatura liquidada',
            task: () => downloadInvoicePDF(updatedSale, 'ReciboA4')
          });
          await runPostCommitTask({
            label: 'atualizar o histórico após liquidar a fatura',
            task: async () => setSales(await dbService.getSales())
          });

          if (receiptGenerated) {
            showToast(`Fatura ${sale.invoiceNumber} paga com sucesso! Recibo gerado em A4.`, 'success');
          } else {
            showToast(`Fatura ${sale.invoiceNumber} foi liquidada com sucesso. O recibo pode ser reimpresso pelo histórico.`, 'warning');
          }
        } catch (err) {
          const info = describeError(err, 'Não foi possível liquidar a fatura.');
          console.error('[PDV] Erro ao liquidar fatura:', info.raw);
          if (paymentSaved) {
            showToast(`A fatura ${sale.invoiceNumber} foi liquidada com sucesso. Consulte o histórico antes de repetir a operação.`, 'warning');
          } else {
            showToast(`${info.title} ${info.hint}`.trim(), 'error');
          }
        }
      }
    );
  };

  const handleCancelInvoice = (sale: Sale) => {
    askConfirmation(
      'Cancelar Fatura',
      `Deseja realmente cancelar a fatura ${sale.invoiceNumber}? Esta ação irá anular este documento no histórico de vendas de forma permanente.`,
      async () => {
        let cancellationSaved = false;
        try {
          // Revert stock and update the invoice in the same batch whenever this
          // is a definitive invoice. This prevents a cancelled invoice from
          // being shown as failed after its stock has already been restored.
          if (sale.status !== 'Cancelada' && (!sale.documentType || sale.documentType === 'FaturaDefinitiva')) {
            const products = await dbService.getProducts();
            const restockItems: any[] = [];
            for (const item of (sale.items || [])) {
              if (!item) continue;
              const prod = products.find(p => String(p.id) === String(item.productId));
              if (prod && !prod.isService) {
                const hasConversion = Boolean(prod.parentUnit && prod.conversionRate && Number(prod.conversionRate) > 1);
                const qtyToAdd = Number(item.quantity) || 0;
                if (qtyToAdd <= 0) continue;
                if (hasConversion && item.sellingUnit === 'Bulk') {
                  restockItems.push({
                    productId: String(prod.id),
                    hasConversion: true,
                    sellingUnit: 'Bulk',
                    qtyToAdd,
                    equivalentBaseQty: qtyToAdd * (Number(prod.conversionRate) || 1)
                  });
                } else if (hasConversion) {
                  restockItems.push({ productId: String(prod.id), hasConversion: true, sellingUnit: 'Retail', qtyToAdd });
                } else {
                  restockItems.push({ productId: String(prod.id), hasConversion: false, qtyToAdd });
                }
              }
            }
            await dbService.cancelSaleWithStockRestoration(sale, restockItems);
          } else {
            await dbService.addSale({ ...sale, id: String(sale.id || uid('sale-')), status: 'Cancelada' });
          }

          cancellationSaved = true;
          await runPostCommitTasks([
            {
              label: 'atualizar o histórico depois de cancelar a fatura',
              task: async () => setSales(await dbService.getSales())
            },
            {
              label: 'atualizar os dados do PDV depois de cancelar a fatura',
              task: () => loadPDVData()
            }
          ]);
          showToast(`Fatura ${sale.invoiceNumber} cancelada com sucesso.`, 'success');
        } catch (err) {
          const info = describeError(err, 'Não foi possível cancelar a fatura.');
          console.error('[PDV] Erro ao cancelar fatura:', info.raw);
          if (cancellationSaved) {
            showToast(`A fatura ${sale.invoiceNumber} foi cancelada com sucesso. Alguns dados visuais serão atualizados em seguida.`, 'warning');
          } else {
            showToast(`${info.title} ${info.hint}`.trim(), 'error');
          }
        }
      }
    );
  };

  const handleRestoreInvoice = async (sale: Sale) => {
    let restorationSaved = false;
    try {
      const updatedSale: Sale = { ...sale, id: String(sale.id || uid('sale-')), status: 'Pendente' };

      // Reapply the original stock deduction and restore the invoice status in
      // one batch. A partial stock-only restore must never be reported as an
      // error after the action has already changed the database.
      if (sale.status === 'Cancelada' && (!sale.documentType || sale.documentType === 'FaturaDefinitiva')) {
        const products = await dbService.getProducts();
        const deductionItems: any[] = [];
        for (const item of (sale.items || [])) {
          if (!item) continue;
          const prod = products.find(p => String(p.id) === String(item.productId));
          if (!prod || prod.isService) continue;

          const hasConversion = Boolean(prod.parentUnit && prod.conversionRate && Number(prod.conversionRate) > 1);
          const qtyToReduce = Number(item.quantity) || 0;
          if (qtyToReduce <= 0) continue;
          if (hasConversion && item.sellingUnit === 'Bulk') {
            deductionItems.push({
              productId: String(prod.id),
              hasConversion: true,
              sellingUnit: 'Bulk',
              qtyToReduce,
              equivalentBaseQty: qtyToReduce * (Number(prod.conversionRate) || 1)
            });
          } else if (hasConversion) {
            deductionItems.push({ productId: String(prod.id), hasConversion: true, sellingUnit: 'Retail', qtyToReduce });
          } else {
            deductionItems.push({ productId: String(prod.id), hasConversion: false, qtyToReduce });
          }
        }
        await dbService.addSaleWithStockDeduction(updatedSale, deductionItems);
      } else {
        await dbService.addSale(updatedSale);
      }

      restorationSaved = true;
      await runPostCommitTasks([
        {
          label: 'atualizar o histórico depois de restaurar a fatura',
          task: async () => setSales(await dbService.getSales())
        },
        {
          label: 'atualizar os dados do PDV depois de restaurar a fatura',
          task: () => loadPDVData()
        }
      ]);
      showToast(`Fatura ${sale.invoiceNumber} restaurada para o estado Pendente.`, 'success');
    } catch (err) {
      const info = describeError(err, 'Não foi possível restaurar a fatura.');
      console.error('[PDV] Erro ao restaurar fatura:', info.raw);
      if (restorationSaved) {
        showToast(`A fatura ${sale.invoiceNumber} foi restaurada com sucesso. Alguns dados visuais serão atualizados em seguida.`, 'warning');
      } else {
        showToast(`${info.title} ${info.hint}`.trim(), 'error');
      }
    }
  };

  // Real Camera Barcode/QR Scanner Trigger
  const simulateCameraScan = () => {
    setShowScanner(true);
    setScannerStatus('Aponte a câmara para o código de barras...');
    setScanResult(null);
    setScanQty(1);
  };

  const applyScanResult = () => {
    if (scanResult) {
      if (scanResult.id.startsWith('unrecognized-')) {
        setUnrecognizedBarcode(scanResult.code);
        setShowScanner(false);
        showToast(`Código "${scanResult.code}" não encontrado. Deseja associá-lo a um produto?`, 'error');
      } else {
        playScannerBeep();
        addToCart(scanResult, scanQty);
        setShowScanner(false);
        showToast(`Adicionado ao carrinho: ${scanQty}x ${scanResult.name}`, 'success');
      }
    }
  };

  const filteredProducts = products.filter(p => {
    if (p.isActive === false) return false;
    const matchCat = selectedCategory === 'Todas' || p.category === selectedCategory;
    const matchQuery =
      p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (p.reference && p.reference.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchCat && matchQuery;
  });

  const categories = ['Todas', 'Sementes', 'Químicos', 'Adubos', 'Ferramentas e Ferragens', 'Limpeza', 'Jardinagem e Irrigação', 'Máquinas e Equipamentos'];

  const filteredSales = sales.filter(s => {
    // 1. Filter by status tab
    if (faturasFilter !== 'Todas' && s.status?.toLowerCase() !== faturasFilter.toLowerCase()) {
      return false;
    }
    // 2. Filter by search input
    if (faturasSearch.trim()) {
      const query = faturasSearch.toLowerCase();
      const matchInvoice = s.invoiceNumber?.toLowerCase().includes(query);
      const matchCustomer = s.customerName?.toLowerCase().includes(query);
      const matchOperator = s.operatorName?.toLowerCase().includes(query) || s.operatorId?.toLowerCase().includes(query);
      const matchPayment = s.paymentMethod?.toLowerCase().includes(query);
      const matchNuit = s.customerNuit?.toLowerCase().includes(query);
      const matchTotal = s.total?.toString().includes(query);
      const matchItem = s.items?.some(i => i.productName?.toLowerCase().includes(query) || i.name?.toLowerCase().includes(query));

      return Boolean(matchInvoice || matchCustomer || matchOperator || matchPayment || matchNuit || matchTotal || matchItem);
    }
    return true;
  });

  return (
    <div className="flex flex-col lg:h-full lg:overflow-hidden" id="pdv_module_root">
      
      {/* Top Header Actions (Portaled to App.tsx) */}
      {document.getElementById('module-header-actions') && createPortal(
        <div className="flex items-center gap-2 shrink-0 flex-nowrap">
          <button
            type="button"
            onClick={() => {
              const now = new Date();
              const year = now.getFullYear();
              const month = String(now.getMonth() + 1).padStart(2, '0');
              const day = String(now.getDate()).padStart(2, '0');
              const hours = String(now.getHours()).padStart(2, '0');
              const minutes = String(now.getMinutes()).padStart(2, '0');
              setRetroactiveDateTime(`${year}-${month}-${day}T${hours}:${minutes}`);
              setRetroactiveReceiptNo('');
              setRetroactiveCustomerMode('manual');
              setRetroactiveCustomerName('Cliente Geral');
              setRetroactiveCustomerNuit('');
              setRetroactiveCustomerAddress('');
              setRetroactiveSaveCustomer(false);
              setRetroactivePaymentMethod('Dinheiro');
              setRetroactiveDeductStock(true);
              setRetroactiveCart([]);
              setRetroactiveProductQuery('');
              setRetroactiveError('');
              setRetroactiveSlow(false);
              setShowRetroactiveModal(true);
            }}
            className="px-2 py-1 font-extrabold text-[10px] sm:text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center gap-1 cursor-pointer bg-indigo-700 hover:bg-indigo-800 text-white whitespace-nowrap"
            title="Lançamento retroactivo / Vendas manuais sem energia"
          >
            <span className="material-symbols-outlined text-[15px]">edit_calendar</span>
            Venda Antiga
          </button>

          <button
            type="button"
            onClick={() => pausedSales.length > 0 && setShowPausedSalesModal(true)}
            className={`px-2 py-1 font-black text-[10px] sm:text-xs uppercase tracking-wider rounded-lg shadow-sm transition-all flex items-center gap-1 cursor-pointer whitespace-nowrap ${
              pausedSales.length > 0
                ? 'bg-amber-500 hover:bg-amber-600 text-white animate-pulse'
                : 'bg-gray-100 text-gray-400 border border-gray-200 opacity-60 cursor-not-allowed'
            }`}
            title={pausedSales.length > 0 ? 'Recuperar vendas pausadas anteriormente' : 'Nenhuma venda pausada de momento'}
          >
            <span className="material-symbols-outlined text-[15px]">pause_circle</span>
            Vendas Pausadas ({pausedSales.length})
          </button>



          <div className="flex bg-gray-100 p-0.5 rounded-lg border border-gray-200 shadow-inner shrink-0">
            <button
              type="button"
              onClick={() => setPdvTab('vendas')}
              className={`flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md text-[10px] sm:text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                pdvTab === 'vendas'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-gray-500 hover:text-gray-850'
              }`}
            >
              <span className="material-symbols-outlined text-[13px] sm:text-[15px]">shopping_cart</span>
              Terminal de Vendas
            </button>
            
            <button
              type="button"
              onClick={() => setPdvTab('relatorios')}
              className={`flex items-center gap-1 px-1.5 sm:px-2 py-0.5 sm:py-1 rounded-md text-[10px] sm:text-xs font-bold transition-all cursor-pointer whitespace-nowrap ${
                pdvTab === 'relatorios'
                  ? 'bg-white text-emerald-700 shadow-sm'
                  : 'text-gray-550 hover:text-gray-850'
              }`}
            >
              <span className="material-symbols-outlined text-[13px] sm:text-[15px]">insert_chart</span>
              Relatórios Diários de Vendas
            </button>
          </div>
        </div>,
        document.getElementById('module-header-actions')!
      )}

      {/* Toast global (portal z-[9999]): visível em qualquer tab e sobre qualquer modal */}
      <Toast message={toastMessage} type={toastType} duration={10000} onDismiss={() => setToastMessage('')} />

      {pdvTab === 'vendas' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start lg:items-stretch lg:flex-1 lg:min-h-0 lg:overflow-hidden mt-4" id="pdv_container">
          {/* Active Cart Recovery Banner */}
          {savedActiveCart && cart.length === 0 && (
            <div className="lg:col-span-12 bg-amber-50 border-2 border-amber-300 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-sm">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-amber-600 text-3xl shrink-0 mt-0.5">history</span>
                <div>
                  <h4 className="font-bold text-amber-950 text-sm">Venda Anterior não Finalizada Detetada</h4>
                  <p className="text-xs text-amber-800 leading-relaxed mt-0.5">
                    O sistema recuperou uma sessão que fechou inesperadamente com <strong>{savedActiveCart.cart.length} artigo(s)</strong> no valor total de <strong>{
                      getSavedCartTotal().toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                    } MT</strong> para o cliente <strong>{savedActiveCart.customerName}</strong>. Deseja restaurar este carrinho?
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={discardSavedCart}
                  className="px-3 py-1.5 border border-amber-400 text-amber-900 text-xs font-bold rounded-lg hover:bg-amber-100 transition-colors cursor-pointer"
                >
                  Descartar
                </button>
                <button
                  type="button"
                  onClick={restoreActiveCart}
                  className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white text-xs font-black uppercase tracking-wider rounded-lg shadow-sm transition-all cursor-pointer flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-[16px]">restore</span>
                  Recuperar Venda
                </button>
              </div>
            </div>
          )}

      {/* Main Product Selection Grid (8/12 widths) */}
      <div className="lg:col-span-8 flex flex-col space-y-3 lg:h-full lg:min-h-0">
        {/* Search and Filters bar */}
        <div className="bg-white p-1.5 border border-gray-200 rounded-xl shadow-sm flex flex-col md:flex-row items-stretch md:items-center gap-2">
          <form onSubmit={handleBarcodeSubmit} className="w-full md:w-1/4 md:min-w-[200px] flex gap-1.5 shrink-0">
            <div className="relative flex-1">
              <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-xs">search</span>
              <input
                ref={barcodeInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Pesquisar (F2)..."
                className="w-full bg-gray-50 border border-gray-200 rounded-lg pl-7 pr-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary truncate"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowProductImages(!showProductImages)}
              className={`flex items-center justify-center p-1 rounded-lg transition-colors shrink-0 ${
                showProductImages ? 'bg-indigo-600 text-white hover:bg-indigo-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
              title="Mostrar/Ocultar Imagens dos Produtos"
            >
              <span className="material-symbols-outlined text-[16px]">
                {showProductImages ? 'image' : 'hide_image'}
              </span>
            </button>
          </form>

          {/* Categories Horizontal Carousel */}
          <div className="flex-1 flex gap-1 overflow-x-auto pb-0.5 custom-scrollbar min-w-0">
            {categories.map(cat => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-2 py-0.5 text-[9.5px] rounded-full font-bold border whitespace-nowrap transition-colors ${
                  selectedCategory === cat
                    ? 'bg-primary border-primary text-white'
                    : 'bg-gray-50 hover:bg-gray-100 border-gray-200 text-gray-600'
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Catalog Products Container */}
        <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-2">
          {filteredProducts.map(prod => {
            const lowStock = !prod.isService && prod.stockQty <= 10;
            const noStock = !prod.isService && prod.stockQty === 0;

            return (
              <div
                key={prod.id}
                className={`bg-white border p-2 rounded-lg shadow-2xs relative flex flex-col justify-between transition-all group ${
                  noStock ? 'opacity-60 bg-gray-50 border-gray-200 cursor-not-allowed' : 'hover:border-primary border-gray-200 hover:shadow-sm'
                }`}
              >
                <div className="space-y-0.5">
                  <div className="font-bold text-gray-800 group-hover:text-primary transition-colors text-[11px] leading-tight line-clamp-2">
                    {prod.name}
                  </div>
                  <div className="text-[6px] font-mono text-gray-400 tracking-tight leading-none">
                    REF: {prod.code} {prod.reference ? `• ${prod.reference}` : ''}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {prod.isService ? (
                      <span className="bg-blue-100 text-blue-800 text-[6.5px] px-1 py-0.5 rounded font-bold uppercase tracking-wide leading-none">Serviço</span>
                    ) : noStock ? (
                      <span className="bg-red-100 text-red-800 text-[6.5px] px-1 py-0.5 rounded font-bold uppercase tracking-wide leading-none">Sem Stock</span>
                    ) : lowStock ? (
                      <span className="bg-orange-100 text-orange-800 text-[6.5px] px-1 py-0.5 rounded font-bold uppercase tracking-wide leading-none">Baixo Stock</span>
                    ) : (
                      <span className="bg-green-100 text-green-800 text-[6.5px] px-1 py-0.5 rounded font-bold uppercase tracking-wide leading-none">Disponível</span>
                    )}
                  </div>

                  {/* Vertical Rectangular Image positioned between the stock status and the price info */}
                  {showProductImages && prod.imageUrl && (
                    <div className="flex justify-center my-1 shrink-0">
                      <div className="w-14 h-16 bg-gray-50 rounded border border-gray-200 overflow-hidden shadow-2xs shrink-0">
                        <img 
                          src={prod.imageUrl} 
                          alt={prod.name} 
                          className="w-full h-full object-cover" 
                          referrerPolicy="no-referrer"
                          onError={(e) => {
                            (e.target as HTMLImageElement).src = 'https://images.unsplash.com/photo-1595974482597-4b8da8879bc5?auto=format&fit=crop&w=400&q=80';
                          }}
                        />
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-1.5 pt-1.5 border-t border-gray-100 flex flex-col gap-1">
                  <div className="flex justify-between items-end">
                    <div>
                      <p className="text-[7.5px] text-gray-400 font-bold uppercase">Preço Venda</p>
                      <p className="text-[11px] font-black text-primary">
                        {(() => {
                          const unit = hybridUnits[prod.id] || (prod.parentUnit === 'Sacos' ? 'Bulk' : 'Retail');
                          if (prod.parentUnit && prod.conversionRate && prod.conversionRate > 1 && unit === 'Bulk') {
                            const bulkPrice = prod.sellingPriceBulk && prod.sellingPriceBulk > 0 ? prod.sellingPriceBulk : (prod.sellingPrice * prod.conversionRate);
                            return `${bulkPrice.toLocaleString()} MT / ${getSingularUnit(prod.parentUnit || 'Saco')}`;
                          }
                          return `${prod.sellingPrice.toLocaleString()} MT / ${getSingularUnit(prod.baseUnit || 'Kg')}`;
                        })()}
                      </p>
                    </div>
                    <div className="text-right text-[9.5px] text-gray-500">
                      {!prod.isService && (
                        <>
                          {prod.parentUnit && prod.conversionRate && prod.conversionRate > 1 ? (
                            <div className="text-[8.5px] text-right text-gray-600 space-y-0.5">
                              <p className="font-bold text-emerald-700">{prod.parentUnit}: {prod.stockQtyBulk || 0}</p>
                              <p className="font-bold text-orange-700">{prod.baseUnit}: {prod.stockQtyRetail || 0}</p>
                            </div>
                          ) : (
                            <span className="font-semibold block text-gray-600">
                              {prod.stockQty} {prod.baseUnit}
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {/* Segmented visual selector for hybrid items */}
                  {prod.parentUnit && prod.conversionRate && prod.conversionRate > 1 && (
                    <div className="flex bg-slate-100 p-0.5 rounded-md border border-slate-200 text-[7.5px] font-bold gap-0.5 mt-0.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => setHybridUnits(prev => ({ ...prev, [prod.id]: 'Bulk' }))}
                        className={`flex-1 py-0.5 text-center rounded transition-all flex items-center justify-center gap-0.5 ${
                          (hybridUnits[prod.id] || (prod.parentUnit === 'Sacos' ? 'Bulk' : 'Retail')) === 'Bulk'
                            ? 'bg-emerald-700 text-white shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[10px]">inventory_2</span>
                        Atacado ({prod.parentUnit})
                      </button>
                      <button
                        type="button"
                        onClick={() => setHybridUnits(prev => ({ ...prev, [prod.id]: 'Retail' }))}
                        className={`flex-1 py-0.5 text-center rounded transition-all flex items-center justify-center gap-0.5 ${
                          (hybridUnits[prod.id] || (prod.parentUnit === 'Sacos' ? 'Bulk' : 'Retail')) === 'Retail'
                            ? 'bg-orange-600 text-white shadow-2xs'
                            : 'text-slate-600 hover:text-slate-900 bg-transparent'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[10px]">scale</span>
                        Retalho ({prod.baseUnit})
                      </button>
                    </div>
                  )}

                  {/* Quantity selector & Quick add button */}
                  {!noStock && (
                    <div className="flex flex-col gap-1 mt-0.5">
                      <div className="flex items-center border border-gray-300 rounded overflow-hidden bg-slate-50 justify-between">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const current = catalogQty[prod.id] || 1;
                            setCatalogQty({ ...catalogQty, [prod.id]: Math.max(1, current - 1) });
                          }}
                          className="px-1.5 py-0.5 text-gray-600 hover:bg-gray-200 font-bold text-[10px]"
                        >
                          -
                        </button>
                        <input
                          type="number"
                          value={catalogQty[prod.id] || 1}
                          onChange={(e) => {
                            const val = Math.max(1, Number(e.target.value));
                            setCatalogQty({ ...catalogQty, [prod.id]: val });
                          }}
                          className="w-7 text-center text-[10px] font-black font-mono bg-white focus:outline-none"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            const current = catalogQty[prod.id] || 1;
                            setCatalogQty({ ...catalogQty, [prod.id]: current + 1 });
                          }}
                          className="px-1.5 py-0.5 text-gray-600 hover:bg-gray-200 font-bold text-[10px]"
                        >
                          +
                        </button>
                      </div>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          const qty = catalogQty[prod.id] || 1;
                          const selectedUnit = hybridUnits[prod.id] || (prod.parentUnit === 'Sacos' ? 'Bulk' : 'Retail');
                          addToCart(prod, qty, selectedUnit);
                          setCatalogQty({ ...catalogQty, [prod.id]: 1 });
                        }}
                        className={`w-full py-0.5 text-white text-[8.5px] uppercase font-bold rounded transition-all flex items-center justify-center gap-1 ${
                          prod.parentUnit && prod.conversionRate && prod.conversionRate > 1
                            ? (hybridUnits[prod.id] || (prod.parentUnit === 'Sacos' ? 'Bulk' : 'Retail')) === 'Bulk'
                              ? 'bg-emerald-700 hover:bg-emerald-800'
                              : 'bg-orange-600 hover:bg-orange-700'
                            : 'bg-primary hover:bg-primary/95'
                        }`}
                      >
                        <span className="material-symbols-outlined text-[10px]">add_shopping_cart</span>
                        Adicionar {prod.parentUnit && prod.conversionRate && prod.conversionRate > 1 ? ((hybridUnits[prod.id] || (prod.parentUnit === 'Sacos' ? 'Bulk' : 'Retail')) === 'Bulk' ? getSingularUnit(prod.parentUnit) : getSingularUnit(prod.baseUnit)) : ''}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          </div>
        </div>

      {/* Cart, Calculations & Payments Sidebar (4/12 widths) */}
      <div className="lg:col-span-4 bg-gray-50 border border-gray-200 rounded-xl shadow-sm flex flex-col lg:h-full lg:min-h-0 h-[calc(100vh-140px)] sticky top-4 lg:static overflow-hidden">
        {/* Customer Setup */}
        <div className="p-3 border-b border-gray-200 bg-white space-y-1.5 shrink-0">
          <div className="flex items-center justify-between">
            <label className="block text-[10px] font-black uppercase text-emerald-850 tracking-tight">Cliente</label>
            <button
              type="button"
              onClick={() => {
                setCustomerSearchQuery('');
                setShowCustomerModal(true);
              }}
              className="text-[10px] font-bold text-primary hover:underline flex items-center gap-0.5 cursor-pointer uppercase tracking-tight"
            >
              <span className="material-symbols-outlined text-[12px]">search</span>
              Buscar/Registar
            </button>
          </div>
          
          <div className="grid grid-cols-12 gap-1.5 bg-slate-50 p-1.5 rounded-lg border border-slate-200/80">
            <div className="col-span-5">
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                placeholder="Nome do Cliente"
                className="w-full bg-white border border-gray-300 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-semibold truncate"
                title={customerName}
              />
            </div>
            <div className="col-span-3">
              <input
                type="text"
                value={customerNuit}
                onChange={(e) => setCustomerNuit(e.target.value)}
                placeholder="NUIT"
                className="w-full bg-white border border-gray-300 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-mono truncate"
                title={customerNuit}
              />
            </div>
            <div className="col-span-4">
              <input
                type="text"
                value={customerAddress}
                onChange={(e) => setCustomerAddress(e.target.value)}
                placeholder="Endereço / Telefone"
                className="w-full bg-white border border-gray-300 rounded px-1.5 py-1 text-[10px] focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary truncate"
                title={customerAddress}
              />
            </div>
          </div>
        </div>

        {/* Scrollable Body: Cart Items + Quick Actions + Summary + Payments Selector + Print Preferences */}
        <div className="flex-1 overflow-y-auto p-3 space-y-4 custom-scrollbar min-h-0">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-2 py-8">
              <span className="material-symbols-outlined text-[48px]">shopping_cart</span>
              <p className="text-xs font-semibold">Carrinho de compras vazio</p>
            </div>
          ) : (
            <>
              {/* Cart Items List */}
              <div className="space-y-3">
                {cart.map(item => (
                  <div key={`${item.productId}-${item.sellingUnit || 'Retail'}`} className="bg-white p-3 border border-gray-200 hover:border-emerald-500 rounded-lg flex flex-col gap-2 transition-all hover:shadow-md">
                    <div className="flex justify-between items-start gap-3">
                      <div className="flex-1 space-y-1 min-w-0">
                        <p className="text-xs font-bold text-gray-800 truncate" title={item.name}>
                          {item.name}
                        </p>
                        <p className="text-[10px] text-gray-500">
                          {item.unitPrice.toLocaleString()} MT / {item.unit} • Subtotal: {(item.unitPrice * item.quantity).toLocaleString()} MT
                        </p>
                        {getItemDiscount(item) > 0 && (
                          <p className="text-[10px] text-red-600 font-bold">
                            Desc. Artigo: -{getItemDiscount(item).toLocaleString()} MT
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="flex items-center border border-gray-200 rounded overflow-hidden bg-gray-50">
                          <button
                            onClick={() => updateCartQty(item.productId, item.quantity - 1, item.sellingUnit)}
                            className="px-2 py-0.5 text-gray-600 hover:bg-gray-200 font-bold"
                          >
                            -
                          </button>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => {
                              const valStr = e.target.value;
                              if (valStr === '') {
                                updateCartQty(item.productId, '', item.sellingUnit);
                              } else {
                                updateCartQty(item.productId, Number(valStr), item.sellingUnit);
                              }
                            }}
                            onBlur={() => {
                              if (item.quantity === '' || item.quantity <= 0) {
                                updateCartQty(item.productId, 1, item.sellingUnit);
                              }
                            }}
                            className="w-10 text-center text-xs font-bold font-mono bg-white focus:outline-none border-l border-r border-gray-200 py-0.5"
                          />
                          <button
                            onClick={() => updateCartQty(item.productId, item.quantity + 1, item.sellingUnit)}
                            className="px-2 py-0.5 text-gray-600 hover:bg-gray-200 font-bold"
                          >
                            +
                          </button>
                        </div>

                        <button
                          onClick={() => removeFromCart(item.productId, item.sellingUnit)}
                          className="text-red-500 hover:text-red-700 p-0.5 rounded"
                        >
                          <span className="material-symbols-outlined text-[18px]">delete</span>
                        </button>
                      </div>
                    </div>

                    {/* Spaces for discounts: unit discount or total discount */}
                    <div className="pt-2 border-t border-gray-100 flex flex-wrap items-center justify-between gap-2 text-[10px]">
                      <div className="flex items-center gap-1">
                        <span className="text-gray-500 font-medium">Desconto:</span>
                        <select
                          value={item.discountType || 'line_total'}
                          onChange={(e) => updateCartDiscount(item.productId, e.target.value as ItemDiscountType, item.discountValue || 0, item.sellingUnit)}
                          className="border border-gray-200 rounded px-1 py-0.5 bg-gray-50 text-[10px] focus:outline-none focus:border-primary text-gray-700 cursor-pointer font-medium"
                        >
                          <option value="line_total">Total fixo (MT)</option>
                          <option value="per_unit">Unitário fixo (MT)</option>
                          <option value="percent_total">Total percentual (%)</option>
                          <option value="percent_unit">Unitário percentual (%)</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-1">
                        <input
                          type="number"
                          min="0"
                          max={getMaxItemDiscountValue(item, item.discountType || 'line_total')}
                          step="any"
                          value={item.discountValue || ''}
                          onChange={(e) => {
                            updateCartDiscount(item.productId, item.discountType || 'line_total', Number(e.target.value), item.sellingUnit);
                          }}
                          placeholder="0"
                          className="w-14 border border-gray-200 rounded px-1 py-0.5 font-bold font-mono text-[10px] focus:outline-none focus:border-primary text-right"
                        />
                        <span className="text-gray-500 font-bold">
                          {item.discountType === 'percent_total' || item.discountType === 'percent_unit' ? '%' : 'MT'}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* 4. Ações Rápidas e Controlo do IVA 16% */}
              <div className="flex items-center justify-between gap-1.5 bg-white p-2 rounded-lg border border-gray-200">
                <button
                  type="button"
                  disabled={isPausingSale || cart.length === 0}
                  onClick={handlePauseCurrentSale}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-amber-50 hover:bg-amber-100 disabled:opacity-50 disabled:cursor-not-allowed text-amber-700 rounded-lg text-[10px] font-black uppercase tracking-tight transition-colors cursor-pointer border border-amber-200/50"
                  title="Pausar a venda atual para efetuar outra"
                >
                  {isPausingSale ? (
                    <>
                      <span className="animate-spin rounded-full h-3 w-3 border-2 border-amber-700 border-t-transparent" />
                      <span>A Pausar...</span>
                    </>
                  ) : (
                    <>
                      <span className="material-symbols-outlined text-[13px]">pause_circle</span>
                      <span>Pausar</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    askConfirmation(
                      'Cancelar e Limpar Venda',
                      'Deseja realmente cancelar e limpar a venda atual? Todos os produtos adicionados ao carrinho serão removidos.',
                      () => {
                        setCart([]);
                        setCustomerName('Cliente Geral');
                        setCustomerNuit('');
                        setCustomerAddress('');
                        setCustomSubtotalDiscount(0);
                        setIncludeIva(false);
                        setNewSaleStatus('Paga');
                        setAmountReceived('');
                        showToast('Venda cancelada com sucesso.', 'success');
                      }
                    );
                  }}
                  className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-lg text-[10px] font-black uppercase tracking-tight transition-colors cursor-pointer border border-rose-200/50"
                >
                  <span className="material-symbols-outlined text-[13px]">cancel</span>
                  Cancelar
                </button>

                {/* Micro-Botão de IVA (Toggle) */}
                <button
                  type="button"
                  onClick={() => setIncludeIva(!includeIva)}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-tight transition-all cursor-pointer border shadow-2xs ${
                    includeIva
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600'
                      : 'bg-rose-600 hover:bg-rose-700 text-white border-rose-600'
                  }`}
                  title={includeIva ? 'Cobrar IVA (16%) - Clique para Desativar' : 'Sem IVA - Clique para Ativar (16%)'}
                >
                  <span className="material-symbols-outlined text-[13px]">{includeIva ? 'task_alt' : 'cancel'}</span>
                  <span>IVA: {includeIva ? '16%' : 'NÃO'}</span>
                </button>
              </div>

              {/* 5. Resumo Financeiro Compacto (Máximo 2 Linhas) */}
              <div className="bg-white border border-gray-200 rounded-xl p-2.5 shadow-sm">
                <div className="grid grid-cols-4 gap-1 text-center border-b border-gray-100 pb-1.5 mb-1.5">
                  <span className="text-[9px] font-black uppercase text-gray-400 tracking-tight">Subtotal</span>
                  <span className="text-[9px] font-black uppercase text-gray-400 tracking-tight">Desconto</span>
                  <span className="text-[9px] font-black uppercase text-gray-400 tracking-tight">IVA (16%)</span>
                  <span className="text-[9px] font-black uppercase text-emerald-800 tracking-tight">Total Final</span>
                </div>
                <div className="grid grid-cols-4 gap-1 text-center font-mono font-black text-xs">
                  <span className="text-gray-700">{getSubtotal().toLocaleString()} MT</span>
                  <span className={getDiscount() === 0 ? 'text-gray-400' : 'text-rose-600'}>
                    -{getDiscount().toLocaleString()} MT
                  </span>
                  <span className="text-gray-700">
                    {includeIva ? `${cartTotals.ivaAmount.toLocaleString()} MT` : 'Isento'}
                  </span>
                  <span className="text-emerald-600 font-extrabold">{getTotal().toLocaleString()} MT</span>
                </div>
              </div>

              {/* 6. Métodos de Pagamento, Valor Entregue e Troco */}
              <div className="space-y-1.5">
                <div className="grid grid-cols-6 gap-1">
                  {(['Dinheiro', 'Transferência', 'M-Pesa', 'E-Mola', 'Crédito', 'Múltiplo'] as const).map(method => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`py-1.5 px-0.5 text-[9px] font-black uppercase rounded-lg border text-center transition-all cursor-pointer ${
                        paymentMethod === method
                          ? 'bg-emerald-600 border-emerald-600 text-white shadow-xs'
                          : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                      }`}
                      title={method === 'Transferência' ? 'Transferência Bancária (F5)' : `${method}`}
                    >
                      {method === 'Transferência' ? 'Transf.' : method === 'Dinheiro' ? 'Dinh.' : method === 'Múltiplo' ? 'Múltip.' : method}
                    </button>
                  ))}
                </div>

                {/* Multiple Payment Split Configuration */}
                {paymentMethod === 'Múltiplo' && (
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-200 space-y-1.5">
                    <div className="space-y-1 max-h-36 overflow-y-auto pr-1">
                      {[
                        'Dinheiro',
                        'Transferência (BCI)',
                        'Transferência (BIM)',
                        'M-Pesa',
                        'E-Mola'
                      ].map((mName) => {
                        const line = multiPaymentLines.find(l => l.method === mName) || { method: mName, amount: 0 };
                        return (
                          <div key={mName} className="flex items-center justify-between gap-1.5 text-xs">
                            <span className="text-[10px] font-bold text-gray-700 w-24 truncate">{mName}</span>
                            <div className="relative flex-1">
                              <input
                                type="number"
                                min="0"
                                value={line.amount || ''}
                                onChange={(e) => {
                                  const val = Math.max(0, Number(e.target.value));
                                  setMultiPaymentLines(prev => {
                                    const exists = prev.some(p => p.method === mName);
                                    if (exists) {
                                      return prev.map(p => p.method === mName ? { ...p, amount: val } : p);
                                    } else {
                                      return [...prev, { method: mName, amount: val }];
                                    }
                                  });
                                }}
                                placeholder="0.00"
                                className="w-full bg-white border border-gray-300 rounded px-1.5 py-0.5 text-right text-[10px] font-mono font-bold focus:outline-none focus:border-primary"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    {(() => {
                      const currentTotal = multiPaymentLines.reduce((acc, l) => acc + (l.amount || 0), 0);
                      const targetTotal = getTotal();
                      const diff = targetTotal - currentTotal;
                      return (
                        <div className="pt-1 border-t border-slate-200 flex justify-between items-center text-[9px] font-black">
                          <span>Digitado: <strong className="font-mono">{currentTotal.toLocaleString()} MT</strong></span>
                          <span className={diff === 0 ? 'text-emerald-600' : diff > 0 ? 'text-orange-600' : 'text-red-600'}>
                            {diff === 0 ? '✓ Ok' : diff > 0 ? `Falta: ${diff} MT` : `Excesso: ${Math.abs(diff)} MT`}
                          </span>
                        </div>
                      );
                    })()}
                  </div>
                )}

                {/* Cash details (Dinheiro): Valor Entregue & Troco (Auto & compact) */}
                {paymentMethod === 'Dinheiro' && (
                  <div className="bg-slate-50 p-2 rounded-lg border border-slate-200/85 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-black uppercase text-gray-500">Entregue:</span>
                      <div className="relative flex items-center">
                        <input
                          type="number"
                          min="0"
                          value={amountReceived}
                          onChange={(e) => {
                            const val = e.target.value === '' ? '' : Math.max(0, Number(e.target.value));
                            setAmountReceived(val);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleFinalizeSale(defaultPrinter);
                            }
                          }}
                          placeholder="0.00"
                          className="border border-gray-300 rounded bg-white font-black font-mono text-[11px] text-right focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary px-1.5 py-0.5"
                          style={{
                            width: `${Math.max(4, String(amountReceived || '').length + 1) * 7 + 16}px`,
                            minWidth: '60px',
                            maxWidth: '120px'
                          }}
                        />
                        <span className="text-[9px] text-gray-400 font-bold ml-1">MT</span>
                      </div>
                    </div>

                    {amountReceived !== '' && amountReceived >= getTotal() && (
                      <div className="flex items-center gap-1 text-[10px] font-black bg-emerald-50 text-emerald-800 border border-emerald-100 rounded px-2 py-0.5 animate-fade-in shrink-0">
                        <span>Troco:</span>
                        <span className="font-mono text-emerald-600">
                          {(amountReceived - getTotal()).toLocaleString()} MT
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* 7. Opções de Impressão */}
              <div className="flex items-center justify-between gap-2 bg-slate-50 p-2 rounded-lg border border-slate-200/80 text-[10px]">
                <div className="flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[13px] text-gray-500">print</span>
                  <span className="font-black uppercase text-gray-500">Impressora:</span>
                </div>
                <select
                  value={defaultPrinter}
                  onChange={(e) => setDefaultPrinter(e.target.value as any)}
                  className="bg-white border border-gray-300 rounded px-1.5 py-0.5 text-[10px] font-bold focus:outline-none focus:border-primary cursor-pointer text-gray-700"
                >
                  <option value="Thermal">Térmica (80mm)</option>
                  <option value="ReciboA4">Recibo A4</option>
                  <option value="A4">FAT.Definitiva</option>
                  <option value="FaturaProforma">FAT. PROFORMA</option>
                </select>
              </div>
            </>
          )}
        </div>

        {/* 8. Rodapé Fixo e Estático (Sticky Footer - Confirmação) */}
        {cart.length > 0 && (
          <div className="p-3 bg-white border-t border-gray-200 flex items-center justify-between gap-3 shrink-0">
            {/* Lado Esquerdo: Total Final */}
            <div className="flex flex-col">
              <span className="text-[9px] font-black uppercase text-gray-400 tracking-wider">Total a Pagar</span>
              <span className="text-lg sm:text-xl font-black font-mono text-emerald-700 leading-none">
                {getTotal().toLocaleString()} <span className="text-xs font-black">MT</span>
              </span>
            </div>

            {/* Lado Direito: Botão Confirmar Venda */}
            <button
              type="button"
              disabled={isFinalizing}
              onClick={() => handleFinalizeSale(defaultPrinter)}
              className="flex-1 max-w-[200px] py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-400 disabled:cursor-not-allowed text-white font-black text-xs uppercase tracking-wider rounded-lg shadow-md hover:shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-1.5 cursor-pointer font-sans"
            >
              {isFinalizing ? (
                <>
                  <span className="animate-spin rounded-full h-3.5 w-3.5 border-2 border-white border-t-transparent" />
                  <span>Processando...</span>
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[15px]">done_all</span>
                  <span>Confirmar ✓</span>
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
    ) : (
        /* High-Fidelity Reports Tab UI with Date Range Filtering (Parte 5) */
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 sm:p-6 overflow-y-auto custom-scrollbar space-y-6 flex-1 min-h-[500px]">
          {/* Universal Date Range Filter */}
          <DateRangeFilter
            title="Relatório de Vendas por Período"
            startDate={reportStartDate}
            endDate={reportEndDate}
            preset={reportPreset}
            onRangeChange={(start, end, preset) => {
              setReportStartDate(start);
              setReportEndDate(end);
              setReportPreset(preset);
            }}
            onExportPDF={async () => {
              const s = settings || { companyName: 'AGRO - XICOMO & SERVIÇOS, LDA', companyNuit: '401976590' } as any;
              showToast('A compilar e descarregar relatório em formato PDF...', 'success');
              await downloadPeriodSalesReportPDF(reportStartDate, reportEndDate, sales, s);
            }}
            onExportExcel={() => {
              const salesInRange = sales.filter(s => {
                if (s.status === 'Cancelada' || s.status === 'canceled') return false;
                if (!s.date) return false;
                return isDateInRange(s.date, reportStartDate, reportEndDate);
              });
              const dataRows = salesInRange.map(s => ({
                'Factura': s.invoiceNumber,
                'Recibo': s.receiptNumber || '',
                'Data': formatDatePT(s.date),
                'Cliente': s.customerName,
                'NUIT': s.customerNuit || '',
                'Itens': s.items.length,
                'Subtotal (MT)': s.subtotal,
                'Desconto (MT)': s.discount,
                'Total (MT)': s.total,
                'Método Pagamento': s.paymentMethod,
                'Operador': s.operatorName,
                'Estado': s.status
              }));
              const ws = XLSX.utils.json_to_sheet(dataRows);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'Vendas');
              XLSX.writeFile(wb, `VENDAS_${reportStartDate}_a_${reportEndDate}.xlsx`);
              showToast('Exportação para Excel concluída com sucesso!');
            }}
          />

          {(() => {
            const salesOnDate = sales.filter(s => {
              if (s.status === 'Cancelada' || s.status === 'canceled') return false;
              if (!s.date) return false;
              return isDateInRange(s.date, reportStartDate, reportEndDate);
            });
            const totalRevenue = salesOnDate.reduce((acc, s) => acc + s.total, 0);

            // Payment Methods Breakdown
            let totalNumerario = 0;
            let totalMPesa = 0;
            let totalEMola = 0;
            let totalTransferencia = 0;
            let totalCredito = 0;

            salesOnDate.forEach(s => {
              const pm = (s.paymentMethod || '').trim().toLowerCase();
              if (pm === 'dinheiro' || pm === 'numerario' || pm === 'cash') {
                totalNumerario += s.total;
              } else if (pm === 'm-pesa' || pm === 'mpesa') {
                totalMPesa += s.total;
              } else if (pm === 'e-mola' || pm === 'emola') {
                totalEMola += s.total;
              } else if (pm === 'transferência' || pm === 'transferencia' || pm === 'banco') {
                totalTransferencia += s.total;
              } else if (pm === 'crédito' || pm === 'credit') {
                totalCredito += s.total;
              } else if (pm === 'múltiplo' || pm === 'multiplo') {
                if (s.paymentBreakdown && Array.isArray(s.paymentBreakdown)) {
                  s.paymentBreakdown.forEach(b => {
                    const bpm = (b.method || '').trim().toLowerCase();
                    if (bpm === 'dinheiro' || bpm === 'numerario' || bpm === 'cash') totalNumerario += b.amount;
                    else if (bpm === 'm-pesa' || bpm === 'mpesa') totalMPesa += b.amount;
                    else if (bpm === 'e-mola' || bpm === 'emola') totalEMola += b.amount;
                    else if (bpm === 'transferência' || bpm === 'transferencia' || bpm === 'banco') totalTransferencia += b.amount;
                    else if (bpm === 'crédito' || bpm === 'credit') totalCredito += b.amount;
                    else totalNumerario += b.amount;
                  });
                } else {
                  totalNumerario += s.total;
                }
              } else {
                totalNumerario += s.total;
              }
            });

            // Grouping products
            const productAggregates: Record<string, { name: string; qty: number; unit: string; total: number; category: string }> = {};
            salesOnDate.forEach(s => {
              s.items.forEach(item => {
                const key = item.productId || item.name;
                const origProduct = products.find(p => p.id === item.productId);
                const category = origProduct?.category || 'Serviços/Geral';
                
                if (!productAggregates[key]) {
                  productAggregates[key] = {
                    name: item.name,
                    qty: 0,
                    unit: item.unit || 'UN',
                    total: 0,
                    category
                  };
                }
                productAggregates[key].qty += item.quantity;
                productAggregates[key].total += item.totalPrice;
              });
            });

            const aggregatedList = Object.values(productAggregates).sort((a, b) => b.total - a.total);

            return (
              <div className="space-y-6">
                {/* Financial Dashboard Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
                  
                  {/* Total Faturado Card */}
                  <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 p-4 rounded-xl text-white shadow-md flex flex-col justify-between min-h-[100px]">
                    <div>
                      <p className="text-[10px] font-black uppercase text-emerald-200 tracking-wider">Total Faturado</p>
                      <h3 className="text-lg font-black font-mono tracking-tight mt-1">
                        {totalRevenue.toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT
                      </h3>
                    </div>
                    <p className="text-[9px] text-emerald-100 font-semibold mt-3">{salesOnDate.length} Vendas no Período</p>
                  </div>

                  {/* Numerário Card */}
                  <div className="bg-slate-50 border border-gray-200 p-4 rounded-xl flex flex-col justify-between shadow-sm min-h-[100px]">
                    <div>
                      <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Dinheiro Vivo (Numerário)</p>
                      <h3 className="text-base font-black font-mono tracking-tight text-gray-800 mt-1">
                        {totalNumerario.toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-gray-500">MT</span>
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-emerald-600 font-bold mt-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                      Caixa Físico
                    </div>
                  </div>

                  {/* M-Pesa Card */}
                  <div className="bg-slate-50 border border-gray-200 p-4 rounded-xl flex flex-col justify-between shadow-sm min-h-[100px]">
                    <div>
                      <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">M-Pesa</p>
                      <h3 className="text-base font-black font-mono tracking-tight text-gray-800 mt-1">
                        {totalMPesa.toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-gray-500">MT</span>
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-red-500 font-bold mt-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
                      Carteira Eletrónica
                    </div>
                  </div>

                  {/* E-Mola Card */}
                  <div className="bg-slate-50 border border-gray-200 p-4 rounded-xl flex flex-col justify-between shadow-sm min-h-[100px]">
                    <div>
                      <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">E-Mola</p>
                      <h3 className="text-base font-black font-mono tracking-tight text-gray-800 mt-1">
                        {totalEMola.toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-gray-500">MT</span>
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-orange-500 font-bold mt-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                      Carteira Eletrónica
                    </div>
                  </div>

                  {/* Transferência Card */}
                  <div className="bg-slate-50 border border-gray-200 p-4 rounded-xl flex flex-col justify-between shadow-sm min-h-[100px]">
                    <div>
                      <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Transferência Bancária</p>
                      <h3 className="text-base font-black font-mono tracking-tight text-gray-800 mt-1">
                        {totalTransferencia.toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-gray-500">MT</span>
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-blue-500 font-bold mt-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                      Conta Bancária
                    </div>
                  </div>

                  {/* Crédito Card */}
                  <div className="bg-slate-50 border border-gray-200 p-4 rounded-xl flex flex-col justify-between shadow-sm min-h-[100px]">
                    <div>
                      <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Vendas a Crédito</p>
                      <h3 className="text-base font-black font-mono tracking-tight text-gray-800 mt-1">
                        {totalCredito.toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-xs text-gray-500">MT</span>
                      </h3>
                    </div>
                    <div className="flex items-center gap-1 text-[9px] text-purple-500 font-bold mt-3">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
                      Contas a Receber
                    </div>
                  </div>

                </div>

                {/* Aggregated Sold Products List Table */}
                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                  <div className="bg-gray-50 p-4 border-b border-gray-200 flex justify-between items-center">
                    <h3 className="text-xs font-black text-gray-700 uppercase tracking-wider">Produtos e Serviços Vendidos no Período</h3>
                    <span className="text-[10px] bg-emerald-100 text-emerald-800 font-black px-2 py-0.5 rounded-full uppercase">
                      {aggregatedList.length} Artigos Distintos
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-gray-100 text-[10px] font-black uppercase text-gray-500 tracking-wider border-b border-gray-200">
                          <th className="p-3 pl-4">Produto / Serviço</th>
                          <th className="p-3">Categoria</th>
                          <th className="p-3 text-right">Unidades Vendidas</th>
                          <th className="p-3">Unidade Medida</th>
                          <th className="p-3 text-right pr-4">Faturamento Bruto</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-150 text-xs text-gray-700 font-medium">
                        {aggregatedList.length === 0 ? (
                          <tr>
                            <td colSpan={5} className="p-8 text-center text-gray-400 italic">
                              Sem movimentos registados para o período de {formatDatePT(reportStartDate)} a {formatDatePT(reportEndDate)}.
                            </td>
                          </tr>
                        ) : (
                          aggregatedList.map((item, idx) => (
                            <tr key={idx} className="hover:bg-emerald-50/70 hover:shadow-md transition-all border-b border-gray-100">
                              <td className="p-3 pl-4 font-bold text-gray-800">{item.name}</td>
                              <td className="p-3 text-gray-500 uppercase font-bold text-[10px]">{item.category}</td>
                              <td className="p-3 text-right font-bold text-gray-900 font-mono">
                                {item.qty.toLocaleString('pt-MZ')}
                              </td>
                              <td className="p-3 text-gray-500 font-semibold">{item.unit}</td>
                              <td className="p-3 text-right font-black font-mono text-emerald-700 pr-4">
                                {item.total.toLocaleString('pt-MZ', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* --- Scanner Simulation Modal --- */}
      {showScanner && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-white border border-gray-200 rounded-xl overflow-hidden shadow-2xl">
            <div className="bg-primary p-4 text-white font-bold flex justify-between items-center">
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined">qr_code_scanner</span>
                Câmara POS - Scanner Real-Time
              </span>
              <button 
                onClick={() => {
                  setShowScanner(false);
                }} 
                className="text-white/80 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-6 text-center space-y-4">
              {/* Real Camera Finder */}
              <div className="relative aspect-video bg-black rounded-lg border-2 border-primary overflow-hidden flex items-center justify-center">
                {/* HTML5 QR Code element container */}
                <div id="reader-container" className="absolute inset-0 w-full h-full z-10" />
                
                {/* Visual scan line overlay */}
                <div className="absolute left-0 right-0 top-0 h-0.5 bg-red-500 shadow-[0_0_8px_rgba(239,68,68,1)] animate-bounce z-20 pointer-events-none" style={{ animationDuration: '3s' }}></div>
                <span className="material-symbols-outlined text-[64px] text-white/20 absolute z-0 pointer-events-none">qr_code_2</span>
              </div>

              <div className="space-y-2">
                <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">
                  Status de Leitura: <span className="text-primary font-bold">{scannerStatus}</span>
                </p>

                {scanResult && (
                  <div className="bg-green-50 border border-green-200 p-3 rounded-lg text-left space-y-2.5 animate-slide-up">
                    <div>
                      <p className="text-[10px] text-green-700 uppercase font-black flex items-center gap-1">
                        <span className="material-symbols-outlined text-[12px] animate-bounce text-emerald-600">barcode</span>
                        Artigo Detetado
                      </p>
                      <p className="text-sm font-bold text-gray-800">{scanResult.name}</p>
                      <p className="text-xs text-gray-500">REF: {scanResult.code} • Preço: {scanResult.sellingPrice} MT</p>
                    </div>

                    {/* Quantity Selector */}
                    <div className="pt-2 border-t border-green-150 flex items-center justify-between">
                      <span className="text-xs font-bold text-green-800">Qtd a Adicionar:</span>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => setScanQty(prev => Math.max(1, prev - 1))}
                          className="w-6 h-6 rounded bg-green-200 hover:bg-green-300 text-green-900 font-black text-xs transition-colors flex items-center justify-center"
                        >
                          remove
                        </button>
                        <input
                          type="number"
                          value={scanQty}
                          min="1"
                          onChange={(e) => setScanQty(Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-12 text-center text-xs font-mono font-bold bg-white border border-green-300 rounded py-0.5 focus:ring-1 focus:ring-emerald-500"
                        />
                        <button
                          type="button"
                          onClick={() => setScanQty(prev => prev + 1)}
                          className="w-6 h-6 rounded bg-green-200 hover:bg-green-300 text-green-900 font-black text-xs transition-colors flex items-center justify-center"
                        >
                          add
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Point a product manually selection */}
              <div className="border-t border-gray-150 pt-3 space-y-1.5 text-left">
                <label className="block text-[10px] font-black uppercase text-gray-400">Selecionar Manualmente (Alternativo)</label>
                <select
                  onChange={(e) => {
                    const pId = e.target.value;
                    const p = products.find(prod => prod.id === pId);
                    if (p) {
                      setScanResult(p);
                      setScannerStatus(`Código Lido Manual: ${p.code || 'S/C'} 🟢`);
                      setScanQty(1);
                      playScannerBeep();
                      showToast(`Código de barras lido para "${p.name}".`, 'success');
                    }
                  }}
                  className="w-full text-xs border border-gray-300 rounded px-2.5 py-1.5 focus:outline-none focus:border-primary bg-slate-50 font-medium"
                  defaultValue=""
                >
                  <option value="" disabled>-- Selecione um artigo --</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} (REF/SKU: {p.code || 'S/R'})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    simulateCameraScan();
                  }}
                  className="flex-1 py-2 border border-gray-300 rounded text-xs text-gray-700 hover:bg-gray-50 font-semibold"
                >
                  Nova Leitura
                </button>
                <button
                  type="button"
                  disabled={!scanResult}
                  onClick={applyScanResult}
                  className="flex-1 py-2 bg-primary disabled:opacity-50 text-white rounded text-xs font-bold shadow-sm transition-all"
                >
                  Confirmar Detecção
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- Invoicing and Receipt Print Modal --- */}
      {invoiceToPrint && printType && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-2xl max-w-4xl w-full my-8 overflow-hidden flex flex-col">
            {/* Modal Actions */}
            <div className="bg-gray-100 p-4 border-b border-gray-200 flex flex-col md:flex-row gap-4 justify-between items-center">
              <div className="flex flex-col gap-0.5 text-left w-full md:w-auto">
                <span className="font-black text-gray-800 flex items-center gap-1.5 text-sm">
                  <span className="material-symbols-outlined text-emerald-600">print_connect</span>
                  VENDA REGISTADA - EMISSÃO DE DOCUMENTO
                </span>
                <p className="text-[10px] text-gray-500 font-bold font-mono uppercase">
                  Doc: {invoiceToPrint.invoiceNumber} | Total: {invoiceToPrint.total.toLocaleString()} MT
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 w-full md:w-auto justify-end">
                {/* Realtime format switcher */}
                <div className="flex items-center gap-1 bg-white p-1 rounded-lg border border-gray-200 shadow-sm text-xs">
                  <span className="text-[9px] font-black text-gray-400 uppercase px-1">Visualizar:</span>
                  {(['Thermal', 'ReciboA4', 'A4', 'FaturaProforma'] as const).map(fmt => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setPrintType(fmt)}
                      className={`px-2 py-0.5 rounded text-[9px] font-black uppercase transition-all ${
                        printType === fmt
                          ? 'bg-emerald-600 text-white'
                          : 'text-gray-500 hover:text-gray-800 hover:bg-gray-50'
                      }`}
                    >
                      {fmt === 'Thermal' ? 'Térmico' : fmt === 'A4' ? 'Fatura A4' : fmt === 'ReciboA4' ? 'Recibo A4' : 'Proforma'}
                    </button>
                  ))}
                </div>

                {/* Default printer select */}
                <div className="flex items-center gap-1">
                  <label className="text-[9px] font-black uppercase text-gray-500">Padrão:</label>
                  <select
                    value={defaultPrinter}
                    onChange={(e) => setDefaultPrinter(e.target.value as any)}
                    className="bg-white border border-gray-300 rounded px-1.5 py-1 text-[10px] font-bold text-gray-700 focus:outline-none focus:border-primary cursor-pointer"
                  >
                    <option value="Thermal">Térmica (80mm)</option>
                    <option value="ReciboA4">Recibo A4</option>
                    <option value="A4">FAT.Definitiva</option>
                    <option value="FaturaProforma">FAT. PROFORMA</option>
                  </select>
                </div>

                {/* Primary Action to actually print/download */}
                <button
                  onClick={() => {
                    const s = settings || { companyName: 'AGRO - XICOMO & SERVI\u00c7OS, LDA', companyNuit: '401976590' } as any;
                    if (printType === 'Thermal') {
                      downloadThermalReceipt(invoiceToPrint, s);
                      // Trigger native print dialog too
                      setTimeout(() => {
                        try {
                          window.print();
                        } catch (err) {
                          console.error('Falha ao disparar window.print():', err);
                        }
                      }, 500);
                    } else if (printType === 'A4') {
                      downloadInvoiceA4(invoiceToPrint, s, false);
                    } else if (printType === 'FaturaProforma') {
                      downloadInvoiceA4(invoiceToPrint, s, false, 'FACTURA PROFORMA');
                    } else if (printType === 'ReciboA4') {
                      downloadInvoiceA4(invoiceToPrint, s, true);
                    } else if (printType === 'DoubleA5') {
                      downloadDuplicatedInvoiceA4(invoiceToPrint, s);
                    }
                    showToast('Impressão e descarregamento iniciados!', 'success');
                  }}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] uppercase font-black rounded transition-colors flex items-center gap-1 shadow-sm"
                >
                  <span className="material-symbols-outlined text-[15px]">print</span>
                  Imprimir / Descarregar
                </button>

                <button
                  onClick={() => {
                    setInvoiceToPrint(null);
                    setPrintType(null);
                  }}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 text-xs font-semibold rounded hover:bg-gray-300 transition-colors"
                >
                  Fechar
                </button>
              </div>
            </div>

            {/* Simulated Document Layouts */}
            <div className="p-8 bg-gray-200/50 flex justify-center custom-scrollbar overflow-y-auto max-h-[650px]">
              {/* 1. Standard A4 Commercial / Proforma Invoice Layout */}
              {(printType === 'A4' || printType === 'FaturaProforma') && (() => {
                const chunks: typeof invoiceToPrint.items[] = [];
                const limit = 8;
                for (let i = 0; i < invoiceToPrint.items.length; i += limit) {
                  chunks.push(invoiceToPrint.items.slice(i, i + limit));
                }
                return (
                  <div className="flex flex-col gap-8 w-full items-center" id="a4_invoice">
                    {chunks.map((chunk, pageIdx) => {
                      const isFirst = pageIdx === 0;
                      const isLast = pageIdx === chunks.length - 1;
                      return (
                        <div
                          key={pageIdx}
                          className="bg-white p-8 w-[210mm] min-h-[297mm] shadow-lg border border-gray-300 text-gray-800 text-xs font-sans flex flex-col justify-between print:m-0 print:border-none print:shadow-none print:w-full print:min-h-0"
                          style={{ pageBreakAfter: pageIdx < chunks.length - 1 ? 'always' : 'avoid' }}
                        >
                          <div>
                            {isFirst ? (
                              <div className="flex justify-between items-start border-b border-gray-200 pb-6 mb-6">
                                <div className="space-y-1">
                                  {settings?.logoUrl ? (
                                    <img src={settings.logoUrl} alt="Logo" className="w-[6.5cm] h-[4cm] object-contain rounded mb-2 block animate-fade-in" />
                                  ) : null}
                                  <h2 className="text-xl font-black text-primary uppercase">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h2>
                                  <p className="text-[10px] text-gray-500 font-semibold mt-1">SISTEMA INTEGRADO DE FATURAÇÃO COMERCIAL</p>
                                  <p className="text-gray-600">Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}</p>
                                  <div className="text-[10px] text-gray-600 space-y-0.5 mt-1.5 border-t border-gray-100 pt-1.5">
                                    {settings?.email && <p><strong>Email:</strong> {settings.email}</p>}
                                    
                                    {(settings?.vodacom1 || settings?.vodacom2 || settings?.vodacom3) ? (
                                      <p><strong>Vodacom:</strong> {[settings.vodacom1, settings.vodacom2, settings.vodacom3].filter(Boolean).join(' / ')}</p>
                                    ) : (
                                      <p><strong>Vodacom:</strong> +258 84 123 4567</p>
                                    )}

                                    {(settings?.movitel1 || settings?.movitel2 || settings?.movitel3) ? (
                                      <p><strong>Movitel:</strong> {[settings.movitel1, settings.movitel2, settings.movitel3].filter(Boolean).join(' / ')}</p>
                                    ) : (
                                      <p><strong>Movitel:</strong> +258 86 123 4567</p>
                                    )}

                                    {(settings?.fixo1 || settings?.fixo2) && (
                                      <p><strong>Fixo:</strong> {[settings.fixo1, settings.fixo2].filter(Boolean).join(' / ')}</p>
                                    )}
                                  </div>
                                </div>
                                <div className="text-right">
                                  <div className="bg-primary/10 text-primary px-4 py-2 rounded text-base font-black uppercase">
                                    {printType === 'FaturaProforma' || invoiceToPrint.documentType === 'FaturaProforma'
                                      ? 'FACTURA PROFORMA'
                                      : (invoiceToPrint.paymentMethod === 'Crédito' ? 'FACTURA A CRÉDITO' : 'FACTURA DEFINITIVA')}
                                  </div>
                                  <p className="text-gray-500 mt-2 font-mono">Nº: {invoiceToPrint.invoiceNumber}</p>
                                  <p className="text-gray-500 font-mono">Data: {new Date(invoiceToPrint.date).toLocaleString('pt-MZ')}</p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-4">
                                <div className="space-y-0.5">
                                  <h2 className="text-sm font-black text-primary uppercase">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h2>
                                  <p className="text-[9px] text-gray-500">FATURA COMERCIAL - CONTINUAÇÃO (Pág {pageIdx + 1}/{chunks.length})</p>
                                </div>
                                <div className="text-right font-mono text-[9px] text-gray-500">
                                  Nº: {invoiceToPrint.invoiceNumber} | Data: {new Date(invoiceToPrint.date).toLocaleDateString('pt-MZ')}
                                </div>
                              </div>
                            )}

                            {isFirst && (
                              <div className="grid grid-cols-2 gap-4 bg-gray-50 p-4 rounded-lg border border-gray-200 mb-6">
                                <div>
                                  <p className="text-[10px] font-black uppercase text-gray-400 mb-1">Faturado a</p>
                                  <p className="font-bold text-gray-800 text-sm">{invoiceToPrint.customerName}</p>
                                  <p className="text-gray-500">Província de Maputo, Moçambique</p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[10px] font-black uppercase text-gray-400 mb-1">Operador de Registo</p>
                                  <p className="font-semibold text-gray-800">{invoiceToPrint.operatorName}</p>
                                  <p className="text-gray-500">Sessão Local Validada</p>
                                </div>
                              </div>
                            )}

                            <table className="w-full text-left border-collapse mb-8 text-xs">
                              <thead>
                                <tr className="bg-primary text-white font-bold">
                                  <th className="p-2.5 rounded-l">Item</th>
                                  <th className="p-2.5 text-right">Qtd</th>
                                  <th className="p-2.5">Unidade</th>
                                  <th className="p-2.5 text-right">P. Unitário (MT)</th>
                                  <th className="p-2.5 text-right rounded-r">Total (MT)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {chunk.map((item, idx) => (
                                  <tr key={idx} className="hover:bg-gray-50">
                                    <td className="p-2.5 font-semibold text-gray-800">{item.name}</td>
                                    <td className="p-2.5 text-right font-mono">{item.quantity}</td>
                                    <td className="p-2.5 text-gray-600">{item.unit || 'UN'}</td>
                                    <td className="p-2.5 text-right font-mono">{item.unitPrice.toLocaleString()}</td>
                                    <td className="p-2.5 text-right font-bold font-mono text-primary">{item.totalPrice.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div>
                            {isLast ? (
                              <>
                                <div className="grid grid-cols-12 gap-4 border-t border-gray-200 pt-6 mb-6">
                                  <div className="col-span-8 bg-gray-50 p-4 rounded border border-gray-200 text-[11px] leading-relaxed">
                                    <p className="font-bold text-primary mb-1 uppercase text-[10px]">Coordenadas Bancárias & POS</p>
                                    <p><span className="font-semibold text-gray-600">Banco:</span> {paymentConfig?.banco}</p>
                                    <p><span className="font-semibold text-gray-600">Nº de Conta:</span> {paymentConfig?.numeroConta} | <span className="font-semibold text-gray-600">NIB:</span> {paymentConfig?.nib}</p>
                                    <div className="flex gap-4 mt-1 border-t border-gray-100 pt-1">
                                      <p><span className="font-semibold text-gray-600">M-Pesa:</span> {paymentConfig?.mpesa}</p>
                                      <p><span className="font-semibold text-gray-600">E-Mola:</span> {paymentConfig?.emola}</p>
                                    </div>
                                  </div>

                                  <div className="col-span-4 text-right space-y-1.5 text-xs text-gray-600">
                                    <div className="flex justify-between">
                                      <span>Subtotal:</span>
                                      <span className="font-bold font-mono">{invoiceToPrint.subtotal.toLocaleString()} MT</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Desconto:</span>
                                      <span className="font-bold font-mono text-red-500">-{invoiceToPrint.discount.toLocaleString()} MT</span>
                                    </div>
                                    <div className="flex justify-between text-sm font-black text-gray-900 border-t border-gray-200 pt-2">
                                      <span>Total Pago:</span>
                                      <span className="text-primary font-mono">{invoiceToPrint.total.toLocaleString()} MT</span>
                                    </div>
                                    <div className="flex justify-between text-[10px] font-bold text-gray-700 bg-gray-50 p-1.5 rounded border border-gray-150 mt-2">
                                      <span>Forma de Pagamento:</span>
                                      <span className="uppercase text-emerald-700 font-extrabold">{invoiceToPrint.paymentMethod || 'Dinheiro'}</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="border-t-2 border-dashed border-gray-300 pt-4 text-center">
                                  <p className="text-gray-500 italic font-semibold text-[11px]">
                                    {printType === 'FaturaProforma' || invoiceToPrint.documentType === 'FaturaProforma'
                                      ? '"Esta fatura proforma tem a validade de 30 dias a contar da data da sua emissão."'
                                      : '"Esta fatura tem validade até à reposição de stock"'}
                                  </p>
                                  <p className="text-[9px] text-gray-400 mt-2 uppercase tracking-widest">
                                    Processado por Computador • Licenciado para Vercel/Firebase Free Tiers
                                  </p>
                                </div>
                              </>
                            ) : (
                              <div className="border-t border-gray-200 pt-4 flex justify-between items-center text-[10px] text-gray-400 italic">
                                <span>Fatura Comercial Nº: {invoiceToPrint.invoiceNumber}</span>
                                <span className="font-semibold text-primary">Continua na página seguinte... (Pág {pageIdx + 1} de {chunks.length})</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}

              {/* 1.5. Beautiful Recibo A4 Layout */}
              {printType === 'ReciboA4' && (() => {
                const chunks: typeof invoiceToPrint.items[] = [];
                const limit = 8;
                for (let i = 0; i < invoiceToPrint.items.length; i += limit) {
                  chunks.push(invoiceToPrint.items.slice(i, i + limit));
                }
                return (
                  <div className="flex flex-col gap-8 w-full items-center" id="a4_receipt">
                    {chunks.map((chunk, pageIdx) => {
                      const isFirst = pageIdx === 0;
                      const isLast = pageIdx === chunks.length - 1;
                      return (
                        <div
                          key={pageIdx}
                          className="bg-white p-8 w-[210mm] min-h-[297mm] shadow-lg border border-gray-300 text-gray-800 text-xs font-sans flex flex-col justify-between print:m-0 print:border-none print:shadow-none print:w-full print:min-h-0"
                          style={{ pageBreakAfter: pageIdx < chunks.length - 1 ? 'always' : 'avoid' }}
                        >
                          <div>
                            {isFirst ? (
                              <div className="flex justify-between items-start border-b border-gray-200 pb-6 mb-6">
                                <div className="space-y-1 max-w-[60%]">
                                  {settings?.logoUrl ? (
                                    <img src={settings.logoUrl} alt="Logo" className="w-[6.5cm] h-[4cm] object-contain rounded mb-2 block animate-fade-in" />
                                  ) : null}
                                  <h2 className="text-xl font-black text-primary uppercase">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h2>
                                  
                                  <p className="text-gray-600 font-semibold text-[11px]">
                                    Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}
                                  </p>
                                  
                                  <p className="text-gray-500 text-[10px]">
                                    <strong>Email:</strong> {settings?.email || 'agroxicomo1@gmail.com'} | <strong>Contacto:</strong> {[settings?.vodacom1, settings?.movitel1, settings?.fixo1].filter(Boolean).join(' / ') || '+258 84 123 4567'}
                                  </p>
                                </div>
                                
                                <div className="text-right space-y-1.5">
                                  <div className="bg-primary text-white px-5 py-2 rounded text-base font-black tracking-wide inline-block uppercase shadow-sm">
                                    RECIBO
                                  </div>
                                  <p className="text-gray-700 font-bold font-mono text-sm pt-2">
                                    Recibo Nº: {invoiceToPrint.receiptNumber || (invoiceToPrint.invoiceNumber.startsWith('Fact-') ? invoiceToPrint.invoiceNumber.replace('Fact-', 'Rec-') : invoiceToPrint.invoiceNumber.startsWith('FAC-') ? invoiceToPrint.invoiceNumber.replace('FAC-', 'REC-A4-') : `Rec-2026-${invoiceToPrint.invoiceNumber}`)}
                                  </p>
                                  <p className="text-gray-500 font-medium text-[10px]">
                                    Referente à Fatura Nº: <span className="font-bold font-mono text-gray-800">{invoiceToPrint.invoiceNumber}</span>
                                  </p>
                                  <p className="text-gray-500 font-medium text-[10px]">
                                    Data de Emissão: <span className="font-bold font-mono text-gray-800">{new Date(invoiceToPrint.date).toLocaleString('pt-MZ')}</span>
                                  </p>
                                  <p className="text-gray-500 font-medium text-[10px]">
                                    Forma de Pagamento: <strong className="uppercase text-emerald-700">{invoiceToPrint.paymentMethod || 'Dinheiro'}</strong>
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="flex justify-between items-center border-b border-gray-200 pb-3 mb-4">
                                <div className="space-y-0.5">
                                  <h2 className="text-sm font-black text-primary uppercase">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h2>
                                  <p className="text-[9px] text-gray-500">RECIBO DE PAGAMENTO - CONTINUAÇÃO (Pág {pageIdx + 1}/{chunks.length})</p>
                                </div>
                                <div className="text-right font-mono text-[9px] text-gray-500">
                                  Ref Fatura: {invoiceToPrint.invoiceNumber}
                                </div>
                              </div>
                            )}

                            {isFirst && (
                              <div className="grid grid-cols-2 gap-6 bg-gray-50 p-5 rounded-lg border border-gray-200 mb-6">
                                <div className="space-y-1">
                                  <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Dados do Cliente</p>
                                  <p className="font-black text-gray-800 text-sm">{invoiceToPrint.customerName}</p>
                                  <p className="text-gray-600 text-[10px]"><strong>Endereço:</strong> {invoiceToPrint.customerAddress || 'N/D'}</p>
                                  <p className="text-gray-600 text-[10px]"><strong>NUIT:</strong> {invoiceToPrint.customerNuit || 'Consumidor Final'}</p>
                                </div>
                                <div className="text-right space-y-1">
                                  <p className="text-[10px] font-black uppercase text-gray-400 tracking-wider mb-1">Dados do Operador</p>
                                  <p className="font-bold text-gray-800">{invoiceToPrint.operatorName || 'Operador Autorizado'}</p>
                                  <p className="text-gray-500 text-[10px]">Autenticado no Caixa POS</p>
                                  <p className="text-gray-500 text-[10px]">Maputo, Moçambique</p>
                                </div>
                              </div>
                            )}

                            <table className="w-full text-left border-collapse mb-8 text-xs rounded-lg overflow-hidden">
                              <thead>
                                <tr className="bg-primary text-white font-bold">
                                  <th className="p-3 rounded-l">Item / Serviço</th>
                                  <th className="p-3 text-right">Qtd</th>
                                  <th className="p-3">Unidade</th>
                                  <th className="p-3 text-right">P. Unitário (MT)</th>
                                  <th className="p-3 text-right rounded-r">Total (MT)</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-200">
                                {chunk.map((item, idx) => (
                                  <tr key={idx} className="hover:bg-gray-50">
                                    <td className="p-3 font-semibold text-gray-800">{item.name}</td>
                                    <td className="p-3 text-right font-mono">{item.quantity}</td>
                                    <td className="p-3 text-gray-600">{item.unit || 'UN'}</td>
                                    <td className="p-3 text-right font-mono">{item.unitPrice.toLocaleString()}</td>
                                    <td className="p-3 text-right font-bold font-mono text-primary">{item.totalPrice.toLocaleString()}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          <div>
                            {isLast ? (
                              <>
                                <div className="flex justify-between items-center border-t border-gray-200 pt-6 mb-8">
                                  <div className="text-[11px] text-gray-500 italic max-w-lg leading-relaxed">
                                    *Este recibo serve como prova oficial de liquidação total da fatura acima referenciada.
                                  </div>
                                  <div className="w-64 text-right space-y-1.5 text-xs text-gray-600">
                                    <div className="flex justify-between">
                                      <span>Subtotal:</span>
                                      <span className="font-bold font-mono">{invoiceToPrint.subtotal.toLocaleString()} MT</span>
                                    </div>
                                    <div className="flex justify-between">
                                      <span>Desconto:</span>
                                      <span className="font-bold font-mono text-red-500">-{invoiceToPrint.discount.toLocaleString()} MT</span>
                                    </div>
                                    <div className="flex justify-between text-sm font-black text-gray-900 border-t border-gray-200 pt-2">
                                      <span>Total Pago:</span>
                                      <span className="text-primary font-mono text-base">{invoiceToPrint.total.toLocaleString()} MT</span>
                                    </div>
                                  </div>
                                </div>

                                <div className="border-t border-gray-200 pt-6 text-center space-y-1 bg-gray-50 p-4 rounded-lg">
                                  <p className="font-black text-gray-800 text-xs uppercase tracking-wide">
                                    {settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}
                                  </p>
                                  <p className="text-[9px] text-gray-500">
                                    Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}
                                  </p>
                                  <p className="text-[9px] text-gray-400">
                                    Email: {settings?.email || 'agroxicomo1@gmail.com'} • Tel: {[settings?.vodacom1, settings?.movitel1].filter(Boolean).join(' / ') || '+258 84 123 4567'}
                                  </p>
                                  <p className="text-[8px] text-gray-400 uppercase tracking-widest pt-2">
                                    Processado por Computador • Impresso Automático via Epson L3250 / POS
                                  </p>
                                </div>
                              </>
                            ) : (
                              <div className="border-t border-gray-200 pt-4 flex justify-between items-center text-[10px] text-gray-400 italic">
                                <span>Recibo Nº: {invoiceToPrint.receiptNumber || (invoiceToPrint.invoiceNumber.startsWith('Fact-') ? invoiceToPrint.invoiceNumber.replace('Fact-', 'Rec-') : invoiceToPrint.invoiceNumber.startsWith('FAC-') ? invoiceToPrint.invoiceNumber.replace('FAC-', 'REC-A4-') : invoiceToPrint.invoiceNumber)}</span>
                                <span className="font-semibold text-primary">Continua na página seguinte... (Pág {pageIdx + 1} de {chunks.length})</span>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              {printType === 'Thermal' && (
                <div className="bg-white p-4 w-[72mm] shadow-none text-black text-[9px] font-mono leading-tight space-y-3 mx-auto" id="thermal_receipt">
                  {/* Header */}
                  <div className="text-center space-y-1">
                    {settings?.logoUrl ? (
                      <img src={settings.logoUrl} alt="Logo" className="max-h-10 object-contain bg-white mx-auto mb-1 block" />
                    ) : null}
                    <h3 className="text-[11px] font-black uppercase tracking-wide">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h3>
                    <p className="text-[8px] text-gray-700">Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}</p>
                    <div className="text-[8px] text-gray-600 space-y-0.5">
                      {settings?.email && <p>Email: {settings.email}</p>}
                      <p>Vodacom: {[settings?.vodacom1, settings?.vodacom2, settings?.vodacom3].filter(Boolean).join(' / ') || '+258 84 123 4567'}</p>
                      <p>Movitel: {[settings?.movitel1, settings?.movitel2, settings?.movitel3].filter(Boolean).join(' / ') || '+258 86 123 4567'}</p>
                    </div>
                  </div>

                  {/* Document Title Bar */}
                  <div className="border-y-2 border-double border-gray-400 py-1.5 text-center font-black uppercase text-[10px] tracking-wider text-gray-900 bg-gray-50/50">
                    Recibo de Pagamento POS
                  </div>

                  {/* Metadata */}
                  <div className="space-y-0.5 text-[8px] text-gray-700">
                    <div className="flex justify-between">
                      <span className="font-bold">FATURA Nº:</span>
                      <span className="font-mono font-black">{invoiceToPrint.invoiceNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>DATA:</span>
                      <span>{new Date(invoiceToPrint.date).toLocaleString('pt-MZ')}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>OPERADOR:</span>
                      <span className="uppercase">{invoiceToPrint.operatorName}</span>
                    </div>
                    <div className="flex justify-between border-t border-dotted border-gray-300 pt-0.5 mt-0.5">
                      <span className="font-bold">CLIENTE:</span>
                      <span className="uppercase font-semibold">{invoiceToPrint.customerName}</span>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-b border-dashed border-gray-400 my-1"></div>

                  {/* Items list */}
                  <div className="space-y-2">
                    <div className="font-bold uppercase text-[8px] text-gray-500 flex justify-between">
                      <span>Artigo / Qtd x Preço</span>
                      <span>Total (MT)</span>
                    </div>
                    
                    <div className="space-y-2">
                      {invoiceToPrint.items.map((item, idx) => (
                        <div key={idx} className="space-y-0.5">
                          <div className="font-bold text-gray-900 uppercase text-[8.5px] leading-tight">{item.name}</div>
                          <div className="flex justify-between text-[8px] text-gray-600 font-mono">
                            <span>{item.quantity} {item.unit} x {item.unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                            <span className="font-bold font-mono text-gray-900">{item.totalPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-b border-dashed border-gray-400 my-1"></div>

                  {/* Calculations */}
                  <div className="space-y-1 text-[8.5px]">
                    <div className="flex justify-between">
                      <span>SUBTOTAL:</span>
                      <span className="font-mono">{invoiceToPrint.subtotal.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                    </div>
                    
                    {invoiceToPrint.discount > 0 && (
                      <div className="flex justify-between text-red-600">
                        <span>DESCONTO:</span>
                        <span className="font-mono">-{invoiceToPrint.discount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                      </div>
                    )}

                    {invoiceToPrint.includeIva && (
                      <div className="flex justify-between text-gray-600 text-[8px]">
                        <span>IVA INCLUÍDO (16%):</span>
                        <span className="font-mono">{(invoiceToPrint.ivaAmount || (invoiceToPrint.total - invoiceToPrint.total / 1.16)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                      </div>
                    )}

                    <div className="flex justify-between font-black text-[11px] border-t border-dashed border-gray-400 pt-1.5 mt-1 text-black">
                      <span>TOTAL PAGO:</span>
                      <span className="font-mono">{invoiceToPrint.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                    </div>

                    <div className="flex justify-between text-[8px] text-gray-700 pt-0.5 border-t border-dotted border-gray-300 mt-1">
                      <span>FORMA PAGAMENTO:</span>
                      <span className="uppercase font-bold text-gray-900">{invoiceToPrint.paymentMethod || 'Dinheiro'}</span>
                    </div>

                    {invoiceToPrint.paymentMethod === 'Dinheiro' && amountReceived && Number(amountReceived) >= invoiceToPrint.total && (
                      <div className="space-y-0.5 pt-0.5 font-mono text-[8px]">
                        <div className="flex justify-between text-gray-600">
                          <span>VALOR ENTREGUE:</span>
                          <span>{Number(amountReceived).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                        </div>
                        <div className="flex justify-between text-emerald-800 font-bold">
                          <span>TROCO:</span>
                          <span>{(Number(amountReceived) - invoiceToPrint.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MT</span>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Footer */}
                  <div className="border-t border-dashed border-gray-400 pt-3 text-center space-y-1 text-[8px] text-gray-500 uppercase">
                    <p className="font-bold text-gray-800">Obrigado pela sua preferência!</p>
                    <p className="font-bold text-gray-700 italic text-[8.5px] mt-0.5">"Validade até à reposição de stock"</p>
                    <div className="pt-2 text-[7px] text-gray-400 font-mono space-y-0.5">
                      <p>Processado por Software AgroGestão</p>
                      <p className="tracking-widest font-black text-[6px]">|||| | ||||| ||| |||||| |||| | ||</p>
                    </div>
                  </div>
                </div>
              )}

              {/* 3. Double A5 format on A4 Sheet layout (Duplicado) */}
              {printType === 'DoubleA5' && (
                <div className="bg-white p-6 w-[210mm] min-h-[297mm] shadow-lg border border-gray-300 text-gray-800 text-[10px] font-sans flex flex-col justify-between" id="double_a5">
                  {/* UPPER HALF (Empresa copy) */}
                  <div className="border-b-2 border-dashed border-gray-400 pb-12 mb-12">
                    <div className="flex justify-between items-center bg-gray-50 p-2.5 border border-gray-200 rounded mb-4">
                      <span className="font-bold text-primary uppercase text-xs">VIA DA EMPRESA (ARQUIVO FISCAL)</span>
                      <span className="font-mono text-gray-500 font-bold">Nº {invoiceToPrint.invoiceNumber}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="space-y-1">
                        {settings?.logoUrl ? (
                          <img src={settings.logoUrl} alt="Logo" className="max-h-8 object-contain bg-white rounded mb-1.5 block" />
                        ) : null}
                        <h4 className="font-black text-gray-800 text-sm">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h4>
                        <div className="text-[8px] text-gray-500 space-y-0.5">
                          <p>Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}</p>
                          {settings?.email && <p><strong>Email:</strong> {settings.email}</p>}
                          <p><strong>Vodacom:</strong> {[settings?.vodacom1, settings?.vodacom2, settings?.vodacom3].filter(Boolean).join(' / ') || '+258 84 123 4567'}</p>
                          <p><strong>Movitel:</strong> {[settings?.movitel1, settings?.movitel2, settings?.movitel3].filter(Boolean).join(' / ') || '+258 86 123 4567'}</p>
                          {(settings?.fixo1 || settings?.fixo2) && <p><strong>Fixo:</strong> {[settings.fixo1, settings.fixo2].filter(Boolean).join(' / ')}</p>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p><span className="font-semibold">Cliente:</span> {invoiceToPrint.customerName}</p>
                        <p><span className="font-semibold">Data:</span> {new Date(invoiceToPrint.date).toLocaleDateString()}</p>
                      </div>
                    </div>

                    <table className="w-full text-left border-collapse mb-4 text-[9px]">
                      <thead>
                        <tr className="bg-primary text-white font-bold">
                          <th className="p-1 rounded-l">Artigo</th>
                          <th className="p-1 text-right">Qtd</th>
                          <th className="p-1">Uni</th>
                          <th className="p-1 text-right">Total (MT)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {invoiceToPrint.items.map((item, idx) => (
                          <tr key={idx}>
                            <td className="p-1 font-semibold">{item.name}</td>
                            <td className="p-1 text-right font-mono">{item.quantity}</td>
                            <td className="p-1 text-gray-500">{item.unit}</td>
                            <td className="p-1 text-right font-bold font-mono">{item.totalPrice.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <div className="flex flex-col text-[8px] text-gray-500">
                        <span className="font-bold italic">"Esta fatura tem validade até à reposição de stock"</span>
                        <span className="mt-0.5">Forma de Pagamento: <strong className="uppercase text-emerald-700 font-black">{invoiceToPrint.paymentMethod || 'Dinheiro'}</strong></span>
                      </div>
                      <p className="font-black text-gray-800">TOTAL: <span className="text-primary text-xs font-mono">{invoiceToPrint.total.toLocaleString()} MT</span></p>
                    </div>
                  </div>

                  {/* LOWER HALF (Cliente copy) */}
                  <div>
                    <div className="flex justify-between items-center bg-gray-50 p-2.5 border border-gray-200 rounded mb-4">
                      <span className="font-bold text-primary uppercase text-xs">VIA DO CLIENTE (RECIBO QUITADO)</span>
                      <span className="font-mono text-gray-500 font-bold">Nº {invoiceToPrint.invoiceNumber}</span>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mb-4">
                      <div className="space-y-1">
                        {settings?.logoUrl ? (
                          <img src={settings.logoUrl} alt="Logo" className="max-h-8 object-contain bg-white rounded mb-1.5 block" />
                        ) : null}
                        <h4 className="font-black text-gray-800 text-sm">{settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}</h4>
                        <div className="text-[8px] text-gray-500 space-y-0.5">
                          <p>Maputo, Moçambique • NUIT: {settings?.companyNuit || '401976590'}</p>
                          {settings?.email && <p><strong>Email:</strong> {settings.email}</p>}
                          <p><strong>Vodacom:</strong> {[settings?.vodacom1, settings?.vodacom2, settings?.vodacom3].filter(Boolean).join(' / ') || '+258 84 123 4567'}</p>
                          <p><strong>Movitel:</strong> {[settings?.movitel1, settings?.movitel2, settings?.movitel3].filter(Boolean).join(' / ') || '+258 86 123 4567'}</p>
                          {(settings?.fixo1 || settings?.fixo2) && <p><strong>Fixo:</strong> {[settings.fixo1, settings.fixo2].filter(Boolean).join(' / ')}</p>}
                        </div>
                      </div>
                      <div className="text-right">
                        <p><span className="font-semibold">Cliente:</span> {invoiceToPrint.customerName}</p>
                        <p><span className="font-semibold">Data:</span> {new Date(invoiceToPrint.date).toLocaleDateString()}</p>
                      </div>
                    </div>

                    <table className="w-full text-left border-collapse mb-4 text-[9px]">
                      <thead>
                        <tr className="bg-primary text-white font-bold">
                          <th className="p-1 rounded-l">Artigo</th>
                          <th className="p-1 text-right">Qtd</th>
                          <th className="p-1">Uni</th>
                          <th className="p-1 text-right">Total (MT)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100">
                        {invoiceToPrint.items.map((item, idx) => (
                          <tr key={idx}>
                            <td className="p-1 font-semibold">{item.name}</td>
                            <td className="p-1 text-right font-mono">{item.quantity}</td>
                            <td className="p-1 text-gray-500">{item.unit}</td>
                            <td className="p-1 text-right font-bold font-mono">{item.totalPrice.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="flex justify-between items-center pt-2 border-t border-gray-100">
                      <div className="flex flex-col text-[8px] text-gray-500">
                        <span className="font-bold italic">"Esta fatura tem validade até à reposição de stock"</span>
                        <span className="mt-0.5">Forma de Pagamento: <strong className="uppercase text-emerald-700 font-black">{invoiceToPrint.paymentMethod || 'Dinheiro'}</strong></span>
                      </div>
                      <p className="font-black text-gray-800">TOTAL: <span className="text-primary text-xs font-mono">{invoiceToPrint.total.toLocaleString()} MT</span></p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {/* --- Barcode Association Modal --- */}
      {unrecognizedBarcode && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white border border-gray-200 rounded-xl overflow-hidden shadow-2xl">
            <div className="bg-amber-600 p-4 text-white font-bold flex justify-between items-center">
              <span className="flex items-center gap-2 text-xs uppercase tracking-wider">
                <span className="material-symbols-outlined text-[18px]">barcode_scanner</span>
                Associar Código de Barras
              </span>
              <button 
                onClick={() => {
                  setUnrecognizedBarcode(null);
                  setSelectedProductToAssociate('');
                  setAssociationSearch('');
                }} 
                className="text-white/80 hover:text-white"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-amber-50 border border-amber-200/80 rounded-lg p-3.5 space-y-1.5 text-xs text-amber-900">
                <p className="font-bold flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px] text-amber-700 animate-pulse">warning</span>
                  Código não cadastrado:
                </p>
                <p className="font-mono text-base font-black tracking-wider bg-white px-2.5 py-1.5 rounded border border-amber-200 text-center select-all">
                  {unrecognizedBarcode}
                </p>
                <p className="text-[10px] text-amber-750 leading-relaxed pt-1">
                  O sistema não localizou nenhum item com este código de barras. Deseja associá-lo a um produto do catálogo abaixo para facilitar as próximas vendas?
                </p>
              </div>

              <div className="space-y-2">
                <label className="block text-[10px] font-black uppercase text-gray-500">
                  1. Pesquisar Produto no Catálogo
                </label>
                <div className="relative">
                  <input
                    type="text"
                    value={associationSearch}
                    onChange={(e) => setAssociationSearch(e.target.value)}
                    placeholder="Filtrar por nome, categoria ou código..."
                    className="w-full border border-gray-300 rounded pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-primary"
                  />
                  <span className="material-symbols-outlined text-[16px] text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2">search</span>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="block text-[10px] font-black uppercase text-gray-500">
                  2. Selecionar Produto Alvo
                </label>
                <select
                  value={selectedProductToAssociate}
                  onChange={(e) => setSelectedProductToAssociate(e.target.value)}
                  className="w-full border border-gray-300 rounded px-2.5 py-2 text-xs focus:outline-none focus:border-primary bg-white"
                >
                  <option value="">-- Selecione o Produto --</option>
                  {products
                    .filter(p => 
                      !associationSearch ||
                      p.name.toLowerCase().includes(associationSearch.toLowerCase()) ||
                      p.category.toLowerCase().includes(associationSearch.toLowerCase()) ||
                      p.code.toLowerCase().includes(associationSearch.toLowerCase())
                    )
                    .map(p => (
                      <option key={p.id} value={p.id}>
                        [{p.code}] {p.name} - {p.sellingPrice.toLocaleString()} MT
                      </option>
                    ))
                  }
                </select>
                <p className="text-[9px] text-gray-400">
                  Mostrando {products.filter(p => !associationSearch || p.name.toLowerCase().includes(associationSearch.toLowerCase()) || p.category.toLowerCase().includes(associationSearch.toLowerCase()) || p.code.toLowerCase().includes(associationSearch.toLowerCase())).length} de {products.length} produtos.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setUnrecognizedBarcode(null);
                    setSelectedProductToAssociate('');
                    setAssociationSearch('');
                  }}
                  className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded text-xs font-bold transition-colors uppercase cursor-pointer text-center"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  disabled={!selectedProductToAssociate}
                  onClick={handleAssociateBarcode}
                  className={`flex-1 py-2 text-white rounded text-xs font-black transition-all uppercase flex items-center justify-center gap-1.5 ${
                    selectedProductToAssociate 
                      ? 'bg-emerald-600 hover:bg-emerald-700 cursor-pointer shadow-sm' 
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  <span className="material-symbols-outlined text-[16px]">add_circle</span>
                  Gravar & Adicionar
                </button>
              </div>
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

      {/* HIDDEN PRINT COMPONENT FOR XPRINT 80C */}
      <div id="thermal_receipt_80" className="hidden print:block fixed top-0 left-0 w-[80mm] bg-white p-0 m-0 text-black font-mono">
        {invoiceToPrint && (
          <div className="p-2 space-y-3">
            <div className="text-center">
              {settings?.logoUrl && (
                <div className="flex justify-center mb-2">
                  <img src={settings.logoUrl} alt="Logo" className="max-h-16 w-auto grayscale contrast-125" />
                </div>
              )}
              {/* Increased font size for company name */}
              <h1 className="text-[14px] font-bold uppercase whitespace-nowrap overflow-hidden text-ellipsis">
                {settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, EI'}
              </h1>
              <div className="text-[11px] mt-1">
                <p>NUIT: {settings?.companyNuit || '401976590'}</p>
                <p>Cel: {settings?.vodacom1 || '845197072'}</p>
                <p>Maputo, Moçambique</p>
              </div>
              <div className="my-2 border-t border-dashed border-black"></div>
              <p className="text-[12px] font-bold">RECIBO DE VENDA</p>
            </div>

            <div className="text-[11px] space-y-1">
              <p>Nº: {invoiceToPrint.receiptNumber || invoiceToPrint.invoiceNumber.replace('FAC-', 'REC-POS-').replace('Fact-', 'REC-POS-')}</p>
              <p>Data: {new Date(invoiceToPrint.date).toLocaleString('pt-MZ')}</p>
              <p>Cliente: {invoiceToPrint.customerName}</p>
            </div>

            <div className="border-t border-dashed border-black my-2"></div>
            
            {/* Items Table with larger font */}
            <table className="w-full text-[11px] text-left border-collapse">
              <thead>
                <tr className="border-b border-dashed border-black">
                  <th className="py-1">DESCRIÇÃO</th>
                  <th className="py-1 text-center">QTD</th>
                  <th className="py-1 text-right">TOTAL</th>
                </tr>
              </thead>
              <tbody>
                {invoiceToPrint.items.map((item, idx) => (
                  <tr key={idx} className="border-b border-gray-100 border-dotted">
                    <td className="py-1 leading-tight">{item.name}</td>
                    <td className="py-1 text-center whitespace-nowrap">{item.quantity} {item.unit}</td>
                    <td className="py-1 text-right whitespace-nowrap">{item.totalPrice.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div className="border-t border-dashed border-black my-2"></div>

            {/* Totals Section - Larger and Bold */}
            <div className="text-[13px] space-y-1">
              <div className="flex justify-between w-full">
                <span className="font-bold">Subtotal:</span>
                <span className="text-right">{invoiceToPrint.subtotal.toLocaleString()} MT</span>
              </div>
              <div className="flex justify-between w-full">
                <span className="font-bold">Desconto:</span>
                <span className="text-right">-{invoiceToPrint.discount.toLocaleString()} MT</span>
              </div>
              <div className="flex justify-between w-full font-bold text-[16px] border-t border-dashed border-black pt-2">
                <span>TOTAL:</span>
                <span className="text-right">{invoiceToPrint.total.toLocaleString()} MT</span>
              </div>
            </div>

            <div className="text-center pt-8 pb-12">
              <p className="text-[11px] italic">Obrigado pela preferência!</p>
              <p className="text-[9px] mt-2 text-gray-500">AgroGestão - Sistema POS</p>
            </div>
          </div>
        )}
      </div>

      {/* --- Registered Customers & Registration Modal --- */}
      {showCustomerModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-white border border-gray-200 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[85vh]">
            <div className="bg-primary p-4 text-white font-bold flex justify-between items-center shrink-0">
              <span className="flex items-center gap-2 text-xs uppercase tracking-wider">
                <span className="material-symbols-outlined text-[18px]">group</span>
                Gestão de Clientes (Base de Dados)
              </span>
              <button 
                onClick={() => setShowCustomerModal(false)}
                className="text-white hover:opacity-70 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6 custom-scrollbar flex-1">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 divide-y md:divide-y-0 md:divide-x divide-gray-200">
                
                {/* Left Side: Search and Select */}
                <div className="space-y-4 pb-6 md:pb-0">
                  <h3 className="text-xs font-black uppercase text-gray-400 tracking-wider">Buscar Cliente Existente</h3>
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 text-[16px]">search</span>
                    <input
                      type="text"
                      placeholder="Pesquise por Nome, NUIT ou Telefone..."
                      value={customerSearchQuery}
                      onChange={(e) => setCustomerSearchQuery(e.target.value)}
                      className="w-full bg-gray-50 border border-gray-200 rounded pl-8 pr-3 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary"
                    />
                  </div>

                  <div className="border border-gray-150 rounded-lg overflow-hidden max-h-[250px] overflow-y-auto custom-scrollbar">
                    {(() => {
                      const filteredCustomers = registeredCustomers.filter(c =>
                        c.name.toLowerCase().includes(customerSearchQuery.toLowerCase()) ||
                        (c.nuit && c.nuit.includes(customerSearchQuery)) ||
                        (c.phone && c.phone.includes(customerSearchQuery))
                      );

                      if (filteredCustomers.length === 0) {
                        return (
                          <div className="p-4 text-center text-gray-400 text-xs italic">
                            Nenhum cliente cadastrado.
                          </div>
                        );
                      }

                      return (
                        <div className="divide-y divide-gray-100 bg-white">
                          {filteredCustomers.map(cust => (
                            <div 
                              key={cust.id} 
                              onClick={() => {
                                handleSelectCustomer(cust);
                                setShowCustomerModal(false);
                              }}
                              className="p-3 hover:bg-gray-50 transition-colors cursor-pointer text-left space-y-1"
                            >
                              <p className="text-xs font-black text-gray-800">{cust.name}</p>
                              <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono">
                                {cust.nuit && (
                                  <span className="bg-gray-100 px-1 py-0.5 rounded">NUIT: {cust.nuit}</span>
                                )}
                                {cust.phone && (
                                  <span className="bg-gray-100 px-1 py-0.5 rounded">Cel: {cust.phone}</span>
                                )}
                              </div>
                              {cust.address && (
                                <p className="text-[10px] text-gray-400 truncate">Endereço: {cust.address}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                </div>

                {/* Right Side: Register New Customer */}
                <div className="space-y-4 pt-6 md:pt-0 md:pl-6">
                  <h3 className="text-xs font-black uppercase text-gray-400 tracking-wider">Cadastrar Novo Cliente</h3>
                  <form onSubmit={(e) => handleSaveCustomer(e)} className="space-y-3 text-left">
                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">Nome Completo *</label>
                      <input
                        type="text"
                        required
                        placeholder="Ex: Fazenda Sol Nascente Lda"
                        value={newCustomerName}
                        onChange={(e) => setNewCustomerName(e.target.value)}
                        className="w-full border border-gray-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-semibold"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">NUIT (Opcional)</label>
                      <input
                        type="text"
                        placeholder="Ex: 400123456"
                        value={newCustomerNuit}
                        onChange={(e) => setNewCustomerNuit(e.target.value)}
                        className="w-full border border-gray-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-mono"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">Endereço (Opcional)</label>
                      <input
                        type="text"
                        placeholder="Ex: Av. Moçambique, Maputo"
                        value={newCustomerAddress}
                        onChange={(e) => setNewCustomerAddress(e.target.value)}
                        className="w-full border border-gray-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                    </div>

                    <div>
                      <label className="block text-[10px] font-bold text-gray-500 uppercase mb-0.5">Telefone / Contacto (Opcional)</label>
                      <input
                        type="text"
                        placeholder="Ex: +258 84 123 4567"
                        value={newCustomerPhone}
                        onChange={(e) => setNewCustomerPhone(e.target.value)}
                        className="w-full border border-gray-200 rounded px-3 py-1.5 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                    </div>

                    <div className="pt-2">
                      <button
                        type="submit"
                        className="w-full py-2 bg-primary hover:bg-primary/95 text-white font-black uppercase text-xs tracking-wider rounded shadow-sm transition-colors cursor-pointer"
                      >
                        Salvar e Selecionar
                      </button>
                    </div>
                  </form>
                </div>

              </div>
            </div>
          </div>
        </div>
      )}

      {/* --- Paused Sales List Modal --- */}
      {showPausedSalesModal && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="w-full max-w-3xl bg-white border border-gray-200 rounded-xl overflow-hidden shadow-2xl flex flex-col max-h-[80vh]">
            <div className="bg-amber-500 p-4 text-white font-bold flex justify-between items-center shrink-0">
              <span className="flex items-center gap-2 text-xs uppercase tracking-wider">
                <span className="material-symbols-outlined text-[18px]">pause_circle</span>
                Vendas Pausadas em Espera
              </span>
              <button 
                onClick={() => setShowPausedSalesModal(false)}
                className="text-white hover:opacity-70 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
              {pausedSales.length === 0 ? (
                <div className="py-12 text-center text-gray-400 space-y-2">
                  <span className="material-symbols-outlined text-[48px]">pause_circle</span>
                  <p className="text-sm font-semibold">Nenhuma venda em espera no momento</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="border border-gray-150 rounded-lg overflow-hidden">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-150 font-black text-gray-500 uppercase tracking-wider">
                          <th className="p-3">Data/Hora</th>
                          <th className="p-3">Cliente</th>
                          <th className="p-3">Itens</th>
                          <th className="p-3 text-right">Total</th>
                          <th className="p-3 text-center">Acções</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-100 bg-white text-gray-700">
                        {pausedSales.map((ps) => {
                          const total = getSaleTotals(ps.items, ps.customSubtotalDiscount, ps.includeIva).total;

                          return (
                            <tr key={ps.id} className="hover:bg-amber-50/70 hover:shadow-md transition-all border-b border-gray-100">
                              <td className="p-3 whitespace-nowrap text-[11px] font-medium text-gray-500 font-mono">
                                {new Date(ps.date).toLocaleTimeString('pt-MZ')} • {new Date(ps.date).toLocaleDateString('pt-MZ')}
                              </td>
                              <td className="p-3">
                                <p className="font-bold text-gray-800">{ps.customerName}</p>
                                <div className="flex gap-1.5 text-[10px] text-gray-500 font-mono">
                                  {ps.customerNuit && <span>NUIT: {ps.customerNuit}</span>}
                                  {ps.customerAddress && <span>End: {ps.customerAddress}</span>}
                                </div>
                              </td>
                              <td className="p-3">
                                <div className="max-w-[200px] truncate font-semibold" title={ps.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}>
                                  {ps.items.map(i => `${i.quantity}x ${i.name}`).join(', ')}
                                </div>
                              </td>
                              <td className="p-3 text-right font-black font-mono text-emerald-700 whitespace-nowrap">
                                {total.toLocaleString()} MT
                              </td>
                              <td className="p-3">
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    type="button"
                                    onClick={() => handleResumePausedSale(ps.id)}
                                    className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[10px] uppercase font-black rounded flex items-center gap-1 cursor-pointer"
                                  >
                                    <span className="material-symbols-outlined text-[12px]">restore</span>
                                    Recuperar
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeletePausedSale(ps.id)}
                                    className="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 text-[10px] uppercase font-bold rounded flex items-center gap-1 cursor-pointer"
                                  >
                                    <span className="material-symbols-outlined text-[12px]">delete</span>
                                    Excluir
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- Modal Fullscreen Registo de Venda Antiga / Venda Sem Energia / Lançamento Retroativo --- */}
      {showRetroactiveModal && (
        <div className="fixed inset-0 bg-slate-900/95 backdrop-blur-md z-50 flex flex-col h-screen w-screen overflow-hidden animate-in fade-in duration-200">
          <div className="w-full h-full bg-slate-100 flex flex-col overflow-hidden">
            
            {/* Fullscreen Modal Header */}
            <div className="bg-indigo-950 text-white px-4 sm:px-8 py-3 sm:py-4 flex justify-between items-center shrink-0 border-b border-indigo-800/80 shadow-lg">
              <div className="flex items-center gap-3">
                <div className="bg-white/10 p-2.5 rounded-2xl text-indigo-200 backdrop-blur-md flex items-center justify-center shadow-inner">
                  <span className="material-symbols-outlined text-[28px]">edit_calendar</span>
                </div>
                <div>
                  <h2 className="text-base sm:text-xl font-black text-white tracking-tight flex items-center gap-2 flex-wrap">
                    Registo de Venda Antiga
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setShowRetroactiveModal(false)}
                  disabled={isFinalizingRetroactive}
                  className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white flex items-center gap-1.5 text-xs font-bold transition-all cursor-pointer border border-white/10 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-[18px]">close</span>
                  <span className="hidden sm:inline">Fechar (Sair)</span>
                </button>
              </div>
            </div>

            {/* Fullscreen Body Content */}
            <div className="p-3 sm:p-5 overflow-y-auto custom-scrollbar flex-1">

              {(retroactiveError || retroactiveSlow) && (
                <div className={`mb-4 rounded-2xl border-2 p-3.5 flex items-start gap-3 shadow-sm ${retroactiveError ? 'bg-red-50 border-red-300 text-red-800' : 'bg-amber-50 border-amber-300 text-amber-900'}`}>
                  <span className="material-symbols-outlined text-[22px] shrink-0 mt-0.5">{retroactiveError ? 'error' : 'hourglass_top'}</span>
                  <div className="flex-1">
                    <p className="text-xs font-black uppercase tracking-wider">{retroactiveError ? 'Não foi possível concluir' : 'A gravação está a demorar…'}</p>
                    <p className="text-xs leading-relaxed mt-0.5">
                      {retroactiveError || 'A ligação pode estar lenta ou instável. Não feche esta janela: a gravação continua em curso e o resultado será apresentado assim que o servidor responder.'}
                    </p>
                  </div>
                  {retroactiveError && (
                    <button type="button" onClick={() => setRetroactiveError('')} className="opacity-60 hover:opacity-100 cursor-pointer">
                      <span className="material-symbols-outlined text-[18px]">close</span>
                    </button>
                  )}
                </div>
              )}
              
              <div className={`grid grid-cols-1 lg:grid-cols-12 gap-4 items-start ${isFinalizingRetroactive ? 'pointer-events-none opacity-60' : ''}`}>
                
                {/* 1. INFORMAÇÕES PRINCIPAIS DA VENDA (Width: 3/12 - Reduced) */}
                <div className="lg:col-span-3 space-y-4 bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
                  <h3 className="text-[11px] font-black uppercase text-indigo-900 tracking-wider flex items-center gap-1.5 pb-2 border-b border-slate-100">
                    <span className="material-symbols-outlined text-indigo-600 text-[18px]">info</span>
                    Informações Principais
                  </h3>

                  {/* 1. DATA E HORA REAL DA VENDA */}
                  <div className="space-y-1">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-bold text-gray-700 uppercase flex items-center gap-1">
                        <span className="material-symbols-outlined text-indigo-600 text-[16px]">event</span>
                        Data e Hora Real <span className="text-red-500">*</span>
                      </label>
                      <button
                        type="button"
                        onClick={() => {
                          const now = new Date();
                          const year = now.getFullYear();
                          const month = String(now.getMonth() + 1).padStart(2, '0');
                          const day = String(now.getDate()).padStart(2, '0');
                          const hours = String(now.getHours()).padStart(2, '0');
                          const minutes = String(now.getMinutes()).padStart(2, '0');
                          setRetroactiveDateTime(`${year}-${month}-${day}T${hours}:${minutes}`);
                        }}
                        className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 underline cursor-pointer"
                        title="Repor para a data e hora actual"
                      >
                        Agora
                      </button>
                    </div>
                    <input
                      type="datetime-local"
                      value={retroactiveDateTime}
                      onChange={(e) => setRetroactiveDateTime(e.target.value)}
                      className="w-full bg-slate-50 border border-gray-300 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-800 focus:outline-none focus:border-indigo-600 focus:bg-white transition-all shadow-2xs"
                    />
                    <p className="text-[9px] text-indigo-700 font-medium">
                      📌 Data memorizada automaticamente para lançamentos consecutivos.
                    </p>
                  </div>

                  {/* 2. Nº DO RECIBO MANUSCRITO */}
                  <div className="space-y-1">
                    <label className="text-[10px] font-bold text-gray-700 uppercase flex items-center gap-1">
                      <span className="material-symbols-outlined text-amber-600 text-[16px]">receipt_long</span>
                      Nº Recibo / Talão
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Talão Nº 045..."
                      value={retroactiveReceiptNo}
                      onChange={(e) => setRetroactiveReceiptNo(e.target.value)}
                      className="w-full bg-amber-50/50 border border-amber-300 rounded-lg px-2.5 py-1.5 text-[11px] font-bold text-gray-900 placeholder-amber-400 focus:outline-none focus:border-amber-500 transition-all shadow-2xs"
                    />
                    <p className="text-[10px] text-gray-500 font-medium">
                      Para auditoria e rastreio.
                    </p>
                  </div>

                  {/* 3. CLIENTE */}
                  <div className="space-y-2 pt-2 border-t border-slate-100">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <label className="text-[10px] font-bold text-gray-700 uppercase flex items-center gap-1">
                        <span className="material-symbols-outlined text-indigo-600 text-[16px]">person</span>
                        Cliente
                      </label>
                      
                      {/* Segmented control */}
                      <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[10px] font-bold">
                        <button
                          type="button"
                          onClick={() => setRetroactiveCustomerMode('registered')}
                          className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                            retroactiveCustomerMode === 'registered'
                              ? 'bg-indigo-600 text-white shadow-2xs'
                              : 'text-gray-600 hover:text-gray-900'
                          }`}
                        >
                          Cadastrado
                        </button>
                        <button
                          type="button"
                          onClick={() => setRetroactiveCustomerMode('manual')}
                          className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                            retroactiveCustomerMode === 'manual'
                              ? 'bg-indigo-600 text-white shadow-2xs'
                              : 'text-gray-600 hover:text-gray-900'
                          }`}
                        >
                          Manual
                        </button>
                      </div>
                    </div>

                    {retroactiveCustomerMode === 'manual' ? (
                      <div className="space-y-2 bg-slate-50/90 p-2.5 rounded-xl border border-slate-200">
                        <input
                          type="text"
                          placeholder="Nome do Cliente"
                          value={retroactiveCustomerName}
                          onChange={(e) => setRetroactiveCustomerName(e.target.value)}
                          className="w-full bg-white border border-gray-200 rounded-lg px-2.5 py-1 text-[11px] font-semibold focus:outline-none focus:border-indigo-600"
                        />
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                          <input
                            type="text"
                            placeholder="NUIT (Opcional)"
                            value={retroactiveCustomerNuit}
                            onChange={(e) => setRetroactiveCustomerNuit(e.target.value)}
                            className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:border-indigo-600"
                          />
                          <input
                            type="text"
                            placeholder="Endereço"
                            value={retroactiveCustomerAddress}
                            onChange={(e) => setRetroactiveCustomerAddress(e.target.value)}
                            className="bg-white border border-gray-200 rounded-lg px-2 py-1 text-[10px] focus:outline-none focus:border-indigo-600"
                          />
                        </div>
                        <label className="flex items-center gap-1.5 text-[10px] font-semibold text-gray-600 cursor-pointer pt-0.5">
                          <input
                            type="checkbox"
                            checked={retroactiveSaveCustomer}
                            onChange={(e) => setRetroactiveSaveCustomer(e.target.checked)}
                            className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
                          />
                          Guardar na base de dados
                        </label>
                      </div>
                    ) : (
                      <div className="bg-slate-50/90 p-2 rounded-xl border border-slate-200">
                        <select
                          value={selectedRegisteredCustomer}
                          onChange={(e) => {
                            setSelectedRegisteredCustomer(e.target.value);
                            const found = registeredCustomers.find(c => c.id === e.target.value || c.name === e.target.value);
                            if (found) {
                              setRetroactiveCustomerName(found.name);
                              setRetroactiveCustomerNuit(found.nuit || '');
                              setRetroactiveCustomerAddress(found.address || '');
                            }
                          }}
                          className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1.5 text-[11px] font-semibold focus:outline-none focus:border-indigo-600"
                        >
                          <option value="">-- Selecione Cliente Cadastrado --</option>
                          {registeredCustomers.map(c => (
                            <option key={c.id} value={c.id}>
                              {c.name} {c.nuit ? `(NUIT: ${c.nuit})` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>

                  {/* 4. FORMA DE PAGAMENTO */}
                  <div className="space-y-1.5 pt-2 border-t border-slate-100">
                    <label className="text-[10px] font-bold text-gray-700 uppercase flex items-center gap-1">
                      <span className="material-symbols-outlined text-indigo-600 text-[16px]">payments</span>
                      Forma de Pagamento <span className="text-red-500">*</span>
                    </label>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1">
                      {(['Dinheiro', 'Transferência', 'M-Pesa', 'E-Mola', 'Crédito'] as const).map(pm => (
                        <button
                          key={pm}
                          type="button"
                          onClick={() => setRetroactivePaymentMethod(pm)}
                          className={`py-1.5 px-2 rounded-lg text-[10px] font-black transition-all border text-center cursor-pointer ${
                            retroactivePaymentMethod === pm
                              ? 'bg-indigo-600 text-white border-indigo-600 shadow-2xs'
                              : 'bg-white text-gray-700 border-gray-200 hover:border-indigo-300 hover:bg-slate-50'
                          }`}
                        >
                          {pm}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 5. DESCONTAR DO STOCK ACTUAL */}
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-2.5 space-y-0.5">
                    <label className="flex items-start gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={retroactiveDeductStock}
                        onChange={(e) => setRetroactiveDeductStock(e.target.checked)}
                        className="rounded text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5 mt-0.5"
                      />
                      <div>
                        <span className="text-[10px] font-bold text-gray-800 flex items-center gap-1">
                          Descontar do stock
                          <span className="bg-indigo-100 text-indigo-700 text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase">
                            PADRÃO
                          </span>
                        </span>
                        <p className="text-[9.5px] text-gray-500 mt-0.5 leading-relaxed">
                          Desmarque apenas se a saída física já tiver sido dada.
                        </p>
                      </div>
                    </label>
                  </div>

                </div>

                {/* 2. CATÁLOGO DE PRODUTOS E SERVIÇOS (Width: 4/12 - Reduced) */}
                <div className="lg:col-span-4 space-y-3 bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs">
                  <div className="flex flex-wrap items-center justify-between gap-1 pb-2 border-b border-slate-100">
                    <h3 className="text-[11px] font-black uppercase text-indigo-900 tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-indigo-600 text-[18px]">add_shopping_cart</span>
                      Catálogo
                    </h3>
                    <span className="text-[10px] font-bold text-gray-500 bg-slate-100 px-2.5 py-0.5 rounded-full">
                      {products.length} itens
                    </span>
                  </div>

                  {/* Search Product */}
                  <div className="relative">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[18px]">
                      search
                    </span>
                    <input
                      type="text"
                      placeholder="Pesquisar por nome, código ou categoria..."
                      value={retroactiveProductQuery}
                      onChange={(e) => setRetroactiveProductQuery(e.target.value)}
                      className="w-full bg-slate-50 border border-gray-200 rounded-xl pl-9 pr-3 py-1.5 text-[11px] font-semibold focus:outline-none focus:border-indigo-600 focus:bg-white transition-all shadow-2xs"
                    />
                  </div>

                  {/* Filtered Products Grid/List */}
                  <div className="border border-slate-200 rounded-xl overflow-hidden max-h-[260px] sm:max-h-[320px] overflow-y-auto custom-scrollbar divide-y divide-slate-100 bg-white">
                    {products
                      .filter(p => 
                        p.name.toLowerCase().includes(retroactiveProductQuery.toLowerCase()) ||
                        p.code.toLowerCase().includes(retroactiveProductQuery.toLowerCase()) ||
                        (p.category && p.category.toLowerCase().includes(retroactiveProductQuery.toLowerCase()))
                      )
                      .map(p => {
                        const hybrid = isHybridProduct(p);
                        return (
                        <div
                          key={p.id}
                          onClick={() => { if (!hybrid) addProductToRetroactiveCart(p, 'Retail'); }}
                          className={`p-2.5 hover:bg-indigo-50/80 transition-colors flex items-center justify-between group ${hybrid ? '' : 'cursor-pointer'}`}
                        >
                          <div className="space-y-0.5">
                            <p className="font-bold text-[11px] text-gray-900 group-hover:text-indigo-700 transition-colors">
                              {p.name}
                            </p>
                            <p className="text-[9.5px] text-gray-500 font-mono">
                              Cód: <span className="font-semibold text-gray-700">{p.code}</span> • <span className="font-medium text-gray-600">{p.category || 'Geral'}</span>
                            </p>
                            {hybrid && (
                              <div className="flex gap-1 pt-1">
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); addProductToRetroactiveCart(p, 'Bulk'); }}
                                  className="px-2 py-0.5 bg-amber-100 hover:bg-amber-200 text-amber-900 border border-amber-300 rounded-lg text-[9px] font-black uppercase cursor-pointer"
                                  title={`Vender em ${p.parentUnit || 'Sacos'} (${getBulkSellingPrice(p).toLocaleString('pt-PT')} MT)`}
                                >
                                  + {p.parentUnit || 'Saco'} · {getBulkSellingPrice(p).toLocaleString('pt-PT')} MT
                                </button>
                                <button
                                  type="button"
                                  onClick={(e) => { e.stopPropagation(); addProductToRetroactiveCart(p, 'Retail'); }}
                                  className="px-2 py-0.5 bg-indigo-100 hover:bg-indigo-200 text-indigo-900 border border-indigo-300 rounded-lg text-[9px] font-black uppercase cursor-pointer"
                                  title={`Vender em ${p.baseUnit} (${p.sellingPrice.toLocaleString('pt-PT')} MT)`}
                                >
                                  + {p.baseUnit} · {p.sellingPrice.toLocaleString('pt-PT')} MT
                                </button>
                              </div>
                            )}
                          </div>
                          <div className="text-right shrink-0 ml-3">
                            <p className="font-black text-[11px] text-indigo-700 font-mono">
                              {p.sellingPrice.toLocaleString('pt-PT')} MT
                            </p>
                            <p className={`text-[9px] font-bold ${p.stockQty > 0 ? 'text-emerald-600' : 'text-amber-600'}`}>
                              {p.isService ? 'Serviço' : `${p.stockQty} stock`}
                            </p>
                          </div>
                        </div>
                        );
                      })}
                  </div>

                  <p className="text-[10px] text-gray-500 flex items-center justify-center gap-1 py-0.5 text-center font-medium">
                    <span className="material-symbols-outlined text-[14px] text-indigo-600">touch_app</span>
                    Clique no artigo para adicionar
                  </p>
                </div>

                {/* 3. CARRINHO (Width: 5/12 - Increased) */}
                <div className="lg:col-span-5 bg-white p-3.5 sm:p-4 rounded-2xl border border-slate-200/90 shadow-2xs space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-1 pb-2 border-b border-slate-100">
                    <div className="flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-indigo-600 text-[18px]">shopping_bag</span>
                      <span className="text-[11px] font-black uppercase text-indigo-900 tracking-wider">
                        Carrinho ({retroactiveCart.length})
                      </span>
                    </div>

                  {retroactiveCart.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setRetroactiveCart([])}
                      className="text-[10px] font-bold text-red-600 hover:text-red-700 flex items-center gap-0.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[14px]">remove_shopping_cart</span>
                      Esvaziar
                    </button>
                  )}
                </div>

                {retroactiveCart.length === 0 ? (
                  <div className="py-10 border-2 border-dashed border-slate-200 rounded-xl text-center text-gray-400 space-y-1.5 bg-slate-50/50">
                    <span className="material-symbols-outlined text-[40px] text-gray-300">shopping_cart</span>
                    <p className="text-xs font-bold text-gray-600">Carrinho da venda retroativa vazio</p>
                    <p className="text-[10px] text-gray-400">Selecione produtos no catálogo ao lado para adicionar</p>
                  </div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden divide-y divide-slate-100 overflow-x-auto">
                    <table className="w-full text-left text-[10.5px]">
                      <thead>
                        <tr className="bg-slate-50 text-gray-500 font-black uppercase tracking-wider text-[9.5px] border-b border-slate-200">
                          <th className="p-2.5">Artigo</th>
                          <th className="p-2.5 text-center">Preço Un.</th>
                          <th className="p-2.5 text-center">Qtd</th>
                          <th className="p-2.5 text-right">Total líquido</th>
                          <th className="p-2.5 text-center">Ação</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-gray-800">
                        {retroactiveCart.map(item => (
                          <tr key={`${item.productId}-${item.sellingUnit || 'Retail'}`} className="hover:bg-slate-50/80 transition-colors">
                            <td className="p-2.5 min-w-[195px]">
                              <p className="font-bold text-gray-900">{item.name}</p>
                              <p className="text-[9px] font-black uppercase text-gray-500">
                                {item.sellingUnit === 'Bulk' ? `Grosso • ${item.unit}` : `Retalho • ${item.unit}`}
                              </p>
                              <div className="flex flex-wrap items-center gap-1 mt-2 text-[10px]">
                                <label className="font-bold text-gray-500">Desconto:</label>
                                <select
                                  value={item.discountType || 'line_total'}
                                  onChange={(e) => updateRetroactiveCartDiscount(item.productId, e.target.value as ItemDiscountType, item.discountValue || 0, item.sellingUnit || 'Retail')}
                                  aria-label={`Tipo de desconto: ${item.name} (${item.unit})`}
                                  className="border border-gray-200 rounded px-1 py-1 bg-slate-50 text-gray-700 focus:outline-none focus:border-indigo-600"
                                >
                                  <option value="line_total">Total fixo (MT)</option>
                                  <option value="per_unit">Unitário fixo (MT)</option>
                                  <option value="percent_total">Total percentual (%)</option>
                                  <option value="percent_unit">Unitário percentual (%)</option>
                                </select>
                                <input
                                  type="number"
                                  min="0"
                                  max={getMaxItemDiscountValue(item, item.discountType || 'line_total')}
                                  step="any"
                                  value={item.discountValue || ''}
                                  onChange={(e) => updateRetroactiveCartDiscount(item.productId, item.discountType || 'line_total', Number(e.target.value), item.sellingUnit || 'Retail')}
                                  aria-label={`Valor do desconto: ${item.name} (${item.unit})`}
                                  placeholder="0"
                                  className="w-16 border border-gray-200 rounded px-1 py-1 text-right font-bold font-mono focus:outline-none focus:border-indigo-600"
                                />
                                <span className="font-bold text-gray-500">
                                  {item.discountType === 'percent_total' || item.discountType === 'percent_unit' ? '%' : 'MT'}
                                </span>
                              </div>
                            </td>
                            <td className="p-2.5 text-center font-mono font-semibold text-[10px]">
                              {item.unitPrice.toLocaleString('pt-PT')} MT
                            </td>
                            <td className="p-2.5 text-center">
                              <div className="inline-flex items-center border border-gray-300 rounded-lg overflow-hidden bg-slate-50 shadow-2xs">
                                <button
                                  type="button"
                                  onClick={() => updateRetroactiveCartQty(item.productId, -1, item.sellingUnit === 'Bulk' ? 'Bulk' : 'Retail')}
                                  className="px-2 py-0.5 text-gray-700 hover:bg-gray-200 font-black text-xs cursor-pointer transition-colors"
                                >
                                  -
                                </button>
                                <span className="px-2 py-0.5 font-mono font-black text-[10.5px] bg-white min-w-[28px] text-center border-x border-gray-200">
                                  {item.quantity}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => updateRetroactiveCartQty(item.productId, 1, item.sellingUnit === 'Bulk' ? 'Bulk' : 'Retail')}
                                  className="px-2 py-0.5 text-gray-700 hover:bg-gray-200 font-black text-xs cursor-pointer transition-colors"
                                >
                                  +
                                </button>
                              </div>
                            </td>
                            <td className="p-2.5 text-right font-black font-mono text-indigo-700 text-[11px] whitespace-nowrap">
                              {((item.unitPrice * item.quantity) - getItemDiscount(item)).toLocaleString('pt-PT')} MT
                              {getItemDiscount(item) > 0 && (
                                <span className="block text-[9px] text-rose-600 font-semibold">
                                  Desc. -{getItemDiscount(item).toLocaleString('pt-PT')} MT
                                </span>
                              )}
                            </td>
                            <td className="p-2.5 text-center">
                              <button
                                type="button"
                                onClick={() => removeRetroactiveCartItem(item.productId, item.sellingUnit === 'Bulk' ? 'Bulk' : 'Retail')}
                                className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                                title="Remover item"
                              >
                                <span className="material-symbols-outlined text-[16px]">delete</span>
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

            </div>

          </div>

            {/* Fullscreen Sticky Footer */}
            <div className="p-4 sm:p-5 px-4 sm:px-8 bg-white border-t border-slate-200 flex flex-col sm:flex-row justify-between items-center gap-4 shrink-0 shadow-lg">
              <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-start">
                <button
                  type="button"
                  onClick={() => setShowRetroactiveModal(false)}
                  disabled={isFinalizingRetroactive}
                  className="px-5 py-3 border border-gray-300 text-gray-700 font-bold text-xs sm:text-sm rounded-xl hover:bg-gray-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Cancelar
                </button>

                <div className="text-right sm:text-left" aria-live="polite">
                  <p className="text-[10px] text-gray-500 font-bold">
                    Subtotal: {retroactiveTotals.subtotal.toLocaleString('pt-PT')} MT
                  </p>
                  <p className="text-[10px] text-rose-600 font-bold">
                    Desconto: -{retroactiveTotals.discount.toLocaleString('pt-PT')} MT
                  </p>
                  <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">Total Final da Venda</p>
                  <p className="text-lg sm:text-2xl font-black font-mono text-indigo-900">
                    {retroactiveTotals.total.toLocaleString('pt-PT')} MT
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={retroactiveCart.length === 0 || isFinalizingRetroactive}
                onClick={handleFinalizeRetroactiveSale}
                className={`w-full sm:w-auto px-8 py-3.5 text-xs sm:text-sm uppercase font-black tracking-wider rounded-2xl shadow-lg transition-all flex items-center justify-center gap-2 cursor-pointer ${
                  retroactiveCart.length === 0 || isFinalizingRetroactive
                    ? 'bg-indigo-200 text-indigo-400 cursor-not-allowed shadow-none'
                    : 'bg-indigo-600 hover:bg-indigo-700 text-white shadow-indigo-300 hover:shadow-indigo-400'
                }`}
              >
                {isFinalizingRetroactive ? (
                  <>
                    <span className="material-symbols-outlined text-[20px] animate-spin">progress_activity</span>
                    A gravar...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">check_circle</span>
                    Finalizar Registo Retroativo ({retroactiveTotals.total.toLocaleString('pt-PT')} MT)
                  </>
                )}
              </button>
            </div>

          </div>
        </div>
      )}

      {/* --- Autorização da gerência: crédito acima do limite (D3) --- */}
      {creditAuth.show && (
        <CreditAuthModal
          customerName={customerName}
          amount={creditAuth.amount}
          outstanding={creditAuth.outstanding}
          reasons={creditAuth.reasons}
          settings={settings}
          onAuthorized={() => {
            void dbService.addAuditLog({
              id: uid('log-'),
              timestamp: new Date().toISOString(),
              username: currentUser.username,
              ipAddress: 'N/D',
              action: 'Crédito Autorizado Acima do Limite',
              status: 'Alerta',
              level: 'WARNING',
              entity: 'sales',
              details: `Venda a crédito de ${creditAuth.amount.toFixed(2)} MT a ${customerName} autorizada pela gerência (dívida anterior ${creditAuth.outstanding.toFixed(2)} MT; limite 20.000 MT).`
            });
            setCreditAuth({ show: false, reasons: [], outstanding: 0, amount: 0 });
            setCreditAuthOk(true);
            // Volta a chamar o fecho: agora com autorização registada.
            void handleFinalizeSaleRef.current?.(creditPendingFormatRef.current);
          }}
          onClose={() => setCreditAuth({ show: false, reasons: [], outstanding: 0, amount: 0 })}
        />
      )}

      {/* --- Modal Opções de Impressão (Recibo Xprinter XP 80C e A4) --- */}
      {retroactiveCompletedSale && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 sm:p-7 space-y-6 shadow-2xl border border-slate-200">
            <div className="flex items-center gap-4">
              <div className="w-14 h-14 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0 shadow-inner">
                <span className="material-symbols-outlined text-[32px]">check_circle</span>
              </div>
              <div>
                <h3 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">Venda Antiga Registada!</h3>
                <p className="text-xs text-slate-500 font-medium mt-0.5">
                  Recibo nº {retroactiveCompletedSale.receiptNumber || retroactiveCompletedSale.invoiceNumber} • {retroactiveCompletedSale.customerName}
                </p>
                <p className="text-sm font-black font-mono text-indigo-900 mt-1">
                  Total: {retroactiveCompletedSale.total.toLocaleString('pt-MZ')} MT
                </p>
              </div>
            </div>

            <div className="p-4 bg-emerald-50/80 rounded-2xl border border-emerald-200/80 space-y-1.5">
              <div className="flex items-center gap-2 text-emerald-900 font-extrabold text-xs">
                <span className="material-symbols-outlined text-[18px]">print</span>
                <span>Recibo Impresso / Descarregado em Xprinter XP 80C</span>
              </div>
              <p className="text-[11px] text-emerald-800 leading-relaxed font-medium">
                O recibo térmico de 80mm para a impressora **Xprinter XP 80C** foi enviado automaticamente. Abaixo pode também descarregar ou imprimir a versão do recibo no formato **A4**.
              </p>
            </div>

            <div className="space-y-3">
              <p className="text-xs font-black uppercase text-slate-400 tracking-wider">Outras Opções de Impressão</p>
              
              <button
                type="button"
                onClick={() => {
                  if (settings) downloadThermalReceipt(retroactiveCompletedSale, settings);
                }}
                className="w-full py-3 px-4 bg-slate-900 hover:bg-black text-white rounded-2xl text-xs font-bold flex items-center justify-between cursor-pointer transition-all shadow-sm"
              >
                <span className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[20px] text-amber-400">receipt_long</span>
                  <span>Recibo Térmico POS (Reimprimir Xprinter 80mm)</span>
                </span>
                <span className="material-symbols-outlined text-[18px]">download</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (settings) downloadReceiptA4(retroactiveCompletedSale, settings);
                }}
                className="w-full py-3 px-4 bg-emerald-700 hover:bg-emerald-800 text-white rounded-2xl text-xs font-bold flex items-center justify-between cursor-pointer transition-all shadow-sm"
              >
                <span className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[20px]">description</span>
                  <span>Imprimir Recibo em Formato A4</span>
                </span>
                <span className="material-symbols-outlined text-[18px]">download</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  if (settings) downloadDuplicatedInvoiceA4(retroactiveCompletedSale, settings);
                }}
                className="w-full py-3 px-4 bg-indigo-700 hover:bg-indigo-800 text-white rounded-2xl text-xs font-bold flex items-center justify-between cursor-pointer transition-all shadow-sm"
              >
                <span className="flex items-center gap-2.5">
                  <span className="material-symbols-outlined text-[20px]">content_copy</span>
                  <span>Fatura / Recibo Duplicado (A4 - 2 Vias)</span>
                </span>
                <span className="material-symbols-outlined text-[18px]">download</span>
              </button>
            </div>

            <div className="pt-3 border-t border-slate-100 flex flex-wrap items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setRetroactiveCompletedSale(null);
                  setRetroactiveError('');
                  setRetroactiveSlow(false);
                  setShowRetroactiveModal(true);
                }}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-extrabold text-xs rounded-xl transition-all shadow-md flex items-center gap-1.5 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[18px]">add_circle</span>
                <span>Lançar Outra Venda Antiga</span>
              </button>

              <button
                type="button"
                onClick={() => setRetroactiveCompletedSale(null)}
                className="px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-extrabold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Concluir
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
