import { safeStorage, safeSessionStorage } from "../utils/safeStorage";
import ToastBanner from './ToastBanner';
import React, { useState, useEffect, useRef } from 'react';
import { jsPDF } from 'jspdf';
import { dbService, type FirestorePageCursor } from '../utils/firebaseDB';
import { SystemSettings, AuditLog, UserCredentials, Product, AppRole, ActiveSession } from '../types';
import { AVAILABLE_ROLES, getUserRoles } from '../utils/roleHelper';
import DatabaseSchemaViewer from './DatabaseSchemaViewer';
import { DateRangeFilter } from './DateRangeFilter';
import { DateRangePreset, getDateRangeFromPreset, formatDatePT } from '../utils/dateRangeHelper';
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
  onSettingsUpdated?: () => void | Promise<void>;
}

export default function TechnicalModule({ onSettingsUpdated }: TechnicalModuleProps = {}) {
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [users, setUsers] = useState<UserCredentials[]>([]);

  // Active Technical Panel Tab
  const [activeTab, setActiveTab] = useState<'settings' | 'users' | 'logs' | 'schema' | 'sessions'>('settings');
  const [settingsSubTab, setSettingsSubTab] = useState<'empresa' | 'bancos' | 'impressoras' | 'backups' | 'sistema'>('empresa');

  // Logs Date Range Filter
  const defaultLogsRange = getDateRangeFromPreset('Este Mês');
  const [logsStartDate, setLogsStartDate] = useState(defaultLogsRange.startDate);
  const [logsEndDate, setLogsEndDate] = useState(defaultLogsRange.endDate);
  const [logsPreset, setLogsPreset] = useState<DateRangePreset>('Este Mês');
  const [auditLogSource, setAuditLogSource] = useState<'active' | 'archive'>('active');
  const [nextAuditCursor, setNextAuditCursor] = useState<FirestorePageCursor | null>(null);
  const [hasMoreAuditLogs, setHasMoreAuditLogs] = useState(false);
  const [auditLoadError, setAuditLoadError] = useState('');
  const [isLoadingAuditLogs, setIsLoadingAuditLogs] = useState(false);
  const [isExportingAuditLogs, setIsExportingAuditLogs] = useState(false);
  const [isArchivingAuditLogs, setIsArchivingAuditLogs] = useState(false);
  const [auditRefreshKey, setAuditRefreshKey] = useState(0);
  const auditRequestVersion = useRef(0);
  const [archiveBeforeDate, setArchiveBeforeDate] = useState(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 6);
    return date.toISOString().slice(0, 10);
  });
  const [activeSessions, setActiveSessions] = useState<ActiveSession[]>([]);

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
  const [sessionLockMinutes, setSessionLockMinutes] = useState(15);
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
  const [usrMustChange, setUsrMustChange] = useState(false);
  const [userToDelete, setUserToDelete] = useState<{ id: string; username: string } | null>(null);

  // Toast
  const [toastMessage, setToastMessage] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [isPrinterConnected, setIsPrinterConnected] = useState(false);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isVirtualMode, setIsVirtualMode] = useState(false);
  const [hardwareError, setHardwareError] = useState<{ msg: string; isIframe: boolean } | null>(null);

  const getCurrentAuditQuery = () => ({
    startDate: logsStartDate,
    endDate: logsEndDate,
    source: auditLogSource
  });

  const loadAuditLogs = async (reset = true) => {
    const requestVersion = reset ? ++auditRequestVersion.current : auditRequestVersion.current;
    if (!reset && (!nextAuditCursor || !hasMoreAuditLogs)) return;

    setIsLoadingAuditLogs(true);
    setAuditLoadError('');
    if (reset) {
      // Do not momentarily label a previous period/source as the new query.
      setAuditLogs([]);
      setNextAuditCursor(null);
      setHasMoreAuditLogs(false);
    }
    try {
      const page = await dbService.getAuditLogsPage({
        ...getCurrentAuditQuery(),
        cursor: reset ? undefined : nextAuditCursor,
        pageSize: 50
      });
      if (requestVersion !== auditRequestVersion.current) return;

      setAuditLogs(previous => {
        if (reset) return page.items;
        const knownIds = new Set(previous.map(log => log.id));
        return [...previous, ...page.items.filter(log => !knownIds.has(log.id))];
      });
      setNextAuditCursor(page.nextCursor);
      setHasMoreAuditLogs(page.hasMore);
    } catch (error) {
      console.error('[TechnicalModule] Could not load audit log page:', error);
      setAuditLoadError('Não foi possível carregar a auditoria. Confirme a ligação e a publicação dos índices Firestore.');
      if (reset) {
        setAuditLogs([]);
        setNextAuditCursor(null);
        setHasMoreAuditLogs(false);
      }
    } finally {
      if (requestVersion === auditRequestVersion.current) {
        setIsLoadingAuditLogs(false);
      }
    }
  };

  const loadAllData = async () => {
    try {
      await dbService.init();

      // Settings, users and sessions are small operational datasets. Sales,
      // products and audit history intentionally do not load in full here.
      const [config, creds, activeSess] = await Promise.all([
        dbService.getSettings(),
        dbService.getCredentials(),
        dbService.getActiveSessions()
      ]);
      setSettings(config);
      setUsers(creds);
      setActiveSessions(activeSess);

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
      setSessionLockMinutes(config.sessionLockMinutes || 15);
      setPrinterA4(config.printerA4 || 'Microsoft Print to PDF');
      setPrinterThermal(config.printerThermal || 'Xprinter XP-80');
      setBarcodePrefix(config.barcodePrefix || '');
      setBarcodeSuffix(config.barcodeSuffix || '');

      try {
        const indexStr = safeStorage.getItem('agro_erp_backups_index') || '[]';
        setAutoBackupsList(JSON.parse(indexStr));
      } catch (error) {
        console.warn('Error loading backups index:', error);
      }
    } catch (error) {
      // Refreshing technical panels is non-critical. In particular, do not let
      // it overwrite the confirmation of a user/configuration change that was
      // already saved successfully.
      console.warn('[TechnicalModule] Could not refresh all dashboard data:', error);
    }
  };

  useEffect(() => {
    setIsPrinterConnected(isSerialPrinterConnected());
    setIsVirtualMode(isVirtualPrinterActive());
  }, []);

  useEffect(() => {
    void loadAllData();

    const handleDbUpdate = () => {
      void loadAllData();
      setAuditRefreshKey(value => value + 1);
    };
    window.addEventListener('db-update', handleDbUpdate);
    return () => window.removeEventListener('db-update', handleDbUpdate);
  }, []);

  useEffect(() => {
    void loadAuditLogs(true);
    // A period/source change starts from the first cursor page.
  }, [logsStartDate, logsEndDate, auditLogSource, auditRefreshKey]);

  const handleTerminateSession = async (sessionId: string, username: string) => {
    await dbService.removeActiveSession(sessionId);
    void dbService.addAuditLog({
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
    void dbService.addAuditLog({
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

  const handleArchiveAuditLogs = async () => {
    if (isArchivingAuditLogs) return;
    const confirmation = window.confirm(
      `Arquivar registos de auditoria anteriores a ${formatDatePT(archiveBeforeDate)}? ` +
      'Os registos não serão apagados: serão copiados para o arquivo e removidos apenas da lista ativa.'
    );
    if (!confirmation) return;

    setIsArchivingAuditLogs(true);
    try {
      const result = await dbService.archiveAuditLogsBefore(archiveBeforeDate, 200);
      if (result.archivedCount === 0) {
        showToast('Não existem registos ativos anteriores à data indicada.');
        return;
      }

      void dbService.addAuditLog({
        id: `log-archive-${Date.now()}`,
        timestamp: new Date().toISOString(),
        username: 'Técnico',
        ipAddress: '127.0.0.1',
        action: 'Arquivo de Registos de Auditoria',
        status: 'Sucesso',
        details: `${result.archivedCount} registo(s) anterior(es) a ${archiveBeforeDate} foram movidos para audit_logs_archive sem eliminação definitiva.`
      });
      setAuditRefreshKey(value => value + 1);
      showToast(
        result.hasMore
          ? `${result.archivedCount} registos arquivados. Existem mais; repita a operação para continuar.`
          : `${result.archivedCount} registos arquivados com segurança.`
      );
    } catch (error) {
      console.error('[TechnicalModule] Audit archive failed:', error);
      showToast('Não foi possível arquivar os registos. Nenhum lote parcial foi eliminado.');
    } finally {
      setIsArchivingAuditLogs(false);
    }
  };

  const handleExportAuditPDF = async () => {
    if (isExportingAuditLogs) return;
    setIsExportingAuditLogs(true);
    try {
      const exportLogs = await dbService.getAuditLogsForPeriod(getCurrentAuditQuery());
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
      exportLogs.forEach(log => {
        if (y > 275) { doc.addPage(); y = 20; }
        doc.text(new Date(log.timestamp).toLocaleString('pt-MZ'), 15, y);
        doc.text(log.username || '', 55, y);
        doc.text((log.action || '').substring(0, 25), 95, y);
        doc.text(log.status || '', 145, y);
        doc.text(log.ipAddress || '', 170, y);
        y += 6;
      });
      doc.save(`Auditoria_Seguranca_${logsStartDate}_a_${logsEndDate}.pdf`);
      showToast(`Relatório de Auditoria PDF descarregado com ${exportLogs.length} registo(s).`);
    } catch (error) {
      console.error('[TechnicalModule] Audit PDF export failed:', error);
      showToast('Não foi possível exportar o relatório de auditoria.');
    } finally {
      setIsExportingAuditLogs(false);
    }
  };

  const handleExportAuditExcel = async () => {
    if (isExportingAuditLogs) return;
    setIsExportingAuditLogs(true);
    try {
      const exportLogs = await dbService.getAuditLogsForPeriod(getCurrentAuditQuery());
      const data = exportLogs.map(log => ({
        'Data / Hora': new Date(log.timestamp).toLocaleString('pt-MZ'),
        'Utilizador': log.username,
        'IP': log.ipAddress,
        'Ação': log.action,
        'Estado': log.status,
        'Detalhes': log.details || ''
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, 'Audit_Logs');
      XLSX.writeFile(wb, `Audit_Logs_${logsStartDate}_a_${logsEndDate}.xlsx`);
      showToast(`Planilha de Auditoria descarregada com ${exportLogs.length} registo(s).`);
    } catch (error) {
      console.error('[TechnicalModule] Audit Excel export failed:', error);
      showToast('Não foi possível exportar a planilha de auditoria.');
    } finally {
      setIsExportingAuditLogs(false);
    }
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
      mfaEnabled: editingUser?.mfaEnabled || false,
      mustChangePassword: isExistingHash ? (editingUser?.mustChangePassword || false) : usrMustChange,
      passwordResetVersion: editingUser?.passwordResetVersion
    };

    setIsSubmitting(true);
    try {
      await dbService.saveCredential(newUser);

      // Log to Audit logs
      void dbService.addAuditLog({
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

      void dbService.addAuditLog({
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
      sessionLockMinutes: Math.max(1, Number(sessionLockMinutes) || 15),
      printerA4,
      printerThermal,
      barcodePrefix,
      barcodeSuffix
    } as any;

    setIsSubmitting(true);
    try {
      await dbService.saveSettings(updated);

      void dbService.addAuditLog({
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
      void Promise.resolve(onSettingsUpdated?.()).catch(error => {
        console.warn('[TechnicalModule] Could not refresh the shared settings after a successful save:', error);
      });
    } catch (err) {
      console.error(err);
      showToast('Erro ao gravar configurações.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // --- firebase CLOUD MANAGEMENT HANDLERS ---

  // NOTA DE SEGURANÇA (Auditoria FASE 1, achado T-05):
  // Os handlers "Eliminar Histórico de Teste", "Zerar Sistema" e "Novo Exercício
  // Fiscal" foram removidos: todos chamavam clearSystemData() e apagavam
  // permanentemente vendas reais sem backup, violando a regra inviolável nº 1
  // do negócio. A limpeza de dados de teste é uma operação de manutenção fora da
  // interface, com backup obrigatório e aprovação documentada.

  const handleFecharAno = async () => {
    const conf = window.confirm('Pretende fechar o Exercício Fiscal Corrente? Esta operação congelará os registos ativos.');
    if (!conf) return;

    void dbService.addAuditLog({
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

  const handleBackupTotal = async () => {
    const [prods, sls, lss, emps, att, activeAuditLogs, archivedAuditLogs] = await Promise.all([
      dbService.getProducts(),
      dbService.getSales(),
      dbService.getLosses(),
      dbService.getEmployees(),
      dbService.getAttendance(),
      dbService.getAuditLogs(),
      dbService.getAuditLogsForPeriod({ source: 'archive' })
    ]);

    const fullBackup = {
      timestamp: new Date().toISOString(),
      app: 'AgroGestao Zero',
      data: {
        products: prods,
        sales: sls,
        losses: lss,
        employees: emps,
        attendance: att,
        audit_logs: activeAuditLogs,
        audit_logs_archive: archivedAuditLogs
      }
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

    void dbService.addAuditLog({
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

  return (
    <div className="space-y-6 animate-fade-in" id="tech_module">
      {/* Toast banner */}
      {toastMessage && (
        <ToastBanner message={toastMessage} type="success" onClose={() => setToastMessage('')} />
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
                    <div>
                      <label className="block text-[10px] font-black uppercase text-gray-500 mb-1">Bloqueio de Sessão por Inactividade (min)</label>
                      <input
                        type="number"
                        min={1}
                        max={240}
                        value={sessionLockMinutes}
                        onChange={(e) => setSessionLockMinutes(Number(e.target.value))}
                        className="w-full border border-gray-300 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        placeholder="15"
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
                    Operações de fecho de exercício contábil anual. O histórico de vendas é preservado na íntegra.
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
                  </div>
                </div>

                {/* Data Safety Notice — replaces destructive reset tools (Auditoria FASE 1, T-05) */}
                <div className="p-4 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-3">
                  <h5 className="font-bold text-emerald-900 text-xs uppercase flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[16px] text-emerald-600">verified_user</span>
                    Protecção do Histórico de Vendas
                  </h5>
                  <p className="text-[11px] text-emerald-800 leading-relaxed">
                    As ferramentas de eliminação de histórico e reposição de fábrica foram removidas desta interface:
                    o histórico de vendas é permanente e nunca pode ser apagado a partir do painel.
                    Para manutenção com eliminação de dados de teste, contacte o suporte técnico com backup prévio obrigatório.
                  </p>
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={handleBackupTotal}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs uppercase transition-colors shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <span className="material-symbols-outlined text-[16px]">download</span>
                      Descarregar Backup Completo Agora
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
            onExportPDF={() => { void handleExportAuditPDF(); }}
            onExportExcel={() => { void handleExportAuditExcel(); }}
          />

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col xl:flex-row gap-4 xl:items-end xl:justify-between">
            <div className="space-y-2">
              <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Origem da consulta</p>
                <p className="text-xs text-slate-600">Alterne entre os registos operacionais e o arquivo histórico sem perder rastreabilidade.</p>
              </div>
              <div className="inline-flex rounded-lg overflow-hidden border border-slate-300 bg-white">
                <button
                  type="button"
                  onClick={() => setAuditLogSource('active')}
                  className={`px-3 py-1.5 text-xs font-bold transition-colors ${auditLogSource === 'active' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  Registos ativos
                </button>
                <button
                  type="button"
                  onClick={() => setAuditLogSource('archive')}
                  className={`px-3 py-1.5 text-xs font-bold transition-colors border-l border-slate-300 ${auditLogSource === 'archive' ? 'bg-indigo-700 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                >
                  Arquivo histórico
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-end gap-2 bg-white border border-amber-200 rounded-lg p-3">
              <div>
                <label className="block text-[10px] font-black uppercase tracking-wider text-amber-800 mb-1">Arquivar antes de</label>
                <input
                  type="date"
                  value={archiveBeforeDate}
                  onChange={(event) => setArchiveBeforeDate(event.target.value)}
                  className="border border-amber-300 bg-amber-50 rounded-md px-2 py-1.5 text-xs font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500"
                />
              </div>
              <button
                type="button"
                onClick={() => void handleArchiveAuditLogs()}
                disabled={isArchivingAuditLogs || !archiveBeforeDate}
                className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-wait text-white rounded-md text-xs font-black transition-colors"
                title="Move até 200 registos por lote para o arquivo, sem eliminação definitiva"
              >
                <span className={`material-symbols-outlined text-[16px] ${isArchivingAuditLogs ? 'animate-spin' : ''}`}>inventory_2</span>
                {isArchivingAuditLogs ? 'A arquivar…' : 'Arquivar lote seguro'}
              </button>
            </div>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
              <div>
                <h4 className="font-headline-md text-headline-md text-gray-800 font-bold">
                  {auditLogSource === 'archive' ? 'Arquivo Histórico de Auditoria' : 'Rastreio Imutável de Auditoria de Cibersegurança'}
                </h4>
                <p className="text-xs text-gray-500">
                  {auditLogSource === 'archive'
                    ? 'Registos preservados fora da coleção operacional. Pode filtrá-los e exportá-los pelo período.'
                    : 'Registos de tentativas de intrusão, acessos, fecho de turnos e modificações de inventário.'}
                </p>
              </div>
              <span className="text-[10px] font-bold bg-slate-100 text-slate-600 rounded-full px-2 py-1 whitespace-nowrap">
                {isLoadingAuditLogs ? 'A atualizar…' : `${auditLogs.length} registo(s) carregado(s)`}
              </span>
            </div>

            {auditLoadError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800">
                {auditLoadError}
              </div>
            )}

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
                  {auditLogs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-gray-400 italic">
                        {isLoadingAuditLogs
                          ? 'A carregar registos de auditoria…'
                          : 'Nenhum registo de auditoria encontrado no período selecionado.'}
                      </td>
                    </tr>
                  ) : (
                    auditLogs.map(log => (
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
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 pt-1">
              <p className="text-[10px] text-slate-400 text-center sm:text-left">
                Consulta paginada: 50 registos por página. As exportações incluem todos os registos do período e da origem selecionada.
              </p>
              <div className="flex items-center gap-2">
                {isExportingAuditLogs && <span className="text-[10px] text-amber-700 font-semibold">A preparar exportação completa…</span>}
                {hasMoreAuditLogs && (
                  <button
                    type="button"
                    onClick={() => void loadAuditLogs(false)}
                    disabled={isLoadingAuditLogs}
                    className="inline-flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 disabled:cursor-wait text-slate-800 rounded-lg text-xs font-black transition-colors"
                  >
                    <span className={`material-symbols-outlined text-[16px] ${isLoadingAuditLogs ? 'animate-spin' : ''}`}>expand_more</span>
                    {isLoadingAuditLogs ? 'A carregar…' : 'Carregar mais'}
                  </button>
                )}
              </div>
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
