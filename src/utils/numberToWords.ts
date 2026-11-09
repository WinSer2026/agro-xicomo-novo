/**
 * Converte um valor numérico em meticais para a sua extensão por extenso em português.
 * Exemplo: 1250.50 -> "Um Mil, Duzentos e Cinquenta Meticais e Cinquenta Centavos"
 */

const UNIDADES = ['', 'Um', 'Dois', 'Três', 'Quatro', 'Cinco', 'Seis', 'Sete', 'Oito', 'Nove'];
const DEZ_A_DEZANOVE = ['Dez', 'Onze', 'Doze', 'Treze', 'Catorze', 'Quinze', 'Dezesseis', 'Dezessete', 'Dezoito', 'Dezenove'];
const DEZENAS = ['', '', 'Vinte', 'Trinta', 'Quarenta', 'Cinquenta', 'Sessenta', 'Setenta', 'Oitenta', 'Noventa'];
const CENTENAS = ['', 'Cento', 'Duzentos', 'Trezentos', 'Quatrocentos', 'Quinhentos', 'Seiscentos', 'Setecentos', 'Oitocentos', 'Novecentos'];

function converterGrupo(n: number): string {
  if (n === 0) return '';
  if (n === 100) return 'Cem';

  const c = Math.floor(n / 100);
  const r100 = n % 100;
  const d = Math.floor(r100 / 10);
  const u = r100 % 10;

  const partes: string[] = [];

  if (c > 0) {
    partes.push(CENTENAS[c]);
  }

  if (r100 >= 10 && r100 <= 19) {
    partes.push(DEZ_A_DEZANOVE[r100 - 10]);
  } else {
    if (d > 0) {
      partes.push(DEZENAS[d]);
    }
    if (u > 0) {
      partes.push(UNIDADES[u]);
    }
  }

  return partes.join(' e ');
}

export function numeroParaExtenso(valor: number): string {
  if (isNaN(valor) || valor < 0) return 'Zero Meticais';

  const inteiro = Math.floor(valor);
  const centavos = Math.round((valor - inteiro) * 100);

  if (inteiro === 0 && centavos === 0) {
    return 'Zero Meticais';
  }

  const partesInteiro: string[] = [];

  const milhoes = Math.floor(inteiro / 1000000);
  const restoMilhoes = inteiro % 1000000;
  const milhares = Math.floor(restoMilhoes / 1000);
  const unidades = restoMilhoes % 1000;

  if (milhoes > 0) {
    const txtMilhoes = converterGrupo(milhoes);
    partesInteiro.push(milhoes === 1 ? 'Um Milhão' : `${txtMilhoes} Milhões`);
  }

  if (milhares > 0) {
    const txtMilhares = converterGrupo(milhares);
    partesInteiro.push(milhares === 1 ? 'Um Mil' : `${txtMilhares} Mil`);
  }

  if (unidades > 0) {
    partesInteiro.push(converterGrupo(unidades));
  }

  let extensaoInteiro = partesInteiro.join(unidades > 0 && (milhares > 0 || milhoes > 0) && unidades < 100 ? ' e ' : ', ');

  // Normalização de pontuação
  extensaoInteiro = extensaoInteiro.replace(/, e /g, ' e ');

  let resultado = '';

  if (inteiro > 0) {
    resultado = `${extensaoInteiro} ${inteiro === 1 ? 'Metical' : 'Meticais'}`;
  }

  if (centavos > 0) {
    const txtCentavos = converterGrupo(centavos);
    const extensaoCentavos = `${txtCentavos} ${centavos === 1 ? 'Centavo' : 'Centavos'}`;
    if (inteiro > 0) {
      resultado += ` e ${extensaoCentavos}`;
    } else {
      resultado = extensaoCentavos;
    }
  }

  return resultado;
}
