import { safeStorage, safeSessionStorage } from "../utils/safeStorage";
import { uid } from '../utils/idHelper';
import React, { useState, useEffect } from 'react';
import { dbService } from '../utils/firebaseDB';
import { UserCredentials, AuditLog, ActiveSession, SystemSettings, AppRole } from '../types';
import { getUserRoles } from '../utils/roleHelper';
import { validateAccessPassword, verifyPassword, needsPasswordRehash, hashPassword } from '../utils/securityHelper';
import { applyNewPassword } from '../utils/credentialsReset';
import { getOrCreateDeviceId, fetchClientIp } from '../utils/deviceHelper';

interface LoginPanelProps {
  onLoginSuccess: (user: { username: string; role: string; roles?: AppRole[] }) => void;
}

export default function LoginPanel({ onLoginSuccess }: LoginPanelProps) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingUser, setPendingUser] = useState<UserCredentials | null>(null);

  // Primeiro acesso após o reset de credenciais: troca obrigatória de palavra-passe
  const [showPasswordChange, setShowPasswordChange] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [changePasswordError, setChangePasswordError] = useState('');

  // Stats for the screen
  const [activeOpsCount, setActiveOpsCount] = useState(0);
  const [activeTechsCount, setActiveTechsCount] = useState(0);

  // Brute Force & Rate Limiting Protection (Parte 6 - 6.2.2)
  const [failedAttempts, setFailedAttempts] = useState<number>(() => {
    try {
      const saved = safeStorage.getItem('agro_login_failed_attempts');
      return saved ? parseInt(saved, 10) : 0;
    } catch {
      return 0;
    }
  });

  const [lockoutUntil, setLockoutUntil] = useState<number | null>(() => {
    try {
      const saved = safeStorage.getItem('agro_login_lockout_until');
      if (saved) {
        const time = parseInt(saved, 10);
        return time > Date.now() ? time : null;
      }
      return null;
    } catch {
      return null;
    }
  });

  const [remainingLockoutSecs, setRemainingLockoutSecs] = useState<number>(0);

  // Security Challenge (Math CAPTCHA after 3 failed attempts)
  const [captchaNum1, setCaptchaNum1] = useState<number>(() => Math.floor(Math.random() * 9 + 2));
  const [captchaNum2, setCaptchaNum2] = useState<number>(() => Math.floor(Math.random() * 8 + 1));
  const [captchaAnswer, setCaptchaAnswer] = useState<string>('');
  const [showCaptcha, setShowCaptcha] = useState<boolean>(failedAttempts >= 3);

  const regenerateCaptcha = () => {
    setCaptchaNum1(Math.floor(Math.random() * 9 + 2));
    setCaptchaNum2(Math.floor(Math.random() * 8 + 1));
    setCaptchaAnswer('');
  };

  useEffect(() => {
    // Initial fetch of active session counts and system settings
    const loadSessionStatsAndSettings = async () => {
      try {
        await dbService.init();
        // Limpar em segundo plano sessões órfãs antigas (> 12h) no arranque da tela de login
        void dbService.terminatePreviousSessions({}).catch(() => {});
        const sessions = await dbService.getActiveSessions();
        const ops = sessions.filter(s => s.role !== 'Técnico').length;
        const techs = sessions.filter(s => s.role === 'Técnico').length;
        setActiveOpsCount(ops);
        setActiveTechsCount(techs);

        const s = await dbService.getSettings();
        setSettings(s);
      } catch (err) {
        console.warn('Failed to load initial login stats:', err);
      }
    };
    loadSessionStatsAndSettings();
  }, []);

  // Countdown timer for account lockout
  useEffect(() => {
    if (!lockoutUntil) {
      setRemainingLockoutSecs(0);
      return;
    }

    const updateTimer = () => {
      const now = Date.now();
      const diff = Math.max(0, Math.ceil((lockoutUntil - now) / 1000));
      setRemainingLockoutSecs(diff);
      if (diff <= 0) {
        setLockoutUntil(null);
        safeStorage.removeItem('agro_login_lockout_until');
        safeStorage.setItem('agro_login_failed_attempts', '0');
        setFailedAttempts(0);
        setShowCaptcha(false);
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [lockoutUntil]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError('');

    // Check Lockout
    if (lockoutUntil && Date.now() < lockoutUntil) {
      setError(`Acesso temporariamente bloqueado por excesso de tentativas falhadas. Aguarde ${remainingLockoutSecs}s.`);
      return;
    }

    if (!username || !password) {
      setError('Por favor preencha o nome de utilizador e a palavra-passe.');
      return;
    }

    // Verify CAPTCHA if enabled
    if (showCaptcha) {
      if (parseInt(captchaAnswer, 10) !== (captchaNum1 + captchaNum2)) {
        setError('Resposta ao teste de segurança (CAPTCHA) incorreta. Tente novamente.');
        regenerateCaptcha();
        return;
      }
    }

    setIsSubmitting(true);

    try {
      const cleanUser = username.trim();
      const cleanPass = password.trim();
      const lower = cleanUser.toLowerCase();
      // Obter IP real do cliente com fallback seguro
      const ipAddress = await fetchClientIp();

      // Credenciais apenas da base de dados (sem chaves mestre nem lista de
      // contingência hardcoded — Auditoria FASE 1, S-02/S-04).
      let allCreds: UserCredentials[] = [];
      try {
        allCreds = await dbService.getCredentials();
      } catch (err) {
        console.warn('Failed to fetch credentials from database service:', err);
        setError('Não foi possível ligar à base de dados. Verifique a ligação à internet e tente novamente.');
        return;
      }

      const user = (allCreds || []).find(c => c.username.toLowerCase() === lower);

      const isPasswordMatch = user ? await verifyPassword(cleanPass, user.passwordHash) : false;

      // Verify password
      if (!user || !isPasswordMatch) {
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);
        safeStorage.setItem('agro_login_failed_attempts', String(nextAttempts));

        // Background non-blocking audit log
        dbService.addAuditLog({
          id: uid('log-'),
          timestamp: new Date().toISOString(),
          username: cleanUser || 'Desconhecido',
          ipAddress,
          action: 'Tentativa de Login Falhada',
          status: 'Falha',
          level: nextAttempts >= 5 ? 'CRITICAL' : 'WARNING',
          details: `Credenciais inválidas para o utilizador: "${cleanUser}" (Tentativa ${nextAttempts}/5).`
        }).catch(() => {});

        // Trigger CAPTCHA after 3 attempts
        if (nextAttempts >= 3) {
          setShowCaptcha(true);
          regenerateCaptcha();
        }

        // Trigger Account Lockout after 5 attempts (15 minutes lockout)
        if (nextAttempts >= 5) {
          const lockTime = Date.now() + (15 * 60 * 1000);
          setLockoutUntil(lockTime);
          safeStorage.setItem('agro_login_lockout_until', String(lockTime));
          setError('Limite de tentativas excedido (5 falhas). Acesso bloqueado durante 15 minutos.');
          return;
        }

        setError(`Credenciais inválidas. (${5 - nextAttempts} tentativas restantes antes do bloqueio).`);
        return;
      }

      // Successful credentials match: reset failed attempts
      safeStorage.removeItem('agro_login_failed_attempts');
      safeStorage.removeItem('agro_login_lockout_until');

      // Migração de hash legado (sha256/texto simples) para PBKDF2 no login.
      if (user && needsPasswordRehash(user.passwordHash)) {
        try {
          const migrated: UserCredentials = {
            ...user,
            passwordHash: await hashPassword(cleanPass),
            passwordResetVersion: user.passwordResetVersion
          };
          await dbService.saveCredential(migrated);
          void dbService.addAuditLog({
            id: 'log-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8),
            timestamp: new Date().toISOString(),
            username: cleanUser,
            ipAddress,
            action: 'Palavra-passe Migrada para Formato Seguro',
            status: 'Sucesso',
            level: 'INFO',
            details: 'O hash da palavra-passe foi promovido para PBKDF2 (migração automática).'
          }).catch(() => {});
        } catch (migErr) {
          console.warn('Password hash migration failed (login continues):', migErr);
        }
      }

      // 3. Primeiro acesso: exigir nova palavra-passe
      if (user.mustChangePassword) {
        setPendingUser(user);
        setNewPassword('');
        setConfirmPassword('');
        setChangePasswordError('');
        setShowPasswordChange(true);
        setIsSubmitting(false);
        return;
      }

      // 4. Login normal
      await finalizeSession(user, ipAddress);

    } catch (err) {
      console.error('Login error:', err);
      setError('Erro ao validar credenciais. Verifique os dados inseridos.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Primeiro acesso: o operador define a palavra-passe que quiser (4 a 6 caracteres)
  const handleChangePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setChangePasswordError('');

    if (!pendingUser) return;

    const policy = validateAccessPassword(newPassword);
    if (!policy.strong) {
      setChangePasswordError(policy.message || 'Palavra-passe inválida.');
      return;
    }
    if (newPassword.trim() !== confirmPassword.trim()) {
      setChangePasswordError('As palavras-passe introduzidas não coincidem.');
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await applyNewPassword(pendingUser.username, newPassword.trim());
      if (!result.ok) {
        setChangePasswordError(result.message || 'Erro ao gravar a nova palavra-passe.');
        return;
      }

      const ipAddress = await fetchClientIp();
      await finalizeSession({ ...pendingUser, passwordHash: '', mustChangePassword: false }, ipAddress);
      setShowPasswordChange(false);
      setPendingUser(null);
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      console.error('Password change error:', err);
      setChangePasswordError('Erro ao gravar a nova palavra-passe. Tente novamente.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const finalizeSession = async (user: UserCredentials, ip: string) => {
    const userRoles = getUserRoles(user);
    const roleStr = userRoles.join(', ') || user.role;
    const deviceId = getOrCreateDeviceId();
    const sessionId = 'sess-' + user.username.toLowerCase() + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 8);

    safeSessionStorage.setItem('agro_session_id', sessionId);

    // 1. Terminar automaticamente sessões anteriores deste utilizador (ex.: Almira),
    // ou deste mesmo computador (IP / deviceId)
    try {
      const terminated = await dbService.terminatePreviousSessions({
        username: user.username,
        ipAddress: ip,
        deviceId: deviceId,
        excludeSessionId: sessionId
      });
      if (terminated.length > 0) {
        void dbService.addAuditLog({
          id: uid('log-'),
          timestamp: new Date().toISOString(),
          username: user.username,
          ipAddress: ip,
          action: 'Sessão Anterior Encerrada',
          status: 'Alerta',
          level: 'INFO',
          details: `${terminated.length} sessão(ões) anterior(es) órfã(s) de "${user.username}" ou deste computador foram encerradas automaticamente para manter sessão única.`
        }).catch(() => {});
      }
    } catch (cleanErr) {
      console.warn('Erro ao limpar sessões antigas durante o login:', cleanErr);
    }

    // 2. Registar a nova sessão
    Promise.allSettled([
      dbService.saveActiveSession({
        id: sessionId,
        username: user.username,
        role: roleStr,
        roles: userRoles,
        loginTime: new Date().toISOString(),
        ipAddress: ip,
        deviceId: deviceId,
        lastHeartbeat: new Date().toISOString()
      }),
      dbService.addAuditLog({
        id: uid('log-'),
        timestamp: new Date().toISOString(),
        username: user.username,
        ipAddress: ip,
        action: 'Login Efetuado',
        status: 'Sucesso',
        level: 'INFO',
        details: `Sessão iniciada com perfil: ${roleStr}.`
      })
    ]).catch(err => console.warn('Background login tracking log error:', err));

    onLoginSuccess({ username: user.username, role: roleStr, roles: userRoles });
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-white border border-gray-200 rounded-2xl shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Banner */}
        <div className="bg-linear-to-r from-emerald-800 to-teal-900 p-6 text-white text-center relative shadow-md">
          <div className="flex flex-col items-center justify-center gap-2">
            {settings?.logoUrl ? (
              <img src={settings.logoUrl} alt="Logo" className="h-14 w-auto object-contain bg-white rounded-lg p-1 shadow-md" />
            ) : (
              <img src="/logo.png" alt="Logo AGRO - XICOMO & SERVIÇOS" className="h-14 w-auto object-contain bg-white rounded-lg p-1 shadow-md" onError={(e) => { (e.target as HTMLImageElement).style.display='none'; }} />
            )}
            <div className="text-lg font-black tracking-tight font-headline-lg">
              {settings?.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA'}
            </div>
          </div>
          <p className="text-[11px] text-emerald-100 mt-1 uppercase font-semibold tracking-wider">
            Gestão Comercial, Estoque e Recursos Humanos • Moçambique
          </p>
          <div className="absolute top-2 right-2 bg-white/15 px-2 py-0.5 rounded text-[9px] font-bold text-white uppercase flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Segurança v2.0
          </div>
        </div>

        <div className="p-6 space-y-4">
          
          {/* Lockout Warning */}
          {lockoutUntil && Date.now() < lockoutUntil && (
            <div className="bg-red-50 border-2 border-red-300 text-red-800 p-4 rounded-xl text-xs font-bold space-y-1 text-center animate-pulse">
              <span className="material-symbols-outlined text-2xl text-red-600">lock_clock</span>
              <p className="font-black text-sm">Acesso Bloqueado Temporariamente</p>
              <p className="text-[11px] text-red-700">
                Tentativas excessivas detectadas. O acesso será reativado em: <strong className="font-mono text-sm">{Math.floor(remainingLockoutSecs / 60)}m {remainingLockoutSecs % 60}s</strong>
              </p>
            </div>
          )}

          {/* Error Message */}
          {error && !lockoutUntil && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-xs font-bold flex items-center gap-2 animate-shake">
              <span className="material-symbols-outlined text-[18px] text-red-600">error</span>
              <span>{error}</span>
            </div>
          )}

          {/* Bootstrap notice (instalação nova) */}
          {settings?.bootstrapNotice && !showPasswordChange && (
            <div className="bg-amber-50 border border-amber-300 text-amber-900 p-3 rounded-xl text-xs font-bold leading-relaxed">
              <span className="material-symbols-outlined text-[16px] align-middle mr-1">info</span>
              {settings.bootstrapNotice}
            </div>
          )}

          {showPasswordChange ? (
            <form onSubmit={handleChangePasswordSubmit} autoComplete="off" noValidate className="space-y-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-center space-y-1">
                <span className="material-symbols-outlined text-[28px] text-amber-600">key</span>
                <p className="text-xs font-black text-amber-900 uppercase">
                  Primeiro acesso — atualize a sua palavra-passe
                </p>
                <p className="text-[11px] text-amber-800">
                  Operador: <strong>{pendingUser?.username}</strong>
                </p>
              </div>

              {changePasswordError && (
                <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-xs font-bold flex items-center gap-2 animate-shake">
                  <span className="material-symbols-outlined text-[18px] text-red-600">error</span>
                  <span>{changePasswordError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Nova Palavra-passe
                </label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  maxLength={6}
                  autoComplete="new-password"
                  placeholder="4 a 6 caracteres (letras ou números)"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-xs font-bold focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Repetir Nova Palavra-passe
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  maxLength={6}
                  autoComplete="new-password"
                  placeholder="Repita a nova palavra-passe"
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-xs font-bold focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600"
                />
              </div>

              <p className="text-[10px] text-gray-500 text-center leading-relaxed">
                Pode usar qualquer palavra-passe com 4 a 6 caracteres (apenas números, apenas letras ou mistos).
                Não é obrigatório usar símbolos.
              </p>

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 transition-all text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmitting ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    <span>A gravar...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">verified_user</span>
                    <span>Gravar e Entrar no Sistema</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setShowPasswordChange(false);
                  setPendingUser(null);
                  setNewPassword('');
                  setConfirmPassword('');
                  setChangePasswordError('');
                  setPassword('');
                }}
                className="w-full py-2 border border-gray-300 text-gray-700 font-bold text-xs rounded-xl hover:bg-gray-50 transition-colors cursor-pointer"
              >
                Voltar ao Login Principal
              </button>
            </form>
          ) : (
            <form onSubmit={handleLoginSubmit} autoComplete="off" noValidate className="space-y-4">
              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Nome de Utilizador
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[20px]">
                    person
                  </span>
                  <input
                    type="text"
                    disabled={Boolean(lockoutUntil && Date.now() < lockoutUntil)}
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="off"
                    name="user_ident_field"
                    id="user_ident_field"
                    spellCheck={false}
                    autoCorrect="off"
                    autoCapitalize="off"
                    placeholder="Nome de utilizador"
                    className="w-full border border-gray-300 rounded-xl pl-10 pr-3 py-2.5 text-xs font-bold focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:bg-gray-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase text-gray-700 mb-1">
                  Palavra-passe
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-[20px]">
                    lock
                  </span>
                  <input
                    type="password"
                    disabled={Boolean(lockoutUntil && Date.now() < lockoutUntil)}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    name="user_secret_field"
                    id="user_secret_field"
                    placeholder="••••••••"
                    className="w-full border border-gray-300 rounded-xl pl-10 pr-3 py-2.5 text-xs font-bold focus:outline-none focus:border-emerald-600 focus:ring-1 focus:ring-emerald-600 disabled:bg-gray-100"
                  />
                </div>
              </div>

              {/* Math Security Challenge CAPTCHA after 3 failed attempts (Parte 6) */}
              {showCaptcha && !lockoutUntil && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2 text-xs animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="font-black text-amber-900 uppercase text-[10px] flex items-center gap-1">
                      <span className="material-symbols-outlined text-[14px]">verified</span>
                      Teste de Segurança Anti-Bot
                    </span>
                    <button
                      type="button"
                      onClick={regenerateCaptcha}
                      className="text-[10px] text-amber-800 hover:underline font-bold"
                    >
                      Alterar conta
                    </button>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="px-3 py-1.5 bg-white border border-amber-300 rounded-lg font-mono font-black text-amber-950 text-sm tracking-wider">
                      {captchaNum1} + {captchaNum2} = ?
                    </div>
                    <input
                      type="number"
                      value={captchaAnswer}
                      onChange={(e) => setCaptchaAnswer(e.target.value)}
                      placeholder="Resultado"
                      className="flex-1 bg-white border border-amber-300 rounded-lg px-3 py-1.5 text-xs font-bold text-center focus:ring-1 focus:ring-amber-600"
                    />
                  </div>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting || Boolean(lockoutUntil && Date.now() < lockoutUntil)}
                className="w-full py-3 bg-emerald-700 hover:bg-emerald-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-all text-white font-black text-xs uppercase tracking-wider rounded-xl shadow-md hover:shadow-lg active:scale-[0.98] flex items-center justify-center gap-2 cursor-pointer font-sans"
              >
                {isSubmitting ? (
                  <>
                    <span className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                    <span>A Verificar Acesso...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[18px]">login</span>
                    <span>Aceder ao Sistema</span>
                  </>
                )}
              </button>

              <div className="border-t border-gray-100 pt-3 text-center space-y-1">
                <p className="text-[11px] text-gray-500">
                  Acesso Restrito aos Operadores e Gestores Autorizados.
                </p>
                <div className="flex items-center justify-center gap-3 text-[10px] text-gray-600 font-bold">
                  <span>Operadores: <strong className="text-emerald-700">{activeOpsCount}/6</strong></span>
                  <span>•</span>
                  <span>Técnicos: <strong className="text-emerald-700">{activeTechsCount}/4</strong></span>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
