import React, { useState, useEffect } from 'react';
import { dbService } from '../utils/firebaseDB';
import { Sale, Product, Employee, Attendance, SystemSettings, AppRole } from '../types';
import { getUserRoles } from '../utils/roleHelper';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip } from 'recharts';

interface DashboardModuleProps {
  currentUser: {
    username: string;
    role: string;
    roles?: AppRole[];
  };
  onNavigate: (module: 'vendas' | 'stock' | 'rh' | 'financas' | 'tecnico') => void;
}

export default function DashboardModule({ currentUser, onNavigate }: DashboardModuleProps) {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadDashboardData();

    const handleDbUpdate = (e: any) => {
      const updatedTable = e.detail?.table;
      if (
        !updatedTable ||
        updatedTable === 'all' ||
        updatedTable === 'sales' ||
        updatedTable === 'products' ||
        updatedTable === 'employees' ||
        updatedTable === 'attendance' ||
        updatedTable === 'settings'
      ) {
        loadDashboardData();
      }
    };
    window.addEventListener('db-update', handleDbUpdate);
    return () => window.removeEventListener('db-update', handleDbUpdate);
  }, []);

  const loadDashboardData = async () => {
    setLoading(true);
    await dbService.init();
    // Dashboard charts and stock alerts are complete-dataset metrics.
    await dbService.enableLiveCatalogAndSalesSync();
    
    const [salesList, prodsList, empsList, attList, sysSettings] = await Promise.all([
      dbService.getSales(),
      dbService.getProducts(),
      dbService.getEmployees(),
      dbService.getAttendance(),
      dbService.getSettings()
    ]);

    setSales(salesList);
    setProducts(prodsList);
    setEmployees(empsList);
    setAttendance(attList);
    setSettings(sysSettings);
    setLoading(false);
  };

  // Roles verification
  const userRoles = getUserRoles(currentUser);
  const isTech = userRoles.includes('Técnico');
  const isGestorGeral = userRoles.includes('Gestor Geral');
  const isOperador = userRoles.includes('Operador');
  const isStockManager = userRoles.includes('Gestor de Stock');
  const isHRManager = userRoles.includes('Gestor de RH');
  const isFinance = userRoles.includes('Contabilista');

  // Permission checks
  const canSeeSales = isTech || isGestorGeral || isFinance || isOperador;
  const canSeeStock = isTech || isGestorGeral || isStockManager;
  const canSeeHR = isTech || isGestorGeral || isHRManager;

  // Calculators
  const todayStr = new Date().toISOString().split('T')[0];
  
  // Today's Sales
  const todaySales = sales.filter(s => s.date.startsWith(todayStr));
  const todaySalesTotal = todaySales.reduce((sum, s) => sum + s.total, 0);
  const todaySalesCount = todaySales.length;

  // Critical Stock level products (Qty <= 10)
  const criticalProducts = products.filter(p => !p.isService && p.stockQty <= 10);
  const criticalStockCount = criticalProducts.length;

  // HR metrics
  const activeEmployeesCount = employees.length;
  const todayPresentEmployees = attendance.filter(a => a.date === todayStr && !a.absent).length;

  // Chart data: sales of the last 7 days
  const getChartData = () => {
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const daySales = sales.filter(s => s.date.startsWith(dateStr));
      const total = daySales.reduce((sum, s) => sum + s.total, 0);
      
      days.push({
        name: d.toLocaleDateString('pt-MZ', { weekday: 'short' }),
        value: total
      });
    }
    return days;
  };

  if (loading) {
    return (
      <div className="h-64 flex items-center justify-center">
        <div className="flex flex-col items-center gap-2">
          <div className="w-8 h-8 rounded-full border-4 border-slate-100 border-t-primary animate-spin"></div>
          <p className="text-xs text-gray-500 font-semibold uppercase tracking-wider">A carregar painel inicial...</p>
        </div>
      </div>
    );
  }

  const companyName = settings?.companyName || 'AgroGestão Zero';

  return (
    <div className="space-y-6 animate-fade-in" id="dashboard_module">
      
      {/* Welcome Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-emerald-950 p-6 rounded-xl border border-slate-800 text-white flex flex-col md:flex-row justify-between items-start md:items-center gap-4 shadow-md">
        <div className="space-y-1">
          <div className="flex items-center gap-2.5">
            {settings?.logoUrl ? (
              <img src={settings.logoUrl} alt="Logo" className="w-8 h-8 object-contain bg-white rounded p-0.5" />
            ) : (
              <span className="material-symbols-outlined text-emerald-400 text-2xl">eco</span>
            )}
            <h2 className="text-lg font-black tracking-tight">{companyName}</h2>
          </div>
          <p className="text-slate-300 text-xs">
            Olá, <span className="text-emerald-400 font-bold">{currentUser.username}</span>. Tem acesso ao painel como <span className="bg-emerald-500/10 text-emerald-400 px-2 py-0.5 rounded text-[10px] uppercase font-black border border-emerald-500/20">{currentUser.role}</span>.
          </p>
        </div>
        <div className="text-xs text-right text-slate-400 font-mono">
          <div>Hora do Sistema (Local)</div>
          <div className="text-white font-bold text-sm mt-0.5">{new Date().toLocaleDateString('pt-MZ')}</div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        
        {/* Card: Daily Sales */}
        {canSeeSales ? (
          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm flex items-center justify-between hover:border-emerald-200 transition-colors">
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Vendas de Hoje</span>
              <p className="text-lg font-black text-slate-800">{todaySalesTotal.toLocaleString('pt-MZ', { style: 'currency', currency: 'AOA' }).replace('AOA', 'MT')} </p>
              <p className="text-[10px] text-gray-500 font-semibold">{todaySalesCount} transações registadas</p>
            </div>
            <div className="w-10 h-10 bg-emerald-50 text-emerald-600 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">payments</span>
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 p-5 border border-dashed border-gray-200 rounded-xl flex items-center justify-between opacity-60">
            <span className="text-[10px] font-black uppercase text-gray-400">Vendas Ocultas</span>
            <span className="material-symbols-outlined text-gray-400">visibility_off</span>
          </div>
        )}

        {/* Card: Critical Stock */}
        {canSeeStock ? (
          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm flex items-center justify-between hover:border-red-200 transition-colors">
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Ruptura de Stock</span>
              <p className={`text-lg font-black ${criticalStockCount > 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {criticalStockCount} {criticalStockCount === 1 ? 'Produto' : 'Produtos'}
              </p>
              <p className="text-[10px] text-gray-500 font-semibold">Qtd. igual ou inferior a 10 un.</p>
            </div>
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${criticalStockCount > 0 ? 'bg-red-50 text-red-600 animate-pulse' : 'bg-gray-50 text-gray-600'}`}>
              <span className="material-symbols-outlined text-xl">warning</span>
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 p-5 border border-dashed border-gray-200 rounded-xl flex items-center justify-between opacity-60">
            <span className="text-[10px] font-black uppercase text-gray-400">Stock Oculto</span>
            <span className="material-symbols-outlined text-gray-400">visibility_off</span>
          </div>
        )}

        {/* Card: Active Employees */}
        {canSeeHR ? (
          <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm flex items-center justify-between hover:border-blue-200 transition-colors">
            <div className="space-y-1">
              <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Funcionários Ativos</span>
              <p className="text-lg font-black text-slate-800">{activeEmployeesCount} Registados</p>
              <p className="text-[10px] text-gray-500 font-semibold">{todayPresentEmployees} presentes hoje</p>
            </div>
            <div className="w-10 h-10 bg-blue-50 text-blue-600 rounded-lg flex items-center justify-center">
              <span className="material-symbols-outlined text-xl">badge</span>
            </div>
          </div>
        ) : (
          <div className="bg-gray-50 p-5 border border-dashed border-gray-200 rounded-xl flex items-center justify-between opacity-60">
            <span className="text-[10px] font-black uppercase text-gray-400">RH Oculto</span>
            <span className="material-symbols-outlined text-gray-400">visibility_off</span>
          </div>
        )}

        {/* Card: System Mode */}
        <div className="bg-white p-5 border border-gray-200 rounded-xl shadow-sm flex items-center justify-between">
          <div className="space-y-1">
            <span className="text-[10px] font-black uppercase text-gray-400 tracking-wider">Sincronização Cloud (Nuvem)</span>
            <p className="text-lg font-black text-slate-800">Modo {settings?.mode || 'Online'}</p>
            <p className="text-[10px] text-emerald-600 font-bold flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block animate-ping"></span>
              Base de Dados Ativa
            </p>
          </div>
          <div className="w-10 h-10 bg-slate-50 text-slate-600 rounded-lg flex items-center justify-center">
            <span className="material-symbols-outlined text-xl">database</span>
          </div>
        </div>

      </div>

      {/* Main Content Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left Section: Sales Chart or Alerts */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Sales chart (for users with sales access) */}
          {canSeeSales && (
            <div className="bg-white p-6 border border-gray-200 rounded-xl shadow-sm space-y-4">
              <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                <div>
                  <h3 className="text-xs font-black uppercase text-gray-700">Fluxo de Faturação de Vendas</h3>
                  <p className="text-[10px] text-gray-400">Histórico de vendas faturadas dos últimos 7 dias comerciais</p>
                </div>
                <span className="bg-emerald-50 text-emerald-800 px-2 py-0.5 rounded font-black text-[9px] uppercase">Gráfico de Linha</span>
              </div>
              <div className="h-64 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={getChartData()} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.2}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="name" stroke="#94a3b8" fontSize={10} tickLine={false} />
                    <YAxis stroke="#94a3b8" fontSize={10} tickLine={false} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#1e293b', borderRadius: '8px', border: 'none', color: '#fff', fontSize: '11px' }}
                      formatter={(val: any) => [`${val.toLocaleString('pt-MZ')} MT`, 'Faturação']}
                    />
                    <Area type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorSales)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Low Stock Listing (Only for authorized stock controllers) */}
          {canSeeStock && (
            <div className="bg-white p-6 border border-gray-200 rounded-xl shadow-sm space-y-4">
              <div className="flex justify-between items-center pb-2 border-b border-gray-100">
                <div>
                  <h3 className="text-xs font-black uppercase text-red-600">Alerta de Níveis Críticos de Stock</h3>
                  <p className="text-[10px] text-gray-400">Produtos jardinagem ou agrícolas que exigem reabastecimento imediato</p>
                </div>
                <button 
                  onClick={() => onNavigate('stock')}
                  className="text-primary hover:underline text-[10px] font-bold uppercase"
                >
                  Gerir Stock →
                </button>
              </div>
              
              {criticalProducts.length === 0 ? (
                <div className="py-8 text-center text-gray-400 font-semibold text-xs flex flex-col items-center gap-1.5">
                  <span className="material-symbols-outlined text-green-500 text-3xl">check_circle</span>
                  <span>Todos os níveis de stock estão adequados e seguros!</span>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-100 text-gray-500 font-bold">
                        <th className="p-2.5">Código</th>
                        <th className="p-2.5">Produto</th>
                        <th className="p-2.5">Categoria</th>
                        <th className="p-2.5 text-right">Qtd. em Stock</th>
                        <th className="p-2.5 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {criticalProducts.slice(0, 5).map(p => (
                        <tr key={p.id} className="hover:bg-red-50/20">
                          <td className="p-2.5 font-mono text-gray-500">{p.code}</td>
                          <td className="p-2.5 font-bold text-slate-800">{p.name}</td>
                          <td className="p-2.5 text-gray-500">{p.category}</td>
                          <td className="p-2.5 text-right font-bold text-red-600">{p.stockQty} {p.baseUnit}</td>
                          <td className="p-2.5 text-center">
                            <span className="bg-red-100 text-red-800 px-2 py-0.5 rounded font-black text-[9px] uppercase">Ruptura</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>

        {/* Right Section: Shortcuts & Quick Actions */}
        <div className="space-y-6">
          
          {/* Quick Shortcuts */}
          <div className="bg-white p-6 border border-gray-200 rounded-xl shadow-sm space-y-4">
            <div>
              <h3 className="text-xs font-black uppercase text-gray-700 border-b border-gray-100 pb-2">Atalhos de Acesso Rápido</h3>
              <p className="text-[10px] text-gray-400 leading-normal mt-1">Navegação ágil para os módulos que possui credenciais de acesso</p>
            </div>

            <div className="grid grid-cols-1 gap-2">
              
              {(isTech || isGestorGeral || isOperador) && (
                <button
                  onClick={() => onNavigate('vendas')}
                  className="w-full p-3 bg-slate-50 hover:bg-emerald-50 rounded-lg text-left border border-gray-100 flex items-center justify-between transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-slate-500 group-hover:text-emerald-600 text-lg">shopping_cart</span>
                    <div>
                      <span className="text-xs font-bold text-slate-800">Ponto de Venda (PDV)</span>
                      <p className="text-[9px] text-gray-400">Operar caixa, efetuar faturas e recibos rápidos</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-gray-400 group-hover:text-emerald-600 text-[14px]">arrow_forward</span>
                </button>
              )}

              {(isTech || isGestorGeral || isStockManager) && (
                <button
                  onClick={() => onNavigate('stock')}
                  className="w-full p-3 bg-slate-50 hover:bg-emerald-50 rounded-lg text-left border border-gray-100 flex items-center justify-between transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-slate-500 group-hover:text-emerald-600 text-lg">inventory</span>
                    <div>
                      <span className="text-xs font-bold text-slate-800">Stock & Inventário</span>
                      <p className="text-[9px] text-gray-400">Fazer entradas de stock e registar perdas</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-gray-400 group-hover:text-emerald-600 text-[14px]">arrow_forward</span>
                </button>
              )}

              {(isTech || isGestorGeral || isHRManager) && (
                <button
                  onClick={() => onNavigate('rh')}
                  className="w-full p-3 bg-slate-50 hover:bg-emerald-50 rounded-lg text-left border border-gray-100 flex items-center justify-between transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-slate-500 group-hover:text-emerald-600 text-lg">badge</span>
                    <div>
                      <span className="text-xs font-bold text-slate-800">Recursos Humanos (RH)</span>
                      <p className="text-[9px] text-gray-400">Processar folhas de salário e marcar faltas</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-gray-400 group-hover:text-emerald-600 text-[14px]">arrow_forward</span>
                </button>
              )}

              {(isTech || isGestorGeral || isFinance) && (
                <button
                  onClick={() => onNavigate('financas')}
                  className="w-full p-3 bg-slate-50 hover:bg-emerald-50 rounded-lg text-left border border-gray-100 flex items-center justify-between transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-slate-500 group-hover:text-emerald-600 text-lg">bar_chart</span>
                    <div>
                      <span className="text-xs font-bold text-slate-800">Contabilidade & Finanças</span>
                      <p className="text-[9px] text-gray-400">Ver balancetes, relatórios e auditoria</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-gray-400 group-hover:text-emerald-600 text-[14px]">arrow_forward</span>
                </button>
              )}

              {isTech && (
                <button
                  onClick={() => onNavigate('tecnico')}
                  className="w-full p-3 bg-slate-50 hover:bg-emerald-50 rounded-lg text-left border border-gray-100 flex items-center justify-between transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <span className="material-symbols-outlined text-slate-500 group-hover:text-emerald-600 text-lg">shield_person</span>
                    <div>
                      <span className="text-xs font-bold text-slate-800">Painel do Técnico</span>
                      <p className="text-[9px] text-gray-400">Gerir utilizadores, marca e configurações de sistema</p>
                    </div>
                  </div>
                  <span className="material-symbols-outlined text-gray-400 group-hover:text-emerald-600 text-[14px]">arrow_forward</span>
                </button>
              )}

            </div>
          </div>

          {/* Quick Mozambican Tips */}
          <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 space-y-2">
            <span className="text-[9px] font-black uppercase text-emerald-800 tracking-wider flex items-center gap-1">
              <span className="material-symbols-outlined text-[12px]">info</span>
              Suporte Legal Moçambicano
            </span>
            <p className="text-[11px] text-emerald-950 leading-relaxed font-medium">
              Este sistema foi desenhado de acordo com a <strong>Lei do Trabalho de Moçambique</strong> para cálculos de IRPS, INSS e limites semanais de horas extras (44/48h).
            </p>
          </div>

        </div>

      </div>

    </div>
  );
}
