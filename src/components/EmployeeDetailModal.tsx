import { appConfirm } from '../utils/confirmDialog';
import React, { useState, useEffect, useRef } from 'react';
import { dbService } from '../utils/firebaseDB';
import { Employee, PerformanceRecord, ContractType } from '../types';

interface EmployeeDetailModalProps {
  employee: Employee;
  onClose: () => void;
  onSave: () => void;
  initialTab?: 'general' | 'performance' | 'compliance' | 'vacations';
}

export default function EmployeeDetailModal({ employee, onClose, onSave, initialTab = 'general' }: EmployeeDetailModalProps) {
  const [activeTab, setActiveTab] = useState<'general' | 'performance' | 'compliance' | 'vacations'>(initialTab);
  const [isExpanded, setIsExpanded] = useState(false);

  // Employee Form State
  const [name, setName] = useState(employee.name);
  const [contact, setContact] = useState(employee.contact || '');
  const [contractType, setContractType] = useState<ContractType>(employee.contractType);
  const [nuit, setNuit] = useState(employee.nuit);
  const [inssNumber, setInssNumber] = useState(employee.inssNumber);
  const [iban, setIban] = useState(employee.iban);
  const [isForeigner, setIsForeigner] = useState(employee.isForeigner);
  const [baseSalary, setBaseSalary] = useState(employee.baseSalary);
  const [hiredDate, setHiredDate] = useState(employee.hiredDate);
  const [gender, setGender] = useState<'Masculino' | 'Feminino'>(employee.gender);
  const [dependentsCount, setDependentsCount] = useState(employee.dependentsCount || 0);
  const [maritalStatus, setMaritalStatus] = useState<'Solteiro' | 'Casado' | 'Divorciado' | 'Viúvo'>(employee.maritalStatus || 'Solteiro');
  const [photoUrl, setPhotoUrl] = useState(employee.photoUrl || '');
  const [vacationStart, setVacationStart] = useState(employee.vacationStart || '');
  const [vacationEnd, setVacationEnd] = useState(employee.vacationEnd || '');

  // Performance Records state
  const [performanceHistory, setPerformanceHistory] = useState<PerformanceRecord[]>(employee.performanceHistory || []);

  // Performance Form State
  const [perfDate, setPerfDate] = useState(new Date().toISOString().split('T')[0]);
  const [perfEvaluator, setPerfEvaluator] = useState('');
  const [perfRating, setPerfRating] = useState<number>(4);
  const [perfFeedback, setPerfFeedback] = useState('');
  const [perfGoals, setPerfGoals] = useState('');
  const [showAddPerformance, setShowAddPerformance] = useState(false);

  // Camera State
  const [isCameraOpen, setIsCameraOpen] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Notification Toast State
  const [toastMsg, setToastMsg] = useState('');

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(''), 3000);
  };

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, []);

  // Watch for external employee changes
  useEffect(() => {
    setName(employee.name);
    setContact(employee.contact || '');
    setContractType(employee.contractType);
    setNuit(employee.nuit);
    setInssNumber(employee.inssNumber);
    setIban(employee.iban);
    setIsForeigner(employee.isForeigner);
    setBaseSalary(employee.baseSalary);
    setHiredDate(employee.hiredDate);
    setGender(employee.gender);
    setDependentsCount(employee.dependentsCount || 0);
    setMaritalStatus(employee.maritalStatus || 'Solteiro');
    setPhotoUrl(employee.photoUrl || '');
    setPerformanceHistory(employee.performanceHistory || []);
    setVacationStart(employee.vacationStart || '');
    setVacationEnd(employee.vacationEnd || '');
  }, [employee]);

  // Handle camera init
  const startCamera = async () => {
    setCameraError(null);
    setIsCameraOpen(true);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Navegador não suporta acesso à câmara.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 400, height: 400, facingMode: 'user' },
        audio: false
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch (err: any) {
      console.error('Erro ao aceder à câmara:', err);
      setCameraError(err.message || 'Sem permissões ou câmara ocupada.');
    }
  };

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    setIsCameraOpen(false);
  };

  const capturePhoto = () => {
    if (videoRef.current) {
      const video = videoRef.current;
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth || 400;
      canvas.height = video.videoHeight || 400;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg');
        setPhotoUrl(dataUrl);
        triggerToast('Foto capturada com sucesso!');
        stopCamera();
      }
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setPhotoUrl(reader.result as string);
        triggerToast('Foto carregada do ficheiro!');
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddPerformanceRecord = (e: React.FormEvent) => {
    e.preventDefault();
    if (!perfEvaluator.trim() || !perfFeedback.trim()) {
      triggerToast('Preencha o avaliador e o feedback de desempenho.');
      return;
    }

    const newRecord: PerformanceRecord = {
      id: 'perf-' + Date.now(),
      date: perfDate,
      evaluator: perfEvaluator.trim(),
      rating: perfRating,
      feedback: perfFeedback.trim(),
      goals: perfGoals.trim() || undefined
    };

    const updatedHistory = [newRecord, ...performanceHistory];
    setPerformanceHistory(updatedHistory);
    
    // Reset form
    setPerfEvaluator('');
    setPerfFeedback('');
    setPerfGoals('');
    setShowAddPerformance(false);
    triggerToast('Avaliação de desempenho adicionada!');
  };

  const handleDeletePerformanceRecord = async (id: string) => {
    if (await appConfirm('Deseja realmente eliminar este registo de avaliação?')) {
      const filtered = performanceHistory.filter(x => x.id !== id);
      setPerformanceHistory(filtered);
      triggerToast('Avaliação eliminada do histórico temporário.');
    }
  };

  const handleSaveAll = async () => {
    const nuitClean = nuit.replace(/\D/g, '');
    if (nuitClean.length !== 9) {
      triggerToast('O NUIT deve conter exatamente 9 dígitos.');
      return;
    }

    const updatedEmployee: Employee = {
      ...employee,
      name: name.trim(),
      contact: contact.trim() || undefined,
      contractType,
      nuit: nuitClean,
      inssNumber: inssNumber.trim(),
      iban: iban.trim(),
      isForeigner,
      baseSalary,
      hiredDate,
      gender,
      dependentsCount,
      maritalStatus,
      photoUrl,
      performanceHistory,
      vacationStart: vacationStart || undefined,
      vacationEnd: vacationEnd || undefined
    };

    try {
      await dbService.saveEmployee(updatedEmployee);
      triggerToast('Informações do funcionário guardadas com sucesso!');
      onSave();
      setTimeout(() => {
        onClose();
      }, 500);
    } catch (err) {
      console.error(err);
      triggerToast('Erro ao guardar alterações no IndexedDB.');
    }
  };

  const averageRating = performanceHistory.length > 0
    ? Math.round((performanceHistory.reduce((acc, curr) => acc + curr.rating, 0) / performanceHistory.length) * 10) / 10
    : 0;

  const getRatingLabel = (score: number) => {
    if (score >= 4.5) return 'Excelente';
    if (score >= 3.5) return 'Muito Bom';
    if (score >= 2.5) return 'Satisfatório';
    if (score >= 1.5) return 'Insuficiente';
    return 'Mau';
  };

  return (
    <div className="fixed inset-0 bg-slate-900/70 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-all animate-fade-in" id="employee_detail_modal">
      {/* Dynamic Toast inside Modal */}
      {toastMsg && (
        <div className="fixed top-6 left-1/2 transform -translate-x-1/2 z-50 bg-emerald-800 text-white font-bold text-xs px-4 py-2.5 rounded-full shadow-2xl flex items-center gap-2 border border-emerald-600">
          <span className="material-symbols-outlined text-sm">check_circle</span>
          {toastMsg}
        </div>
      )}

      {/* Expandable/Collapsible Content Panel */}
      <div className={`bg-white rounded-3xl shadow-2xl overflow-hidden border border-slate-200 transition-all duration-300 flex flex-col ${
        isExpanded ? 'max-w-7xl w-full h-[90vh]' : 'max-w-4xl w-full h-[80vh]'
      }`}>
        
        {/* Modal Header */}
        <div className="bg-slate-900 text-white p-6 flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-4">
            <div className="relative">
              {photoUrl ? (
                <img
                  src={photoUrl}
                  alt={name}
                  className="w-14 h-14 rounded-full object-cover border-2 border-emerald-500"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="w-14 h-14 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-slate-400">
                  <span className="material-symbols-outlined text-2xl">person</span>
                </div>
              )}
              {averageRating > 0 && (
                <div className="absolute -bottom-1 -right-1 bg-amber-500 text-slate-900 font-mono font-black text-[10px] w-6 h-6 rounded-full flex items-center justify-center border-2 border-slate-900" title={`Média de Desempenho: ${averageRating}`}>
                  {averageRating}
                </div>
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-black tracking-tight">{name || 'Novo Funcionário'}</h2>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md ${
                  isForeigner ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                }`}>
                  {isForeigner ? 'Estrangeiro' : 'Nacional'}
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">REF: {employee.id} • NUIT: {nuitCleanUp(nuit)}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Toggle Expand View Button */}
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-2 bg-slate-800 hover:bg-slate-700 rounded-xl text-slate-400 hover:text-white transition-all"
              title={isExpanded ? 'Ver em tamanho padrão' : 'Maximizar ecrã'}
            >
              <span className="material-symbols-outlined text-lg">
                {isExpanded ? 'fullscreen_exit' : 'fullscreen'}
              </span>
            </button>
            <button
              onClick={onClose}
              className="p-2 bg-slate-800 hover:bg-rose-950 hover:text-rose-400 rounded-xl text-slate-400 transition-all"
              title="Fechar Janela"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          </div>
        </div>

        {/* Modal Sub-navigation Bar */}
        <div className="bg-slate-50 border-b border-slate-200 px-6 py-2 flex items-center justify-between flex-wrap gap-2">
          <div className="flex items-center gap-1">
            <button
              onClick={() => setActiveTab('general')}
              className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-lg flex items-center gap-1.5 transition-all ${
                activeTab === 'general'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span className="material-symbols-outlined text-sm">badge</span>
              Ficha & Foto
            </button>
            <button
              onClick={() => setActiveTab('performance')}
              className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-lg flex items-center gap-1.5 transition-all ${
                activeTab === 'performance'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span className="material-symbols-outlined text-sm">trending_up</span>
              Desempenho ({performanceHistory.length})
            </button>
            <button
              onClick={() => setActiveTab('compliance')}
              className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-lg flex items-center gap-1.5 transition-all ${
                activeTab === 'compliance'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span className="material-symbols-outlined text-sm">gavel</span>
              Legal & Contabilidade
            </button>
            <button
              onClick={() => setActiveTab('vacations')}
              className={`px-4 py-2 text-xs font-black uppercase tracking-wider rounded-lg flex items-center gap-1.5 transition-all ${
                activeTab === 'vacations'
                  ? 'bg-emerald-600 text-white'
                  : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              <span className="material-symbols-outlined text-sm">beach_access</span>
              Férias
            </button>
          </div>

          <div className="text-[10px] text-slate-400 font-bold uppercase">
            Lei de Trabalho Moçambicana (Lei 13/2023)
          </div>
        </div>

        {/* Modal Main Content Container */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50/50">
          
          {/* TAB 1: GENERAL INFO & CAMERA CAPTURE */}
          {activeTab === 'general' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Left Form (Detailed Details) */}
              <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-emerald-600">person</span>
                  Dados de Identificação
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Nome Completo *</label>
                    <input
                      type="text"
                      required
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Contacto Telefónico / Email</label>
                    <input
                      type="text"
                      value={contact}
                      onChange={(e) => setContact(e.target.value)}
                      placeholder="Ex: +258 84 123 4567"
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Género *</label>
                    <select
                      value={gender}
                      onChange={(e) => setGender(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="Masculino">Masculino</option>
                      <option value="Feminino">Feminino</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Estado Civil *</label>
                    <select
                      value={maritalStatus}
                      onChange={(e) => setMaritalStatus(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="Solteiro">Solteiro/a</option>
                      <option value="Casado">Casado/a</option>
                      <option value="Divorciado">Divorciado/a</option>
                      <option value="Viúvo">Viúvo/a</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Agregado Familiar (Nº de Dependentes) *</label>
                    <input
                      type="number"
                      min={0}
                      max={15}
                      value={dependentsCount}
                      onChange={(e) => setDependentsCount(Number(e.target.value))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
                      title="Utilizado para dedução de tabelas IRPS moçambicanas"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Data de Admissão *</label>
                    <input
                      type="date"
                      value={hiredDate}
                      onChange={(e) => setHiredDate(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="pt-2">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-start gap-3">
                    <span className="material-symbols-outlined text-slate-500">info</span>
                    <div className="text-[11px] text-slate-500 leading-relaxed">
                      <strong>Nota Legal:</strong> A contagem de dependentes do trabalhador afecta diretamente a retenção na fonte do <strong>IRPS (Imposto sobre o Rendimento de Pessoas Singulares)</strong> em Moçambique, conforme as tabelas oficiais atualizadas.
                    </div>
                  </div>
                </div>
              </div>

              {/* Right Form (Profile Picture & Live Camera Capture) */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* Photo Viewer Container */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col items-center justify-center text-center space-y-4">
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider self-start border-b border-slate-100 pb-2 w-full flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">photo_camera</span>
                    Fotografia de Perfil
                  </h3>

                  <div className="relative group">
                    {photoUrl ? (
                      <div className="relative">
                        <img
                          src={photoUrl}
                          alt="Previsualização"
                          className="w-40 h-40 rounded-2xl object-cover border-4 border-slate-100 shadow-md"
                          referrerPolicy="no-referrer"
                        />
                        <button
                          onClick={async () => {
                            if (await appConfirm('Remover esta fotografia?')) setPhotoUrl('');
                          }}
                          className="absolute -top-2 -right-2 bg-red-600 hover:bg-red-700 text-white rounded-full p-1.5 shadow-lg transition-all"
                          title="Remover foto"
                        >
                          <span className="material-symbols-outlined text-xs">close</span>
                        </button>
                      </div>
                    ) : (
                      <div className="w-40 h-40 rounded-2xl bg-slate-100 border-2 border-dashed border-slate-300 flex flex-col items-center justify-center text-slate-400 p-4">
                        <span className="material-symbols-outlined text-4xl mb-1">image_not_supported</span>
                        <span className="text-[10px] font-bold">Sem Fotografia</span>
                      </div>
                    )}
                  </div>

                  {/* Actions for Camera */}
                  <div className="w-full space-y-2 pt-2">
                    {!isCameraOpen ? (
                      <button
                        onClick={startCamera}
                        className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm"
                      >
                        <span className="material-symbols-outlined text-sm">videocam</span>
                        Capturar via Câmara
                      </button>
                    ) : (
                      <div className="space-y-4 bg-slate-950 p-3 rounded-2xl border border-slate-800 animate-fade-in">
                        {cameraError ? (
                          <div className="text-rose-400 text-[10px] py-1">
                            {cameraError}
                            <button onClick={stopCamera} className="underline block mt-2 text-white font-bold">Cancelar</button>
                          </div>
                        ) : (
                          <>
                            <div className="relative rounded-lg overflow-hidden bg-black aspect-square max-w-[200px] mx-auto border border-slate-800">
                              <video
                                ref={videoRef}
                                autoPlay
                                playsInline
                                className="w-full h-full object-cover scale-x-[-1]"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                onClick={capturePhoto}
                                className="flex-1 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1"
                              >
                                <span className="material-symbols-outlined text-sm">photo_camera</span>
                                Capturar
                              </button>
                              <button
                                onClick={stopCamera}
                                className="p-1.5 bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white rounded-lg"
                                title="Cancelar câmara"
                              >
                                <span className="material-symbols-outlined text-sm">videocam_off</span>
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    <div className="relative flex items-center justify-center py-2">
                      <hr className="w-full border-slate-200" />
                      <span className="absolute bg-white px-3 text-[9px] font-bold text-slate-400 uppercase">ou</span>
                    </div>

                    {/* Standard File Upload Fallback */}
                    <label className="w-full py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer border border-slate-200">
                      <span className="material-symbols-outlined text-sm">upload</span>
                      Carregar Ficheiro
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleFileUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: PERFORMANCE HISTORY & ADD EVALUATIONS */}
          {activeTab === 'performance' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              
              {/* Performance Stats & Form to Add (Left Side) */}
              <div className="lg:col-span-4 space-y-6">
                
                {/* Performance Summary Card */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                  <h3 className="text-xs font-black text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm">dashboard</span>
                    Métricas de Desempenho
                  </h3>

                  <div className="flex items-center gap-4 py-2">
                    <div className="w-16 h-16 rounded-full bg-slate-900 border-4 border-slate-100 flex flex-col items-center justify-center text-white">
                      <span className="text-2xl font-black font-mono leading-none">{averageRating || 'N/A'}</span>
                      {averageRating > 0 && <span className="text-[8px] font-bold uppercase text-slate-400">/ 5</span>}
                    </div>
                    <div>
                      <span className="text-[9px] font-black uppercase text-slate-400 tracking-wider">Classificação Geral</span>
                      <h4 className="text-base font-black text-slate-800 mt-0.5">
                        {averageRating > 0 ? getRatingLabel(averageRating) : 'Sem avaliações'}
                      </h4>
                      <p className="text-[10px] text-slate-500 mt-0.5">Baseado em {performanceHistory.length} registos históricos.</p>
                    </div>
                  </div>

                  {/* Star rating preview bars */}
                  {performanceHistory.length > 0 && (
                    <div className="space-y-2 pt-2 border-t border-slate-100 text-[10px] text-slate-500">
                      <div className="flex justify-between items-center">
                        <span>Excelente (5 estrelas)</span>
                        <span className="font-bold">{performanceHistory.filter(h => h.rating === 5).length}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Muito Bom (4 estrelas)</span>
                        <span className="font-bold">{performanceHistory.filter(h => h.rating === 4).length}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Regular (3 estrelas)</span>
                        <span className="font-bold">{performanceHistory.filter(h => h.rating === 3).length}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span>Crítico (1-2 estrelas)</span>
                        <span className="font-bold">{performanceHistory.filter(h => h.rating <= 2).length}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Form to Add Record */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
                  {!showAddPerformance ? (
                    <button
                      onClick={() => {
                        setPerfDate(new Date().toISOString().split('T')[0]);
                        setShowAddPerformance(true);
                      }}
                      className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-sm"
                    >
                      <span className="material-symbols-outlined text-sm font-bold">add</span>
                      Nova Avaliação
                    </button>
                  ) : (
                    <form onSubmit={handleAddPerformanceRecord} className="space-y-4 animate-fade-in">
                      <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                        <span className="text-xs font-black text-slate-800 uppercase tracking-wider">Nova Avaliação</span>
                        <button type="button" onClick={() => setShowAddPerformance(false)} className="text-slate-400 hover:text-slate-600">
                          <span className="material-symbols-outlined text-sm">close</span>
                        </button>
                      </div>

                      <div>
                        <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1">Avaliador / Gestor *</label>
                        <input
                          type="text"
                          required
                          placeholder="Ex: Diretor Técnico"
                          value={perfEvaluator}
                          onChange={(e) => setPerfEvaluator(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none"
                        />
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1">Data *</label>
                          <input
                            type="date"
                            required
                            value={perfDate}
                            onChange={(e) => setPerfDate(e.target.value)}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-mono"
                          />
                        </div>

                        <div>
                          <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1">Pontuação *</label>
                          <select
                            value={perfRating}
                            onChange={(e) => setPerfRating(Number(e.target.value))}
                            className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-bold text-slate-700"
                          >
                            <option value={5}>5 ★ - Excelente</option>
                            <option value={4}>4 ★ - Muito Bom</option>
                            <option value={3}>3 ★ - Satisfatório</option>
                            <option value={2}>2 ★ - Insuficiente</option>
                            <option value={1}>1 ★ - Mau</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1">Feedback Detalhado *</label>
                        <textarea
                          required
                          rows={3}
                          placeholder="Análise qualitativa das tarefas executadas, postura e profissionalismo..."
                          value={perfFeedback}
                          onChange={(e) => setPerfFeedback(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none"
                        />
                      </div>

                      <div>
                        <label className="block text-[9px] font-black uppercase text-slate-400 tracking-wider mb-1">Metas & Objectivos Próxima Avaliação</label>
                        <textarea
                          rows={2}
                          placeholder="Definição de metas de vendas ou operacionais, formações..."
                          value={perfGoals}
                          onChange={(e) => setPerfGoals(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5 text-xs font-semibold focus:outline-none"
                        />
                      </div>

                      <button
                        type="submit"
                        className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
                      >
                        Gravar Avaliação
                      </button>
                    </form>
                  )}
                </div>
              </div>

              {/* Timeline of Performance (Right Side) */}
              <div className="lg:col-span-8 bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-emerald-600">history</span>
                    Histórico do Colaborador
                  </span>
                  <span className="text-[10px] text-slate-400 font-bold font-mono">Registo Completo</span>
                </h3>

                {performanceHistory.length === 0 ? (
                  <div className="py-12 text-center text-slate-400 italic space-y-2">
                    <span className="material-symbols-outlined text-4xl block">reviews</span>
                    <p className="text-xs">Este funcionário ainda não possui avaliações de desempenho registadas.</p>
                    <p className="text-[10px] text-slate-400">Adicione uma avaliação para acompanhar o crescimento do colaborador.</p>
                  </div>
                ) : (
                  <div className="space-y-4 relative border-l-2 border-slate-100 pl-4 ml-2 max-h-[450px] overflow-y-auto">
                    {performanceHistory.map((rec) => (
                      <div key={rec.id} className="relative bg-slate-50 p-4 rounded-xl border border-slate-150 shadow-sm hover:border-slate-300 transition-colors">
                        {/* Timeline Circle Bullet */}
                        <div className={`absolute -left-[25px] top-4 w-2.5 h-2.5 rounded-full border-2 border-white shadow ${
                          rec.rating >= 4 ? 'bg-emerald-500' : rec.rating === 3 ? 'bg-amber-500' : 'bg-red-500'
                        }`}></div>

                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200 pb-2 mb-2">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-slate-900 text-xs">{rec.evaluator}</span>
                            <span className="text-[9px] font-semibold bg-slate-200 text-slate-600 px-2 py-0.5 rounded-md font-mono">{rec.date}</span>
                          </div>

                          <div className="flex items-center justify-between sm:justify-end gap-3">
                            <div className="flex items-center gap-0.5">
                              {Array.from({ length: 5 }).map((_, i) => (
                                <span
                                  key={i}
                                  className={`material-symbols-outlined text-sm ${
                                    i < rec.rating ? 'text-amber-500 fill-current font-black' : 'text-slate-300'
                                  }`}
                                >
                                  star
                                </span>
                              ))}
                            </div>
                            <button
                              onClick={() => handleDeletePerformanceRecord(rec.id)}
                              className="text-slate-400 hover:text-red-600 transition-all"
                              title="Remover avaliação"
                            >
                              <span className="material-symbols-outlined text-xs">delete</span>
                            </button>
                          </div>
                        </div>

                        <p className="text-xs text-slate-600 whitespace-pre-wrap leading-relaxed">
                          <strong>Comentário de Desempenho:</strong> {rec.feedback}
                        </p>

                        {rec.goals && (
                          <div className="mt-3 bg-emerald-50/50 border border-emerald-100/50 p-2.5 rounded-lg text-[11px] text-slate-700">
                            <strong className="text-emerald-800 flex items-center gap-1">
                              <span className="material-symbols-outlined text-xs">emoji_events</span>
                              Objectivos e Metas Traçados:
                            </strong>
                            <p className="mt-0.5 italic text-slate-600 leading-relaxed">{rec.goals}</p>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: COMPLIANCE, IBAN, CONTRACT, LEGAL REQUIREMENTS */}
          {activeTab === 'compliance' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
              
              {/* Financial & Compliance Info */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-emerald-600 font-bold">account_balance</span>
                  Dados Fiscais e Bancários
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">NUIT (ID Fiscal de 9 dígitos) *</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: 123456789"
                      value={nuit}
                      onChange={(e) => setNuit(e.target.value.replace(/\D/g, '').substring(0, 9))}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Número de Inscrição INSS *</label>
                    <input
                      type="text"
                      required
                      placeholder="Ex: INSS102938"
                      value={inssNumber}
                      onChange={(e) => setInssNumber(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">IBAN de Moçambique *</label>
                    <input
                      type="text"
                      required
                      placeholder="MZ59 0033 1000 0012 3456 7890 1"
                      value={iban}
                      onChange={(e) => setIban(e.target.value.toUpperCase())}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold font-mono focus:outline-none"
                    />
                  </div>

                  <div className="flex items-center gap-2 pt-2">
                    <input
                      type="checkbox"
                      id="comp_foreigner"
                      checked={isForeigner}
                      onChange={(e) => setIsForeigner(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 border-slate-300 rounded"
                    />
                    <label htmlFor="comp_foreigner" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                      Este colaborador é de nacionalidade estrangeira
                    </label>
                  </div>
                </div>
              </div>

              {/* Labor Contract Details */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-emerald-600">assignment</span>
                  Regime Contratual e Salarial
                </h3>

                <div className="space-y-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Tipo de Contrato em Vigor *</label>
                    <select
                      value={contractType}
                      onChange={(e) => setContractType(e.target.value as ContractType)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold focus:outline-none"
                    >
                      <option value="Prazo Certo">Prazo Certo</option>
                      <option value="Prazo Indeterminado">Prazo Indeterminado</option>
                      <option value="Prazo Incerto">Prazo Incerto</option>
                      <option value="Teletrabalho">Teletrabalho</option>
                      <option value="Trabalho Intermitente">Trabalho Intermitente</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Salário Base Mensal (MT) *</label>
                    <div className="relative">
                      <input
                        type="number"
                        required
                        value={baseSalary}
                        onChange={(e) => setBaseSalary(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-3 pr-10 py-2 text-xs font-black font-mono text-slate-950 focus:outline-none"
                        placeholder="0.00"
                      />
                      <span className="absolute right-3 top-2 text-xs font-black text-slate-400 font-mono">MT</span>
                    </div>
                  </div>

                  <div className="pt-2">
                    <div className="bg-amber-50 p-4 rounded-xl border border-amber-100 space-y-1.5 text-[11px] text-amber-900 leading-relaxed">
                      <strong className="flex items-center gap-1 text-xs">
                        <span className="material-symbols-outlined text-sm">warning</span>
                        Lei n.º 13/2023 de Moçambique:
                      </strong>
                      <p>
                        A nova lei prevê regras restritivas para a contratação de cidadãos estrangeiros sob o regime de quotas, que varia com o tamanho da empresa (Pequena, Média ou Grande). Certifique-se de que a ficha e a nacionalidade estão sempre em perfeita harmonia documental.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'vacations' && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 animate-fade-in">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-emerald-600">calendar_month</span>
                  Agendamento de Férias
                </h3>
                
                <p className="text-xs text-slate-500 leading-relaxed">
                  Defina o período em que o colaborador estará ausente para gozo de férias. Estas datas serão apresentadas na lista principal de colaboradores para facilitar a consulta do gestor.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Início das Férias</label>
                    <input
                      type="date"
                      value={vacationStart}
                      onChange={(e) => setVacationStart(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Fim das Férias</label>
                    <input
                      type="date"
                      value={vacationEnd}
                      onChange={(e) => setVacationEnd(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setVacationStart('');
                      setVacationEnd('');
                      triggerToast('Período de férias limpo!');
                    }}
                    className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all"
                  >
                    Limpar Período
                  </button>
                  
                  <button
                    type="button"
                    onClick={() => {
                      const today = new Date();
                      const nextMonday = new Date();
                      nextMonday.setDate(today.getDate() + ((1 + 7 - today.getDay()) % 7 || 7));
                      const endDate = new Date(nextMonday);
                      endDate.setDate(nextMonday.getDate() + 29); // 30 days total

                      setVacationStart(nextMonday.toISOString().split('T')[0]);
                      setVacationEnd(endDate.toISOString().split('T')[0]);
                      triggerToast('Sugerido período padrão de 30 dias!');
                    }}
                    className="px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-bold transition-all flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-sm">schedule</span>
                    Sugerir 30 Dias (Próx. Segunda)
                  </button>
                </div>
              </div>

              {/* Informative legal side block about vacations */}
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm space-y-4">
                <h3 className="text-sm font-black text-slate-800 uppercase tracking-wider border-b border-slate-100 pb-2 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-emerald-600">gavel</span>
                  Enquadramento Legal (Lei n.º 13/2023)
                </h3>

                <div className="space-y-3 text-xs text-slate-600 leading-relaxed">
                  <div className="flex gap-2 items-start">
                    <span className="material-symbols-outlined text-emerald-600 text-sm mt-0.5">verified</span>
                    <p>
                      <strong>Duração das Férias:</strong> Nos termos da Lei de Trabalho de Moçambique, o trabalhador tem direito a um período de férias pagas de <strong>30 dias civis</strong> por cada ano de trabalho efetivo.
                    </p>
                  </div>

                  <div className="flex gap-2 items-start">
                    <span className="material-symbols-outlined text-emerald-600 text-sm mt-0.5">verified</span>
                    <p>
                      <strong>Acumulação de Férias:</strong> As férias devem ser gozadas no decurso do ano civil em que se vencem, sendo permitida a acumulação até ao máximo de <strong>60 dias</strong> por conveniência de serviço e acordo mútuo.
                    </p>
                  </div>

                  <div className="flex gap-2 items-start">
                    <span className="material-symbols-outlined text-emerald-600 text-sm mt-0.5">verified</span>
                    <p>
                      <strong>Substituição por Remuneração:</strong> O direito a férias é irrenunciável. O gozo de férias não pode ser substituído por remuneração suplementar, salvo em situações excecionais previstas na lei ou na cessação do contrato de trabalho.
                    </p>
                  </div>
                </div>

                {vacationStart && vacationEnd && (
                  <div className="bg-emerald-50 p-4 rounded-xl border border-emerald-100 text-xs text-slate-700 mt-4 space-y-2">
                    <div className="font-bold text-emerald-800 flex items-center gap-1">
                      <span className="material-symbols-outlined text-base">beach_access</span>
                      Resumo do Planeamento
                    </div>
                    <div>
                      O colaborador <strong>{name}</strong> estará em gozo de férias a partir do dia <strong>{(() => {
                        const months = [
                          'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                          'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
                        ];
                        const startParts = vacationStart.split('-');
                        if (startParts.length === 3) {
                          const day = parseInt(startParts[2], 10);
                          const mIdx = parseInt(startParts[1], 10) - 1;
                          return `${day} de ${months[mIdx] || startParts[1]}`;
                        }
                        return vacationStart;
                      })()}</strong> e regressará ao serviço no dia <strong>{(() => {
                        const months = [
                          'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
                          'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
                        ];
                        const endParts = vacationEnd.split('-');
                        if (endParts.length === 3) {
                          const day = parseInt(endParts[2], 10);
                          const mIdx = parseInt(endParts[1], 10) - 1;
                          return `${day} de ${months[mIdx] || endParts[1]}`;
                        }
                        return vacationEnd;
                      })()}</strong>.
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer Controls */}
        <div className="bg-slate-50 border-t border-slate-200 p-6 flex items-center justify-between">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold uppercase tracking-wider transition-all"
          >
            Voltar
          </button>

          <button
            onClick={handleSaveAll}
            className="px-6 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-sm flex items-center gap-1.5"
          >
            <span className="material-symbols-outlined text-sm">save</span>
            Guardar Alterações
          </button>
        </div>
      </div>
    </div>
  );
}

// Simple Helper to clean/visualize NUIT
function nuitCleanUp(raw: string) {
  const clean = raw.replace(/\D/g, '');
  if (clean.length === 9) {
    return `${clean.substring(0, 3)} ${clean.substring(3, 6)} ${clean.substring(6, 9)}`;
  }
  return raw;
}
