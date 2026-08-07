import React from 'react';

// EAN-13 encoding tables
const PARITY_PATTERNS = [
  'LLLLLL', // 0
  'LLGLGG', // 1
  'LLGGLG', // 2
  'LLGGGL', // 3
  'LGLLGG', // 4
  'LGGLLG', // 5
  'LGGGLL', // 6
  'LGLGLG', // 7
  'LGLGGL', // 8
  'LGGLGL'  // 9
];

const L_CODE = [
  '0001101', // 0
  '0011001', // 1
  '0010011', // 2
  '0111101', // 3
  '0100011', // 4
  '0110001', // 5
  '0101111', // 6
  '0111011', // 7
  '0110111', // 8
  '0001011'  // 9
];

const G_CODE = [
  '0100111', // 0
  '0110011', // 1
  '0011011', // 2
  '0100001', // 3
  '0011101', // 4
  '0111001', // 5
  '0000101', // 6
  '0010001', // 7
  '0001001', // 8
  '0010111'  // 9
];

const R_CODE = [
  '1110010', // 0
  '1100110', // 1
  '1101100', // 2
  '1000010', // 3
  '1011100', // 4
  '1001110', // 5
  '1010000', // 6
  '1000100', // 7
  '1001000', // 8
  '1110100'  // 9
];

// Helper to generate EAN-13 check digit
export function calculateEAN13CheckDigit(digits12: string): string {
  let sum1 = 0;
  let sum2 = 0;
  for (let i = 0; i < 12; i++) {
    const d = parseInt(digits12[i], 10);
    if (isNaN(d)) return '0';
    if (i % 2 === 0) {
      sum1 += d;
    } else {
      sum2 += d;
    }
  }
  const total = sum1 + 3 * sum2;
  const checksum = (10 - (total % 10)) % 10;
  return checksum.toString();
}

// Generate a valid 13-digit barcode starting with a prefix (default "961")
export function generateValidEAN13(prefix = '961'): string {
  let code = prefix;
  while (code.length < 12) {
    code += Math.floor(Math.random() * 10).toString();
  }
  return code + calculateEAN13CheckDigit(code);
}

interface Barcode13Props {
  code: string;
  width?: number;
  height?: number;
  className?: string;
}

export default function Barcode13({ code, width = 180, height = 90, className = '' }: Barcode13Props) {
  // Ensure we have exactly 13 digits
  let sanitized = code.replace(/\D/g, '');
  if (sanitized.length < 13) {
    sanitized = sanitized.padEnd(12, '0');
    sanitized += calculateEAN13CheckDigit(sanitized);
  } else if (sanitized.length > 13) {
    sanitized = sanitized.substring(0, 13);
  }

  const firstDigit = parseInt(sanitized[0], 10);
  const leftDigits = sanitized.substring(1, 7);
  const rightDigits = sanitized.substring(7, 13);

  // Get parity pattern for left side
  const pattern = PARITY_PATTERNS[firstDigit] || 'LLLLLL';

  // Build the barcode binary bits
  // 1 = black bar, 0 = white space
  const modules: { bit: number; isGuard: boolean }[] = [];

  // Left Guard (101)
  modules.push({ bit: 1, isGuard: true });
  modules.push({ bit: 0, isGuard: true });
  modules.push({ bit: 1, isGuard: true });

  // Left 6 Digits
  for (let i = 0; i < 6; i++) {
    const digit = parseInt(leftDigits[i], 10);
    const type = pattern[i];
    const bitsStr = type === 'L' ? L_CODE[digit] : G_CODE[digit];
    for (let b = 0; b < 7; b++) {
      modules.push({ bit: parseInt(bitsStr[b], 10), isGuard: false });
    }
  }

  // Center Guard (01010)
  modules.push({ bit: 0, isGuard: true });
  modules.push({ bit: 1, isGuard: true });
  modules.push({ bit: 0, isGuard: true });
  modules.push({ bit: 1, isGuard: true });
  modules.push({ bit: 0, isGuard: true });

  // Right 6 Digits
  for (let i = 0; i < 6; i++) {
    const digit = parseInt(rightDigits[i], 10);
    const bitsStr = R_CODE[digit];
    for (let b = 0; b < 7; b++) {
      modules.push({ bit: parseInt(bitsStr[b], 10), isGuard: false });
    }
  }

  // Right Guard (101)
  modules.push({ bit: 1, isGuard: true });
  modules.push({ bit: 0, isGuard: true });
  modules.push({ bit: 1, isGuard: true });

  // Svg Layout specs
  const totalModules = modules.length; // 3 + 42 + 5 + 42 + 3 = 95 modules
  const paddingX = 14;
  const barWidth = (width - paddingX * 2) / totalModules;
  const svgHeight = height;
  
  // Guard bars extend slightly lower
  const normalBarHeight = svgHeight * 0.65;
  const guardBarHeight = svgHeight * 0.77;

  return (
    <div className={`flex flex-col items-center bg-white p-2 rounded-lg ${className}`} id={`barcode-${sanitized}`}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        {/* Render Bars */}
        {modules.map((m, idx) => {
          if (m.bit === 0) return null;
          const x = paddingX + idx * barWidth;
          const barH = m.isGuard ? guardBarHeight : normalBarHeight;
          return (
            <rect
              key={idx}
              x={x}
              y={5}
              width={barWidth + 0.1} // small overlap to prevent rendering lines/gaps between modules
              height={barH}
              fill="#000000"
            />
          );
        })}

        {/* Human-readable Numbers underneath */}
        {/* First digit (left side outside the bars) */}
        <text
          x={paddingX - 8}
          y={svgHeight - 6}
          fontSize="11"
          fontWeight="bold"
          fontFamily="monospace"
          fill="#1e293b"
          textAnchor="middle"
        >
          {sanitized[0]}
        </text>

        {/* First group of 6 digits (left half under the bars) */}
        <text
          x={paddingX + 3 + (21 * barWidth)}
          y={svgHeight - 6}
          fontSize="11"
          fontWeight="bold"
          fontFamily="monospace"
          fill="#1e293b"
          textAnchor="middle"
          letterSpacing={barWidth * 3}
        >
          {leftDigits}
        </text>

        {/* Second group of 6 digits (right half under the bars) */}
        <text
          x={paddingX + 3 + (70 * barWidth)}
          y={svgHeight - 6}
          fontSize="11"
          fontWeight="bold"
          fontFamily="monospace"
          fill="#1e293b"
          textAnchor="middle"
          letterSpacing={barWidth * 3}
        >
          {rightDigits}
        </text>
      </svg>
    </div>
  );
}

export function getEan13SvgString(code: string, width = 180, height = 90): string {
  let sanitized = code.replace(/\D/g, '');
  if (sanitized.length < 13) {
    sanitized = sanitized.padEnd(12, '0');
    sanitized += calculateEAN13CheckDigit(sanitized);
  } else if (sanitized.length > 13) {
    sanitized = sanitized.substring(0, 13);
  }

  const firstDigit = parseInt(sanitized[0], 10);
  const leftDigits = sanitized.substring(1, 7);
  const rightDigits = sanitized.substring(7, 13);

  const pattern = PARITY_PATTERNS[firstDigit] || 'LLLLLL';
  const modules: { bit: number; isGuard: boolean }[] = [];

  // Left Guard (101)
  modules.push({ bit: 1, isGuard: true });
  modules.push({ bit: 0, isGuard: true });
  modules.push({ bit: 1, isGuard: true });

  for (let i = 0; i < 6; i++) {
    const digit = parseInt(leftDigits[i], 10);
    const type = pattern[i];
    const bitsStr = type === 'L' ? L_CODE[digit] : G_CODE[digit];
    for (let b = 0; b < 7; b++) {
      modules.push({ bit: parseInt(bitsStr[b], 10), isGuard: false });
    }
  }

  // Center Guard (01010)
  modules.push({ bit: 0, isGuard: true });
  modules.push({ bit: 1, isGuard: true });
  modules.push({ bit: 0, isGuard: true });
  modules.push({ bit: 1, isGuard: true });
  modules.push({ bit: 0, isGuard: true });

  for (let i = 0; i < 6; i++) {
    const digit = parseInt(rightDigits[i], 10);
    const bitsStr = R_CODE[digit];
    for (let b = 0; b < 7; b++) {
      modules.push({ bit: parseInt(bitsStr[b], 10), isGuard: false });
    }
  }

  // Right Guard (101)
  modules.push({ bit: 1, isGuard: true });
  modules.push({ bit: 0, isGuard: true });
  modules.push({ bit: 1, isGuard: true });

  const totalModules = modules.length;
  const paddingX = 14;
  const barWidth = (width - paddingX * 2) / totalModules;
  const svgHeight = height;
  const normalBarHeight = svgHeight * 0.65;
  const guardBarHeight = svgHeight * 0.77;

  let rectsHtml = '';
  modules.forEach((m, idx) => {
    if (m.bit === 0) return;
    const x = paddingX + idx * barWidth;
    const barH = m.isGuard ? guardBarHeight : normalBarHeight;
    rectsHtml += `<rect x="${x}" y="5" width="${barWidth + 0.1}" height="${barH}" fill="#000000" />`;
  });

  return `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible;">
      ${rectsHtml}
      <text x="${paddingX - 8}" y="${svgHeight - 6}" font-size="11" font-weight="bold" font-family="monospace" fill="#1e293b" text-anchor="middle">${sanitized[0]}</text>
      <text x="${paddingX + 3 + (21 * barWidth)}" y="${svgHeight - 6}" font-size="11" font-weight="bold" font-family="monospace" fill="#1e293b" text-anchor="middle" letter-spacing="${barWidth * 3}">${leftDigits}</text>
      <text x="${paddingX + 3 + (70 * barWidth)}" y="${svgHeight - 6}" font-size="11" font-weight="bold" font-family="monospace" fill="#1e293b" text-anchor="middle" letter-spacing="${barWidth * 3}">${rightDigits}</text>
    </svg>
  `;
}
