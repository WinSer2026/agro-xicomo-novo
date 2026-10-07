import React, { useState, useRef, useEffect } from 'react';
import { dbService } from '../utils/firebaseDB';
import { validateStandardPrices, validateHybridPrices, isHybridProduct } from '../utils/priceHelper';
import { Product } from '../types';

interface StockUpdate {
  productSearch: string;
  quantityToAdd: number;
  newBuyingPrice?: number;
  newSellingPrice?: number;
}

interface AIResponse {
  explanation: string;
  changes: {
    stockUpdates?: StockUpdate[];
  };
}

interface StockAIEntryProps {
  onClose: () => void;
  onSuccess: () => void;
}

export const StockAIEntry: React.FC<StockAIEntryProps> = ({ onClose, onSuccess }) => {
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<{ name: string; base64: string; mime: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = e.target.files;
    if (!selectedFiles) return;

    const newFiles = [...files];
    for (let i = 0; i < selectedFiles.length; i++) {
      const file = selectedFiles[i];
      const reader = new FileReader();
      
      const fileData = await new Promise<{ base64: string; mime: string }>((resolve) => {
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          resolve({ base64, mime: file.type });
        };
        reader.readAsDataURL(file);
      });

      newFiles.push({
        name: file.name,
        base64: fileData.base64,
        mime: fileData.mime
      });
    }
    setFiles(newFiles);
  };

  const removeFile = (index: number) => {
    setFiles(files.filter((_, i) => i !== index));
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const reader = new FileReader();
        reader.onload = () => {
          const base64 = (reader.result as string).split(',')[1];
          setFiles([...files, { name: 'Áudio Gravado.webm', base64, mime: 'audio/webm' }]);
        };
        reader.readAsDataURL(blob);
        
        // Stop all tracks
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Erro ao acessar microfone:', err);
      alert('Não foi possível acessar o microfone.');
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const processWithAI = async () => {
    if (!prompt && files.length === 0) {
      alert('Por favor, insira um comando de voz, texto ou anexe um documento.');
      return;
    }

    setLoading(true);
    setAiResponse(null);

    try {
      const response = await fetch('/api/gemini/technician-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, files })
      });

      const data = await response.json();
      if (data.error) throw new Error(data.error);

      setAiResponse(data);
    } catch (err: any) {
      console.error('Erro IA:', err);
      alert('Erro ao processar com IA: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const applyChanges = async () => {
    if (!aiResponse || !aiResponse.changes.stockUpdates) return;

    setLoading(true);
    try {
      await dbService.init();
      const allProducts = await dbService.getProducts();
      let updatedCount = 0;

      for (const update of aiResponse.changes.stockUpdates) {
        const search = update.productSearch.toLowerCase();
        const target = allProducts.find(p => 
          p.name.toLowerCase().includes(search) || 
          p.code.toLowerCase().includes(search)
        );

        if (target) {
          target.stockQty += Number(update.quantityToAdd) || 0;

          // Regra de preços: só aplica alterações que mantenham a compra abaixo da venda
          const proposedBuy = update.newBuyingPrice ? Number(update.newBuyingPrice) : target.buyingPrice;
          const proposedSell = update.newSellingPrice ? Number(update.newSellingPrice) : target.sellingPrice;
          const priceError = isHybridProduct(target)
            ? validateHybridPrices(
                target.buyingPriceBulk ?? target.buyingPrice,
                target.sellingPriceBulk || proposedSell * (target.conversionRate || 1),
                proposedSell,
                Number(target.conversionRate) || 1
              )
            : validateStandardPrices(proposedBuy, proposedSell, target.isService);

          if (!priceError) {
            if (update.newBuyingPrice) target.buyingPrice = Number(update.newBuyingPrice);
            if (update.newSellingPrice) target.sellingPrice = Number(update.newSellingPrice);
          } else {
            console.warn('[AI Stock Entry] Preços não alterados (regra de preços):', priceError);
          }
          
          // Re-calculate bulk/retail if applicable
          if (target.parentUnit && target.conversionRate && target.conversionRate > 1) {
            const rate = target.conversionRate;
            target.stockQtyBulk = Math.floor(target.stockQty / rate);
            target.stockQtyRetail = target.stockQty % rate;
          }

          await dbService.saveProduct(target);
          updatedCount++;
        }
      }

      if (updatedCount > 0) {
        void dbService.addAuditLog({
          id: 'log-' + Date.now(),
          timestamp: new Date().toISOString(),
          username: 'Gestor de Stock (IA)',
          ipAddress: '127.0.0.1',
          action: 'Entrada de Stock via IA',
          status: 'Sucesso',
          details: `Atualizado stock de ${updatedCount} produtos via processamento inteligente.`
        });

        alert(`${updatedCount} produtos atualizados com sucesso!`);
        onSuccess();
        onClose();
      } else {
        alert('Nenhum produto correspondente foi encontrado no sistema para as atualizações sugeridas.');
      }
    } catch (err) {
      console.error('Erro ao aplicar alterações:', err);
      alert('Erro ao salvar alterações no banco de dados.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
        {/* Header */}
        <div className="bg-indigo-600 p-4 text-white flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined">auto_awesome</span>
            <h2 className="text-lg font-bold">Entrada de Stock Inteligente</h2>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-full transition-colors">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="p-6 overflow-y-auto space-y-6">
          {/* Instructions */}
          <div className="bg-indigo-50 border-l-4 border-indigo-500 p-3 rounded text-indigo-800 text-xs">
            <p className="font-bold mb-1">Como usar:</p>
            <ul className="list-disc list-inside space-y-1">
              <li>Descreva a entrada (ex: "Recebi 50 unidades de Adubo NPK hoje")</li>
              <li>Anexe uma foto da fatura ou uma planilha Excel de fornecedor</li>
              <li>Use o microfone para ditar a lista de produtos recebidos</li>
            </ul>
          </div>

          {/* Input Section */}
          <div className="space-y-4">
            <div className="relative">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Descreva o que deseja fazer ou ditar..."
                className="w-full h-24 p-3 pr-12 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 transition-all outline-none"
              />
              <button
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                title="Segure para gravar voz"
                className={`absolute right-3 bottom-3 p-2 rounded-full transition-all shadow-md ${
                  isRecording ? 'bg-red-500 text-white animate-pulse scale-110' : 'bg-white text-indigo-600 hover:bg-indigo-50'
                }`}
              >
                <span className="material-symbols-outlined text-[20px]">
                  {isRecording ? 'mic_active' : 'mic'}
                </span>
              </button>
            </div>

            {/* File Uploads */}
            <div className="flex flex-wrap gap-2">
              <label className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-300 hover:border-indigo-500 hover:text-indigo-600 rounded-lg text-xs font-bold text-gray-700 cursor-pointer transition-all shadow-sm">
                <span className="material-symbols-outlined text-[18px]">upload_file</span>
                Anexar Documento (PDF/Excel/Foto)
                <input
                  type="file"
                  multiple
                  accept=".pdf,.xlsx,.xls,.csv,image/*"
                  onChange={handleFileChange}
                  className="hidden"
                />
              </label>
            </div>

            {/* File Previews */}
            {files.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {files.map((file, idx) => (
                  <div key={idx} className="flex items-center gap-2 bg-indigo-50 text-indigo-700 px-2 py-1 rounded text-[10px] font-medium border border-indigo-100">
                    <span className="material-symbols-outlined text-[14px]">
                      {file.mime.startsWith('image/') ? 'image' : 
                       file.mime.includes('pdf') ? 'picture_as_pdf' : 
                       file.mime.includes('audio') ? 'audiotrack' : 'description'}
                    </span>
                    <span className="max-w-[120px] truncate">{file.name}</span>
                    <button onClick={() => removeFile(idx)} className="hover:text-red-500">
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Action Button */}
          <button
            onClick={processWithAI}
            disabled={loading || (!prompt && files.length === 0)}
            className="w-full py-3 bg-indigo-600 text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg active:scale-[0.98]"
          >
            {loading ? (
              <>
                <span className="animate-spin material-symbols-outlined">sync</span>
                Processando Inteligência Artificial...
              </>
            ) : (
              <>
                <span className="material-symbols-outlined">psychology</span>
                Analisar e Extrair Dados
              </>
            )}
          </button>

          {/* AI Response Preview */}
          {aiResponse && (
            <div className="space-y-4 animate-in slide-in-from-top duration-300">
              <div className="p-4 bg-gray-50 rounded-xl border border-gray-200">
                <h3 className="text-sm font-bold text-gray-800 mb-2 flex items-center gap-2">
                  <span className="material-symbols-outlined text-indigo-500">chat_bubble</span>
                  O que a IA entendeu:
                </h3>
                <p className="text-xs text-gray-600 leading-relaxed italic border-l-2 border-indigo-300 pl-3">
                  {aiResponse.explanation}
                </p>
              </div>

              {aiResponse.changes.stockUpdates && aiResponse.changes.stockUpdates.length > 0 ? (
                <div className="bg-indigo-50/50 p-4 rounded-xl border border-indigo-100">
                  <h3 className="text-sm font-bold text-indigo-900 mb-3 flex items-center gap-2">
                    <span className="material-symbols-outlined">inventory_2</span>
                    Entradas Detectadas:
                  </h3>
                  <div className="space-y-2">
                    {aiResponse.changes.stockUpdates.map((item, idx) => (
                      <div key={idx} className="bg-white p-3 rounded-lg border border-indigo-100 shadow-sm flex justify-between items-center">
                        <div>
                          <p className="text-sm font-bold text-gray-900">{item.productSearch}</p>
                          <div className="flex gap-3 mt-1">
                            {item.newBuyingPrice && (
                              <span className="text-[10px] text-gray-500">P. Compra: {item.newBuyingPrice} MT</span>
                            )}
                            {item.newSellingPrice && (
                              <span className="text-[10px] text-gray-500">P. Venda: {item.newSellingPrice} MT</span>
                            )}
                          </div>
                        </div>
                        <div className="bg-green-100 text-green-700 px-3 py-1 rounded-full font-bold text-xs">
                          +{item.quantityToAdd}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mt-6 flex gap-3">
                    <button
                      onClick={applyChanges}
                      className="flex-1 py-3 bg-green-600 text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-all shadow-md"
                    >
                      <span className="material-symbols-outlined">done_all</span>
                      Confirmar e Atualizar Stock
                    </button>
                    <button
                      onClick={() => setAiResponse(null)}
                      className="px-6 py-3 bg-white border border-gray-300 text-gray-700 rounded-lg font-bold hover:bg-gray-50 transition-all"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 bg-yellow-50 text-yellow-800 rounded-lg text-xs flex items-center gap-2">
                  <span className="material-symbols-outlined">warning</span>
                  Nenhuma entrada de stock clara foi detectada na sua mensagem ou documentos.
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
