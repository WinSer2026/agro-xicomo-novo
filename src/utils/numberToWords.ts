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
    partesInteiro.push(milhares === 1 ? 'Mil' : `${txtMilhares} Mil`);
  }

  if (unidades > 0) {
    partesInteiro.push(converterGrupo(unidades));
  }

  // O-03: em português os grupos separam-se por espaço — "mil duzentos e
  // cinquenta", não "mil, duzentos e cinquenta". O "e" só entra quando o
  // último grupo é inferior a 100 ("mil e cinquenta").
  const separadorFinal = unidades > 0 && unidades < 100 && (milhares > 0 || milhoes > 0) ? ' e ' : ' ';
  let extensaoInteiro: string;
  if (partesInteiro.length === 0) {
    extensaoInteiro = '';
  } else if (milhoes > 0 && partesInteiro.length > 1) {
    // "dois milhões e quinhentos mil meticais"
    extensaoInteiro = `${partesInteiro[0]} e ${partesInteiro.slice(1).join(separadorFinal)}`;
  } else {
    extensaoInteiro = partesInteiro.join(separadorFinal);
  }

  let resultado = '';

  if (inteiro > 0) {
    // "um milhão DE meticais"; "mil meticais" (sem "de").
    const ligacaoMoeda = milhoes > 0 && milhares === 0 && unidades === 0 ? ' de ' : ' ';
    resultado = `${extensaoInteiro}${ligacaoMoeda}${inteiro === 1 ? 'Metical' : 'Meticais'}`;
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
