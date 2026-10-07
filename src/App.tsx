import { safeStorage, safeSessionStorage } from "./utils/safeStorage";

import React, { useState, useEffect, Suspense, lazy } from 'react';
import { dbService } from './utils/firebaseDB';
import { runStockMigration, runHybridPriceMigration, runStockListUpdate } from './utils/migrateStock';
import { runCredentialsReset } from './utils/credentialsReset';
import LoginPanel from './components/LoginPanel';
import { InlineHeaderSearch } from './components/InlineHeaderSearch';
import { verifyPassword } from './utils/securityHelper';
import './index.css';
// Lazy-loaded modules
const PDVModule = lazy(() => import('./components/PDVModule'));
const FaturasModule = lazy(() => import('./components/FaturasModule'));
const StockModule = lazy(() => import('./components/StockModule'));
const HRModule = lazy(() => import('./components/HRModule'));
const FinanceModule = lazy(() => import('./components/FinanceModule'));
const TechnicalModule = lazy(() => import('./components/TechnicalModule'));
import { SystemSettings, AppRole } from './types';
import { getUserRoles } from './utils/roleHelper';

type ERPModule = 'vendas' | 'faturas' | 'stock' | 'rh' | 'financas' | 'tecnico';

export default function App() {
  const [currentUser, setCurrentUser] = useState<{ username: string; role: string; roles?: AppRole[] } | null>(null);
  const [activeModule, setActiveModule] = useState<ERPModule>('vendas');
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    return safeStorage.getItem('agro_sidebar_collapsed') === 'true';
  });

  useEffect(() => {
    safeStorage.setItem('agro_sidebar_collapsed', String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  const [settings, setSettings] = useState<SystemSettings | null>(null);
  
  // Persistent Theme State (Claro/Escuro)
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    return (safeStorage.getItem('agro_erp_theme') as 'light' | 'dark') || 'light';
  });

  useEffect(() => {
    safeStorage.setItem('agro_erp_theme', theme);
  }, [theme]);

  const isModuleAccessible = (mod: ERPModule) => {
    if (!currentUser) return false;
    const roles = getUserRoles(currentUser);
    if (roles.includes('Técnico')) return true;
    if (roles.includes('Gestor Geral')) return mod !== 'tecnico';
    if (mod === 'vendas') return roles.includes('Operador');
    if (mod === 'faturas') return roles.includes('Operador') || roles.includes('Gestor de Stock');
    if (mod === 'stock') return roles.includes('Gestor de Stock');
    if (mod === 'rh') return roles.includes('Gestor de RH');
    if (mod === 'financas') return roles.includes('Contabilista');
    if (mod === 'tecnico') return roles.includes('Técnico');
    return false;
  };

  const selectModule = (mod: ERPModule) => {
    if (isModuleAccessible(mod)) {
      setActiveModule(mod);
      setIsMobileSidebarOpen(false);
    }
  };
  
  // Module-level locking states
  const [unlockedModules, setUnlockedModules] = useState<Record<ERPModule, boolean>>({
    vendas: false,
    faturas: false,
    stock: false,
    rh: false,
    financas: false,
    tecnico: false
  });
  const [gatePassword, setGatePassword] = useState('');
  const [gateError, setGateError] = useState('');

  // Real-time synchronization tracking states
  const syncMode = 'Online';
  const [sseConnected, setSseConnected] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSyncTime, setLastSyncTime] = useState('');
  const [isManualSyncing, setIsManualSyncing] = useState(false);

  useEffect(() => {
    const updateSyncStatus = () => {
      setSseConnected(dbService.isSSEActive());
      setPendingCount(dbService.getPendingCount());
      setLastSyncTime(dbService.getLastSyncTime());
    };

    updateSyncStatus();
    const interval = setInterval(updateSyncStatus, 2000);
    window.addEventListener('db-update', updateSyncStatus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('db-update', updateSyncStatus);
    };
  }, []);

  // Critical stock alert states
  const [criticalProducts, setCriticalProducts] = useState<any[]>([]);
  const [showAlertsDropdown, setShowAlertsDropdown] = useState(false);

  // 5-Minute Inactivity Lock States
  const [isSessionLocked, setIsSessionLocked] = useState(false);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');

  useEffect(() => {
    if (!currentUser || isSessionLocked) return;

    const resetTimer = () => {
      setLastActivity(Date.now());
    };

    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('click', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('scroll', resetTimer);
    window.addEventListener('touchstart', resetTimer);

    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('click', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('scroll', resetTimer);
      window.removeEventListener('touchstart', resetTimer);
    };
  }, [currentUser, isSessionLocked]);

  useEffect(() => {
    if (!currentUser || isSessionLocked) return;

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = now - lastActivity;
      // 5 minutes in milliseconds is 300,000
      if (diff >= 300000) {
        setIsSessionLocked(true);
        dbService.addAuditLog({
          id: 'log-' + Date.now(),
          timestamp: new Date().toISOString(),
          username: currentUser.username,
          ipAddress: '127.0.0.1',
          action: 'Sessão Auto-Bloqueada',
          status: 'Alerta',
          details: 'A sessão de balcão foi bloqueada devido a 5 minutos de inatividade.'
        }).catch(err => console.log('Audit log lock error:', err));
      }
    }, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [currentUser, lastActivity, isSessionLocked]);

  const loadCriticalProducts = async () => {
    try {
      await dbService.init();
      const prodList = await dbService.getProducts();
      const critLevel = settings?.criticalStockLevel || 10;
      const filtered = prodList.filter(p => !p.isService && p.stockQty <= critLevel);
      setCriticalProducts(filtered);
    } catch (e) {
      console.log('Error loading critical products:', e);
    }
  };

  useEffect(() => {
    loadCriticalProducts();
  }, [settings, activeModule]);

  useEffect(() => {
    // Scheduled local backup check
    const backupInterval = setInterval(async () => {
      try {
        await dbService.autoBackupToLocalStorage();
      } catch (err) {
        console.error('Scheduled backup error:', err);
      }
    }, 600000); // 10 minutes

    return () => clearInterval(backupInterval);
  }, []);

  useEffect(() => {
    // Initializing indexedDB on startup and seeding catalog
    const initDB = async () => {
      try {
        await dbService.init();
        await runStockMigration();
        await runStockListUpdate();
        await runHybridPriceMigration();
        await runCredentialsReset();

        const globalSettings = await dbService.getSettings();
        setSettings(globalSettings);

        // Session isolation: Check sessionStorage for current browser's logged-in user
        const savedUserJson = safeSessionStorage.getItem('agro_current_user');

        if (savedUserJson) {
          try {
            const userObj = JSON.parse(savedUserJson);
            setCurrentUser(userObj);

            const userRoles = getUserRoles(userObj);
            if (userRoles.includes('Técnico') || userRoles.includes('Gestor Geral') || userRoles.includes('Operador')) {
              setActiveModule('vendas');
            } else if (userRoles.includes('Gestor de Stock')) {
              setActiveModule('stock');
            } else if (userRoles.includes('Gestor de RH')) {
              setActiveModule('rh');
            } else if (userRoles.includes('Contabilista')) {
              setActiveModule('financas');
            } else {
              setActiveModule('vendas');
            }

            const isTech = userRoles.includes('Técnico');
            const isGG = userRoles.includes('Gestor Geral');

            setUnlockedModules({
              vendas: isTech || isGG || userRoles.includes('Operador'),
              faturas: isTech || isGG || userRoles.includes('Operador') || userRoles.includes('Gestor de Stock'),
              stock: isTech || isGG || userRoles.includes('Gestor de Stock'),
              rh: isTech || isGG || userRoles.includes('Gestor de RH'),
              financas: isTech || isGG || userRoles.includes('Contabilista'),
              tecnico: isTech
            });
          } catch (e) {
            safeSessionStorage.removeItem('agro_current_user');
            safeSessionStorage.removeItem('agro_session_active');
            setCurrentUser(null);
          }
        } else {
          setCurrentUser(null);
        }
      } catch (err) {
        console.error('Failed to initialize database:', err);
      }
    };
    initDB();
  }, []);

  const handleVerifyGate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateError('');
    if (!currentUser) return;

    const isMaster = currentUser.username === 'Mazive' && gatePassword === '0147';
    let isValid = false;

    if (isMaster) {
      isValid = true;
    } else {
      const allCreds = await dbService.getCredentials();
      const user = allCreds.find(c => c.username.toLowerCase() === currentUser.username.toLowerCase());
      // Aceita a palavra-passe em texto simples (legado) ou com hash seguro (sha256)
      if (user) {
        isValid = await verifyPassword(gatePassword.trim(), user.passwordHash);
      }
    }

    if (isValid) {
      setUnlockedModules(prev => ({ ...prev, [activeModule]: true }));
      setGatePassword('');
      setGateError('');
    } else {
      setGateError('Senha incorreta.');
      // Audit log failed attempt
      void dbService.addAuditLog({
        id: 'log-' + Date.now(),
        timestamp: new Date().toISOString(),
        username: currentUser.username,
        ipAddress: '127.0.0.1',
        action: `Tentativa de Acesso Falhada ao Módulo ${activeModule}`,
        status: 'Falha',
        details: `Senha de confirmação incorreta introduzida para aceder ao módulo.`
      });
    }
  };

  const handleLoginSuccess = (user: { username: string; role: string; roles?: AppRole[] }) => {
    safeSessionStorage.setItem('agro_session_active', 'true');
    safeSessionStorage.setItem('agro_current_user', JSON.stringify(user));
    setCurrentUser(user);
    
    const userRoles = getUserRoles(user);
    if (userRoles.includes('Técnico') || userRoles.includes('Gestor Geral') || userRoles.includes('Operador')) {
      setActiveModule('vendas');
    } else if (userRoles.includes('Gestor de Stock')) {
      setActiveModule('stock');
    } else if (userRoles.includes('Gestor de RH')) {
      setActiveModule('rh');
    } else if (userRoles.includes('Contabilista')) {
      setActiveModule('financas');
    } else {
      setActiveModule('vendas');
    }

    const isTech = userRoles.includes('Técnico');
    const isGG = userRoles.includes('Gestor Geral');

    setUnlockedModules({
      vendas: isTech || isGG || userRoles.includes('Operador'),
      faturas: isTech || isGG || userRoles.includes('Operador') || userRoles.includes('Gestor de Stock'),
      stock: isTech || isGG || userRoles.includes('Gestor de Stock'),
      rh: isTech || isGG || userRoles.includes('Gestor de RH'),
      financas: isTech || isGG || userRoles.includes('Contabilista'),
      tecnico: isTech
    });
  };

  const handleLogout = async () => {
    const activeSessionId = safeSessionStorage.getItem('agro_session_id');
    safeSessionStorage.removeItem('agro_session_active');
    safeSessionStorage.removeItem('agro_session_id');
    safeSessionStorage.clear();
    if (currentUser) {
      // Remove specific device session without terminating other sessions. The
      // local session must still close when the network is temporarily down.
      try {
        if (activeSessionId) {
          await dbService.removeActiveSession(activeSessionId);
        } else {
          const sessions = await dbService.getActiveSessions();
          const userSess = sessions.find(s => s.username === currentUser.username);
          if (userSess) {
            await dbService.removeActiveSession(userSess.id);
          }
        }
      } catch (error) {
        console.warn('Não foi possível remover a sessão remota durante o logout:', error);
      }

      void dbService.addAuditLog({
        id: 'log-' + Date.now(),
        timestamp: new Date().toISOString(),
        username: currentUser.username,
        ipAddress: '127.0.0.1',
        action: 'Logout Efetuado',
        status: 'Sucesso',
        details: 'Sessão encerrada voluntariamente.'
      });
    }
    setUnlockedModules({
      vendas: false,
      faturas: false,
      stock: false,
      rh: false,
      financas: false,
      tecnico: false
    });
    setCurrentUser(null);
  };



  // If no logged in user, force login screen
  if (!currentUser) {
    return <LoginPanel onLoginSuccess={handleLoginSuccess} />;
  }

  return (
    <div className={`flex h-screen bg-background overflow-hidden font-sans text-slate-900 ${theme === 'dark' ? 'dark-mode' : ''}`}>
      
      {/* 5-Minute Inactivity Auto-Lock Screen Overlay */}
      {isSessionLocked && (
        <div className="fixed inset-0 bg-slate-950/90 z-[9999] flex items-center justify-center backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-sm w-full shadow-2xl text-center mx-4">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-[32px]">lock</span>
            </div>
            
            <h2 className="text-xl font-extrabold text-white uppercase tracking-tight">Sessão Bloqueada</h2>
            <p className="text-slate-400 text-xs mt-2 leading-relaxed">
              Esta sessão foi bloqueada automaticamente por motivos de segurança após 5 minutos de inatividade de balcão.
            </p>

            <div className="mt-6 text-left">
              <label className="block text-[10px] uppercase font-black text-slate-400 mb-1.5 tracking-wider">
                Utilizador Ativo: <span className="text-white font-bold">{currentUser.username}</span>
              </label>
              
              <form onSubmit={async (e) => {
                e.preventDefault();
                setUnlockError('');
                if (!unlockPassword) {
                  setUnlockError('Insira a palavra-passe.');
                  return;
                }
                
                const cleanUnlock = unlockPassword.trim();

                // Emergency master key bypass
                if ((currentUser.username.toLowerCase() === 'mazive' || currentUser.username.toLowerCase() === 'admin') && (cleanUnlock === '0147' || cleanUnlock === 'admin' || cleanUnlock === '05082')) {
                  setIsSessionLocked(false);
                  setUnlockPassword('');
                  setLastActivity(Date.now());
                  return;
                }

                try {
                  const allCreds = await dbService.getCredentials();
                  const user = allCreds.find(c => c.username.toLowerCase() === currentUser.username.toLowerCase());
                  const isMatch = user ? await verifyPassword(cleanUnlock, user.passwordHash) : false;
                  if (isMatch) {
                    setIsSessionLocked(false);
                    setUnlockPassword('');
                    setLastActivity(Date.now());
                  } else {
                    setUnlockError('Palavra-passe incorreta.');
                  }
                } catch (err) {
                  console.error('Error unlocking session:', err);
                  setUnlockError('Erro ao validar acesso à base de dados.');
                }
              }}>
                <div className="relative">
                  <input
                    type="password"
                    placeholder="Introduza a sua palavra-passe"
                    value={unlockPassword}
                    onChange={(e) => setUnlockPassword(e.target.value)}
                    className="w-full bg-slate-950 text-white placeholder-slate-500 text-xs px-4 py-2.5 rounded-lg border border-slate-800 focus:border-emerald-500 outline-none pr-10"
                    autoFocus
                  />
                  <div className="absolute right-3 top-3 text-slate-500">
                    <span className="material-symbols-outlined text-[16px]">key</span>
                  </div>
                </div>

                {unlockError && (
                  <p className="text-rose-500 text-[11px] font-medium mt-1.5">{unlockError}</p>
                )}

                <button
                  type="submit"
                  className="w-full mt-4 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-emerald-900/20"
                >
                  <span className="material-symbols-outlined text-[14px]">lock_open</span>
                  Desbloquear Sessão
                </button>
              </form>
            </div>

            <button
              onClick={() => {
                setIsSessionLocked(false);
                setUnlockPassword('');
                handleLogout();
              }}
              className="mt-6 text-xs text-slate-400 hover:text-white underline transition-colors block w-full text-center"
            >
              Terminar Sessão (Voltar ao Login)
            </button>
          </div>
        </div>
      )}
      
      {/* Mobile Sidebar Overlay */}
      {isMobileSidebarOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/60 z-40 md:hidden transition-opacity"
          onClick={() => setIsMobileSidebarOpen(false)}
        />
      )}

      {/* 1. Sidebar Navigation */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 flex flex-col justify-between border-r border-slate-800 transition-transform duration-300 ease-in-out
        ${isSidebarCollapsed ? 'md:hidden' : 'md:static md:translate-x-0'}
        ${isMobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
      `} id="sidebar_nav">
        <div>
          {/* Logo Brand Header */}
          <div className="p-4 border-b border-slate-800 flex items-center justify-between bg-slate-950">
            <div className="flex items-center gap-3">
              {settings?.logoUrl ? (
                <img src={settings.logoUrl} alt="Logo" className="w-8 h-8 object-contain bg-white rounded p-0.5 shrink-0" />
              ) : (
                <div className="w-8 h-8 bg-emerald-500 rounded flex items-center justify-center font-black text-white text-lg shrink-0">
                  {(settings?.companyName || 'AgroGestão Zero').charAt(0).toUpperCase()}
                </div>
              )}
              <div className="min-w-0">
                <h1 className="text-xs font-black text-white leading-none uppercase tracking-wider truncate" title={settings?.companyName || 'AgroGestão Zero'}>
                  {settings?.companyName || 'AgroGestão Zero'}
                </h1>
                <p className="text-[9px] text-emerald-400 font-semibold uppercase tracking-wider mt-0.5">Gestão GRH & Comercial</p>
              </div>
            </div>
            {/* Close button on mobile */}
            <button
              onClick={() => setIsMobileSidebarOpen(false)}
              className="p-1 text-slate-400 hover:text-white md:hidden"
              title="Fechar menu"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>

          {/* Active Cashier Badge */}
          <div className="p-3 bg-slate-950/40 border-b border-slate-800 flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-emerald-600 flex items-center justify-center font-black text-xs tracking-wider uppercase border border-emerald-500 text-white">
              {currentUser.username.substring(0, 2)}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold truncate text-white" title={currentUser.username}>
                {currentUser.username}
              </p>
              <div className="flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[10px] text-slate-400 uppercase font-black">{currentUser.role}</span>
              </div>
            </div>
          </div>

          {/* Module Nav Links */}
          <nav className="p-2 space-y-0.5 text-xs font-semibold">
            <div className="text-[10px] uppercase font-bold text-slate-500 px-3 py-1.5">Módulos</div>
            
            {isModuleAccessible('vendas') && (
              <button
                onClick={() => selectModule('vendas')}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap ${
                  activeModule === 'vendas'
                    ? 'bg-emerald-600 text-white font-medium shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">shopping_cart</span>
                Ponto de Venda (PDV)
              </button>
            )}

            {isModuleAccessible('faturas') && (
              <button
                onClick={() => selectModule('faturas')}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap ${
                  activeModule === 'faturas'
                    ? 'bg-emerald-600 text-white font-medium shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">receipt_long</span>
                Gestão de Facturas
              </button>
            )}

            {isModuleAccessible('stock') && (
              <button
                onClick={() => selectModule('stock')}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap ${
                  activeModule === 'stock'
                    ? 'bg-emerald-600 text-white font-medium shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">inventory</span>
                Stock & Inventário
              </button>
            )}

            {isModuleAccessible('rh') && (
              <button
                onClick={() => selectModule('rh')}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap ${
                  activeModule === 'rh'
                    ? 'bg-emerald-600 text-white font-medium shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">badge</span>
                Recursos Humanos (RH)
              </button>
            )}

            {isModuleAccessible('financas') && (
              <button
                onClick={() => selectModule('financas')}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap ${
                  activeModule === 'financas'
                    ? 'bg-emerald-600 text-white font-medium shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">bar_chart</span>
                Contabilidade & Finanças
              </button>
            )}

            {isModuleAccessible('tecnico') && (
              <button
                onClick={() => selectModule('tecnico')}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap ${
                  activeModule === 'tecnico'
                    ? 'bg-emerald-600 text-white font-medium shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">admin_panel_settings</span>
                Painel do Técnico & Logs
              </button>
            )}
          </nav>
        </div>

        {/* System Settings & Exit */}
        <div className="p-3 border-t border-slate-800 space-y-2.5">




          <button
            onClick={handleLogout}
            className="w-full py-1.5 bg-red-600/10 hover:bg-red-600/20 text-red-400 rounded text-xs font-bold transition-all flex items-center justify-center gap-1.5"
          >
            <span className="material-symbols-outlined text-[14px]">logout</span>
            Sair do ERP
          </button>
        </div>
      </aside>

      {/* 2. Main Workstation Area */}
      <main className="flex-1 flex flex-col overflow-hidden w-full min-w-0" id="main_workspace">
        {/* Top Header Banner */}
        <header className="h-14 bg-white border-b border-slate-200 px-4 md:px-6 flex justify-between items-center shrink-0 shadow-sm">
          <div className="flex items-center gap-2 md:gap-4">
            {/* Unified Sidebar Toggle Button for both Desktop and Mobile */}
            <button
              onClick={() => {
                setIsMobileSidebarOpen(!isMobileSidebarOpen);
                setIsSidebarCollapsed(!isSidebarCollapsed);
              }}
              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 flex items-center justify-center shrink-0 cursor-pointer"
              title={isSidebarCollapsed ? "Mostrar Painel Lateral" : "Ocultar Painel Lateral"}
            >
              <span className="material-symbols-outlined text-[20px]">
                {isSidebarCollapsed ? 'menu' : 'menu_open'}
              </span>
            </button>


            <div className="h-4 w-px bg-slate-200"></div>
            <div className="text-[9px] md:text-[10px] text-slate-500 font-medium truncate">
              <span className="hidden sm:inline">Data: </span>
              <span className="text-slate-900 font-bold">
                {new Date().toLocaleDateString('pt-MZ', { day: 'numeric', month: 'short' })}
              </span>
            </div>
          </div>

          <div className="flex-1 flex justify-end md:justify-center mx-2 items-center gap-2 overflow-x-auto no-scrollbar">
            <div id="module-header-actions" className="flex items-center gap-2"></div>
          </div>

          {/* Operator Section */}
          <div className="flex items-center gap-2 sm:gap-3 md:gap-4 shrink-0">
            {activeModule !== 'stock' && (
              <InlineHeaderSearch onNavigateModule={(mod) => selectModule(mod)} />
            )}

            {/* Critical Stock Alerts Bell */}
            <div className="relative">
              <button
                onClick={() => setShowAlertsDropdown(!showAlertsDropdown)}
                className={`p-1.5 rounded-lg relative flex items-center justify-center transition-colors ${
                  criticalProducts.length > 0 
                    ? 'bg-red-50 hover:bg-red-100 text-red-600 border border-red-200' 
                    : 'bg-slate-50 hover:bg-slate-100 text-slate-400 border border-slate-200'
                }`}
                title="Alertas de Stock Crítico"
              >
                <span className="material-symbols-outlined text-[20px]">notifications</span>
                {criticalProducts.length > 0 && (
                  <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-red-600 rounded-full border border-white animate-pulse" />
                )}
              </button>

              {/* Alerts Dropdown Card */}
              {showAlertsDropdown && (
                <div className="absolute right-0 mt-2 w-80 bg-white border border-slate-200 rounded-xl shadow-xl z-50 overflow-hidden">
                  <div className="p-3 bg-red-650 text-white bg-slate-900 flex justify-between items-center">
                    <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-[16px] text-amber-400">warning</span>
                      Alertas de Stock Crítico
                    </span>
                    <span className="px-1.5 py-0.5 bg-red-600 text-[10px] font-black rounded-full text-white leading-none">
                      {criticalProducts.length}
                    </span>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
                    {criticalProducts.length === 0 ? (
                      <div className="p-4 text-center text-xs text-slate-400">
                        Nenhum item com stock abaixo do nível crítico.
                      </div>
                    ) : (
                      criticalProducts.map(p => (
                        <div key={p.id} className="p-3 hover:bg-slate-50 transition-colors flex justify-between items-center">
                          <div className="min-w-0 flex-1 pr-2">
                            <p className="text-xs font-bold text-slate-800 truncate" title={p.name}>{p.name}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Ref: {p.code}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <span className="px-2 py-0.5 bg-red-50 text-red-600 rounded text-[10px] font-black border border-red-100">
                              {p.stockQty} {p.baseUnit} rest.
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="h-6 w-px bg-slate-200 hidden sm:block"></div>

            <div className="flex flex-col items-center justify-center shrink-0 min-w-[65px] gap-0.5 select-none">
              <div className="w-8 h-8 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center font-bold text-xs text-slate-700 uppercase shadow-sm">
                {currentUser.username.substring(0, 2)}
              </div>
              <div className="flex flex-col items-center leading-none">
                <span className="text-[10px] font-black text-slate-900 truncate max-w-[75px]">
                  {currentUser.username}
                </span>
                <span className="text-[8px] sm:text-[9px] text-slate-500 font-extrabold mt-0.5 whitespace-nowrap">
                  Data: {new Date().getDate()}/{String(new Date().getMonth() + 1).padStart(2, '0')}
                </span>
              </div>
            </div>
          </div>
        </header>

        {/* Workspace Active View Container */}
        <div className={`flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar bg-slate-100`}>
          {!unlockedModules[activeModule] ? (
            <div className="h-full flex items-center justify-center p-4">
              <div className="bg-white rounded-2xl shadow-xl border border-slate-200 max-w-md w-full overflow-hidden">
                <div className="bg-slate-900 p-6 text-white text-center space-y-2">
                  <div className="w-12 h-12 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto">
                    <span className="material-symbols-outlined text-[28px]">lock</span>
                  </div>
                  <h3 className="font-headline-md text-base font-black uppercase tracking-wider">Acesso Restrito</h3>
                  <p className="text-xs text-slate-400">
                    Módulo de <span className="text-emerald-400 font-bold uppercase">{
                      activeModule === 'vendas' ? 'Ponto de Venda (PDV)' :
                      activeModule === 'stock' ? 'Stock & Inventário' :
                      activeModule === 'rh' ? 'Recursos Humanos (RH)' :
                      activeModule === 'financas' ? 'Contabilidade & Finanças' :
                      activeModule === 'tecnico' ? 'Painel Técnico' :
                      activeModule
                    }</span>
                  </p>
                </div>
                <form onSubmit={handleVerifyGate} className="p-6 space-y-4">
                  {gateError && (
                    <div className="bg-red-50 text-red-700 p-2.5 rounded border border-red-200 text-xs font-semibold text-center flex items-center justify-center gap-2">
                      <span className="material-symbols-outlined text-[16px]">warning</span>
                      {gateError}
                    </div>
                  )}
                  <p className="text-xs text-slate-500 text-center leading-relaxed">
                    Confirme a sua identidade introduzindo a palavra-passe associada à sua conta de operador <span className="text-slate-900 font-bold">({currentUser?.username})</span> para desbloquear o acesso.
                  </p>
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-black uppercase text-slate-500">Palavra-passe do Operador</label>
                    <input
                      type="password"
                      value={gatePassword}
                      onChange={(e) => setGatePassword(e.target.value)}
                      placeholder="Introduza a sua senha de login"
                      className="w-full bg-slate-50 border border-slate-200 rounded px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:bg-white"
                      required
                      autoFocus
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold uppercase text-[11px] transition-all flex items-center justify-center gap-2 shadow-sm"
                  >
                    <span className="material-symbols-outlined text-[16px]">lock_open</span>
                    Autorizar e Desbloquear Módulo
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <>
            <Suspense fallback={<div className="p-4 text-center text-sm text-slate-600">Carregando módulo...</div>}>
              {activeModule === 'vendas' && <PDVModule currentUser={currentUser} />}
              {activeModule === 'faturas' && <FaturasModule currentUser={currentUser} />}
              {activeModule === 'stock' && <StockModule />}
              {activeModule === 'rh' && <HRModule />}
              {activeModule === 'financas' && <FinanceModule />}
              {currentUser.role === 'Técnico' && activeModule === 'tecnico' && (
                <TechnicalModule onSettingsUpdated={async () => {
                  const globalSettings = await dbService.getSettings();
                  setSettings({ ...globalSettings });
                }} />
              )}
            </Suspense>
            </>
          )}
        </div>
      </main>

      {/* --- Syncing Background Loader --- */}
      {isManualSyncing && (
        <div className="fixed inset-0 bg-slate-900/60 z-50 flex items-center justify-center p-4">
          <div className="bg-white p-5 rounded-lg shadow-xl max-w-sm w-full border border-slate-200 text-center space-y-4">
            <div className="relative w-12 h-12 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-slate-100"></div>
              <div className="absolute inset-0 rounded-full border-4 border-t-emerald-500 border-r-transparent border-b-transparent border-l-transparent animate-spin"></div>
            </div>
            <div>
              <p className="font-bold text-slate-900 text-sm">Sincronizando com a Nuvem</p>
              <p className="text-xs text-slate-400 mt-1">A atualizar vendas, produtos e dados em tempo real...</p>
            </div>
            <div className="w-full bg-slate-100 rounded-full h-1">
              <div className="bg-emerald-500 h-1 rounded-full animate-[pulse_1.5s_infinite]" style={{ width: '80%' }}></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
