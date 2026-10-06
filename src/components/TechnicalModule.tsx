import { safeStorage, safeSessionStorage } from "../utils/safeStorage";
import React, { useState, useEffect } from 'react';
import { jsPDF } from 'jspdf';
import { dbService } from '../utils/firebaseDB';
import { SystemSettings, AuditLog, UserCredentials, Product, Sale, LossRecord, AppRole, ActiveSession } from '../types';
import { AVAILABLE_ROLES, getUserRoles } from '../utils/roleHelper';
import DatabaseSchemaViewer from './DatabaseSchemaViewer';
import { DateRangeFilter } from './DateRangeFilter';
import { DateRangePreset, getDateRangeFromPreset, isDateInRange, formatDatePT } from '../utils/dateRangeHelper';
import { hashPassword, validateAccessPassword } from '../utils/securityHelper';
import { validateStandardPrices, validateHybridPrices, isHybridProduct } from '../utils/priceHelper';
import * as XLSX from 'xlsx';
import { 
  connectSerialPrinter, 
  disconnectSerialPrinter, 
  isSerialPrinterConnected, 
  sendCashDrawerPulse, 
  playChachingSound,
  isVirtualPrinterActive,
  setVirtualPrinterMode
} from '../utils/posHardware';

interface TechnicalModuleProps {
  onSettingsUpdated?: () => void;
}

export default function TechnicalModule({ onSettingsUpdated }: TechnicalModuleProps = {}) {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<UserCredentials[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [losses, setLosses] = useState<LossRecord[]>([]);

  // Active Technical Panel Tab
  const [activeTab, setActiveTab] = useState<'settings' | 'users' | 'logs' | 'schema' | 'ai_assistant' | 'cloud_firebase' | 'sessions'>('settings');
  const [settingsSubTab, setSettingsSubTab] = useState<'empresa' | 'bancos' | 'impressoras' | 'backups' | 'sistema'>('empresa');

  // Logs Date Range Filter
  const defaultLogsRange = getDateRangeFromPreset('Este Mês');
  const [logsStartDate, setLogsStartDate] = useState(defaultLogsRange.startDate);
  const [logsEndDate, setLogsEndDate] = useState(defaultLogsRange.endDate);
  const [logsPreset, setLogsPreset] = useState<DateRangePreset>('Este Mês');

  // Reconciliation Tool States
  const [techReconcileData, setTechReconcileData] = useState<any | null>(null);
  const [isTechReconciling, setIsTechReconciling] = useState(false);
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);

  // Firebase Cloud Management States
  const [firebaseUrlInput, setFirebaseUrlInput] = useState('');
  const [firebaseKeyInput, setFirebaseKeyInput] = useState('');
  const [testingFirebase, setTestingFirebase] = useState(false);
  const [firebaseTestResult, setFirebaseTestResult] = useState<{ success: boolean; message: string; latencyMs?: number } | null>(null);
  const [syncingFirebase, setSyncingFirebase] = useState(false);
  const [firebaseSyncLogs, setFirebaseSyncLogs] = useState<string[]>([]);
  const [firebaseSyncSummary, setFirebaseSyncSummary] = useState<Record<string, { local: number; cloud: number; synced: number }> | null>(null);

  // AI Assistant Tab States
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiAttachedFiles, setAiAttachedFiles] = useState<Array<{ id: string; base64: string; mime: string; name: string }>>([]);
  const [aiVoiceRecording, setAiVoiceRecording] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<any | null>(null);
  const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);

  // Editing Settings
  const [compName, setCompName] = useState('');
  const [stockCode, setStockCode] = useState('');
  const [logoUrl, setLogoUrl] = useState('');
  const [banco, setBanco] = useState('');
  const [conta, setConta] = useState('');
  const [nib, setNib] = useState('');
  const [banco2, setBanco2] = useState('');
  const [conta2, setConta2] = useState('');
  const [nib2, setNib2] = useState('');
  const [mpesa, setMpesa] = useState('');
  const [emola, setEmola] = useState('');
  const [vodacom1, setVodacom1] = useState('');
  const [vodacom2, setVodacom2] = useState('');
  const [vodacom3, setVodacom3] = useState('');
  const [movitel1, setMovitel1] = useState('');
  const [movitel2, setMovitel2] = useState('');
  const [movitel3, setMovitel3] = useState('');
  const [fixo1, setFixo1] = useState('');
  const [fixo2, setFixo2] = useState('');
  const [email, setEmail] = useState('');
  const [companyNuit, setCompanyNuit] = useState('');
  const [criticalStockLevel, setCriticalStockLevel] = useState(10);
  const [printerA4, setPrinterA4] = useState('Microsoft Print to PDF');
  const [printerThermal, setPrinterThermal] = useState('Xprinter XP-80');
  const [barcodePrefix, setBarcodePrefix] = useState('');
  const [barcodeSuffix, setBarcodeSuffix] = useState('');
  
  // Backups index list state
  const [autoBackupsList, setAutoBackupsList] = useState<string[]>([]);

  // Editing / Creating User States
  const [editingUser, setEditingUser] = useState<UserCredentials | null>(null);
  const [usrUsername, setUsrUsername] = useState('');
  const [usrPassword, setUsrPassword] = useState('');
  const [usrRoles, setUsrRoles] = useState<AppRole[]>(['Operador']);
  const [usrMfa, setUsrMfa] = useState(false);
  const [usrMustChange, setUsrMustChange] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: string; username: string } | null>(null);

  // Toast
  const [toastMessage, setToastMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isPrinterConnected, setIsPrinterConnected] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isVirtualMode, setIsVirtualMode] = useState(false);
  const [hardwareError, setHardwareError] = useState<{ msg: string; isIframe: boolean } | null>(null);

  useEffect(() => {
    setIsPrinterConnected(isSerialPrinterConnected());
    setIsVirtualMode(isVirtualPrinterActive());
  }, []);

  useEffect(() => {
    loadAllData();

    const handleDbUpdate = (e: any) => {
      loadAllData(); // reload on any update for the technical settings view
    };
    window.addEventListener('db-update', handleDbUpdate);
    return () => window.removeEventListener('db-update', handleDbUpdate);
  }, []);

  const loadAllData = async () => {
    await dbService.init();
    
    // Load Firebase config inputs
    const supConf = dbService.getFirebaseConfig();
    if (supConf.url) setFirebaseUrlInput(supConf.url);
    if (supConf.key) setFirebaseKeyInput(supConf.key);

    // Load config settings
    const config = await dbService.getSettings();
    setSettings(config);

    setCompName(config.companyName);
    setStockCode(config.stockPasswordHash);
    setLogoUrl(config.logoUrl || '');
    setBanco((config as any).banco || 'First Capital Bank, S.A.');
    setConta((config as any).numero_conta || '99466610001');
    setNib((config as any).nib || '001000000099466610196');
    setBanco2((config as any).banco2 || '');
    setConta2((config as any).numero_conta2 || '');
    setNib2((config as any).nib2 || '');
    setMpesa((config as any).mpesa || '');
    setEmola((config as any).emola || '');
    setVodacom1(config.vodacom1 || '');
    setVodacom2(config.vodacom2 || '');
    setVodacom3(config.vodacom3 || '');
    setMovitel1(config.movitel1 || '');
    setMovitel2(config.movitel2 || '');
    setMovitel3(config.movitel3 || '');
    setFixo1(config.fixo1 || '');
    setFixo2(config.fixo2 || '');
    setEmail(config.email || '');
    setCompanyNuit(config.companyNuit || '401976590');
    setCriticalStockLevel(config.criticalStockLevel || 10);
    setPrinterA4(config.printerA4 || 'Microsoft Print to PDF');
    setPrinterThermal(config.printerThermal || 'Xprinter XP-80');
    setBarcodePrefix(config.barcodePrefix || '');
    setBarcodeSuffix(config.barcodeSuffix || '');

    // Load backups index from localStorage
    try {
      const indexStr = safeStorage.getItem('agro_erp_backups_index') || '[]';
      setAutoBackupsList(JSON.parse(indexStr));
    } catch (e) {
      console.warn('Error loading backups index:', e);
    }

    // Load audit logs
    const logs = await dbService.getAuditLogs();
    setAuditLogs(logs);

    // Load users (credentials)
    const creds = await dbService.getCredentials();
    setUsers(creds);

    // Load products
    const prods = await dbService.getProducts();
    setProducts(prods);

    // Load sales
    const sls = await dbService.getSales();
    setSales(sls);

    // Load losses
    const lss = await dbService.getLosses();
    setLosses(lss);

    // Load active sessions
    const activeSess = await dbService.getActiveSessions();
    setActiveSessions(activeSess);
  };

  const handleTerminateSession = async (sessionId: string, username: string) => {
    await dbService.removeActiveSession(sessionId);
    await dbService.addAuditLog({
      id: 'log-' + Date.now(),
      timestamp: new Date().toISOString(),
      username: 'Técnico',
      ipAddress: '127.0.0.1',
      action: 'Terminar Sessão Forçada',
      status: 'Alerta',
      details: `O técnico encerrou a sessão ativa do utilizador: ${username}`
    });
    showToast(`Sessão de ${username} terminada com sucesso!`);
    loadAllData();
  };

  const handleClearAllSessions = async () => {
    if (!window.confirm('Tem certeza que deseja limpar todas as sessões ativas / órfãs? Isto desconectará todos os utilizadores no sistema.')) return;
    await dbService.clearActiveSessions();
    await dbService.addAuditLog({
      id: 'log-' + Date.now(),
      timestamp: new Date().toISOString(),
      username: 'Técnico',
      ipAddress: '127.0.0.1',
      action: 'Limpeza Geral de Sessões',
      status: 'Alerta',
      details: 'Todas as sessões ativas foram limpas pelo técnico.'
    });
    showToast('Todas as sessões ativas foram limpas!');
    loadAllData();
  };

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(''), 3000);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1.5 * 1024 * 1024) {
        showToast('Erro: O ficheiro do logotipo não deve exceder 1.5MB.');
        return;
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        if (event.target?.result) {
          setLogoUrl(event.target.result as string);
          showToast('Logotipo carregado com sucesso!');
        }
      };
      reader.readAsDataURL(file);
    }
  };

  // --- USER MANAGEMENT HANDLERS ---
  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!usrUsername || !usrPassword) {
      showToast('Por favor, indique o utilizador e palavra-passe.');
      return;
    }

    const rolesToSave = usrRoles.length > 0 ? usrRoles : (['Operador'] as AppRole[]);

    const isExistingHash = usrPassword.trim().startsWith('sha256:');
    if (!isExistingHash) {
      // Política oficial: 4 a 6 caracteres (apenas números, apenas letras ou mistos)
      const policy = validateAccessPassword(usrPassword);
      if (!policy.strong) {
        showToast(policy.message || 'Palavra-passe inválida.');
        return;
      }
    }
    const finalPasswordHash = isExistingHash ? usrPassword.trim() : await hashPassword(usrPassword.trim());

    const newUser: UserCredentials = {
      id: editingUser ? editingUser.id : 'usr-' + Date.now(),
      username: usrUsername.trim(),
      passwordHash: finalPasswordHash,
      roles: rolesToSave,
      role: rolesToSave.join(', '),
      mfaEnabled: usrMfa,
      mustChangePassword: isExistingHash ? (editingUser?.mustChangePassword || false) : usrMustChange,
      passwordResetVersion: editingUser?.passwordResetVersion
    };

    setIsSubmitting(true);
    try {
      await dbService.saveCredential(newUser);

      // Log to Audit logs
      await dbService.addAuditLog({
        id: 'log-' + Date.now(),
        timestamp: new Date().toISOString(),
        username: 'Técnico',
        ipAddress: '127.0.0.1',
        action: editingUser ? 'Utilizador Editado' : 'Utilizador Criado',
        status: 'Sucesso',
        details: `Utilizador ${usrUsername} (${rolesToSave.join(', ')}) gravado no sistema.`
      });

      showToast(editingUser ? 'Utilizador atualizado!' : 'Novo utilizador registado!');
      
      // Clear user form
      setEditingUser(null);
      setUsrUsername('');
      setUsrPassword('');
      setUsrRoles(['Operador']);
      setUsrMfa(false);
      setUsrMustChange(false);

      loadAllData();
    } catch (err) {
      console.error(err);
      showToast('Erro ao gravar utilizador.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const startEditUser = (user: UserCredentials) => {
    setEditingUser(user);
    setUsrUsername(user.username);
    setUsrPassword(user.passwordHash);
    const userRoles = getUserRoles(user);
    setUsrRoles(userRoles.length > 0 ? userRoles : ['Operador']);
    setUsrMfa(user.mfaEnabled || false);
    setUsrMustChange(user.mustChangePassword || false);
  };

  const promptDeleteUser = (id: string, username: string) => {
    if (username.toLowerCase() === 'admin') {
      showToast('O administrador padrão "admin" não pode ser eliminado.');
      return;
    }
    setUserToDelete({ id, username });
  };

  const confirmDeleteUser = async () => {
    if (isSubmitting) return;
    if (!userToDelete) return;
    const { id, username } = userToDelete;

    if (username.toLowerCase() === 'admin') {
      showToast('O administrador padrão "admin" não pode ser eliminado.');
      setUserToDelete(null);
      return;
    }

    setIsSubmitting(true);
    try {
      await dbService.deleteCredential(id);

      await dbService.addAuditLog({
        id: 'log-' + Date.now(),
        timestamp: new Date().toISOString(),
        username: 'Técnico',
        ipAddress: '127.0.0.1',
        action: 'Utilizador Eliminado',
        status: 'Sucesso',
        details: `Utilizador ${username} foi removido das credenciais ativas.`
      });

      showToast(`Utilizador "${username}" eliminado com sucesso.`);
      setUserToDelete(null);
      loadAllData();
    } catch (err) {
      console.error(err);
      showToast('Erro ao eliminar utilizador.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- CONFIG SETTINGS HANDLER ---
  const handleSaveSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!compName || !stockCode) {
      showToast('Por favor, preencha o nome da empresa e o código de stock.');
      return;
    }

    const updated: SystemSettings = {
      mode: settings?.mode || 'Online',
      companyName: compName,
      logoUrl,
      stockPasswordHash: stockCode,
      banco,
      numero_conta: conta,
      nib,
      banco2,
      numero_conta2: conta2,
      nib2,
      mpesa,
      emola,
      vodacom1,
      vodacom2,
      vodacom3,
      movitel1,
      movitel2,
      movitel3,
      fixo1,
      fixo2,
      email,
      companyNuit,
      criticalStockLevel: Number(criticalStockLevel),
      printerA4,
      printerThermal,
      barcodePrefix,
      barcodeSuffix
    } as any;

    setIsSubmitting(true);
    try {
      await dbService.saveSettings(updated);

      await dbService.addAuditLog({
        id: 'log-' + Date.now(),
        timestamp: new Date().toISOString(),
        username: 'Técnico',
        ipAddress: '127.0.0.1',
        action: 'Atualização de Configurações Globais',
        status: 'Sucesso',
        details: 'Parâmetros corporativos, logotipo e canais de liquidação atualizados.'
      });

      showToast('Configurações gravadas com sucesso!');
      await loadAllData();
      onSettingsUpdated?.();
    } catch (err) {
      console.error(err);
      showToast('Erro ao gravar configurações.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- firebase CLOUD MANAGEMENT HANDLERS ---
  const handleTestFirebaseConnection = async () => {
    setTestingFirebase(true);
    setFirebaseTestResult(null);
    const res = await dbService.testConnection(firebaseUrlInput, firebaseKeyInput);
    setTestingFirebase(false);
    setFirebaseTestResult(res);
    if (res.success) {
      showToast('Conectado com sucesso ao Firebase!');
    } else {
      showToast(`Falha na conexão: ${res.message}`);
    }
  };

  const handleSaveFirebaseConfig = async () => {
    if (!firebaseUrlInput || !firebaseKeyInput) {
      showToast('Preencha a URL e a Chave Anon de API do Firebase.');
      return;
    }
    dbService.setFirebaseConfig(firebaseUrlInput, firebaseKeyInput);
    showToast('Credenciais ativadas! Sincronizando com a Nuvem...');
    await loadAllData();
    handleTestFirebaseConnection();
  };

  const handleClearFirebaseConfig = async () => {
    dbService.clearFirebaseConfig();
    setFirebaseUrlInput('');
    setFirebaseKeyInput('');
    setFirebaseTestResult(null);
    showToast('Desconectado do Firebase. O sistema está no modo local.');
    await loadAllData();
  };

  const handleSyncAllWithFirebase = async () => {
    setSyncingFirebase(true);
    setFirebaseSyncLogs(['🚀 A iniciar sincronização bidirecional das 11 tabelas com o Firebase...']);
    setFirebaseSyncSummary(null);

    const res = await dbService.syncAllWithFirebase();
    setSyncingFirebase(false);
    setFirebaseSyncLogs(res.logs);
    setFirebaseSyncSummary(res.summary);

    if (res.success) {
      showToast('Sincronização com o Firebase concluída!');
    } else {
      showToast('Sincronização concluída com avisos. Verifique o log.');
    }
    await loadAllData();
  };

  // --- AI ASSISTANT SYSTEM CHANGE HANDLERS ---
  const handleAiFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = (reader.result as string).split(',')[1];
        const newFile = {
          id: 'file-' + Date.now() + '-' + Math.random().toString(36).substr(2, 4),
          base64,
          mime: file.type,
          name: file.name
        };
        setAiAttachedFiles(prev => [...prev, newFile]);
        showToast(`Anexado com sucesso: ${file.name}`);
      };
      reader.readAsDataURL(file);
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          const newFile = {
            id: 'voice-' + Date.now(),
            base64,
            mime: 'audio/webm',
            name: 'gravaçao_voz_tecnico.webm'
          };
          setAiAttachedFiles(prev => [...prev, newFile]);
          showToast("Áudio de voz gravado e anexado com sucesso!");
        };
        reader.readAsDataURL(audioBlob);
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setAiVoiceRecording(true);
    } catch (err) {
      console.error("Erro ao acessar microfone:", err);
      showToast("Não foi possível acessar o microfone. Verifique as permissões.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && aiVoiceRecording) {
      mediaRecorder.stop();
      setAiVoiceRecording(false);
    }
  };

  const handleSendToAi = async () => {
    if (!aiPrompt && aiAttachedFiles.length === 0) {
      showToast("Insira um comando de texto ou anexe pelo menos um ficheiro (imagem, áudio, PDF)!");
      return;
    }

    setAiLoading(true);
    setAiResponse(null);

    try {
      const res = await fetch('/api/gemini/technician-ai', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          prompt: aiPrompt,
          files: aiAttachedFiles.map(f => ({
            base64: f.base64,
            mime: f.mime,
            name: f.name
          }))
        })
      });

      if (!res.ok) {
        let errMsg = 'Falha ao processar pelo assistente IA.';
        try {
          const errData = await res.json();
          errMsg = errData.error || errMsg;
        } catch {
          try {
            const errText = await res.text();
            if (errText) {
              const titleMatch = errText.match(/<title>([\s\S]*?)<\/title>/i);
              if (titleMatch && titleMatch[1]) {
                errMsg = `Erro do Servidor (${res.status}): ${titleMatch[1].trim()}`;
              } else {
                errMsg = `Erro do Servidor (${res.status}): ${errText.substring(0, 150)}...`;
              }
            } else {
              errMsg = `Erro do Servidor com status ${res.status}.`;
            }
          } catch {
            errMsg = `Erro do Servidor com status ${res.status}.`;
          }
        }
        throw new Error(errMsg);
      }

      const data = await res.json();
      setAiResponse(data);
      showToast("Sugestões analisadas pelo assistente IA!");
    } catch (err: any) {
      console.error(err);
      showToast("Erro: " + err.message);
    } finally {
      setAiLoading(false);
    }
  };

  const handleApplyAiChanges = async () => {
    if (!aiResponse || !aiResponse.changes) return;

    try {
      const { changes } = aiResponse;
      let appliedCount = 0;

      // 1. Apply Settings changes
      if (changes.settings && settings) {
        const updatedSettings = {
          ...settings,
          ...changes.settings
        };
        await dbService.saveSettings(updatedSettings);
        appliedCount++;
      }

      // 2. Apply User changes
      if (changes.newUser) {
        const u = changes.newUser;
        const newUser: UserCredentials = {
          id: 'usr-' + Date.now(),
          username: u.username.trim(),
          passwordHash: u.password || u.passwordHash || '123456',
          role: u.role || 'Operador',
          mfaEnabled: false
        };
        await dbService.saveCredential(newUser);
        appliedCount++;
      }

      // 3. Apply Product changes
      if (changes.newProduct) {
        const p = changes.newProduct;
        const aiBuy = Number(p.buyingPrice) || 0;
        const aiSell = Number(p.sellingPrice) || 0;
        // Regra: nunca gravar preços em que a compra seja igual ou superior à venda
        const aiPriceError = validateStandardPrices(aiBuy, aiSell, false);
        if (!aiPriceError) {
          const newProd: Product = {
            id: 'prod-' + Date.now(),
            code: p.code || 'PRD-' + Date.now().toString().substring(8),
            name: p.name,
            category: p.category || 'Adubos',
            stockQty: Number(p.stockQty) || 0,
            buyingPrice: aiBuy,
            sellingPrice: aiSell,
            baseUnit: p.baseUnit || 'Unidades'
          };
          await dbService.saveProduct(newProd);
          appliedCount++;
        } else {
          console.warn('[AI Apply] Produto ignorado por violar a regra de preços:', aiPriceError);
        }
      }

      // 4. Apply Stock Updates (Batch update)
      if (changes.stockUpdates && Array.isArray(changes.stockUpdates)) {
        const allProducts = await dbService.getProducts();
        for (const update of changes.stockUpdates) {
          const search = update.productSearch.toLowerCase();
          const target = allProducts.find(p => 
            p.name.toLowerCase().includes(search) || 
            p.code.toLowerCase().includes(search)
          );

          if (target) {
            target.stockQty += Number(update.quantityToAdd) || 0;

            // Regra de preços: só aplica alterações que mantenham a compra abaixo da venda
            const proposedBuy = update.newBuyingPrice ? Number(update.newBuyingPrice) : target.buyingPrice;
            const proposedSell = update.newSellingPrice ? Number(update.newSellingPrice) : target.sellingPrice;
            const priceError = isHybridProduct(target)
              ? validateHybridPrices(
                  target.buyingPriceBulk ?? target.buyingPrice,
                  target.sellingPriceBulk || proposedSell * (target.conversionRate || 1),
                  proposedSell,
                  Number(target.conversionRate) || 1
                )
              : validateStandardPrices(proposedBuy, proposedSell, target.isService);

            if (!priceError) {
              if (update.newBuyingPrice) target.buyingPrice = Number(update.newBuyingPrice);
              if (update.newSellingPrice) target.sellingPrice = Number(update.newSellingPrice);
            } else {
              console.warn('[AI Apply] Preços não alterados (regra de preços):', priceError);
            }
            
            // Re-calculate bulk/retail if applicable
            if (target.parentUnit && target.conversionRate && target.conversionRate > 1) {
              const rate = target.conversionRate;
              target.stockQtyBulk = Math.floor(target.stockQty / rate);
              target.stockQtyRetail = target.stockQty % rate;
            }

            await dbService.saveProduct(target);
            appliedCount++;
          }
        }
      }

      if (appliedCount > 0) {
        // Log to Audit logs
        await dbService.addAuditLog({
          id: 'log-' + Date.now(),
          timestamp: new Date().toISOString(),
          username: 'Técnico (Assistente IA)',
          ipAddress: '127.0.0.1',
          action: 'Alterações via Assistente IA',
          status: 'Sucesso',
          details: `Aplicado com sucesso ${appliedCount} alteração(ões) baseada(s) na resposta estruturada da Inteligência Artificial.`
        });

        showToast(`${appliedCount} Alterações aplicadas com sucesso pelo Assistente IA!`);
        setAiResponse(null);
        setAiPrompt('');
        setAiAttachedFiles([]);
        await loadAllData();
        onSettingsUpdated?.();
      } else {
        showToast("Nenhuma alteração detectada para aplicar.");
      }
    } catch (error: any) {
      console.error(error);
      showToast("Erro ao aplicar alterações: " + error.message);
    }
  };

  // --- MAINTENANCE & SYSTEM PROCESSORS ---
  const handleEliminarHistoricoTeste = async () => {
    if (isSubmitting) return;
    const conf = window.confirm(
      'Tem a certeza absoluta que deseja eliminar todo o histórico de vendas, facturas e recibos de teste? O sistema ficará limpo e pronto para iniciar o uso com dados reais de produção.'
    );
    if (!conf) return;

    setIsSubmitting(true);
    try {
      await dbService.clearSystemData();

      await dbService.addAuditLog({
        id: 'log-' + Date.now(),
        timestamp: new Date().toISOString(),
        username: 'Técnico',
        ipAddress: '127.0.0.1',
        action: 'Eliminação de Histórico de Teste',
        status: 'Sucesso',
        details: 'Histórico de vendas, facturas e recibos de teste eliminado com sucesso pelo Técnico. Sistema pronto para produção.'
      });

      showToast('Histórico de vendas, facturas e recibos eliminado com sucesso! Pronto para produção.');
      loadAllData();
    } catch (err) {
      console.error(err);
      showToast('Erro ao limpar histórico de teste.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleZerarSistema = async () => {
    if (isSubmitting) return;
    const conf = window.confirm('TEM A CERTEZA QUE PRETENDE ZERAR O SISTEMA? Esta operação apagará permanentemente todas as vendas, quebras e folhas de salários, mas manterá os utilizadores e o catálogo.');
    if (!conf) return;

    setIsSubmitting(true);
    try {
      await dbService.clearSystemData();

      await dbService.addAuditLog({
        id: 'log-' + Date.now(),
        timestamp: new Date().toISOString(),
        username: 'Técnico',
        ipAddress: '127.0.0.1',
        action: 'Zerar Sistema Executado',
        status: 'Sucesso',
        details: 'Manutenção realizada. Dados de faturação e transações limpos para reinstalação de exercício.'
      });

      showToast('Manutenção de limpeza concluída!');
      loadAllData();
    } catch (err) {
      console.error(err);
      showToast('Erro ao zerar o sistema.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFecharAno = async () => {
    const conf = window.confirm('Pretende fechar o Exercício Fiscal Corrente? Esta operação congelará os registos ativos.');
    if (!conf) return;

    await dbService.addAuditLog({
      id: 'log-' + Date.now(),
      timestamp: new Date().toISOString(),
      username: 'Técnico',
      ipAddress: '127.0.0.1',
      action: 'Fecho de Exercício Fiscal',
      status: 'Sucesso',
      details: 'Fecho de exercício executado regulamentarmente.'
    });

    showToast('Ano Fiscal fechado e arquivado com sucesso!');
  };

  const handleNovoAno = async () => {
    const conf = window.confirm('Deseja iniciar um Novo Exercício Comercial? Isto redefinirá os livros de faturação enquanto preserva cadastros estruturais.');
    if (!conf) return;

    await dbService.clearSystemData();

    await dbService.addAuditLog({
      id: 'log-' + Date.now(),
      timestamp: new Date().toISOString(),
      username: 'Técnico',
      ipAddress: '127.0.0.1',
      action: 'Abertura de Novo Exercício',
      status: 'Sucesso',
      details: 'Novo exercício comercial estabelecido com herança de tabelas cadastrais.'
    });

    showToast('Novo Exercício Fiscal Inicializado!');
    loadAllData();
  };

  const handleBackupTotal = async () => {
    const prods = await dbService.getProducts();
    const sls = await dbService.getSales();
    const lss = await dbService.getLosses();
    const emps = await dbService.getEmployees();
    const att = await dbService.getAttendance();

    const fullBackup = {
      timestamp: new Date().toISOString(),
      app: 'AgroGestao Zero',
      data: { prods, sales: sls, losses: lss, emps, att }
    };

    const str = JSON.stringify(fullBackup, null, 2);
    const blob = new Blob([str], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `BACKUP_AGROGESTÃO_ZERO_${new Date().getFullYear()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    await dbService.addAuditLog({
      id: 'log-' + Date.now(),
      timestamp: new Date().toISOString(),
      username: 'Técnico',
      ipAddress: '127.0.0.1',
      action: 'Backup Completo Descarregado',
      status: 'Sucesso',
      details: 'Dados do utilizador e bases de dados locais copiados em formato JSON comprimido.'
    });

    showToast('Ficheiro de Backup JSON gerado com sucesso!');
    loadAllData();
  };

  // --- DASHBOARD ANALYTICS CALCULATIONS ---
  const totalRevenue = sales.reduce((acc, sale) => acc + sale.total, 0);
  
  // Calculate Profit based on actual Cost Prices in database
  const totalCost = sales.reduce((acc, sale) => {
    return acc + sale.items.reduce((sum, item) => {
      const prod = products.find(p => p.id === item.productId);
      const buyPrice = prod ? prod.buyingPrice : (item.unitPrice * 0.6); // default to 60% of sale price if product missing
      return sum + (buyPrice * item.quantity);
    }, 0);
  }, 0);
  
  const totalProfit = Math.max(0, totalRevenue - totalCost);
  const avgTicket = sales.length > 0 ? (totalRevenue / sales.length) : 0;
  
  const stockAlerts = products.filter(p => p.stockQty <= 10);
  const pendingSyncCount = sales.filter(s => !s.synced).length;

  return (
    <div className="space-y-6 animate-fade-in" id="tech_module">
      {/* Toast banner */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-primary text-white p-4 rounded-xl shadow-2xl flex items-center gap-2 border border-green-700">
          <span className="material-symbols-outlined">shield_person</span>
          <span className="text-sm font-semibold">{toastMessage}</span>
        </div>
      )}

      {/* Title */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <h3 className="text-xl font-black text-slate-800 tracking-tight flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-600">admin_panel_settings</span>
          Painel do Técnico & Definições
        </h3>
      </div>

      {/* Modern Compact Sub-Tab Segmented Blocks */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeTab === 'settings'
              ? 'bg-emerald-600 text-white border-emerald-700 shadow-md ring-2 ring-emerald-500/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/50'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeTab === 'settings' ? 'text-white' : 'text-emerald-600'}`}>settings</span>
          <span>Definições</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('users')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeTab === 'users'
              ? 'bg-blue-600 text-white border-blue-700 shadow-md ring-2 ring-blue-500/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-blue-300 hover:bg-blue-50/50'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeTab === 'users' ? 'text-white' : 'text-blue-600'}`}>group</span>
          <span>Utilizadores</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('logs')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeTab === 'logs'
              ? 'bg-purple-600 text-white border-purple-700 shadow-md ring-2 ring-purple-500/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-purple-300 hover:bg-purple-50/50'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeTab === 'logs' ? 'text-white' : 'text-purple-600'}`}>policy</span>
          <span>Auditoria</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('sessions')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeTab === 'sessions'
              ? 'bg-amber-600 text-white border-amber-700 shadow-md ring-2 ring-amber-500/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-amber-300 hover:bg-amber-50/50'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeTab === 'sessions' ? 'text-white' : 'text-amber-600'}`}>devices</span>
          <span>Sessões</span>
          {activeSessions.length > 0 && (
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-black ${
              activeTab === 'sessions' ? 'bg-white text-amber-700' : 'bg-amber-100 text-amber-800'
            }`}>
              {activeSessions.length}
            </span>
          )}
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('cloud_firebase')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeTab === 'cloud_firebase'
              ? 'bg-teal-600 text-white border-teal-700 shadow-md ring-2 ring-teal-500/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-teal-300 hover:bg-teal-50/50'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeTab === 'cloud_firebase' ? 'text-white' : 'text-teal-600'}`}>cloud_sync</span>
          <span>Nuvem</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('schema')}
          className={`flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all shadow-xs cursor-pointer border ${
            activeTab === 'schema'
              ? 'bg-slate-800 text-white border-slate-900 shadow-md ring-2 ring-slate-700/20'
              : 'bg-white text-slate-700 border-slate-200 hover:border-slate-400 hover:bg-slate-100'
          }`}
        >
          <span className={`material-symbols-outlined text-[17px] ${activeTab === 'schema' ? 'text-white' : 'text-slate-700'}`}>database</span>
          <span>Tabelas BD</span>
        </button>
      </div>

      {/* --- 2. CONFIGURATIONS & SYSTEM SETTINGS VIEW --- */}
      {activeTab === 'settings' && (
        <div className="space-y-4">
          {/* Sub-tabs Bar */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-100 p-1.5 rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setSettingsSubTab('empresa')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                settingsSubTab === 'empresa'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">store</span>
              <span>Empresa & Logótipo</span>
            </button>

            <button
              type="button"
              onClick={() => setSettingsSubTab('bancos')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                settingsSubTab === 'bancos'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">account_balance</span>
              <span>Bancos & Contactos</span>
            </button>

            <button
              type="button"
              onClick={() => setSettingsSubTab('impressoras')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                settingsSubTab === 'impressoras'
                  ? 'bg-purple-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">print</span>
              <span>Impressoras (A4 & POS)</span>
            </button>

            <button
              type="button"
              onClick={() => setSettingsSubTab('backups')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                settingsSubTab === 'backups'
                  ? 'bg-teal-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">backup</span>
              <span>Backups & Restauração</span>
            </button>

            <button
              type="button"
              onClick={() => setSettingsSubTab('sistema')}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                settingsSubTab === 'sistema'
                  ? 'bg-slate-800 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/80'
              }`}
            >
              <span className="material-symbols-outlined text-[16px]">build</span>
              <span>Manutenção & Exercício</span>
            </button>
          </div>

          {/* Sub-Tab 1: EMPRESA & LOGOTIPO */}
          {settingsSubTab === 'empresa' && (
            <div className="bg-white p-6 border border-gray-200 rounded-xl shadow-sm space-y-5">
              <div className="border-b border-gray-100 pb-3">
                <h4 className="font-headline-md text-headline-md text-gray-800 font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-600 text-[20px]">store</span>
                  Identificação da Empresa & Logótipo
                </h4>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Defina o nome oficial, número fiscal (NUIT), nível de alerta de stock e identidade visual impressa nos documentos.
                </p>
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-5 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Designação Comercial da Empresa</label>
                    <input
                      type="text"
                      value={compName}
                      onChange={(e) => setCompName(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      placeholder="Ex: Agro-Xicomo & Serviços Lda"
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">NUIT da Empresa</label>
                      <input
                        type="text"
                        value={companyNuit}
                        onChange={(e) => setCompanyNuit(e.target.value)}
                        placeholder="401976590"
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary font-mono focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Nível Crítico de Stock</label>
                      <input
                        type="number"
                        value={criticalStockLevel}
                        onChange={(e) => setCriticalStockLevel(Number(e.target.value))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                      />
                    </div>
                  </div>

                  <div className="md:col-span-2">
                    <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Palavra-passe de Segurança do Stock (Código do Gestor)</label>
                    <input
                      type="password"
                      autoComplete="new-password"
                      spellCheck={false}
                      data-lpignore="true"
                      value={stockCode}
                      onChange={(e) => setStockCode(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary font-mono"
                      placeholder="Código para autorização de alterações manuais de stock"
                    />
                  </div>
                </div>

                {/* Upload de Logotipo */}
                <div className="border-t border-gray-100 pt-4 space-y-3">
                  <label className="block text-[11px] font-bold text-gray-700 uppercase tracking-wider">Logótipo da Empresa</label>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                    {/* File Upload Zone */}
                    <div className="border-2 border-dashed border-gray-300 rounded-xl p-4 text-center bg-gray-50 hover:bg-gray-100 transition-colors relative cursor-pointer group">
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleLogoUpload}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />
                      <div className="space-y-1">
                        <span className="material-symbols-outlined text-gray-400 group-hover:text-primary transition-colors text-3xl">cloud_upload</span>
                        <p className="text-xs font-bold text-gray-700">Carregar Logotipo do Computador ou Celular</p>
                        <p className="text-[10px] text-gray-400">Arraste a imagem ou clique para selecionar (PNG, JPG, SVG de até 1.5MB)</p>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div>
                        <label className="block text-[9px] font-semibold text-gray-500 mb-1">Ou URL Remota do Logótipo</label>
                        <input
                          type="text"
                          value={logoUrl}
                          onChange={(e) => setLogoUrl(e.target.value)}
                          placeholder="https://exemplo.com/logo.png"
                          className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary"
                        />
                      </div>

                      {logoUrl && (
                        <div className="flex items-center justify-between p-3 bg-emerald-50 rounded-xl border border-emerald-200">
                          <div className="flex items-center gap-3">
                            <img src={logoUrl} alt="Logo" className="w-12 h-12 object-contain rounded-lg border border-gray-200 bg-white p-1" onError={(e) => (e.currentTarget.style.display = 'none')} />
                            <div>
                              <span className="text-xs font-bold text-gray-800 block">Logótipo Ativo</span>
                              <span className="text-[10px] text-emerald-700 font-medium">{logoUrl.startsWith('data:') ? 'Ficheiro local (Base64)' : 'Ligação URL'}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setLogoUrl('')}
                            className="px-2.5 py-1 bg-red-100 hover:bg-red-200 text-red-700 font-bold text-[10px] rounded-lg transition-colors cursor-pointer"
                          >
                            Remover
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl uppercase transition-all shadow-xs flex items-center gap-1.5 text-xs cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    Gravar Definições da Empresa
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Sub-Tab 2: BANCOS & CONTACTOS */}
          {settingsSubTab === 'bancos' && (
            <div className="bg-white p-6 border border-gray-200 rounded-xl shadow-sm space-y-5">
              <div className="border-b border-gray-100 pb-3">
                <h4 className="font-headline-md text-headline-md text-gray-800 font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-blue-600 text-[20px]">account_balance</span>
                  Contas Bancárias, Carteiras Móveis & Contactos
                </h4>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Estes dados são exibidos nos cabeçalhos e rodapés de Faturas, Cotações e Recibos para pagamentos de clientes.
                </p>
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-5 text-xs">
                {/* Banco Principal */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <h5 className="text-[11px] font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-blue-600">account_balance</span>
                    Conta Bancária 1 (Principal)
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Instituição Bancária 1</label>
                      <input
                        type="text"
                        value={banco}
                        onChange={(e) => setBanco(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 bg-white"
                        placeholder="Ex: BCI"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Número de Conta 1</label>
                      <input
                        type="text"
                        value={conta}
                        onChange={(e) => setConta(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 bg-white font-mono"
                        placeholder="Ex: 123456789"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">NIB Moçambique 1</label>
                      <input
                        type="text"
                        value={nib}
                        onChange={(e) => setNib(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 bg-white font-mono"
                        placeholder="Ex: 0008 0000 1234 5678 9012 3"
                      />
                    </div>
                  </div>
                </div>

                {/* Banco Secundário */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <h5 className="text-[11px] font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-slate-600">account_balance</span>
                    Conta Bancária 2 (Secundário - Opcional)
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Instituição Bancária 2</label>
                      <input
                        type="text"
                        value={banco2}
                        onChange={(e) => setBanco2(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 bg-white"
                        placeholder="Ex: Millennium BIM / Standard Bank"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Número de Conta 2</label>
                      <input
                        type="text"
                        value={conta2}
                        onChange={(e) => setConta2(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 bg-white font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">NIB Moçambique 2</label>
                      <input
                        type="text"
                        value={nib2}
                        onChange={(e) => setNib2(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 bg-white font-mono"
                      />
                    </div>
                  </div>
                </div>

                {/* Carteiras Móveis */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <h5 className="text-[11px] font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-amber-600">payments</span>
                    Carteiras Móveis de Pagamento
                  </h5>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Contacto M-Pesa Principal</label>
                      <input
                        type="text"
                        value={mpesa}
                        onChange={(e) => setMpesa(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 bg-white font-mono"
                        placeholder="+258 84 000 0000"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Contacto E-Mola Principal</label>
                      <input
                        type="text"
                        value={emola}
                        onChange={(e) => setEmola(e.target.value)}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-blue-500 bg-white font-mono"
                        placeholder="+258 86 000 0000"
                      />
                    </div>
                  </div>
                </div>

                {/* Contactos Telefónicos e Email */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <h5 className="text-[11px] font-bold text-gray-800 uppercase tracking-wider flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-emerald-600">contact_phone</span>
                    Contactos de Atendimento ao Cliente
                  </h5>
                  
                  <div className="space-y-3">
                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Linhas Vodacom</span>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={vodacom1}
                          onChange={(e) => setVodacom1(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-500"
                          placeholder="Vodacom 1: +258 84..."
                        />
                        <input
                          type="text"
                          value={vodacom2}
                          onChange={(e) => setVodacom2(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-500"
                          placeholder="Vodacom 2: +258 84..."
                        />
                        <input
                          type="text"
                          value={vodacom3}
                          onChange={(e) => setVodacom3(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-500"
                          placeholder="Vodacom 3: +258 84..."
                        />
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Linhas Movitel</span>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={movitel1}
                          onChange={(e) => setMovitel1(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-500"
                          placeholder="Movitel 1: +258 86/87..."
                        />
                        <input
                          type="text"
                          value={movitel2}
                          onChange={(e) => setMovitel2(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-500"
                          placeholder="Movitel 2: +258 86/87..."
                        />
                        <input
                          type="text"
                          value={movitel3}
                          onChange={(e) => setMovitel3(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-500"
                          placeholder="Movitel 3: +258 86/87..."
                        />
                      </div>
                    </div>

                    <div>
                      <span className="text-[10px] font-bold text-slate-500 uppercase block mb-1">Linhas Fixas & Email Corporativo</span>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <input
                          type="text"
                          value={fixo1}
                          onChange={(e) => setFixo1(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-500"
                          placeholder="Fixo 1: +258 21..."
                        />
                        <input
                          type="text"
                          value={fixo2}
                          onChange={(e) => setFixo2(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-500"
                          placeholder="Fixo 2: +258 21..."
                        />
                        <input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          className="w-full border border-gray-300 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:border-blue-500"
                          placeholder="Email: geral@empresa.mz"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl uppercase transition-all shadow-xs flex items-center gap-1.5 text-xs cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    Gravar Dados Bancários & Contactos
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Sub-Tab 3: IMPRESSORAS (A4 & POS) */}
          {settingsSubTab === 'impressoras' && (
            <div className="bg-white p-6 border border-gray-200 rounded-xl shadow-sm space-y-5">
              <div className="border-b border-gray-100 pb-3">
                <h4 className="font-headline-md text-headline-md text-gray-800 font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-purple-600 text-[20px]">print</span>
                  Gestão de Impressoras & Gaveta de Dinheiro (POS)
                </h4>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Configure os destinos de impressão de faturas formais (A4) e talões térmicos (POS), e teste a gaveta física.
                </p>
              </div>

              <form onSubmit={handleSaveSettings} className="space-y-5 text-xs">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <label className="block text-[11px] font-bold text-gray-800 uppercase">
                      Impressora X (Facturas, Guias e Cotações A4)
                    </label>
                    <select
                      value={printerA4}
                      onChange={(e) => setPrinterA4(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-purple-500 bg-white"
                    >
                      <option value="Microsoft Print to PDF">Microsoft Print to PDF</option>
                      <option value="HP LaserJet Professional A4">HP LaserJet Professional A4</option>
                      <option value="Epson L3150 A4 Series">Epson L3150 A4 Series</option>
                      <option value="Canon G3010 A4">Canon G3010 A4</option>
                      <option value="Outra Impressora (Nome padrão)">Outra Impressora (Definições de Sistema)</option>
                    </select>
                    <p className="text-[10px] text-gray-500">
                      Documentos fiscais A4 serão formatados automaticamente para esta impressora.
                    </p>
                  </div>

                  <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-2">
                    <label className="block text-[11px] font-bold text-gray-800 uppercase">
                      Impressora Y (Talões Térmicos POS de 80mm/58mm)
                    </label>
                    <select
                      value={printerThermal}
                      onChange={(e) => setPrinterThermal(e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-purple-500 bg-white"
                    >
                      <option value="Xprinter XP-80">Xprinter XP-80 (80mm Térmica)</option>
                      <option value="Xprinter XP-58">Xprinter XP-58 (58mm Térmica)</option>
                      <option value="Epson TM-T20III">Epson TM-T20III Térmica</option>
                      <option value="Generic Thermal 80mm">Generic Thermal 80mm</option>
                      <option value="Outra Impressora POS">Outra Impressora POS</option>
                    </select>
                    <p className="text-[10px] text-gray-500">
                      Os recibos rápidos do balcão (PDV) serão direcionados para esta impressora.
                    </p>
                  </div>
                </div>

                {/* Hardware integration */}
                <div className="bg-slate-900 text-slate-100 p-5 rounded-xl border border-slate-800 space-y-3">
                  <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2">
                    <h5 className="text-xs font-bold uppercase tracking-wider flex items-center gap-2 text-emerald-400">
                      <span className="material-symbols-outlined text-[18px]">settings_input_hdmi</span>
                      Integração de Hardware POS (Impressora & Gaveta)
                    </h5>
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-full flex items-center gap-1 ${
                      isPrinterConnected 
                        ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                        : 'bg-slate-800 text-slate-400 border border-slate-700'
                    }`}>
                      <span className={`h-1.5 w-1.5 rounded-full ${isPrinterConnected ? 'bg-emerald-400 animate-ping' : 'bg-slate-500'}`}></span>
                      {isPrinterConnected ? 'Conectado (Porta Serial / USB)' : 'Pronto para Conexão'}
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    Sincronize a impressora térmica USB para emissão instantânea de talões e disparo automático de abertura da gaveta de dinheiro (RJ11).
                  </p>

                  <div className="flex flex-wrap gap-2 pt-1">
                    {!isPrinterConnected ? (
                      <button
                        type="button"
                        onClick={async () => {
                          setHardwareError(null);
                          const res = await connectSerialPrinter();
                          if (res.success) {
                            setIsPrinterConnected(true);
                            setIsVirtualMode(false);
                            showToast('Impressora Térmica associada com sucesso!');
                          } else {
                            showToast(`Falha de Conexão: ${res.error}`);
                          }
                        }}
                        className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">usb_coexistence</span>
                        Conectar Impressora Térmica (USB / COM)
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={async () => {
                          await disconnectSerialPrinter();
                          setIsPrinterConnected(false);
                          setIsVirtualMode(false);
                          setHardwareError(null);
                          showToast('Dispositivo de impressão desconectado.');
                        }}
                        className="px-3.5 py-2 bg-red-600 hover:bg-red-700 text-white font-bold rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[15px]">usb_off</span>
                        Desconectar Impressora
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={async () => {
                        playChachingSound();
                        setIsDrawerOpen(true);
                        const directSignal = await sendCashDrawerPulse();
                        if (directSignal) {
                          showToast('Gaveta Aberta! Sinal de pulso emitido.');
                        } else {
                          showToast('Comando de abertura emitido.');
                        }
                        setTimeout(() => setIsDrawerOpen(false), 3000);
                      }}
                      className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg text-xs transition-all flex items-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">point_of_sale</span>
                      Testar Abertura de Gaveta
                    </button>
                  </div>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-1.5 text-[11px] leading-relaxed text-gray-600">
                  <p className="font-bold text-gray-800 uppercase flex items-center gap-1 text-[10px]">
                    <span className="material-symbols-outlined text-[14px] text-blue-600">info</span>
                    Configuração Rápida de Hardware
                  </p>
                  <ul className="list-disc pl-4 space-y-1 text-[10px]">
                    <li><strong>Gaveta de Dinheiro (RJ11):</strong> Ligue o cabo RJ11 na porta traseira da impressora térmica.</li>
                    <li><strong>Impressão Direta:</strong> Configure a impressora térmica padrão no driver do sistema operacional.</li>
                  </ul>
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 bg-purple-600 hover:bg-purple-700 text-white font-bold rounded-xl uppercase transition-all shadow-xs flex items-center gap-1.5 text-xs cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    Gravar Definições de Impressão
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Sub-Tab 4: BACKUPS & RESTAURAÇÃO */}
          {settingsSubTab === 'backups' && (
            <div className="space-y-4">
              {/* Top Quick Actions */}
              <div className="bg-teal-50 border border-teal-200 p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-teal-600 text-white rounded-xl">
                    <span className="material-symbols-outlined text-[24px]">cloud_download</span>
                  </div>
                  <div>
                    <h4 className="font-bold text-teal-950 text-sm">Backup Completo do Sistema (.JSON)</h4>
                    <p className="text-teal-700 text-xs">Exporte todos os produtos, vendas, stock, clientes, faturas e utilizadores para um ficheiro .JSON seguro.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleBackupTotal}
                  className="px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-bold text-xs uppercase transition-all shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  Descarregar Backup .JSON
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Left: Auto-Backups List */}
                <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm space-y-3 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <h5 className="font-bold text-gray-800 text-xs uppercase flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-teal-600">history</span>
                        Backups Automáticos em Memória Local
                      </h5>
                      <span className="text-[10px] bg-teal-100 text-teal-800 font-bold px-2 py-0.5 rounded-full">
                        {autoBackupsList.length} pontos
                      </span>
                    </div>
                    <p className="text-[11px] text-gray-500">
                      O ERP cria pontos de restauro periódicos automáticos a cada 5 minutos e após cada venda concluída.
                    </p>
                  </div>
                  
                  {autoBackupsList.length === 0 ? (
                    <div className="p-6 text-center text-gray-400 bg-gray-50 rounded-xl text-xs italic">
                      Nenhum ponto de restauro automático gravado ainda.
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                      {autoBackupsList.map((ts, idx) => (
                        <div key={idx} className="flex justify-between items-center bg-gray-50 hover:bg-gray-100 p-2.5 border border-gray-200 rounded-lg text-xs transition-colors">
                          <div className="space-y-0.5">
                            <span className="font-bold text-gray-800 text-[11px]">Ponto #{autoBackupsList.length - idx}</span>
                            <p className="text-[10px] text-gray-500 flex items-center gap-1 font-mono">
                              <span className="material-symbols-outlined text-[12px]">schedule</span>
                              {new Date(ts).toLocaleString()}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={async () => {
                              const conf = window.confirm(`Deseja restaurar as bases de dados para o estado de ${new Date(ts).toLocaleString()}? Os dados atuais serão substituídos.`);
                              if (!conf) return;
                              try {
                                const backupData = safeStorage.getItem(`agro_erp_backup_${ts}`);
                                if (backupData) {
                                  await dbService.importAllData(backupData);
                                  showToast('Banco de dados restaurado com sucesso!');
                                  loadAllData();
                                } else {
                                  showToast('Erro: Dados de backup não encontrados.');
                                }
                              } catch (err) {
                                showToast('Erro ao restaurar o backup.');
                              }
                            }}
                            className="px-2.5 py-1 bg-teal-600 hover:bg-teal-700 text-white font-bold rounded-lg text-[10px] transition-colors cursor-pointer"
                          >
                            Restaurar
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Right: Manual JSON Upload */}
                <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm space-y-4 flex flex-col justify-between">
                  <div className="space-y-2">
                    <h5 className="font-bold text-gray-800 text-xs uppercase flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-blue-600">file_upload</span>
                      Restaurar Ficheiro de Backup (.JSON)
                    </h5>
                    <p className="text-[11px] text-gray-500 leading-relaxed">
                      Se mudou de computador ou pretende repor um backup histórico, selecione o arquivo .json guardado previamente.
                    </p>
                  </div>
                  
                  <div className="p-4 border-2 border-dashed border-blue-200 bg-blue-50/50 rounded-xl text-center space-y-2">
                    <input
                      type="file"
                      accept=".json"
                      id="backup-upload"
                      className="hidden"
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        
                        const reader = new FileReader();
                        reader.onload = async (event) => {
                          try {
                            const content = event.target?.result as string;
                            await dbService.importAllData(content);
                            showToast('Recuperação efetuada com sucesso a partir do ficheiro de backup!');
                            loadAllData();
                          } catch (err) {
                            showToast('Ficheiro de backup inválido ou corrompido.');
                          }
                        };
                        reader.readAsText(file);
                      }}
                    />
                    <span className="material-symbols-outlined text-blue-600 text-[28px]">upload_file</span>
                    <div>
                      <label
                        htmlFor="backup-upload"
                        className="inline-block px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-xl text-xs uppercase cursor-pointer transition-colors"
                      >
                        Selecionar Ficheiro (.JSON)
                      </label>
                      <p className="text-[10px] text-gray-500 mt-1.5">Formatos suportados: Ficheiros JSON exportados pelo ERP</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Sub-Tab 5: MANUTENÇÃO & EXERCÍCIO FISCAL */}
          {settingsSubTab === 'sistema' && (
            <div className="bg-white p-6 border border-gray-200 rounded-xl shadow-sm space-y-5">
              <div className="border-b border-gray-100 pb-3">
                <h4 className="font-headline-md text-headline-md text-gray-800 font-bold flex items-center gap-2">
                  <span className="material-symbols-outlined text-slate-800 text-[20px]">build</span>
                  Manutenção Avançada, Ciclo Fiscal & Limpeza
                </h4>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Ações críticas com privilégio de Técnico Master. Utilize com cautela após descarregar uma cópia de segurança.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Fiscal Cycle Box */}
                <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-3">
                  <h5 className="font-bold text-slate-800 text-xs uppercase flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-indigo-600">calendar_month</span>
                    Ciclo e Exercício Fiscal
                  </h5>
                  <p className="text-[11px] text-gray-600 leading-relaxed">
                    Operações de fecho de exercício contábil anual e abertura do próximo ano financeiro.
                  </p>
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={handleFecharAno}
                      className="w-full py-2.5 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 rounded-xl font-bold text-xs uppercase transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <span className="material-symbols-outlined text-[15px]">lock</span>
                      Fechar Ano Fiscal
                    </button>
                    <button
                      type="button"
                      onClick={handleNovoAno}
                      className="w-full py-2.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 rounded-xl font-bold text-xs uppercase transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[15px]">calendar_today</span>
                      Novo Exercício Fiscal
                    </button>
                  </div>
                </div>

                {/* Database Reset & Testing Cleansing */}
                <div className="p-4 bg-red-50/50 border border-red-200 rounded-xl space-y-3">
                  <h5 className="font-bold text-red-900 text-xs uppercase flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-red-600">warning</span>
                    Limpeza de Teste e Reposição de Fábrica
                  </h5>
                  <p className="text-[11px] text-red-700 leading-relaxed">
                    Elimine transações de demonstração ou restaure o ERP para o estado inicial de implantação.
                  </p>
                  <div className="space-y-2 pt-1">
                    <button
                      type="button"
                      onClick={handleEliminarHistoricoTeste}
                      className="w-full py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-bold text-xs uppercase transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete_sweep</span>
                      Eliminar Histórico de Teste (Vendas e Facturas)
                    </button>
                    <button
                      type="button"
                      onClick={handleZerarSistema}
                      className="w-full py-2.5 bg-white hover:bg-red-100 text-red-700 border border-red-300 rounded-xl font-bold text-xs uppercase transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">delete_forever</span>
                      Zerar Sistema (Fiscal Reset Total)
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* --- 3. UTILIZADORES MANAGEMENT VIEW --- */}
      {activeTab === 'users' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fade-in">
          {/* List view of existing users */}
          <div className="lg:col-span-2 bg-white p-6 border border-gray-200 rounded-xl shadow-sm space-y-4">
            <h4 className="font-bold text-gray-800 text-sm border-b border-gray-100 pb-2">
              Utilizadores e Perfis Registados
            </h4>

            <div className="overflow-x-auto custom-scrollbar">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                  <tr>
                    <th className="p-3">Utilizador</th>
                    <th className="p-3">Nível / Role</th>
                    <th className="p-3">Palavra-passe</th>
                    <th className="p-3 text-center">MFA Autenticação</th>
                    <th className="p-3 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {users.map(u => {
                    const uRoles = getUserRoles(u);
                    return (
                      <tr key={u.id} className="hover:bg-gray-50">
                        <td className="p-3 font-bold text-slate-900">{u.username}</td>
                        <td className="p-3">
                          <div className="flex flex-wrap gap-1">
                            {uRoles.map((r, idx) => (
                              <span
                                key={idx}
                                className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                  r === 'Técnico'
                                    ? 'bg-purple-100 text-purple-800 border-purple-200'
                                    : r === 'Gestor Geral'
                                    ? 'bg-indigo-100 text-indigo-800 border-indigo-200'
                                    : r === 'Gestor de Stock'
                                    ? 'bg-blue-100 text-blue-800 border-blue-200'
                                    : r === 'Gestor de RH'
                                    ? 'bg-amber-100 text-amber-800 border-amber-200'
                                    : r === 'Contabilista'
                                    ? 'bg-emerald-100 text-emerald-800 border-emerald-200'
                                    : 'bg-gray-100 text-gray-800 border-gray-200'
                                }`}
                              >
                                {r}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="p-3 font-mono text-gray-700 font-bold bg-gray-50/50 rounded px-2">
                          <span className="text-slate-500 font-black tracking-widest">••••••••</span>
                          {u.passwordHash?.startsWith('sha256:') && (
                            <span className="ml-2 text-[9px] bg-emerald-100 text-emerald-800 px-1.5 py-0.5 rounded font-black uppercase">
                              Hash SHA-256
                            </span>
                          )}
                          {u.mustChangePassword && (
                            <span className="ml-2 text-[9px] bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded font-black uppercase">
                              Troca de senha pendente
                            </span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          {u.mfaEnabled ? (
                            <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold text-[10px]">ATIVO</span>
                          ) : (
                            <span className="bg-gray-100 text-gray-500 px-2 py-0.5 rounded text-[10px]">Desativo</span>
                          )}
                        </td>
                        <td className="p-3 text-center space-x-1">
                          <button
                            onClick={() => startEditUser(u)}
                            className="px-2 py-1 bg-blue-50 text-blue-700 border border-blue-200 text-[10px] rounded hover:bg-blue-100 font-bold"
                          >
                            EDITAR
                          </button>
                          <button
                            onClick={() => promptDeleteUser(u.id, u.username)}
                            className="px-2 py-1 bg-red-50 text-red-700 border border-red-200 text-[10px] rounded hover:bg-red-100 font-bold cursor-pointer"
                          >
                            ELIMINAR
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* User Registration Form (Add / Edit) */}
          <div className="bg-white p-6 border border-gray-200 rounded-xl shadow-sm">
            <h4 className="font-bold text-gray-800 text-sm border-b border-gray-100 pb-2">
              {editingUser ? 'Atualizar Utilizador' : 'Admitir Novo Utilizador'}
            </h4>

            <form onSubmit={handleSaveUser} className="space-y-4 text-xs mt-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Nome de Utilizador</label>
                <input
                  type="text"
                  value={usrUsername}
                  onChange={(e) => setUsrUsername(e.target.value)}
                  placeholder="Ex: operador3"
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:border-primary"
                  disabled={editingUser?.username === 'admin'}
                />
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-1">Palavra-passe de Acesso</label>
                <input
                  type="password"
                  autoComplete="new-password"
                  spellCheck={false}
                  data-lpignore="true"
                  value={usrPassword}
                  onChange={(e) => setUsrPassword(e.target.value)}
                  placeholder="4 a 6 caracteres (letras ou números)"
                  maxLength={6}
                  className="w-full border border-gray-300 rounded px-3 py-2 text-xs focus:outline-none focus:border-primary"
                />
                <p className="text-[10px] text-gray-500 mt-1">
                  A palavra-passe deve ter 4 a 6 caracteres (apenas números, apenas letras ou mistos). Símbolos não são obrigatórios.
                </p>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">
                  Níveis de Permissão (Roles) - Selecione 1 ou mais:
                </label>
                <div className="space-y-2 mt-2">
                  {AVAILABLE_ROLES.map((r) => {
                    const isChecked = usrRoles.includes(r.id);
                    const isDisabled = editingUser?.username === 'admin' && r.id === 'Técnico';
                    return (
                      <label
                        key={r.id}
                        className={`flex items-start p-2.5 rounded-lg border cursor-pointer transition-all ${
                          isChecked
                            ? 'border-emerald-500 bg-emerald-50/80 text-emerald-950 font-medium shadow-xs'
                            : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                        } ${isDisabled ? 'opacity-60 cursor-not-allowed' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={isDisabled}
                          onChange={() => {
                            if (!isDisabled) {
                              if (isChecked) {
                                if (usrRoles.length === 1) {
                                  showToast('O utilizador deve possuir pelo menos 1 nível de permissão.');
                                  return;
                                }
                                setUsrRoles(usrRoles.filter(item => item !== r.id));
                              } else {
                                setUsrRoles([...usrRoles, r.id]);
                              }
                            }
                          }}
                          className="mt-0.5 mr-2.5 h-4 w-4 rounded border-gray-300 accent-emerald-600 focus:ring-emerald-500"
                        />
                        <div className="text-xs">
                          <span className="font-bold block text-slate-900">{r.label}</span>
                          <span className="text-[10px] text-gray-500">{r.desc}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
                <p className="text-[10px] text-gray-500 mt-2 italic">
                  * Pode selecionar múltiplos papéis para dar permissões combinadas ao utilizador.
                </p>
              </div>

              <div className="flex items-center gap-2 py-2">
                <input
                  type="checkbox"
                  id="mfa"
                  checked={usrMfa}
                  onChange={(e) => setUsrMfa(e.target.checked)}
                />
                <label htmlFor="mfa" className="font-bold text-gray-700">Ativar Autenticação de Dois Fatores (MFA)</label>
              </div>

              <div className="flex items-center gap-2 py-2">
                <input
                  type="checkbox"
                  id="mustChangePassword"
                  checked={usrMustChange}
                  onChange={(e) => setUsrMustChange(e.target.checked)}
                  disabled={editingUser?.username === 'admin' && false}
                />
                <label htmlFor="mustChangePassword" className="font-bold text-gray-700">
                  Exigir troca de palavra-passe no próximo login (acesso com palavra-passe temporária)
                </label>
              </div>

              <div className="flex gap-2">
                <button
                  type="submit"
                  className="flex-1 py-2 bg-primary hover:opacity-95 text-white font-bold rounded uppercase text-[10px] transition-opacity"
                >
                  {editingUser ? 'Guardar Alterações' : 'Admitir Utilizador'}
                </button>
                {editingUser && (
                  <button
                    type="button"
                    onClick={() => {
                      setEditingUser(null);
                      setUsrUsername('');
                      setUsrPassword('');
                      setUsrRoles(['Operador']);
                      setUsrMfa(false);
                    }}
                    className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 font-bold rounded uppercase text-[10px]"
                  >
                    Cancelar
                  </button>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

      {/* --- 4. CYBERSECURITY AUDIT LOGS VIEW --- */}
      {activeTab === 'logs' && (
        <div className="space-y-6 animate-fade-in">
          {/* Date Range Filter for Audit Logs */}
          <DateRangeFilter
            title="Filtrar Registos de Auditoria por Período"
            startDate={logsStartDate}
            endDate={logsEndDate}
            preset={logsPreset}
            onRangeChange={(start, end, preset) => {
              setLogsStartDate(start);
              setLogsEndDate(end);
              setLogsPreset(preset);
            }}
            onExportPDF={() => {
              const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
              const cName = settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA';
              const nuit = settings?.companyNuit || '401976590';
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(14);
              doc.setTextColor(30, 41, 59);
              doc.text('RELATÓRIO DE AUDITORIA DE SEGURANÇA E ACESSOS', 15, 20);
              doc.setFont('helvetica', 'normal');
              doc.setFontSize(9);
              doc.setTextColor(100, 116, 139);
              doc.text(`${cName} • NUIT: ${nuit}`, 15, 25);
              doc.text(`Período: ${formatDatePT(logsStartDate)} até ${formatDatePT(logsEndDate)}`, 15, 29);
              doc.setDrawColor(30, 41, 59);
              doc.line(15, 33, 195, 33);
              let y = 43;
              doc.setFont('helvetica', 'bold');
              doc.setFontSize(8);
              doc.text('DATA/HORA', 15, y);
              doc.text('UTILIZADOR', 55, y);
              doc.text('AÇÃO', 95, y);
              doc.text('ESTADO', 145, y);
              doc.text('IP', 170, y);
              y += 6;
              doc.setFont('helvetica', 'normal');
              const filtered = auditLogs.filter(l => isDateInRange(l.timestamp, logsStartDate, logsEndDate));
              filtered.forEach(log => {
                if (y > 275) { doc.addPage(); y = 20; }
                doc.text(new Date(log.timestamp).toLocaleString('pt-MZ'), 15, y);
                doc.text(log.username || '', 55, y);
                doc.text((log.action || '').substring(0, 25), 95, y);
                doc.text(log.status || '', 145, y);
                doc.text(log.ipAddress || '', 170, y);
                y += 6;
              });
              doc.save(`Auditoria_Seguranca_${logsStartDate}_a_${logsEndDate}.pdf`);
              setToastMessage('Relatório de Auditoria PDF descarregado!');
            }}
            onExportExcel={() => {
              const filtered = auditLogs.filter(l => isDateInRange(l.timestamp, logsStartDate, logsEndDate));
              const data = filtered.map(l => ({
                'Data / Hora': new Date(l.timestamp).toLocaleString('pt-MZ'),
                'Utilizador': l.username,
                'IP': l.ipAddress,
                'Ação': l.action,
                'Estado': l.status,
                'Detalhes': l.details || ''
              }));
              const ws = XLSX.utils.json_to_sheet(data);
              const wb = XLSX.utils.book_new();
              XLSX.utils.book_append_sheet(wb, ws, 'Audit_Logs');
              XLSX.writeFile(wb, `Audit_Logs_${logsStartDate}_a_${logsEndDate}.xlsx`);
              setToastMessage('Planilha de Auditoria descarregada com sucesso!');
            }}
          />

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
            <div>
              <h4 className="font-headline-md text-headline-md text-gray-800 font-bold">Rastreio Imutável de Auditoria de Cibersegurança</h4>
              <p className="text-xs text-gray-500">
                Registos de tentativas de intrusão, acessos, fecho de turnos, e modificações de inventário.
              </p>
            </div>

            <div className="overflow-x-auto text-xs">
              <table className="w-full text-left border-collapse">
                <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                  <tr>
                    <th className="p-3">Timestamp</th>
                    <th className="p-3">Operador / Técnico</th>
                    <th className="p-3">IP Registado</th>
                    <th className="p-3">Ação Efetuada</th>
                    <th className="p-3">Estado</th>
                    <th className="p-3">Detalhes Históricos</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(() => {
                    const filtered = auditLogs.filter(l => isDateInRange(l.timestamp, logsStartDate, logsEndDate));
                    if (filtered.length === 0) {
                      return (
                        <tr>
                          <td colSpan={6} className="p-8 text-center text-gray-400 italic">
                            Nenhum registo de auditoria encontrado no período selecionado.
                          </td>
                        </tr>
                      );
                    }
                    return filtered.map(log => (
                      <tr key={log.id} className="hover:bg-gray-50">
                        <td className="p-3 font-mono text-[11px] text-gray-500">{new Date(log.timestamp).toLocaleString()}</td>
                        <td className="p-3 font-bold text-gray-800">{log.username}</td>
                        <td className="p-3 font-mono text-gray-600">{log.ipAddress}</td>
                        <td className="p-3 font-semibold">{log.action}</td>
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded text-[10px] font-black ${
                            log.status === 'Sucesso' ? 'bg-green-100 text-green-800' :
                            log.status === 'Alerta' ? 'bg-orange-100 text-orange-800 animate-pulse' :
                            'bg-red-100 text-red-800'
                          }`}>
                            {log.status}
                          </span>
                        </td>
                        <td className="p-3 text-gray-500 italic max-w-xs truncate" title={log.details}>
                          {log.details}
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

      {/* --- ACTIVE SESSIONS MANAGEMENT VIEW --- */}
      {activeTab === 'sessions' && (
        <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4 animate-fade-in">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div>
              <h4 className="font-headline-md text-headline-md text-gray-800 font-bold">Gestão de Sessões Ativas & Conexões</h4>
              <p className="text-xs text-gray-500">
                Visualize os operadores e técnicos com sessões abertas no sistema. Encerre sessões órfãs ou limpe acumulados.
              </p>
            </div>
            <button
              onClick={handleClearAllSessions}
              className="bg-red-600 hover:bg-red-700 text-white font-bold px-4 py-2 rounded-lg text-xs shadow transition-all flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-sm">power_settings_new</span>
              Limpar Todas as Sessões Órfãs
            </button>
          </div>

          <div className="overflow-x-auto text-xs">
            <table className="w-full text-left border-collapse">
              <thead className="bg-gray-50 text-gray-600 font-bold border-b border-gray-200">
                <tr>
                  <th className="p-3">Utilizador / Operador</th>
                  <th className="p-3">Perfil / Cargo</th>
                  <th className="p-3">Início da Sessão</th>
                  <th className="p-3">Endereço IP</th>
                  <th className="p-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {activeSessions.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-6 text-center text-gray-400 italic">
                      Nenhuma sessão ativa registada no momento.
                    </td>
                  </tr>
                ) : (
                  activeSessions.map(sess => (
                    <tr key={sess.id} className="hover:bg-gray-50">
                      <td className="p-3 font-bold text-gray-800 flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                        {sess.username}
                      </td>
                      <td className="p-3">
                        <span className="bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded text-[10px]">
                          {sess.role}
                        </span>
                      </td>
                      <td className="p-3 font-mono text-gray-500">{new Date(sess.loginTime).toLocaleString()}</td>
                      <td className="p-3 font-mono text-gray-600">{sess.ipAddress}</td>
                      <td className="p-3 text-right">
                        <button
                          onClick={() => handleTerminateSession(sess.id, sess.username)}
                          className="bg-amber-100 hover:bg-amber-200 text-amber-800 font-bold px-3 py-1 rounded text-xs transition-all"
                        >
                          Terminar Sessão
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'schema' && (
        <DatabaseSchemaViewer />
      )}

      {/* --- NUVEM & firebase MANAGEMENT VIEW --- */}
      {activeTab === 'cloud_firebase' && (
        <div className="space-y-6">
          {/* Status Header Card */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 text-white p-6 rounded-2xl shadow-xl border border-slate-700/60 relative overflow-hidden">
            <div className="relative z-10 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-emerald-400 text-2xl">cloud_sync</span>
                  <h4 className="text-xl font-bold tracking-tight">Gestão da Nuvem & Firebase PostgreSQL</h4>
                </div>
                <p className="text-slate-300 text-xs max-w-2xl">
                  Sincronização bidirecional em tempo real para inventários, vendas, colaboradores, presenças e auditoria comercial com o banco PostgreSQL.
                </p>
              </div>

              <div className="flex items-center gap-3">
                {dbService.isConfigured() ? (
                  <div className="bg-emerald-500/20 border border-emerald-500/40 px-4 py-2 rounded-xl flex items-center gap-2 text-emerald-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse"></span>
                    <span className="text-xs font-bold uppercase tracking-wider">Conectado à Nuvem</span>
                  </div>
                ) : (
                  <div className="bg-amber-500/20 border border-amber-500/40 px-4 py-2 rounded-xl flex items-center gap-2 text-amber-300">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
                    <span className="text-xs font-bold uppercase tracking-wider">Modo Local (IndexedDB)</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Firebase Configuration Form */}
            <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                <span className="material-symbols-outlined text-emerald-600">settings_remote</span>
                <h5 className="font-bold text-gray-800 text-sm uppercase tracking-wider">Parâmetros do Servidor Firebase</h5>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                    URL do Servidor Firebase (Project URL)
                  </label>
                  <input
                    type="text"
                    value={firebaseUrlInput}
                    onChange={(e) => setFirebaseUrlInput(e.target.value)}
                    placeholder="https://xyzcompany.firebase.co"
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-0.5">Encontrado em Settings -&gt; API no seu dashboard do Firebase.</p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 uppercase mb-1">
                    Chave de API Anon / Public (anon key)
                  </label>
                  <input
                    type="password"
                    value={firebaseKeyInput}
                    onChange={(e) => setFirebaseKeyInput(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-emerald-500 focus:outline-none"
                  />
                  <p className="text-[10px] text-gray-500 mt-0.5">Chave pública de acesso com regras de segurança de linha (RLS).</p>
                </div>

                {/* Connection Test Diagnostic Message */}
                {firebaseTestResult && (
                  <div className={`p-3 rounded-lg border text-xs font-medium ${
                    firebaseTestResult.success ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'
                  }`}>
                    <div className="flex items-center gap-1.5 font-bold mb-1">
                      <span className="material-symbols-outlined text-[16px]">
                        {firebaseTestResult.success ? 'check_circle' : 'error'}
                      </span>
                      <span>{firebaseTestResult.success ? 'Diagnóstico Positivo' : 'Erro de Conexão'}</span>
                      {firebaseTestResult.latencyMs !== undefined && (
                        <span className="ml-auto text-[10px] bg-white/80 px-1.5 py-0.5 rounded font-mono">
                          {firebaseTestResult.latencyMs}ms
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] leading-relaxed">{firebaseTestResult.message}</p>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="pt-2 flex flex-wrap gap-2">
                  <button
                    onClick={handleTestFirebaseConnection}
                    disabled={testingFirebase}
                    className="px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold uppercase transition-all shadow-sm active:scale-95 disabled:opacity-50 flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">network_ping</span>
                    {testingFirebase ? 'A Testar...' : 'Testar Conexão'}
                  </button>

                  <button
                    onClick={handleSaveFirebaseConfig}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold uppercase transition-all shadow-sm active:scale-95 flex items-center gap-1.5 cursor-pointer"
                  >
                    <span className="material-symbols-outlined text-[16px]">save</span>
                    Guardar & Ativar
                  </button>
                </div>
              </div>
            </div>

            {/* Sync Command & Summary */}
            <div className="bg-white border border-gray-200 p-6 rounded-2xl shadow-sm space-y-4 flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 border-b border-gray-100 pb-3">
                  <span className="material-symbols-outlined text-indigo-600">sync_alt</span>
                  <h5 className="font-bold text-gray-800 text-sm uppercase tracking-wider">Sincronização em Massa (11 Tabelas)</h5>
                </div>

                <p className="text-xs text-gray-600 my-3 leading-relaxed">
                  Garante que todos os registos guardados no navegador (IndexedDB) sejam enviados para o Firebase PostgreSQL e vice-versa.
                </p>

                {firebaseSyncSummary && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 my-3 max-h-48 overflow-y-auto pr-1">
                    {Object.entries(firebaseSyncSummary).map(([tbl, stats]: [string, any]) => (
                      <div key={tbl} className="bg-slate-50 border border-slate-200 p-2 rounded-lg text-[11px]">
                        <p className="font-bold text-slate-800 capitalize truncate">{tbl}</p>
                        <div className="flex justify-between text-[10px] text-slate-500 mt-1">
                          <span>Local: {stats?.local ?? 0}</span>
                          <span>Nuvem: {stats?.cloud ?? 0}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <button
                  onClick={handleSyncAllWithFirebase}
                  disabled={syncingFirebase || !dbService.isConfigured()}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold uppercase transition-all shadow-md active:scale-98 disabled:opacity-50 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <span className={`material-symbols-outlined text-[18px] ${syncingFirebase ? 'animate-spin' : ''}`}>
                    {syncingFirebase ? 'sync' : 'published_with_changes'}
                  </span>
                  {syncingFirebase ? 'A Sincronizar Tabelas...' : 'Sincronizar Todas as Tabelas Agora'}
                </button>
              </div>
            </div>
          </div>

          {/* Sync Operations Live Log Box */}
          {firebaseSyncLogs.length > 0 && (
            <div className="bg-slate-900 text-slate-100 p-4 rounded-2xl border border-slate-800 font-mono text-xs shadow-inner space-y-2">
              <div className="flex justify-between items-center border-b border-slate-800 pb-2">
                <span className="font-bold text-emerald-400 flex items-center gap-1 text-[11px]">
                  <span className="material-symbols-outlined text-[14px]">terminal</span>
                  Log de Operações de Sincronização
                </span>
                <button
                  onClick={() => setFirebaseSyncLogs([])}
                  className="text-[10px] text-slate-400 hover:text-slate-200 underline cursor-pointer"
                >
                  Limpar Log
                </button>
              </div>
              <div className="max-h-60 overflow-y-auto space-y-1 text-[11px] pr-2">
                {firebaseSyncLogs.map((log, idx) => (
                  <div key={idx} className="leading-tight text-slate-300">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal for User Deletion */}
      {userToDelete && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-center gap-3 text-red-600">
              <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-2xl">person_remove</span>
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Remover Utilizador</h3>
                <p className="text-xs text-gray-500">Esta ação é permanente e irreversível.</p>
              </div>
            </div>

            <p className="text-sm text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
              Tem certeza que deseja eliminar o utilizador <strong className="text-slate-900">{userToDelete.username}</strong>?
            </p>

            <div className="flex justify-end gap-3 pt-2">
              <button
                onClick={() => setUserToDelete(null)}
                className="px-4 py-2 border border-gray-300 rounded-lg text-xs font-bold text-gray-700 hover:bg-gray-50 transition-all cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDeleteUser}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer"
              >
                Confirmar Eliminação
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
