/**
 * Identificação do posto que está a usar o sistema.
 *
 * O registo de auditoria guardava um IP inventado (`197.218.10.x` aleatório),
 * o que tornava a auditoria inútil (achado L-05). O IP real só é conhecido do
 * servidor, por isso é pedido uma vez ao arranque e reutilizado. Quando não há
 * servidor (modo offline puro), regista-se `'local'` — é verdade, ao contrário
 * de um número aleatório.
 */
let cachedIp: string | null = null;
let pending: Promise<string> | null = null;

export function getClientIp(): Promise<string> {
  if (cachedIp) return Promise.resolve(cachedIp);
  if (pending) return pending;

  pending = (async () => {
    try {
      const response = await fetch('/api/client-info', {
        headers: { Accept: 'application/json' }
      });
      if (response.ok) {
        const data = await response.json();
        const ip = typeof data?.ip === 'string' ? data.ip.replace(/^::ffff:/, '') : '';
        if (ip) {
          cachedIp = ip;
          return ip;
        }
      }
    } catch {
      /* servidor ausente: usa-se o valor local */
    }
    cachedIp = 'local';
    return cachedIp;
  })();

  return pending;
}
