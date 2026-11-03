import { safeStorage } from './safeStorage';

/**
 * Retorna ou gera um ID único e persistente para o computador/navegador actual.
 * Fica gravado no localStorage do computador e sobrevive a fechos de navegador e reinícios.
 */
export function getOrCreateDeviceId(): string {
  let devId = safeStorage.getItem('agro_device_id');
  if (!devId) {
    devId = 'dev-' + Math.random().toString(36).substring(2, 10) + '-' + Date.now().toString(36);
    safeStorage.setItem('agro_device_id', devId);
  }
  return devId;
}

/**
 * Tenta obter o IP público real da máquina com timeout rápido de 1.5s.
 * Se offline ou bloqueado, devolve fallback seguro sem atrasar o login.
 */
export async function fetchClientIp(): Promise<string> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch('https://api.ipify.org?format=json', { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok) {
      const data = await res.json();
      if (data && data.ip) {
        return String(data.ip).trim();
      }
    }
  } catch {
    // Silencioso em caso de timeout ou falta de acesso exterior
  }
  return 'Local / N/D';
}
