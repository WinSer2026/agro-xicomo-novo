import { safeStorage, safeSessionStorage } from "./utils/safeStorage";
import { uid } from './utils/idHelper';

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

type ERPModule = 'vendas' | 'faturas' | 'stock' | 'armazem' | 'rh' | 'financas' | 'tecnico';

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
    if (mod === 'armazem') return roles.includes('Gestor de Stock') || roles.includes('Gestor Geral') || roles.includes('Técnico');
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
    armazem: false,
    rh: false,
    financas: false,
    tecnico: false
  });
  const [gatePassword, setGatePassword] = useState('');
  const [gateError, setGateError] = useState('');

  // NOTA (Auditoria FASE 1, F-05/T-04): os indicadores falsos de sincronização
  // ("SSE activo", "pendentes", "última sync") foram removidos — devolviam
  // constantes inventadas. O estado real da ligação Firestore será exposto quando
  // existir autenticação/observabilidade server-side.
  const [isOnline, setIsOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine));

  useEffect(() => {
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  // Critical stock alert states
  const [criticalProducts, setCriticalProducts] = useState<any[]>([]);
  const [showAlertsDropdown, setShowAlertsDropdown] = useState(false);

  // Inactivity Lock States com persistência (sobrevive a F5 / recarregamento)
  const [isSessionLocked, setIsSessionLocked] = useState(() => {
    return safeSessionStorage.getItem('agro_session_locked') === 'true' ||
           safeStorage.getItem('agro_session_locked') === 'true';
  });
  const [lastActivity, setLastActivity] = useState(() => {
    const saved = safeSessionStorage.getItem('agro_last_activity') || safeStorage.getItem('agro_last_activity');
    const parsed = saved ? parseInt(saved, 10) : NaN;
    return !isNaN(parsed) && parsed > 0 ? parsed : Date.now();
  });
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');

  useEffect(() => {
    if (!currentUser || isSessionLocked) return;

    let lastSave = 0;
    const resetTimer = () => {
      const now = Date.now();
      setLastActivity(now);
      // Salva em storage com throttle de 5 segundos para não impactar performance
      if (now - lastSave > 5000) {
        lastSave = now;
        safeSessionStorage.setItem('agro_last_activity', String(now));
        safeStorage.setItem('agro_last_activity', String(now));
      }
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

    // Bloqueio por inactividade configurável (predefinição: 15 minutos).
    // A sessão NÃO é terminada — apenas bloqueada até reintroduzir a palavra-passe,
    // e o carrinho em curso fica recuperável (Auditoria FASE 1, A-04).
    const lockMinutes = Math.max(1, settings?.sessionLockMinutes || 15);
    const lockMs = lockMinutes * 60 * 1000;

    const interval = setInterval(() => {
      const now = Date.now();
      const diff = now - lastActivity;
      if (diff >= lockMs) {
        setIsSessionLocked(true);
        safeSessionStorage.setItem('agro_session_locked', 'true');
        safeStorage.setItem('agro_session_locked', 'true');
        dbService.addAuditLog({
          id: uid('log-'),
          timestamp: new Date().toISOString(),
          username: currentUser.username,
          ipAddress: '127.0.0.1',
          action: 'Sessão Auto-Bloqueada',
          status: 'Alerta',
          details: `A sessão de balcão foi bloqueada devido a ${lockMinutes} minutos de inatividade.`
        }).catch(err => console.warn('Audit log lock error:', err));
      }
    }, 5000); // Check every 5 seconds

    return () => clearInterval(interval);
  }, [currentUser, lastActivity, isSessionLocked, settings]);

  const loadCriticalProducts = async () => {
    try {
      await dbService.init();
      const critLevel = settings?.criticalStockLevel || 10;
      const filtered = await dbService.getLowStockProducts(critLevel);
      setCriticalProducts(filtered);
    } catch (e) {
      console.warn('Error loading critical products:', e);
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
        await runStockListUpdate();
        await runCredentialsReset();

        const globalSettings = await dbService.getSettings();
        setSettings(globalSettings);

        // Session isolation: Check sessionStorage for current browser's logged-in user
        const savedUserJson = safeSessionStorage.getItem('agro_current_user');

        if (savedUserJson) {
          try {
            const userObj = JSON.parse(savedUserJson);
            setCurrentUser(userObj);

            // Verificar se a sessão estava previamente bloqueada por inatividade antes do F5
            const wasLocked = safeSessionStorage.getItem('agro_session_locked') === 'true' ||
                              safeStorage.getItem('agro_session_locked') === 'true';
            const savedLast = parseInt(safeSessionStorage.getItem('agro_last_activity') || safeStorage.getItem('agro_last_activity') || '0', 10);
            const lockMinutes = Math.max(1, globalSettings?.sessionLockMinutes || 15);
            const lockMs = lockMinutes * 60 * 1000;
            const now = Date.now();
            const isTimeExpired = savedLast > 0 && (now - savedLast >= lockMs);

            if (wasLocked || isTimeExpired) {
              setIsSessionLocked(true);
              safeSessionStorage.setItem('agro_session_locked', 'true');
              safeStorage.setItem('agro_session_locked', 'true');
            }

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

  // Heartbeat de presença e remoção de sessão ao fechar navegador/aba
  useEffect(() => {
    if (!currentUser) return;
    const activeSessionId = safeSessionStorage.getItem('agro_session_id');
    if (!activeSessionId) return;

    const interval = setInterval(() => {
      void dbService.updateSessionHeartbeat(activeSessionId);
    }, 2 * 60 * 1000);

    const handleBeforeUnload = () => {
      const sessId = safeSessionStorage.getItem('agro_session_id');
      if (sessId) {
        void dbService.removeActiveSession(sessId);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [currentUser]);

  const handleVerifyGate = async (e: React.FormEvent) => {
    e.preventDefault();
    setGateError('');
    if (!currentUser) return;

    // Sem chaves mestre (Auditoria FASE 1, S-02): apenas a palavra-passe real da conta.
    let isValid = false;
    try {
      const allCreds = await dbService.getCredentials();
      const user = allCreds.find(c => c.username.toLowerCase() === currentUser.username.toLowerCase());
      if (user) {
        isValid = await verifyPassword(gatePassword.trim(), user.passwordHash);
      }
    } catch (err) {
      console.warn('Gate verification failed to load credentials:', err);
      setGateError('Não foi possível validar a identidade (sem ligação à base de dados).');
      return;
    }

    if (isValid) {
      setUnlockedModules(prev => ({ ...prev, [activeModule]: true }));
      setGatePassword('');
      setGateError('');
    } else {
      setGateError('Senha incorreta.');
      // Audit log failed attempt
      void dbService.addAuditLog({
        id: uid('log-'),
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
    safeSessionStorage.removeItem('agro_session_locked');
    safeStorage.removeItem('agro_session_locked');
    const now = Date.now();
    setLastActivity(now);
    safeSessionStorage.setItem('agro_last_activity', String(now));
    safeStorage.setItem('agro_last_activity', String(now));
    setIsSessionLocked(false);
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
    safeSessionStorage.removeItem('agro_session_locked');
    safeSessionStorage.removeItem('agro_last_activity');
    safeStorage.removeItem('agro_session_locked');
    safeStorage.removeItem('agro_last_activity');
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
        id: uid('log-'),
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

      {/* Banda global de ligação: sem internet as escritas ficam penduradas no
          Firestore e o operador tem de saber porquê. */}
      {!isOnline && (
        <div className="fixed top-0 inset-x-0 z-[9998] bg-amber-500 text-slate-950 px-4 py-2 text-center text-xs font-black uppercase tracking-wider shadow-lg flex items-center justify-center gap-2">
          <span className="material-symbols-outlined text-[18px]">wifi_off</span>
          Sem ligação à internet — as operações ficam em espera e serão sincronizadas quando a rede voltar.
        </div>
      )}

      {/* 5-Minute Inactivity Auto-Lock Screen Overlay */}
      {isSessionLocked && (
        <div className="fixed inset-0 bg-slate-950/90 z-[9999] flex items-center justify-center backdrop-blur-md">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-2xl max-w-sm w-full shadow-2xl text-center mx-4">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 rounded-full flex items-center justify-center mx-auto mb-4">
              <span className="material-symbols-outlined text-[32px]">lock</span>
            </div>
            
            <h2 className="text-xl font-extrabold text-white uppercase tracking-tight">Sessão Bloqueada</h2>
            <p className="text-slate-400 text-xs mt-2 leading-relaxed">
              Esta sessão foi bloqueada automaticamente por motivos de segurança após {Math.max(1, settings?.sessionLockMinutes || 15)} minutos de inatividade de balcão.
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

                // Sem chaves mestre (Auditoria FASE 1, S-02): apenas a palavra-passe real da conta.
                try {
                  const allCreds = await dbService.getCredentials();
                  const user = allCreds.find(c => c.username.toLowerCase() === currentUser.username.toLowerCase());
                  const isMatch = user ? await verifyPassword(cleanUnlock, user.passwordHash) : false;
                  if (isMatch) {
                    setIsSessionLocked(false);
                    safeSessionStorage.removeItem('agro_session_locked');
                    safeStorage.removeItem('agro_session_locked');
                    const now = Date.now();
                    setLastActivity(now);
                    safeSessionStorage.setItem('agro_last_activity', String(now));
                    safeStorage.setItem('agro_last_activity', String(now));
                    setUnlockPassword('');
                    setUnlockError('');
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
                safeSessionStorage.removeItem('agro_session_locked');
                safeStorage.removeItem('agro_session_locked');
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

            {isModuleAccessible('armazem') && (
              <button
                onClick={() => selectModule('armazem')}
                className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all whitespace-nowrap ${
                  activeModule === 'armazem'
                    ? 'bg-emerald-600 text-white font-medium shadow-sm'
                    : 'text-slate-300 hover:bg-slate-800 hover:text-white'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">warehouse</span>
                Gestão de Armazém
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
                      activeModule === 'armazem' ? 'Gestão de Armazém' :
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
              {activeModule === 'armazem' && (
                <div className="p-8 max-w-4xl mx-auto space-y-6">
                  <div className="bg-white rounded-2xl p-8 border border-slate-200 shadow-sm text-center space-y-4">
                    <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                      <span className="material-symbols-outlined text-3xl">warehouse</span>
                    </div>
                    <div className="space-y-1">
                      <h2 className="text-xl font-black text-slate-800 uppercase tracking-wide">Gestão de Armazém</h2>
                      <p className="text-sm text-slate-500 font-medium">Módulo Estrutural de Logística e Separação de Stock Físico</p>
                    </div>
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-amber-50 text-amber-700 text-xs font-bold rounded-full border border-amber-200">
                      <span className="material-symbols-outlined text-sm">construction</span>
                      Módulo em Estruturação — Fase Estática
                    </div>
                    <p className="text-xs text-slate-600 max-w-xl mx-auto leading-relaxed">
                      Este espaço reservado centralizará o registo de localizações físicas, separação de corredores, prateleiras e lotes de receção de fornecedores, mantendo a logística desacoplada da frente de venda do PDV.
                    </p>
                  </div>
                </div>
              )}
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

    </div>
  );
}
