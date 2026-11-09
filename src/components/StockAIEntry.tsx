import { appAlert, appPrompt } from '../utils/confirmDialog';
import React, { useState, useRef, useEffect } from 'react';
import { dbService } from '../utils/firebaseDB';
import { validateStandardPrices, validateHybridPrices, isHybridProduct } from '../utils/priceHelper';
import { verifyAuthorizationPassword } from '../utils/authorization';
import { getClientIp } from '../utils/clientInfo';
import { matchProduct, describeMatchStatus, ProductMatch } from '../utils/productMatch';
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
  /** Quem está a dar a entrada — vai para a auditoria. */
  currentUser?: { username: string } | null;
}

interface ResolvedUpdate {
  update: StockUpdate;
  match: ProductMatch;
}

export const StockAIEntry: React.FC<StockAIEntryProps> = ({ onClose, onSuccess, currentUser }) => {
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<{ name: string; base64: string; mime: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [aiResponse, setAiResponse] = useState<AIResponse | null>(null);
  /** Correspondência exacta de cada linha sugerida pela IA (ES-44). */
  const [resolved, setResolved] = useState<ResolvedUpdate[]>([]);
  const [error, setError] = useState('');
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
      void appAlert('Não foi possível acessar o microfone.');
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
      setError('Insira um comando de voz, texto ou anexe um documento.');
      return;
    }

    setLoading(true);
    setAiResponse(null);
    setError('');

    try {
      const response = await fetch('/api/gemini/technician-ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, files })
      });

      let data: any = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok || data?.error) {
        throw new Error(data?.error || `O servidor recusou o pedido (código ${response.status}).`);
      }

      // O servidor devolve texto livre; a pré-visualização estruturada só
      // existe quando vierem alterações de stock.
      let resposta: AIResponse;
      if (data?.result && !data?.changes) {
        resposta = { explanation: data.result, changes: {} } as AIResponse;
      } else {
        resposta = data as AIResponse;
      }
      setAiResponse(resposta);

      // ES-44: a correspondência faz-se agora, não no momento de gravar, para
      // o utilizador ver exactamente qual artigo vai receber a mercadoria.
      const sugestoes = resposta?.changes?.stockUpdates || [];
      if (sugestoes.length > 0) {
        const catalogo = await dbService.getProducts().catch(() => [] as Product[]);
        setResolved(sugestoes.map(update => ({ update, match: matchProduct(catalogo, update.productSearch) })));
      } else {
        setResolved([]);
      }
    } catch (err: any) {
      console.error('Erro IA:', err);
      setError(err?.message || 'Não foi possível contactar o assistente.');
    } finally {
      setLoading(false);
    }
  };

  const applyChanges = async () => {
    if (!aiResponse || !resolved.length) return;

    const validos = resolved.filter(r => r.match.status === 'exact' && r.match.product);
    if (validos.length === 0) {
      void appAlert(
        'Nenhuma das linhas corresponde exactamente a um artigo do catálogo. ' +
          'Nada foi gravado — corrija o nome ou o código e repita.'
      );
      return;
    }

    // V-04: entrada de stock é dinheiro a entrar no armazém; exige gestor.
    const pw = await appPrompt(
      `Vão ser actualizados ${validos.length} artigo(s) no stock.\n\n` +
        'Esta operação soma mercadoria ao inventário e fica registada em auditoria. ' +
        'Introduza a palavra-passe de gestor.'
    );
    if (pw === null) return;

    setLoading(true);
    try {
      const config = await dbService.getSettings().catch(() => null);
      if (!(await verifyAuthorizationPassword(pw, config))) {
        void appAlert('Palavra-passe incorrecta: nada foi gravado.');
        return;
      }

      const operador = currentUser?.username || 'Gestor de Stock';
      const ip = await getClientIp().catch(() => 'desconhecido');

      let stockGravado = 0;
      let precosGravados = 0;
      const ignorados: string[] = [];

      for (const { update, match } of resolved) {
        const produto = match.product;
        if (match.status !== 'exact' || !produto) {
          ignorados.push(`${update.productSearch} (${describeMatchStatus(match)})`);
          continue;
        }

        // 1. Preços primeiro, e só se respeitarem a regra compra < venda.
        const proposedBuy = update.newBuyingPrice ? Number(update.newBuyingPrice) : produto.buyingPrice;
        const proposedSell = update.newSellingPrice ? Number(update.newSellingPrice) : produto.sellingPrice;
        const priceError = isHybridProduct(produto)
          ? validateHybridPrices(
              produto.buyingPriceBulk ?? produto.buyingPrice,
              produto.sellingPriceBulk || proposedSell * (produto.conversionRate || 1),
              proposedSell,
              Number(produto.conversionRate) || 1
            )
          : validateStandardPrices(proposedBuy, proposedSell, produto.isService);

        if ((update.newBuyingPrice || update.newSellingPrice) && !priceError) {
          await dbService.updateProductPrices({
            productId: String(produto.id),
            buyingPrice: update.newBuyingPrice ? Number(update.newBuyingPrice) : undefined,
            sellingPrice: update.newSellingPrice ? Number(update.newSellingPrice) : undefined,
            operator: operador,
            ipAddress: ip,
            reason: 'Entrada de stock por IA'
          });
          precosGravados++;
        } else if ((update.newBuyingPrice || update.newSellingPrice) && priceError) {
          ignorados.push(`${produto.name}: preço não alterado (${priceError})`);
        }

        // 2. Stock por diferença, dentro de transacção, com movimento e auditoria.
        const qty = Number(update.quantityToAdd) || 0;
        if (qty !== 0) {
          await dbService.adjustStock({
            productId: String(produto.id),
            deltaBase: qty,
            reason: `Entrada por IA: «${update.productSearch}»`,
            operator: operador,
            source: 'Entrada IA',
            ipAddress: ip,
            allowNegative: qty > 0
          });
          stockGravado++;
        }
      }

      void dbService.addAuditLog({
        id: 'log-ia-' + Date.now(),
        timestamp: new Date().toISOString(),
        username: operador,
        ipAddress: ip,
        action: 'Entrada de Stock via IA',
        status: 'Sucesso',
        level: 'WARNING',
        entity: 'products',
        details:
          `${stockGravado} artigo(s) com stock actualizado e ${precosGravados} com preço alterado.` +
          (ignorados.length ? ` Ignorados: ${ignorados.join('; ')}.` : '')
      });

      await appAlert(
        `${stockGravado} artigo(s) actualizados no stock` +
          (precosGravados ? `, ${precosGravados} preço(s) alterados` : '') +
          '.' +
          (ignorados.length ? `\n\nNada foi gravado em: ${ignorados.join('; ')}.` : '')
      );
      onSuccess();
      onClose();
    } catch (err: any) {
      console.error('Erro ao aplicar alterações:', err);
      void appAlert(err?.message || 'Erro ao salvar alterações no banco de dados.');
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

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
              <span className="material-symbols-outlined text-base">error</span>
              <span>{error}</span>
            </div>
          )}

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
                    {resolved.map(({ update, match }, idx) => {
                      const produto = match.product;
                      const exacto = match.status === 'exact' && produto;
                      const antes = produto ? Number(produto.stockQty) || 0 : 0;
                      const depois = antes + (Number(update.quantityToAdd) || 0);

                      return (
                        <div
                          key={idx}
                          className={`p-3 rounded-lg border shadow-sm flex justify-between items-center ${
                            exacto ? 'bg-white border-indigo-100' : 'bg-red-50 border-red-200'
                          }`}
                        >
                          <div className="min-w-0">
                            <p className="text-sm font-bold text-gray-900 truncate">
                              {exacto ? produto!.name : update.productSearch}
                            </p>
                            <p className={`text-[10px] ${exacto ? 'text-gray-500' : 'text-red-700 font-bold'}`}>
                              {exacto
                                ? `${antes.toLocaleString('pt-MZ')} → ${depois.toLocaleString('pt-MZ')} ${produto!.baseUnit || 'un'}`
                                : describeMatchStatus(match)}
                            </p>
                            <div className="flex gap-3 mt-1">
                              {update.newBuyingPrice && (
                                <span className="text-[10px] text-gray-500">P. Compra: {update.newBuyingPrice} MT</span>
                              )}
                              {update.newSellingPrice && (
                                <span className="text-[10px] text-gray-500">P. Venda: {update.newSellingPrice} MT</span>
                              )}
                            </div>
                          </div>
                          <div
                            className={`px-3 py-1 rounded-full font-bold text-xs shrink-0 ${
                              exacto ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700 line-through'
                            }`}
                          >
                            +{update.quantityToAdd}
                          </div>
                        </div>
                      );
                    })}

                    {resolved.some(r => r.match.status !== 'exact') && (
                      <p className="text-[10px] text-red-700 font-semibold">
                        Só são gravadas as linhas com artigo identificado por nome ou código exacto. As restantes
                        ficam de fora — corrija o texto e repita.
                      </p>
                    )}
                  </div>

                  <div className="mt-6 flex gap-3">
                    <button
                      onClick={applyChanges}
                      disabled={loading || !resolved.some(r => r.match.status === 'exact')}
                      className="flex-1 py-3 bg-green-600 text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-green-700 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
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
