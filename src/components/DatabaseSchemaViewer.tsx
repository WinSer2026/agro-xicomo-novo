import React, { useState } from 'react';

export default function DatabaseSchemaViewer() {
  const [copied, setCopied] = useState(false);

  const sqlSchema = `-- =========================================================
-- ESQUEMA DE BASE DE DADOS PARA SUPABASE (POSTGRESQL)
-- AGROGESTÃO ZERO - SISTEMA COMERCIAL E DE RECURSOS HUMANOS
-- =========================================================

-- Ativar extensão UUID se não existir
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. CREDENCIAIS DE UTILIZADORES E TÉCNICOS
CREATE TABLE IF NOT EXISTS credentials (
    id VARCHAR(100) PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    "passwordHash" VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL,
    roles JSONB DEFAULT '[]'::jsonb,
    "mfaEnabled" BOOLEAN DEFAULT FALSE,
    "mfaSecret" VARCHAR(64)
);

-- Inserir as credenciais mestre iniciais se não existirem
INSERT INTO credentials (id, username, "passwordHash", role, roles, "mfaEnabled")
VALUES ('usr-mazive', 'Mazive', '0147', 'Técnico', '["Técnico"]'::jsonb, FALSE)
ON CONFLICT (username) DO NOTHING;

-- 2. TABELA DE PRODUTOS E GESTÃO DE STOCK
CREATE TABLE IF NOT EXISTS products (
    id VARCHAR(100) PRIMARY KEY,
    code VARCHAR(100) UNIQUE NOT NULL,
    reference VARCHAR(100),
    name VARCHAR(255) NOT NULL,
    category VARCHAR(100) NOT NULL,
    "stockQty" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "stockQtyBulk" DECIMAL(12,2) DEFAULT 0.00,
    "stockQtyRetail" DECIMAL(12,2) DEFAULT 0.00,
    "buyingPrice" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "sellingPrice" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "sellingPriceBulk" DECIMAL(12,2) DEFAULT 0.00,
    "baseUnit" VARCHAR(50) NOT NULL,
    "conversionRate" DECIMAL(12,2) DEFAULT 1.00,
    "parentUnit" VARCHAR(50),
    "expiryDate" VARCHAR(20),
    "imageUrl" TEXT,
    "isService" BOOLEAN DEFAULT FALSE
);

-- 3. TABELA DE VENDAS (PDV)
CREATE TABLE IF NOT EXISTS sales (
    id VARCHAR(100) PRIMARY KEY,
    "invoiceNumber" VARCHAR(100) UNIQUE NOT NULL,
    "receiptNumber" VARCHAR(100),
    date VARCHAR(50) NOT NULL,
    "customerName" VARCHAR(255) DEFAULT 'Cliente Geral',
    "customerNuit" VARCHAR(50),
    "customerAddress" TEXT,
    items JSONB DEFAULT '[]'::jsonb,
    subtotal DECIMAL(12,2) NOT NULL,
    discount DECIMAL(12,2) DEFAULT 0.00,
    total DECIMAL(12,2) NOT NULL,
    "paymentMethod" VARCHAR(50) NOT NULL,
    "paymentBreakdown" JSONB,
    status VARCHAR(50) DEFAULT 'Paga',
    "documentType" VARCHAR(50),
    "operatorId" VARCHAR(100),
    "operatorName" VARCHAR(100),
    synced BOOLEAN DEFAULT TRUE,
    "includeIva" BOOLEAN DEFAULT FALSE,
    "ivaAmount" DECIMAL(12,2) DEFAULT 0.00
);

-- 4. REGISTO DE QUEBRAS E PERDAS
CREATE TABLE IF NOT EXISTS losses (
    id VARCHAR(100) PRIMARY KEY,
    "productId" VARCHAR(100),
    "productName" VARCHAR(255) NOT NULL,
    quantity DECIMAL(12,2) NOT NULL,
    unit VARCHAR(50) NOT NULL,
    date VARCHAR(20) NOT NULL,
    reason VARCHAR(100) NOT NULL,
    "responsibleEmployeeId" VARCHAR(100),
    justification TEXT NOT NULL,
    "costValue" DECIMAL(12,2) NOT NULL
);

-- 5. CADASTRO DE COLABORADORES (RECURSOS HUMANOS)
CREATE TABLE IF NOT EXISTS employees (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    contact VARCHAR(100),
    "contractType" VARCHAR(100) NOT NULL,
    nuit VARCHAR(50) NOT NULL,
    "inssNumber" VARCHAR(50) NOT NULL,
    iban VARCHAR(100) NOT NULL,
    "isForeigner" BOOLEAN DEFAULT FALSE,
    "baseSalary" VARCHAR(50) NOT NULL,
    "commissionRate" DECIMAL(5,2) DEFAULT 0.00,
    "workingHoursLimit" INT DEFAULT 44,
    "photoUrl" TEXT,
    "documentUrl" TEXT,
    "resumeUrl" TEXT,
    "hiredDate" VARCHAR(20) NOT NULL,
    gender VARCHAR(20) NOT NULL,
    "dependentsCount" INT DEFAULT 0,
    "maritalStatus" VARCHAR(50) DEFAULT 'Solteiro',
    damages JSONB DEFAULT '[]'::jsonb,
    "performanceHistory" JSONB DEFAULT '[]'::jsonb,
    "vacationStart" VARCHAR(20),
    "vacationEnd" VARCHAR(20)
);

-- 6. ASSIDUIDADE, PONTO E HORAS EXTRA
CREATE TABLE IF NOT EXISTS attendance (
    id VARCHAR(100) PRIMARY KEY,
    "employeeId" VARCHAR(100) REFERENCES employees(id) ON DELETE CASCADE,
    "employeeName" VARCHAR(255),
    date VARCHAR(20) NOT NULL,
    "clockIn" VARCHAR(10),
    "clockOut" VARCHAR(10),
    "regularHours" DECIMAL(5,2) DEFAULT 0.00,
    "nightHours" DECIMAL(5,2) DEFAULT 0.00,
    "overtimeWeekday" DECIMAL(5,2) DEFAULT 0.00,
    "overtimeWeekendHoliday" DECIMAL(5,2) DEFAULT 0.00,
    absent BOOLEAN DEFAULT FALSE,
    "absentReason" VARCHAR(100),
    UNIQUE ("employeeId", date)
);

-- 7. LOGS DE SEGURANÇA E AUDITORIA
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(100) PRIMARY KEY,
    timestamp VARCHAR(50) NOT NULL,
    username VARCHAR(100) NOT NULL,
    "ipAddress" VARCHAR(50) NOT NULL,
    action VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL,
    details TEXT
);

-- 8. SESSÕES DE UTILIZADORES ATIVAS
CREATE TABLE IF NOT EXISTS active_sessions (
    id VARCHAR(100) PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    role VARCHAR(100) NOT NULL,
    roles JSONB DEFAULT '[]'::jsonb,
    "loginTime" VARCHAR(50) NOT NULL,
    "ipAddress" VARCHAR(50) NOT NULL
);

-- 9. CONFIGURAÇÕES GERAIS E INFORMAÇÕES DE FATURAÇÃO
CREATE TABLE IF NOT EXISTS settings (
    id VARCHAR(50) PRIMARY KEY DEFAULT 'global',
    data JSONB NOT NULL
);

-- 10. PAGAMENTOS DE SALÁRIOS (FOLHA DE PAGAMENTO)
CREATE TABLE IF NOT EXISTS payroll_payments (
    id VARCHAR(100) PRIMARY KEY,
    "employeeId" VARCHAR(100) NOT NULL,
    "employeeName" VARCHAR(255) NOT NULL,
    month VARCHAR(20) NOT NULL,
    "baseSalary" DECIMAL(12,2) NOT NULL,
    additions DECIMAL(12,2) DEFAULT 0.00,
    "manualAddition" DECIMAL(12,2) DEFAULT 0.00,
    "additionDescription" TEXT,
    deductions DECIMAL(12,2) DEFAULT 0.00,
    "manualCut" DECIMAL(12,2) DEFAULT 0.00,
    "cutDescription" TEXT,
    inss DECIMAL(12,2) DEFAULT 0.00,
    irps DECIMAL(12,2) DEFAULT 0.00,
    "absencesDiscount" DECIMAL(12,2) DEFAULT 0.00,
    "finalNetWage" DECIMAL(12,2) NOT NULL,
    "paymentDate" VARCHAR(50) NOT NULL
);

-- 11. CLIENTES
CREATE TABLE IF NOT EXISTS customers (
    id VARCHAR(100) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    nuit VARCHAR(50),
    address TEXT,
    phone VARCHAR(50)
);

-- 12. VENDAS PAUSADAS (RASCUNHOS)
CREATE TABLE IF NOT EXISTS paused_sales (
    id VARCHAR(100) PRIMARY KEY,
    date VARCHAR(50) NOT NULL,
    "customerName" VARCHAR(255) NOT NULL,
    "customerNuit" VARCHAR(50),
    "customerAddress" TEXT,
    items JSONB DEFAULT '[]'::jsonb,
    "paymentMethod" VARCHAR(50) NOT NULL,
    "documentType" VARCHAR(50) NOT NULL,
    "includeIva" BOOLEAN DEFAULT FALSE,
    "customSubtotalDiscount" DECIMAL(12,2) DEFAULT 0.00
);

-- 13. EXTENSÃO E STORED PROCEDURE SQL PARA GESTÃO SEGURA DE LOGIN E UTILIZADORES
-- Impede sobreposição de logins, garante unicidade de usernames e isolamento de sessões
CREATE OR REPLACE FUNCTION manage_user_credentials(
    p_action VARCHAR(20),
    p_username VARCHAR(100),
    p_password VARCHAR(255) DEFAULT NULL,
    p_role VARCHAR(50) DEFAULT 'Operador',
    p_roles JSONB DEFAULT '["Operador"]'::jsonb,
    p_id VARCHAR(100) DEFAULT NULL
) RETURNS JSONB AS $$
DECLARE
    v_user RECORD;
    v_new_id VARCHAR(100);
BEGIN
    IF LOWER(p_action) = 'create' OR LOWER(p_action) = 'upsert' THEN
        v_new_id := COALESCE(p_id, 'usr-' || gen_random_uuid());
        INSERT INTO credentials (id, username, "passwordHash", role, roles)
        VALUES (v_new_id, p_username, p_password, p_role, p_roles)
        ON CONFLICT (username) DO UPDATE SET
            "passwordHash" = COALESCE(EXCLUDED."passwordHash", credentials."passwordHash"),
            role = EXCLUDED.role,
            roles = EXCLUDED.roles;
        RETURN jsonb_build_object('success', true, 'message', 'Credencial guardada com sucesso.');
    ELSIF LOWER(p_action) = 'delete' THEN
        DELETE FROM credentials WHERE LOWER(username) = LOWER(p_username);
        RETURN jsonb_build_object('success', true, 'message', 'Credencial removida com sucesso.');
    ELSIF LOWER(p_action) = 'verify' THEN
        SELECT * INTO v_user FROM credentials WHERE LOWER(username) = LOWER(p_username);
        IF FOUND AND v_user."passwordHash" = p_password THEN
            RETURN jsonb_build_object('success', true, 'username', v_user.username, 'role', v_user.role, 'roles', v_user.roles);
        ELSE
            RETURN jsonb_build_object('success', false, 'message', 'Utilizador ou palavra-passe incorreta.');
        END IF;
    END IF;
    RETURN jsonb_build_object('success', false, 'message', 'Ação inválida.');
END;
$$ LANGUAGE plpgsql;

-- =========================================================
-- CONFIGURAÇÕES DE REGRAS DE SEGURANÇA (RLS - ROW LEVEL SECURITY)
-- =========================================================
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE credentials ENABLE ROW LEVEL SECURITY;

-- Exemplo de Políticas de Segurança para Técnicos
CREATE POLICY tecnico_full_access ON credentials
    FOR ALL TO authenticated USING (auth.jwt() ->> 'role' = 'Técnico');
`;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(sqlSchema);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden p-6" id="schema_viewer">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5 mb-6">
        <div>
          <h3 className="font-headline-md text-headline-md text-primary font-bold">Desenho Conceptual e Schema Supabase</h3>
          <p className="font-body-sm text-body-sm text-gray-500">
            Estrutura relacional PostgreSQL em conformidade com o plano free do Supabase (limite de 500MB) e regulamentações de Moçambique.
          </p>
        </div>
        <button
          onClick={copyToClipboard}
          className="flex items-center gap-2 self-start px-4 py-2 bg-primary text-white hover:opacity-90 transition-opacity font-label-md text-label-md rounded-lg"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            {copied ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
            )}
          </svg>
          {copied ? 'Copiado!' : 'Copiar Schema SQL'}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
          <div className="font-bold text-gray-800 flex items-center gap-2 text-sm mb-2">
            <span className="w-2.5 h-2.5 rounded-full bg-primary"></span>
            Gestão de Stock Modular
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            Indexação por código de barras ou SKU, suporte a conversão de unidades fracionadas (sacos de 50Kg para retalho de 1Kg, bidões de 20L para frações de 1L) e rastreio automático de lotes por datas de validade.
          </p>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
          <div className="font-bold text-gray-800 flex items-center gap-2 text-sm mb-2">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-500"></span>
            Recursos Humanos Lei 13/2023
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            Controlo automático do rácio de quotas estrangeiras (8%, 10% ou 15% conforme o escalão da empresa), cálculo de IRPS com base nas tabelas progressivas oficiais da AT de Moçambique, e segurança do INSS (3% / 4%).
          </p>
        </div>
        <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
          <div className="font-bold text-gray-800 flex items-center gap-2 text-sm mb-2">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600"></span>
            Cibersegurança e RLS
          </div>
          <p className="text-xs text-gray-600 leading-relaxed">
            Logs de auditoria e monitorização em tempo real de tentativas falhadas e bem-sucedidas. Aplicação de Row Level Security (RLS) no Supabase para garantir que apenas técnicos autorizados alterem credenciais de utilizadores.
          </p>
        </div>
      </div>

      <div className="relative">
        <pre className="text-xs bg-gray-900 text-gray-100 p-5 rounded-xl overflow-x-auto h-[400px] font-mono custom-scrollbar">
          <code>{sqlSchema}</code>
        </pre>
        <div className="absolute bottom-4 right-4 bg-gray-900/80 px-3 py-1 rounded text-[10px] text-gray-400 font-mono">
          PostgreSQL / Supabase Compatible
        </div>
      </div>
    </div>
  );
}
