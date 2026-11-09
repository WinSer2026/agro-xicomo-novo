import React, { useState, useEffect, useRef } from 'react';
import { dbService } from '../utils/firebaseDB';
import { Product, Employee, Sale, Customer } from '../types';

export interface GlobalSearchResult {
  id: string;
  category: 'produtos' | 'rh' | 'vendas' | 'faturas' | 'clientes' | 'modulos';
  title: string;
  subtitle: string;
  badge: string;
  badgeColor: string;
  detail: string;
  targetModule: 'vendas' | 'faturas' | 'stock' | 'rh' | 'financas' | 'tecnico';
  data?: any;
}

interface InlineHeaderSearchProps {
  onNavigateModule: (module: 'vendas' | 'faturas' | 'stock' | 'rh' | 'financas' | 'tecnico', extraData?: any) => void;
  /**
   * L-06: a pesquisa global mostrava o salário de qualquer trabalhador a
   * qualquer utilizador. Os dados de RH (e a linha de salário) só aparecem a
   * quem tem permissão.
   */
  canSeeRestrictedData?: boolean;
}

export const InlineHeaderSearch: React.FC<InlineHeaderSearchProps> = ({ onNavigateModule, canSeeRestrictedData = false }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [allEmployees, setAllEmployees] = useState<Employee[]>([]);
  const [allSales, setAllSales] = useState<Sale[]>([]);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load data when component mounts or when opened
  useEffect(() => {
    if (isOpen) {
      loadSystemData();
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [isOpen]);

  const loadSystemData = async () => {
    setLoading(true);
    try {
      const [prods, emps, sales, custs] = await Promise.all([
        dbService.getProducts(),
        dbService.getEmployees(),
        dbService.getSales(),
        dbService.getCustomers()
      ]);
      setAllProducts(prods || []);
      setAllEmployees(emps || []);
      setAllSales(sales || []);
      setAllCustomers(custs || []);
    } catch (err) {
      console.error('Erro ao carregar dados para pesquisa:', err);
    } finally {
      setLoading(false);
    }
  };

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Keyboard shortcut Ctrl+K
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsOpen(prev => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Filter items
  useEffect(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    const matches: GlobalSearchResult[] = [];

    // Modules matching
    const modules = [
      { name: 'Ponto de Venda (PDV)', code: 'vendas', mod: 'vendas' as const, badge: 'Módulo PDV', color: 'bg-emerald-100 text-emerald-800' },
      { name: 'Faturação e Gestão de Vendas', code: 'faturas', mod: 'faturas' as const, badge: 'Faturação', color: 'bg-indigo-100 text-indigo-800' },
      { name: 'Gestão de Stock e Artigos', code: 'stock', mod: 'stock' as const, badge: 'Stock', color: 'bg-blue-100 text-blue-800' },
      { name: 'Recursos Humanos e Processamento de Salários (RH)', code: 'rh', mod: 'rh' as const, badge: 'Recursos Humanos', color: 'bg-purple-100 text-purple-800' },
      { name: 'Gestão Financeira e Contabilidade', code: 'financas', mod: 'financas' as const, badge: 'Finanças', color: 'bg-amber-100 text-amber-800' },
      { name: 'Suporte Técnico e Definições do Sistema', code: 'tecnico', mod: 'tecnico' as const, badge: 'Suporte Técnico', color: 'bg-slate-100 text-slate-800' },
    ];

    modules.forEach(m => {
      if (m.name.toLowerCase().includes(q) || m.code.includes(q)) {
        matches.push({
          id: `mod-${m.code}`,
          category: 'modulos',
          title: m.name,
          subtitle: `Navegar diretamente para o módulo de ${m.name}`,
          badge: m.badge,
          badgeColor: m.color,
          detail: 'Acesso Rápido',
          targetModule: m.mod
        });
      }
    });

    // 1. Produtos
    allProducts.forEach(p => {
      const matchName = p.name.toLowerCase().includes(q);
      const matchCode = (p.code || '').toLowerCase().includes(q);
      const matchCat = (p.category || '').toLowerCase().includes(q);

      if (matchName || matchCode || matchCat) {
        matches.push({
          id: `prod-${p.id}`,
          category: 'produtos',
          title: p.name,
          subtitle: `Cód: ${p.code || 'N/A'} • Categoria: ${p.category || 'Geral'}`,
          badge: p.isService ? 'Serviço' : `${p.stockQty} ${p.baseUnit}`,
          badgeColor: p.isService ? 'bg-indigo-100 text-indigo-700' : (p.stockQty > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-red-100 text-red-700'),
          detail: `${p.sellingPrice.toLocaleString('pt-MZ')} MT`,
          targetModule: 'stock',
          data: p
        });
      }
    });

    // 2. Trabalhadores RH (apenas para perfis autorizados)
    if (canSeeRestrictedData) allEmployees.forEach(e => {
      const matchName = e.name.toLowerCase().includes(q);
      const matchINSS = (e.inssNumber || '').toLowerCase().includes(q);
      const matchNuit = (e.nuit || '').toLowerCase().includes(q);

      if (matchName || matchINSS || matchNuit) {
        matches.push({
          id: `emp-${e.id}`,
          category: 'rh',
          title: e.name,
          subtitle: `INSS: ${e.inssNumber || 'N/A'} • NUIT: ${e.nuit || 'N/A'}`,
          badge: 'Trabalhador RH',
          badgeColor: 'bg-purple-100 text-purple-800',
          detail: canSeeRestrictedData
            ? `Salário: ${Number(e.baseSalary || 0).toLocaleString('pt-MZ')} MT`
            : 'Dados salariais restritos',
          targetModule: 'rh',
          data: e
        });
      }
    });

    // 3. Vendas / Faturas
    allSales.forEach(s => {
      const matchId = (s.id || '').toLowerCase().includes(q);
      const matchCustomer = (s.customerName || '').toLowerCase().includes(q);
      const matchInv = (s.invoiceNumber || '').toLowerCase().includes(q);
      const matchRec = (s.receiptNumber || s.manualReceiptReference || '').toLowerCase().includes(q);

      if (matchId || matchCustomer || matchInv || matchRec) {
        matches.push({
          id: `sale-${s.id}`,
          category: 'vendas',
          title: s.invoiceNumber ? `Fatura Nº ${s.invoiceNumber}` : `Venda ID: ${s.id}`,
          subtitle: `Cliente: ${s.customerName || 'Consumidor Final'} • Data: ${new Date(s.date).toLocaleDateString('pt-MZ')}`,
          badge: s.manualReceiptReference ? 'Venda Antiga / Retroactiva' : 'Venda Direta',
          badgeColor: s.manualReceiptReference ? 'bg-amber-100 text-amber-800' : 'bg-blue-100 text-blue-800',
          detail: `Total: ${s.total.toLocaleString('pt-MZ')} MT`,
          targetModule: 'faturas',
          data: s
        });
      }
    });

    // 4. Clientes
    allCustomers.forEach(c => {
      const matchName = c.name.toLowerCase().includes(q);
      const matchNuit = (c.nuit || '').toLowerCase().includes(q);

      if (matchName || matchNuit) {
        matches.push({
          id: `cust-${c.id}`,
          category: 'clientes',
          title: c.name,
          subtitle: `NUIT: ${c.nuit || 'S/N'} • Endereço: ${c.address || 'N/A'}`,
          badge: 'Cliente',
          badgeColor: 'bg-teal-100 text-teal-800',
          detail: 'Cliente Cadastrado',
          targetModule: 'faturas',
          data: c
        });
      }
    });

    setResults(matches);
    setSelectedIndex(0);
  }, [searchTerm, allProducts, allEmployees, allSales, allCustomers]);

  const selectResult = (res: GlobalSearchResult) => {
    onNavigateModule(res.targetModule, res.data);
    setIsOpen(false);
    setSearchTerm('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex(prev => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex(prev => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (results[selectedIndex]) {
        selectResult(results[selectedIndex]);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setIsOpen(false);
    }
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="p-2 rounded-xl text-slate-600 hover:text-emerald-700 hover:bg-slate-100 border border-slate-200/80 transition-all flex items-center justify-center cursor-pointer shadow-2xs group"
          title="Pesquisa Rápida Inline (Ctrl+K)"
        >
          <span className="material-symbols-outlined text-[20px] text-emerald-600 group-hover:scale-110 transition-transform">
            search
          </span>
        </button>
      ) : (
        <div className="flex items-center gap-2 bg-white border-2 border-emerald-500 rounded-xl px-3 py-1.5 shadow-md w-72 sm:w-80 md:w-96 transition-all">
          <span className="material-symbols-outlined text-emerald-600 text-[18px]">search</span>
          <input
            ref={inputRef}
            type="text"
            placeholder="Pesquisar produto, cliente, funcionário..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full text-xs font-semibold text-slate-800 focus:outline-none bg-transparent"
          />
          {searchTerm && (
            <button
              type="button"
              onClick={() => setSearchTerm('')}
              className="text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              <span className="material-symbols-outlined text-[16px]">cancel</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => { setIsOpen(false); setSearchTerm(''); }}
            className="text-slate-400 hover:text-slate-600 p-0.5 rounded cursor-pointer"
            title="Fechar pesquisa"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      )}

      {/* Floating Popover Dropdown (No full page modal / window extra) */}
      {isOpen && searchTerm.trim() !== '' && (
        <div className="absolute right-0 sm:left-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden z-50 animate-in fade-in slide-in-from-top-1 duration-150">
          <div className="p-2.5 bg-slate-50 border-b border-slate-100 flex justify-between items-center text-[10px] text-slate-500 font-bold uppercase tracking-wider">
            <span>Resultados da Pesquisa ({results.length})</span>
            <span>Use ↑↓ para navegar</span>
          </div>

          <div className="max-h-80 overflow-y-auto divide-y divide-slate-100 custom-scrollbar">
            {loading ? (
              <div className="p-4 text-center text-xs text-slate-400 font-medium">A pesquisar no sistema...</div>
            ) : results.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-400 font-medium">
                Nenhum resultado encontrado para "{searchTerm}"
              </div>
            ) : (
              results.map((res, idx) => (
                <div
                  key={res.id}
                  onClick={() => selectResult(res)}
                  className={`p-3 transition-colors flex items-center justify-between cursor-pointer ${
                    idx === selectedIndex ? 'bg-emerald-50/80 border-l-4 border-emerald-600' : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="space-y-0.5 min-w-0 pr-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-[9px] font-black uppercase px-2 py-0.5 rounded-full ${res.badgeColor}`}>
                        {res.badge}
                      </span>
                      <p className="font-bold text-xs text-slate-900 truncate">{res.title}</p>
                    </div>
                    <p className="text-[11px] text-slate-500 font-medium truncate">{res.subtitle}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className="text-[11px] font-mono font-bold text-emerald-800 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100">
                      {res.detail}
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
