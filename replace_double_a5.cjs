const fs = require('fs');
const filePath = 'src/components/PDVModule.tsx';
let lines = fs.readFileSync(filePath, 'utf8').split('\n');

// Let's print out the lines with numbers to inspect first or just perform direct replacement by index
// Wait! Let's find index where the line has 'Maputo, Moçambique • NUIT: 102938475'
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('Maputo, Moçambique • NUIT: 102938475')) {
    // Replace lines i-1, i, i+1, i+2
    // line i-1 is the <p> tag, i is Maputo, i+1 is Email/Cel, i+2 is </p>
    lines[i-1] = `                        <div className="text-[8px] text-gray-500 space-y-0.5">`;
    lines[i] = `                          <p>Maputo, Moçambique • NUIT: {settings?.companyNuit || '102938475'}</p>`;
    lines[i+1] = `                          {settings?.email && <p><strong>Email:</strong> {settings.email}</p>}
                          <p><strong>Vodacom:</strong> {[settings?.vodacom1, settings?.vodacom2, settings?.vodacom3].filter(Boolean).join(' / ') || '+258 84 123 4567'}</p>
                          <p><strong>Movitel:</strong> {[settings?.movitel1, settings?.movitel2, settings?.movitel3].filter(Boolean).join(' / ') || '+258 86 123 4567'}</p>
                          {(settings?.fixo1 || settings?.fixo2) && <p><strong>Fixo:</strong> {[settings.fixo1, settings.fixo2].filter(Boolean).join(' / ')}</p>}`;
    lines[i+2] = `                        </div>`;
  }
}

// Let's find index where the line has '"Esta fatura tem validade até à reposição de stock"'
// and the line after it has 'TOTAL:'
for (let i = 0; i < lines.length - 1; i++) {
  if (lines[i].includes('"Esta fatura tem validade até à reposição de stock"') && lines[i+1].includes('TOTAL:')) {
    // Replace lines i-1, i, i+1, i+2 which is the div container
    // Let's see: lines[i-1] has '<div className="flex justify-between items-center pt-2 border-t border-gray-100">'
    // lines[i] has span with "Esta fatura..."
    // lines[i+1] has TOTAL
    // lines[i+2] has </div>
    lines[i] = `                      <div className="flex flex-col text-[8px] text-gray-500">
                        <span className="font-bold italic">"Esta fatura tem validade até à reposição de stock"</span>
                        <span className="mt-0.5">Forma de Pagamento: <strong className="uppercase text-emerald-700 font-black">{invoiceToPrint.paymentMethod || 'Dinheiro'}</strong></span>
                      </div>`;
  }
}

fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
console.log('Line-by-line replacement finished successfully!');
