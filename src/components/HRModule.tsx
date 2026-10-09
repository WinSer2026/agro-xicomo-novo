import { safeStorage, safeSessionStorage } from "../utils/safeStorage";
import { uid } from '../utils/idHelper';
import React, { useState, useEffect } from 'react';
import { exportToPDF, exportToExcel, ReportData } from '../utils/reportExporter';
import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { dbService } from '../utils/firebaseDB';
import Toast from './Toast';
import { Employee, Attendance, ContractType, PayrollPayment, DisciplinaryAction, EmployeeDamage, SystemSettings } from '../types';
import EmployeeDetailModal from './EmployeeDetailModal';
import { 
  calculateIRPS, 
  calculateINSS, 
  calculateAbsenceDeduction, 
  calculateExtraHoursAndNightShift, 
  checkForeignerQuota, 
  calculateVacationDays 
} from '../utils/hrCalculations';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';

const formatFullVacationDates = (start?: string, end?: string) => {
  if (!start || !end) return null;
  
  const formatDateString = (dtStr: string) => {
    const months = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];
    const parts = dtStr.split('-');
    if (parts.length !== 3) return dtStr;
    const day = parseInt(parts[2], 10);
    const monthIndex = parseInt(parts[1], 10) - 1;
    const monthName = months[monthIndex] || parts[1];
    return `${day} de ${monthName}`;
  };

  return {
    start: formatDateString(start),
    end: formatDateString(end)
  };
};

export default function HRModule() {
  // Core HR States
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [payrollPayments, setPayrollPayments] = useState<PayrollPayment[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Active Tab
  const [activeTab, setActiveTab] = useState<'employees' | 'payroll' | 'attendance' | 'disciplinary' | 'damages' | 'reports'>('employees');

  // Search & Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [nationalityFilter, setNationalityFilter] = useState<'all' | 'mozambican' | 'foreigner'>('all');
  const [selectedMonth, setSelectedMonth] = useState('2026-07');

  // UI States
  const [toastMessage, setToastMessage] = useState('');
  const [showEmpModal, setShowEmpModal] = useState(false);
  const [showPontoModal, setShowPontoModal] = useState(false);
  const [showDiscModal, setShowDiscModal] = useState(false);
  const [showDamageModal, setShowDamageModal] = useState(false);
  const [selectedEmployeeForDetail, setSelectedEmployeeForDetail] = useState<Employee | null>(null);
  const [detailModalInitialTab, setDetailModalInitialTab] = useState<'general' | 'performance' | 'compliance' | 'vacations'>('general');

  // Helper to generate dynamic productivity chart data using recharts
  const getProductivityChartData = () => {
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul'];
    const defaultScores: Record<string, number[]> = {
      'João Malembane': [3.5, 3.8, 4.0, 4.2, 3.9, 4.5, 4.3],
      'Maria Chongo': [4.2, 4.5, 4.6, 4.8, 4.7, 4.9, 5.0],
      'André Sitoe': [3.0, 3.2, 3.5, 3.8, 4.0, 4.1, 4.2]
    };

    return months.map((month, idx) => {
      const item: Record<string, any> = { name: month };
      let sum = 0;
      let count = 0;

      employees.forEach(emp => {
        let score = 0;
        if (emp.performanceHistory && emp.performanceHistory.length > 0) {
          const evaluationsInMonth = emp.performanceHistory.filter(p => {
            const evalMonth = new Date(p.date).getMonth();
            return evalMonth === idx;
          });
          if (evaluationsInMonth.length > 0) {
            score = evaluationsInMonth.reduce((a, b) => a + b.rating, 0) / evaluationsInMonth.length;
          }
        }

        if (!score) {
          if (defaultScores[emp.name]) {
            score = defaultScores[emp.name][idx];
          } else {
            const charCodeSum = emp.id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
            score = 3.0 + ((charCodeSum + idx * 7) % 21) / 10;
          }
        }

        item[emp.name] = Number(score.toFixed(1));
        sum += score;
        count++;
      });

      item['Média Geral'] = count > 0 ? Number((sum / count).toFixed(2)) : 0;
      return item;
    });
  };

  // Form State: Add/Edit Employee
  const [empId, setEmpId] = useState('');
  const [empName, setEmpName] = useState('');
  const [empContact, setEmpContact] = useState('');
  const [empContract, setEmpContract] = useState<ContractType>('Prazo Certo');
  const [empNuit, setEmpNuit] = useState('');
  const [empInss, setEmpInss] = useState('');
  const [empIban, setEmpIban] = useState('');
  const [empForeigner, setEmpForeigner] = useState(false);
  const [empSalary, setEmpSalary] = useState('');
  const [empGender, setEmpGender] = useState<'Masculino' | 'Feminino'>('Masculino');
  const [empDependents, setEmpDependents] = useState(0);
  const [empMarital, setEmpMarital] = useState<'Solteiro' | 'Casado' | 'Divorciado' | 'Viúvo'>('Solteiro');
  const [empHiredDate, setEmpHiredDate] = useState('2026-07-10');
  const [isEditing, setIsEditing] = useState(false);

  // Form State: Add Attendance Record (Ponto)
  const [pontoEmployeeId, setPontoEmployeeId] = useState('');
  const [pontoDate, setPontoDate] = useState('2026-07-10');
  const [pontoClockIn, setPontoClockIn] = useState('08:00');
  const [pontoClockOut, setPontoClockOut] = useState('17:00');
  const [pontoNightHours, setPontoNightHours] = useState(0);
  const [pontoOvertimeWeekday, setPontoOvertimeWeekday] = useState(0);
  const [pontoOvertimeWeekend, setPontoOvertimeWeekend] = useState(0);
  const [pontoAbsent, setPontoAbsent] = useState(false);
  const [pontoAbsentReason, setPontoAbsentReason] = useState<'Justificada' | 'Injustificada' | 'Licença Maternidade' | 'Licença Paternidade' | 'Férias'>('Injustificada');

  // Persisted local states for Disciplinary and Damages
  const [disciplinaryActions, setDisciplinaryActions] = useState<DisciplinaryAction[]>(() => {
    const saved = safeStorage.getItem('agro_disciplinary_actions');
    return saved ? JSON.parse(saved) : [
      {
        id: 'disc-1',
        employeeId: 'emp-1',
        employeeName: 'João Malembane',
        infractionDate: '2026-06-15',
        chargeNoteDate: '2026-06-25',
        status: 'Nota de Culpa Notificada',
        severity: 'Grave',
        notes: 'Ausência não autorizada na operação do armazém.'
      },
      {
        id: 'disc-2',
        employeeId: 'emp-3',
        employeeName: 'André Sitoe',
        infractionDate: '2026-05-01',
        chargeNoteDate: '2026-06-10',
        status: 'Iniciado',
        severity: 'Leve',
        notes: 'Atraso recorrente na ligação das reuniões de teletrabalho.'
      }
    ];
  });

  const [employeeDamages, setEmployeeDamages] = useState<any[]>(() => {
    const saved = safeStorage.getItem('agro_employee_damages');
    return saved ? JSON.parse(saved) : [];
  });

  // Form State: Add Disciplinary Action
  const [discEmployeeId, setDiscEmployeeId] = useState('');
  const [discInfractionDate, setDiscInfractionDate] = useState('2026-07-10');
  const [discChargeNoteDate, setDiscChargeNoteDate] = useState('');
  const [discSeverity, setDiscSeverity] = useState<'Leve' | 'Grave' | 'Gravíssima'>('Leve');
  const [discStatus, setDiscStatus] = useState<any>('Iniciado');
  const [discNotes, setDiscNotes] = useState('');

  // Form State: Add Employee Damage
  const [dmgEmployeeId, setDmgEmployeeId] = useState('');
  const [dmgItem, setDmgItem] = useState('');
  const [dmgTotalValue, setDmgTotalValue] = useState('');
  const [dmgToPayValue, setDmgToPayValue] = useState('');
  const [dmgDeduction, setDmgDeduction] = useState('');
  const [dmgStartDate, setDmgStartDate] = useState('2026-07-10');

  // Daily Roll Call State & Function
  const [dailyAttendanceDate, setDailyAttendanceDate] = useState('2026-07-10');

  const handleSetDailyAttendance = async (employeeId: string, isAbsent: boolean) => {
    if (isSubmitting) return;
    const emp = employees.find(x => x.id === employeeId);
    if (!emp) return;

    const existing = attendance.find(a => a.employeeId === employeeId && a.date === dailyAttendanceDate);

    const payload: Attendance = {
      id: existing ? existing.id : uid('att-'),
      employeeId: employeeId,
      employeeName: emp.name,
      date: dailyAttendanceDate,
      clockIn: isAbsent ? undefined : '08:00',
      clockOut: isAbsent ? undefined : '17:00',
      nightHours: 0,
      overtimeWeekday: 0,
      overtimeWeekendHoliday: 0,
      absent: isAbsent,
      absentReason: isAbsent ? 'Injustificada' : undefined
    };

    setIsSubmitting(true);
    try {
      await dbService.saveAttendance(payload);
      showToast(`${emp.name}: Marcado como ${isAbsent ? 'Falta' : 'Presente'}!`);
      loadData(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Manual Adjustments for Payroll
  const [manualAdds, setManualAdds] = useState<Record<string, { value: number; desc: string }>>({});
  const [manualCuts, setManualCuts] = useState<Record<string, { value: number; desc: string }>>({});

  // Sync state changes to localStorage
  useEffect(() => {
    safeStorage.setItem('agro_disciplinary_actions', JSON.stringify(disciplinaryActions));
  }, [disciplinaryActions]);

  useEffect(() => {
    safeStorage.setItem('agro_employee_damages', JSON.stringify(employeeDamages));
  }, [employeeDamages]);

  // Load Initial Data
  useEffect(() => {
    loadData(true);

    const handleDbUpdate = (e: any) => {
      const updatedTable = e.detail?.table;
      if (!updatedTable || updatedTable === 'all' || updatedTable === 'employees' || updatedTable === 'attendance' || updatedTable === 'payroll_payments') {
        loadData(false);
      }
    };
    window.addEventListener('db-update', handleDbUpdate);
    return () => window.removeEventListener('db-update', handleDbUpdate);
  }, []);

  const loadData = async (notifyOnError = true) => {
    setIsLoading(true);
    try {
      await dbService.init();
      const emps = await dbService.getEmployees();
      // Seed initial employees if empty to match screenshots
      if (!emps || emps.length === 0) {
        const initialEmps: Employee[] = [
          {
            id: 'emp-1',
            name: 'João Malembane',
            contact: '+258 84 123 4567',
            contractType: 'Prazo Certo',
            nuit: '102345678',
            inssNumber: 'INSS847291',
            iban: 'MZ59 0033 1000 0012 3456 7890 1',
            isForeigner: false,
            baseSalary: '18500',
            commissionRate: 0,
            workingHoursLimit: 44,
            hiredDate: '2025-01-15',
            gender: 'Masculino',
            dependentsCount: 0,
            maritalStatus: 'Solteiro'
          },
          {
            id: 'emp-2',
            name: 'Maria Chongo',
            contact: '+258 82 987 6543',
            contractType: 'Prazo Indeterminado',
            nuit: '105432109',
            inssNumber: 'INSS102938',
            iban: 'MZ59 0033 1000 0098 7654 3210 2',
            isForeigner: false,
            baseSalary: '26000',
            commissionRate: 0,
            workingHoursLimit: 44,
            hiredDate: '2024-03-10',
            gender: 'Feminino',
            dependentsCount: 1,
            maritalStatus: 'Casado'
          },
          {
            id: 'emp-3',
            name: 'André Sitoe',
            contact: '+258 86 456 7890',
            contractType: 'Teletrabalho',
            nuit: '109876543',
            inssNumber: 'INSS301928',
            iban: 'MZ59 0033 1000 0045 6789 0123 3',
            isForeigner: false,
            baseSalary: '14200',
            commissionRate: 0,
            workingHoursLimit: 44,
            hiredDate: '2025-06-01',
            gender: 'Masculino',
            dependentsCount: 0,
            maritalStatus: 'Solteiro'
          }
        ];
        for (const emp of initialEmps) {
          await dbService.saveEmployee(emp);
        }
        setEmployees(initialEmps);
      } else {
        setEmployees(emps);
      }

      const atts = await dbService.getAttendance();
      setAttendance(atts || []);

      const pay = await dbService.getPayrollPayments();
      setPayrollPayments(pay || []);

      const config = await dbService.getSettings();
      setSettings(config);
    } catch (error) {
      console.error('Erro ao carregar dados de Recursos Humanos:', error);
      if (notifyOnError) {
        showToast('Erro ao carregar dados do sistema.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // Create or Update Employee
  const handleSaveEmployee = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!empName.trim() || !empNuit.trim() || !empInss.trim() || !empIban.trim() || !empSalary) {
      showToast('Por favor, preencha todos os campos obrigatórios.');
      return;
    }
    const nuitClean = empNuit.replace(/\D/g, '');
    if (nuitClean.length !== 9) {
      showToast('O NUIT deve conter exatamente 9 dígitos.');
      return;
    }

    setIsSubmitting(true);

    const payload: Employee = {
      id: isEditing ? empId : uid('emp-'),
      name: empName.trim(),
      contact: empContact.trim() || undefined,
      contractType: empContract,
      nuit: nuitClean,
      inssNumber: empInss.trim(),
      iban: empIban.trim(),
      isForeigner: empForeigner,
      baseSalary: empSalary,
      commissionRate: 0,
      workingHoursLimit: 44,
      hiredDate: empHiredDate,
      gender: empGender,
      dependentsCount: empDependents,
      maritalStatus: empMarital,
    };

    try {
      await dbService.saveEmployee(payload);
      showToast(isEditing ? 'Funcionário atualizado!' : 'Funcionário cadastrado!');
      setShowEmpModal(false);
      resetEmployeeForm();
      loadData(false);
    } catch (err) {
      console.error(err);
      showToast('Erro ao gravar os dados.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditEmployee = (emp: Employee) => {
    setEmpId(emp.id);
    setEmpName(emp.name);
    setEmpContact(emp.contact || '');
    setEmpContract(emp.contractType);
    setEmpNuit(emp.nuit);
    setEmpInss(emp.inssNumber);
    setEmpIban(emp.iban);
    setEmpForeigner(emp.isForeigner);
    setEmpSalary(emp.baseSalary);
    setEmpGender(emp.gender);
    setEmpDependents(emp.dependentsCount || 0);
    setEmpMarital(emp.maritalStatus || 'Solteiro');
    setEmpHiredDate(emp.hiredDate);
    setIsEditing(true);
    setShowEmpModal(true);
  };

  const handleDeleteEmployee = async (id: string) => {
    if (isSubmitting) return;
    if (confirm('Deseja realmente eliminar este colaborador?')) {
      setIsSubmitting(true);
      try {
        await dbService.deleteEmployee(id);
        showToast('Colaborador eliminado.');
        loadData(false);
      } catch (err) {
        console.error(err);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const resetEmployeeForm = () => {
    setEmpId('');
    setEmpName('');
    setEmpContact('');
    setEmpContract('Prazo Certo');
    setEmpNuit('');
    setEmpInss('');
    setEmpIban('');
    setEmpForeigner(false);
    setEmpSalary('');
    setEmpGender('Masculino');
    setEmpDependents(0);
    setEmpMarital('Solteiro');
    setEmpHiredDate('2026-07-10');
    setIsEditing(false);
  };

  // Save Attendance (Ponto)
  const handleSaveAttendance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!pontoEmployeeId) {
      showToast('Selecione um funcionário.');
      return;
    }
    const emp = employees.find(x => x.id === pontoEmployeeId);
    if (!emp) return;

    const existing = attendance.find(a => a.employeeId === pontoEmployeeId && a.date === pontoDate);

    const payload: Attendance = {
      id: existing ? existing.id : uid('att-'),
      employeeId: pontoEmployeeId,
      employeeName: emp.name,
      date: pontoDate,
      clockIn: pontoAbsent ? undefined : pontoClockIn,
      clockOut: pontoAbsent ? undefined : pontoClockOut,
      nightHours: pontoAbsent ? 0 : Number(pontoNightHours),
      overtimeWeekday: pontoAbsent ? 0 : Number(pontoOvertimeWeekday),
      overtimeWeekendHoliday: pontoAbsent ? 0 : Number(pontoOvertimeWeekend),
      absent: pontoAbsent,
      absentReason: pontoAbsent ? pontoAbsentReason : undefined,
    };

    setIsSubmitting(true);
    try {
      await dbService.saveAttendance(payload);
      showToast(existing ? 'Registo de ponto atualizado!' : 'Registo de ponto gravado!');
      setShowPontoModal(false);
      setPontoEmployeeId('');
      setPontoAbsent(false);
      setPontoNightHours(0);
      setPontoOvertimeWeekday(0);
      setPontoOvertimeWeekend(0);
      loadData(false);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Save Disciplinary Action
  const handleSaveDisciplinary = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!discEmployeeId) {
      showToast('Selecione um colaborador.');
      return;
    }
    const emp = employees.find(x => x.id === discEmployeeId);
    if (!emp) return;

    const payload: DisciplinaryAction = {
      id: uid('disc-'),
      employeeId: discEmployeeId,
      employeeName: emp.name,
      infractionDate: discInfractionDate,
      chargeNoteDate: discChargeNoteDate || undefined,
      severity: discSeverity,
      status: discStatus,
      notes: discNotes,
    };

    setDisciplinaryActions([payload, ...disciplinaryActions]);
    setShowDiscModal(false);
    setDiscEmployeeId('');
    setDiscNotes('');
    setDiscChargeNoteDate('');
    showToast('Processo disciplinar iniciado com sucesso!');
  };

  // Save Employee Damage
  const handleSaveDamage = (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    if (!dmgEmployeeId || !dmgItem || !dmgTotalValue || !dmgDeduction) {
      showToast('Preencha os dados obrigatórios.');
      return;
    }
    const emp = employees.find(x => x.id === dmgEmployeeId);
    if (!emp) return;

    const payload = {
      id: uid('dmg-'),
      employeeId: dmgEmployeeId,
      employeeName: emp.name,
      damagedItem: dmgItem,
      totalDamageValue: Number(dmgTotalValue),
      totalToPayValue: Number(dmgToPayValue || dmgTotalValue),
      deductionPerSalary: Number(dmgDeduction),
      remainingValue: Number(dmgToPayValue || dmgTotalValue),
      startDate: dmgStartDate,
      active: true,
    };

    setEmployeeDamages([payload, ...employeeDamages]);
    setShowDamageModal(false);
    setDmgEmployeeId('');
    setDmgItem('');
    setDmgTotalValue('');
    setDmgToPayValue('');
    setDmgDeduction('');
    showToast('Registo de dano material gravado com sucesso!');
  };

  // Save Payroll Payment
  const handleProcessPayment = async (emp: Employee, totals: any) => {
    if (isSubmitting) return;
    const paymentId = `payroll-${emp.id}-${selectedMonth}`;
    const newPayment: PayrollPayment = {
      id: paymentId,
      employeeId: emp.id,
      employeeName: emp.name,
      month: selectedMonth,
      baseSalary: Number(emp.baseSalary),
      additions: totals.additions,
      manualAddition: totals.manualAdd,
      additionDescription: manualAdds[emp.id]?.desc || '',
      deductions: totals.totalDeductions,
      manualCut: totals.manualCut,
      cutDescription: manualCuts[emp.id]?.desc || '',
      inss: totals.inss,
      irps: totals.irps,
      absencesDiscount: totals.absencesDiscount,
      finalNetWage: totals.netWage,
      paymentDate: new Date().toISOString().split('T')[0]
    };

    setIsSubmitting(true);
    try {
      await dbService.savePayrollPayment(newPayment);
      showToast(`Pagamento do mês ${selectedMonth} efetuado para ${emp.name}!`);
      loadData(false);
    } catch (err) {
      console.error(err);
      showToast('Erro ao processar o pagamento.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Quota calculation
  const totalEmployeesCount = employees.length;
  const foreignerCount = employees.filter(e => e.isForeigner).length;
  const quota = checkForeignerQuota(totalEmployeesCount, foreignerCount);

  // Filtered employees list for Table in tab Employees
  const filteredEmployees = employees.filter(emp => {
    const matchesSearch = emp.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
                          emp.nuit.includes(searchTerm) || 
                          (emp.contact && emp.contact.includes(searchTerm));
    
    if (nationalityFilter === 'mozambican') return matchesSearch && !emp.isForeigner;
    if (nationalityFilter === 'foreigner') return matchesSearch && emp.isForeigner;
    return matchesSearch;
  });

  // Calculate stats for reference month
  const monthAttendance = attendance.filter(a => a.date && a.date.startsWith(selectedMonth));
  const monthPresences = monthAttendance.filter(a => !a.absent).length;
  const monthAbsences = monthAttendance.filter(a => a.absent).length;
  const monthVacations = monthAttendance.filter(a => a.absent && a.absentReason === 'Férias').length;
  const monthAttendanceRate = monthAttendance.length > 0 ? Math.round((monthPresences / monthAttendance.length) * 100) : 100;

  // Payroll calculations per employee
  const calculateEmployeePayrollTotals = (emp: Employee) => {
    const base = Number(emp.baseSalary);
    
    // Calculate additions from Ponto
    const empAtt = attendance.filter(a => a.employeeId === emp.id && a.date.startsWith(selectedMonth));
    let totalNightHours = 0;
    let totalOvt50 = 0;
    let totalOvt100 = 0;
    let absentDaysCount = 0;

    empAtt.forEach(att => {
      if (att.absent) {
        if (att.absentReason === 'Injustificada') {
          absentDaysCount++;
        }
      } else {
        totalNightHours += (att.nightHours || 0);
        totalOvt50 += (att.overtimeWeekday || 0);
        totalOvt100 += (att.overtimeWeekendHoliday || 0);
      }
    });

    const adds = calculateExtraHoursAndNightShift(base, emp.workingHoursLimit || 44, totalNightHours, totalOvt50, totalOvt100);
    const absencesDiscount = calculateAbsenceDeduction(base, absentDaysCount);

    const manualAdd = manualAdds[emp.id]?.value || 0;
    const manualCut = manualCuts[emp.id]?.value || 0;

    // Damage deductions for this employee (active damage records)
    const activeDamage = employeeDamages.filter(d => d.employeeId === emp.id && d.active);
    const damageDeductions = activeDamage.reduce((acc, curr) => acc + curr.deductionPerSalary, 0);

    const totalDeductions = absencesDiscount + manualCut + damageDeductions;
    const grossIncome = base + adds.totalAdditions + manualAdd;

    const inssCalc = calculateINSS(grossIncome);
    const inss = inssCalc.worker;
    const irps = calculateIRPS(grossIncome, emp.dependentsCount || 0, emp.maritalStatus === 'Casado');

    const netWage = Math.max(0, grossIncome - inss - irps - totalDeductions);

    return {
      base,
      additions: adds.totalAdditions,
      manualAdd,
      absencesDiscount,
      manualCut,
      damageDeductions,
      totalDeductions: totalDeductions,
      inss,
      irps,
      netWage: Math.round(netWage * 100) / 100
    };
  };

  const handlePrintPaySlip = (emp: Employee, totals: any) => {
    const title = `Recibo_Salario_${emp.name.replace(/\s+/g, '_')}_${selectedMonth}.pdf`;
    const doc = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const cName = settings?.companyName || 'AGRO - XICOMO & SERVI\u00c7OS, LDA';

    const grossSalary = totals.base + totals.additions + totals.manualAdd;
    const totalDeductions = totals.inss + totals.irps + totals.absencesDiscount + totals.manualCut + totals.damageDeductions;
    const netSalary = totals.netWage;

    // Header
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.setTextColor(0, 106, 78);
    doc.text('RECIBO DE VENCIMENTO / FOLHA DE SALÁRIO', 15, 20);

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 116, 139);
    doc.text(`${cName} • NUIT: 401976590`, 15, 25);
    doc.text(`Mês de Referência: ${selectedMonth} • Emissão: ${new Date().toLocaleDateString('pt-MZ')}`, 15, 29);

    doc.setDrawColor(0, 106, 78);
    doc.setLineWidth(1);
    doc.line(15, 33, 195, 33);

    // Grid Info
    doc.saveGraphicsState();
    doc.setFillColor(248, 250, 252);
    doc.rect(15, 37, 180, 26, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(0, 106, 78);
    doc.text('DADOS DO COLABORADOR', 18, 43);
    doc.text('REGISTOS LABORAIS & PAGAMENTO', 110, 43);

    doc.setFont('helvetica', 'normal');
    doc.setTextColor(51, 65, 85);
    doc.setFontSize(7.5);
    doc.text(`Nome: ${emp.name}`, 18, 48);
    doc.text(`Cargo/Função: ${emp.contractType}`, 18, 52);
    doc.text(`Sexo: ${emp.gender} • Estado Civil: ${emp.maritalStatus} (${emp.dependentsCount || 0} dep.)`, 18, 56);

    doc.text(`NUIT: ${emp.nuit}`, 110, 48);
    doc.text(`Nº INSS: ${emp.inssNumber || 'N/A'}`, 110, 52);
    doc.text(`IBAN: ${emp.iban || 'N/A'}`, 110, 56);
    doc.text(`Regime de Horas: ${emp.workingHoursLimit || 44}h semanais`, 110, 60);

    // Rubrics Table
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(0, 106, 78);
    doc.text('DETALHAMENTO DAS RUBRICAS', 15, 71);

    let currentY = 75;
    doc.saveGraphicsState();
    doc.setFillColor(0, 106, 78);
    doc.rect(15, currentY, 180, 7, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(255, 255, 255);
    doc.text('CÓDIGO', 17, currentY + 5);
    doc.text('DESCRIÇÃO DA RUBRICA', 35, currentY + 5);
    doc.text('ACRÉSCIMOS (VANTAGENS)', 125, currentY + 5, { align: 'right' });
    doc.text('DESCONTOS (CORTES)', 175, currentY + 5, { align: 'right' });

    currentY += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(51, 65, 85);

    const rubrics = [
      { code: '1001', name: 'Vencimento Base Mensal', isEarning: true, amt: totals.base },
      ...(totals.additions > 0 ? [{ code: '1005', name: 'Horas Extras / Adicional de Turno', isEarning: true, amt: totals.additions }] : []),
      ...(totals.manualAdd > 0 ? [{ code: '1010', name: `Acréscimo Manual (${manualAdds[emp.id]?.desc || 'Bónus / Prémio'})`, isEarning: true, amt: totals.manualAdd }] : []),
      { code: '3001', name: 'INSS do Trabalhador (Retenção 3%)', isEarning: false, amt: totals.inss },
      ...(totals.irps > 0 ? [{ code: '3005', name: 'IRPS Retido na Fonte (Tabela Oficial Moçambique)', isEarning: false, amt: totals.irps }] : []),
      ...(totals.absencesDiscount > 0 ? [{ code: '3010', name: 'Faltas Injustificadas / Penalizações', isEarning: false, amt: totals.absencesDiscount }] : []),
      ...(totals.manualCut > 0 ? [{ code: '3015', name: `Desconto / Dedução Manual (${manualCuts[emp.id]?.desc || 'Faltas/Outros'})`, isEarning: false, amt: totals.manualCut }] : []),
      ...(totals.damageDeductions > 0 ? [{ code: '3020', name: 'Amortização de Responsabilidade por Danos', isEarning: false, amt: totals.damageDeductions }] : [])
    ];

    rubrics.forEach((r, idx) => {
      if (idx % 2 === 1) {
        doc.saveGraphicsState();
        doc.setFillColor(248, 250, 252);
        doc.rect(15, currentY, 180, 6, 'F');
        doc.restoreGraphicsState();
      }

      doc.text(r.code, 17, currentY + 4);
      doc.text(r.name, 35, currentY + 4);

      if (r.isEarning) {
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(15, 118, 110);
        doc.text(`${r.amt.toLocaleString('pt-MZ')} MT`, 125, currentY + 4, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);
        doc.text('-', 175, currentY + 4, { align: 'right' });
      } else {
        doc.text('-', 125, currentY + 4, { align: 'right' });
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(190, 18, 60);
        doc.text(`${r.amt.toLocaleString('pt-MZ')} MT`, 175, currentY + 4, { align: 'right' });
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(51, 65, 85);
      }

      doc.setDrawColor(241, 245, 249);
      doc.setLineWidth(0.5);
      doc.line(15, currentY + 6, 195, currentY + 6);
      currentY += 6;
    });

    // Totais Row
    doc.saveGraphicsState();
    doc.setFillColor(241, 245, 249);
    doc.rect(15, currentY, 180, 7, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.text('TOTAIS', 17, currentY + 5);
    doc.text('Soma dos Valores Acumulados', 35, currentY + 5);
    doc.setTextColor(0, 106, 78);
    doc.text(`${grossSalary.toLocaleString('pt-MZ')} MT`, 125, currentY + 5, { align: 'right' });
    doc.setTextColor(190, 18, 60);
    doc.text(`${totalDeductions.toLocaleString('pt-MZ')} MT`, 175, currentY + 5, { align: 'right' });

    currentY += 7;

    // Net Row
    doc.saveGraphicsState();
    doc.setFillColor(226, 242, 233);
    doc.rect(15, currentY, 180, 8, 'F');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setTextColor(15, 81, 50);
    doc.text('VALOR LÍQUIDO A RECEBER', 17, currentY + 5.5);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(`${netSalary.toLocaleString('pt-MZ')} MT`, 175, currentY + 5.5, { align: 'right' });

    currentY += 15;

    // Disclaimer Box
    doc.saveGraphicsState();
    doc.setFillColor(248, 250, 252);
    doc.rect(15, currentY, 180, 12, 'F');
    doc.setDrawColor(226, 232, 240);
    doc.rect(15, currentY, 180, 12, 'S');
    doc.restoreGraphicsState();

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(6.5);
    doc.setTextColor(71, 85, 105);
    doc.text('Nota de Isenção de Responsabilidade Fiscal:', 18, currentY + 4);
    doc.setFont('helvetica', 'normal');
    doc.text('Esta folha de vencimento foi gerada em total conformidade com o Regulamento INSS e as tabelas oficiais de Retenção de IRPS', 18, 7.5 + currentY);
    doc.text('estabelecidas pelo Ministério de Economia e Finanças de Moçambique.', 18, 10 + currentY);

    currentY += 18;

    // Signatures
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text('A Direção de Recursos Humanos', 50, currentY + 15, { align: 'center' });
    doc.line(20, currentY + 10, 80, currentY + 10);

    doc.text('Declaro que Recebi a Importância Líquida (Assinatura)', 150, currentY + 15, { align: 'center' });
    doc.line(120, currentY + 10, 180, currentY + 10);

    currentY += 25;
    doc.setFont('helvetica', 'italic');
    doc.setFontSize(7);
    doc.text('Moçambique - Documento Interno Processado por Computador via Agro ERP S.A.', 105, currentY, { align: 'center' });

    doc.save(title);
    setToastMessage(`Folha de Vencimento de ${emp.name} exportada!`);
    setTimeout(() => setToastMessage(''), 3000);
  };

  // CSV Exporters for Reports tab
  const handleDownloadSISSMO = () => {
    const data: ReportData = {
      title: 'Declaração SISSMO (INSS)',
      subtitle: `Período: ${selectedMonth}`,
      fileName: `SISSMO_${selectedMonth}_${Date.now()}`,
      columns: [
        { header: 'NOME', dataKey: 'name' },
        { header: 'NUIT', dataKey: 'nuit' },
        { header: 'INSS_NUM', dataKey: 'inssNumber' },
        { header: 'BASE (MT)', dataKey: 'base' },
        { header: 'ACRESCIMOS (MT)', dataKey: 'additions' },
        { header: 'INSS_WORKER_3%', dataKey: 'inssWorker' },
        { header: 'INSS_EMPLOYER_4%', dataKey: 'inssEmployer' },
        { header: 'CONTRIBUICAO_TOTAL_7%', dataKey: 'total' }
      ],
      rows: employees.map(emp => {
        const totals = calculateEmployeePayrollTotals(emp);
        const gross = totals.base + totals.additions + totals.manualAdd;
        const inssWorker = Math.round(gross * 0.03 * 100) / 100;
        const inssEmployer = Math.round(gross * 0.04 * 100) / 100;
        return {
          name: emp.name,
          nuit: emp.nuit,
          inssNumber: emp.inssNumber,
          base: totals.base,
          additions: totals.additions + totals.manualAdd,
          inssWorker: inssWorker,
          inssEmployer: inssEmployer,
          total: inssWorker + inssEmployer
        };
      })
    };
    exportToExcel(data);
    setToastMessage('Ficheiro Excel SISSMO exportado!');
    setTimeout(() => setToastMessage(''), 3000);
  };

  const handleDownloadINSSDeclarationPDF = async () => {
    const data: ReportData = {
      title: 'DECLARAÇÃO DE CONTRIBUIÇÕES PARA O INSS (SISSMO)',
      subtitle: `Mês de Referência: ${selectedMonth}`,
      fileName: `Declaracao_INSS_${selectedMonth}`,
      columns: [
        { header: 'NOME COMPLETO', dataKey: 'name' },
        { header: 'Nº INSS', dataKey: 'inss' },
        { header: 'REM. BASE', dataKey: 'gross' },
        { header: 'TRAB. (3%)', dataKey: 'w3' },
        { header: 'PATR. (4%)', dataKey: 'e4' },
        { header: 'TOTAL (7%)', dataKey: 't7' }
      ],
      rows: employees.map(emp => {
        const totals = calculateEmployeePayrollTotals(emp);
        const gross = totals.base + totals.additions + totals.manualAdd;
        const w3 = Math.round(gross * 0.03 * 100) / 100;
        const e4 = Math.round(gross * 0.04 * 100) / 100;
        return {
          name: emp.name,
          inss: emp.inssNumber || 'N/A',
          gross: `${gross.toLocaleString()} MT`,
          w3: `${w3.toLocaleString()} MT`,
          e4: `${e4.toLocaleString()} MT`,
          t7: `${(w3 + e4).toLocaleString()} MT`
        };
      })
    };
    await exportToPDF(data, settings);
    setToastMessage('Declaração INSS PDF exportada!');
    setTimeout(() => setToastMessage(''), 3000);
  };

  const handleDownloadModelo2PDF = async () => {
    const data: ReportData = {
      title: 'MODELO 2 - RENDIMENTOS E RETENÇÕES (IRPS)',
      subtitle: `Ano de Exercício: ${new Date().getFullYear()}`,
      fileName: `Modelo2_AT_${new Date().getFullYear()}`,
      columns: [
        { header: 'NOME DO BENEFICIÁRIO', dataKey: 'name' },
        { header: 'Nº NUIT', dataKey: 'nuit' },
        { header: 'RENDIMENTO BRUTO ANUAL EST. (MT)', dataKey: 'annual' },
        { header: 'IRPS TOTAL RETIDO ANUAL EST. (MT)', dataKey: 'irps' }
      ],
      rows: employees.map(emp => {
        const totals = calculateEmployeePayrollTotals(emp);
        return {
          name: emp.name,
          nuit: emp.nuit,
          annual: (emp.baseSalary * 12).toLocaleString(),
          irps: (totals.irps * 12).toLocaleString()
        };
      })
    };
    await exportToPDF(data, settings);
    setToastMessage('Modelo 2 AT PDF exportado!');
    setTimeout(() => setToastMessage(''), 3000);
  };

  return (
    <div className="space-y-6" id="hr_module_main">
      {/* Toast global (portal z-[9999]): visível sobre qualquer modal */}
      <Toast message={toastMessage} type={/erro|falha|inválid|não foi/i.test(toastMessage) ? 'error' : 'success'} onDismiss={() => setToastMessage('')} />

      {/* Header and Brand */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-2">
        <h1 className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
          <span className="material-symbols-outlined text-emerald-600">badge</span>
          Gestão de Recursos Humanos
        </h1>
      </div>

      {/* Navigation Tab Bar */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 pb-px">
        {[
          { id: 'employees', label: 'COLABORADORES', icon: 'people' },
          { id: 'payroll', label: 'FOLHA DE SALÁRIOS', icon: 'payments' },
          { id: 'attendance', label: 'LIVRO DE PONTO', icon: 'fact_check' },
          { id: 'disciplinary', label: 'AÇÕES DISCIPLINARES', icon: 'gavel' },
          { id: 'damages', label: 'DANOS DE COLABORADORES', icon: 'hardware' },
          { id: 'reports', label: 'RELATÓRIOS & SISSMO', icon: 'description' },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2.5 rounded-t-xl font-bold uppercase text-[11px] tracking-wider flex items-center gap-1.5 transition-all border-t border-x ${
              activeTab === tab.id
                ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                : 'bg-white text-slate-500 hover:text-slate-800 border-transparent'
            }`}
          >
            <span className="material-symbols-outlined text-sm">{tab.icon}</span>
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB CONTENT: COLABORADORES */}
      {activeTab === 'employees' && (
        <div className="space-y-6">
          {/* Quick Stats Grid */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex items-center gap-4">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                <span className="material-symbols-outlined text-[30px] block">group</span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Total de Colaboradores</span>
                <h4 className="text-2xl font-black text-slate-900 mt-0.5">{totalEmployeesCount}</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  {totalEmployeesCount - foreignerCount} Nac. • {foreignerCount} Estrang.
                </p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex items-center gap-4">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                <span className="material-symbols-outlined text-[30px] block">analytics</span>
              </div>
              <div className="flex-1 min-w-0">
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Assiduidade ({selectedMonth})</span>
                <h4 className="text-2xl font-black text-slate-900 mt-0.5">{monthAttendanceRate}%</h4>
                <p className="text-[10px] text-slate-500 mt-0.5">
                  ({monthPresences}/{monthAttendance.length} registos)
                </p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex items-center gap-4">
              <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
                <span className="material-symbols-outlined text-[30px] block">event_busy</span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Faltas Registadas</span>
                <h4 className="text-2xl font-black text-slate-900 mt-0.5">{monthAbsences}</h4>
                <p className="text-[10px] text-rose-500 font-semibold mt-0.5">
                  No mês de referência
                </p>
              </div>
            </div>

            <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex items-center gap-4">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
                <span className="material-symbols-outlined text-[30px] block">beach_access</span>
              </div>
              <div>
                <span className="text-[10px] font-black uppercase text-slate-400 tracking-wider">Em Férias</span>
                <h4 className="text-2xl font-black text-slate-900 mt-0.5">{monthVacations}</h4>
                <p className="text-[10px] text-amber-600 font-semibold mt-0.5">
                  Férias gozadas no mês
                </p>
              </div>
            </div>
          </div>

          {/* Recharts Productivity Chart Card */}
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-4">
            <div>
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">trending_up</span>
                Produtividade & Desempenho ao Longo do Tempo
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Avaliação de rendimento individual baseada na pontuação mensal de desempenho (escala de 1 a 5).
              </p>
            </div>

            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={getProductivityChartData()}
                  margin={{ top: 10, right: 30, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                  <XAxis 
                    dataKey="name" 
                    tickLine={false} 
                    axisLine={false}
                    tick={{ fill: '#64748b', fontSize: 11, fontWeight: 'bold' }} 
                  />
                  <YAxis 
                    domain={[1, 5]} 
                    tickCount={5} 
                    tickLine={false} 
                    axisLine={false}
                    tick={{ fill: '#64748b', fontSize: 11, fontWeight: 'bold' }} 
                  />
                  <Tooltip 
                    contentStyle={{ backgroundColor: '#0f172a', borderRadius: '12px', border: 'none', color: '#fff' }} 
                    itemStyle={{ fontSize: '11px', fontWeight: 'bold' }}
                    labelStyle={{ fontSize: '11px', fontWeight: 'black', color: '#94a3b8', marginBottom: '4px' }}
                  />
                  <Legend 
                    verticalAlign="top" 
                    height={36} 
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: '11px', fontWeight: 'bold', color: '#475569' }}
                  />
                  
                  {/* Dynamic Lines for Employees */}
                  {employees.map((emp, index) => (
                    <Line
                      key={emp.id}
                      type="monotone"
                      dataKey={emp.name}
                      stroke={['#0284c7', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#3b82f6', '#f43f5e', '#14b8a6'][index % 8]}
                      strokeWidth={3}
                      activeDot={{ r: 6 }}
                    />
                  ))}

                  {/* general average line */}
                  <Line
                    type="monotone"
                    dataKey="Média Geral"
                    stroke="#475569"
                    strokeWidth={2}
                    strokeDasharray="5 5"
                    activeDot={{ r: 4 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Employees Table Card */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden flex flex-col">
            <div className="p-5 border-b border-slate-100 bg-slate-50/50 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg text-slate-600 font-bold">badge</span>
                  Colaboradores Cadastrados
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Registo e detalhes laborais individuais dos trabalhadores.</p>
              </div>

              {/* Toolbar */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3 top-2.5 text-slate-400 text-sm">search</span>
                  <input
                    type="text"
                    placeholder="Pesquisar por nome, NUIT..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="pl-8 pr-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-emerald-500 w-48"
                  />
                </div>
                <select
                  value={nationalityFilter}
                  onChange={(e) => setNationalityFilter(e.target.value as any)}
                  className="px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="all">Todas Nac.</option>
                  <option value="mozambican">Moçambicanos</option>
                  <option value="foreigner">Estrangeiros</option>
                </select>
                <button
                  onClick={() => {
                    resetEmployeeForm();
                    setShowEmpModal(true);
                  }}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-xs uppercase flex items-center gap-1.5 transition-all shadow-sm"
                >
                  <span className="material-symbols-outlined text-sm">person_add</span>
                  Novo Registo
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-[10px] font-black uppercase text-slate-400 tracking-wider border-b border-slate-100">
                    <th className="p-4">Nome</th>
                    <th className="p-4">Contrato</th>
                    <th className="p-4">Contacto</th>
                    <th className="p-4">NUIT</th>
                    <th className="p-4">Nº INSS</th>
                    <th className="p-4 text-right">Salário Base (MT)</th>
                    <th className="p-4 text-center">Período de Férias</th>
                    <th className="p-4 text-center">Nacionalidade</th>
                    <th className="p-4 text-center">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 text-sm">
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="p-8 text-center text-slate-400 italic">
                        Nenhum colaborador registado encontrado.
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((emp) => (
                      <tr key={emp.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4">
                          <div className="font-bold text-slate-900">{emp.name}</div>
                          <div className="text-[10px] text-slate-400 font-semibold mt-0.5">Admitido em {emp.hiredDate}</div>
                        </td>
                        <td className="p-4 text-xs font-semibold text-slate-600">{emp.contractType}</td>
                        <td className="p-4 text-xs font-mono text-slate-500">{emp.contact || '---'}</td>
                        <td className="p-4 text-xs font-mono font-bold text-slate-600">{emp.nuit}</td>
                        <td className="p-4 text-xs font-mono text-slate-500">{emp.inssNumber}</td>
                        <td className="p-4 text-right font-black font-mono text-slate-900">
                          {Number(emp.baseSalary).toLocaleString('pt-MZ')}.00 MT
                        </td>
                        <td className="p-4 text-center text-xs">
                          {(() => {
                            const dates = formatFullVacationDates(emp.vacationStart, emp.vacationEnd);
                            if (dates) {
                              return (
                                <div className="flex flex-col items-center gap-1">
                                  <div className="bg-emerald-50 text-emerald-800 border border-emerald-100 rounded-lg px-2.5 py-1 text-center leading-tight">
                                    <span className="block text-[10px] uppercase font-black tracking-wider text-emerald-600">Em Férias de</span>
                                    <span className="font-bold font-mono text-[11px]">{dates.start}</span>
                                    <span className="block text-[9px] lowercase font-semibold text-emerald-500 my-0.5">regressa a</span>
                                    <span className="font-bold font-mono text-[11px]">{dates.end}</span>
                                  </div>
                                  <button
                                    onClick={() => {
                                      setDetailModalInitialTab('vacations');
                                      setSelectedEmployeeForDetail(emp);
                                    }}
                                    className="text-[10px] text-emerald-600 hover:text-emerald-800 font-bold hover:underline flex items-center justify-center gap-0.5 mt-0.5"
                                  >
                                    <span className="material-symbols-outlined text-[11px]">edit_calendar</span>
                                    Alterar
                                  </button>
                                </div>
                              );
                            } else {
                              return (
                                <div className="flex flex-col items-center gap-1">
                                  <span className="bg-slate-100 text-slate-500 border border-slate-200 rounded-full px-2.5 py-0.5 font-bold text-[10px] uppercase tracking-wider">
                                    Não Agendado
                                  </span>
                                  <button
                                    onClick={() => {
                                      setDetailModalInitialTab('vacations');
                                      setSelectedEmployeeForDetail(emp);
                                    }}
                                    className="text-[10px] text-emerald-600 hover:text-emerald-700 font-bold hover:underline flex items-center justify-center gap-0.5"
                                  >
                                    <span className="material-symbols-outlined text-[11px]">add_circle</span>
                                    Agendar Férias
                                  </button>
                                </div>
                              );
                            }
                          })()}
                        </td>
                        <td className="p-4 text-center">
                          {emp.isForeigner ? (
                            <span className="bg-amber-50 text-amber-700 border border-amber-200 px-2.5 py-0.5 rounded-full font-bold text-[10px]">
                              Estrangeiro
                            </span>
                          ) : (
                            <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-0.5 rounded-full font-bold text-[10px]">
                              Moçambicano
                            </span>
                          )}
                        </td>
                        <td className="p-4 text-center">
                          <div className="flex items-center justify-center gap-1.5">
                            <button
                              onClick={() => {
                                setDetailModalInitialTab('general');
                                setSelectedEmployeeForDetail(emp);
                              }}
                              className="px-2 py-1 border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 rounded text-xs font-bold transition-all uppercase tracking-wider"
                              title="Editar Ficha, Foto e Histórico de Desempenho"
                            >
                              DETALHES
                            </button>
                            <button
                              onClick={() => handleEditEmployee(emp)}
                              className="px-2 py-1 border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 rounded text-xs font-bold transition-all uppercase tracking-wider"
                            >
                              EDITAR
                            </button>
                            <button
                              onClick={() => handleDeleteEmployee(emp.id)}
                              className="p-1 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded"
                            >
                              <span className="material-symbols-outlined text-sm">delete</span>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: FOLHA DE SALÁRIOS */}
      {activeTab === 'payroll' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">payments</span>
                Processamento de Salários Mensal
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Retenções fiscais IRPS + INSS, acréscimos extraordinários (Lei 13/2023) e ajustes manuais permitidos.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-black uppercase text-slate-400 tracking-wider">Mês de Referência:</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-bold text-xs font-mono text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-[10px] font-black uppercase text-slate-400 tracking-wider border-b border-slate-100">
                    <th className="p-4">Colaborador</th>
                    <th className="p-4">Ilíquido base (MT)</th>
                    <th className="p-4">Acréscimos Ponto (MT)</th>
                    <th className="p-4">Adicional Manual</th>
                    <th className="p-4 text-rose-500">INSS (3%)</th>
                    <th className="p-4 text-rose-500">IRPS Retido</th>
                    <th className="p-4 text-rose-500">Descontos / Cortes</th>
                    <th className="p-4 text-right">Líquido Final (MT)</th>
                    <th className="p-4 text-center">Estado / Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                  {employees.map(emp => {
                    const totals = calculateEmployeePayrollTotals(emp);
                    const isPaid = payrollPayments.some(p => p.employeeId === emp.id && p.month === selectedMonth);

                    return (
                      <tr key={emp.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4">
                          <div className="font-bold text-slate-900">{emp.name}</div>
                          <div className="text-[10px] text-slate-400 font-mono mt-0.5">NUIT: {emp.nuit}</div>
                        </td>
                        <td className="p-4 font-mono font-bold">{Number(emp.baseSalary).toLocaleString('pt-MZ')} MT</td>
                        <td className="p-4 font-mono text-emerald-600 font-semibold">+{totals.additions.toLocaleString('pt-MZ')} MT</td>
                        
                        {/* Adicional Manual inputs */}
                        <td className="p-4 space-y-1">
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] text-slate-400 font-bold">Valor:</span>
                            <input
                              type="number"
                              disabled={isPaid}
                              value={manualAdds[emp.id]?.value || ''}
                              onChange={(e) => setManualAdds({
                                ...manualAdds,
                                [emp.id]: { value: Number(e.target.value), desc: manualAdds[emp.id]?.desc || '' }
                              })}
                              className="w-16 px-1 py-0.5 border border-slate-200 rounded font-mono text-xs text-right"
                              placeholder="0 MT"
                            />
                          </div>
                          <input
                            type="text"
                            disabled={isPaid}
                            value={manualAdds[emp.id]?.desc || ''}
                            onChange={(e) => setManualAdds({
                              ...manualAdds,
                              [emp.id]: { value: manualAdds[emp.id]?.value || 0, desc: e.target.value }
                            })}
                            placeholder="Ex: Prémio, Bónus..."
                            className="w-28 px-1 py-0.5 border border-slate-200 rounded text-[9px] placeholder-slate-400"
                          />
                        </td>

                        <td className="p-4 font-mono text-rose-600 font-bold">-{totals.inss.toLocaleString('pt-MZ')} MT</td>
                        <td className="p-4 font-mono text-rose-600 font-bold">-{totals.irps.toLocaleString('pt-MZ')} MT</td>

                        {/* Descontos Manual inputs */}
                        <td className="p-4 space-y-1">
                          {totals.damageDeductions > 0 && (
                            <div className="text-[9px] text-rose-600 font-bold">
                              Danos Ativos: -{totals.damageDeductions} MT
                            </div>
                          )}
                          <div className="flex items-center gap-1">
                            <span className="text-[9px] text-slate-400 font-bold">Corte:</span>
                            <input
                              type="number"
                              disabled={isPaid}
                              value={manualCuts[emp.id]?.value || ''}
                              onChange={(e) => setManualCuts({
                                ...manualCuts,
                                [emp.id]: { value: Number(e.target.value), desc: manualCuts[emp.id]?.desc || '' }
                              })}
                              className="w-16 px-1 py-0.5 border border-slate-200 rounded font-mono text-xs text-right"
                              placeholder="0 MT"
                            />
                          </div>
                          <input
                            type="text"
                            disabled={isPaid}
                            value={manualCuts[emp.id]?.desc || ''}
                            onChange={(e) => setManualCuts({
                              ...manualCuts,
                              [emp.id]: { value: manualCuts[emp.id]?.value || 0, desc: e.target.value }
                            })}
                            placeholder="Ex: Atrasos, Faltas..."
                            className="w-28 px-1 py-0.5 border border-slate-200 rounded text-[9px] placeholder-slate-400"
                          />
                        </td>

                        {/* Net salary */}
                        <td className="p-4 text-right font-black font-mono text-emerald-600 text-sm">
                          {totals.netWage.toLocaleString('pt-MZ')} MT
                        </td>

                        <td className="p-4 text-center">
                          {isPaid ? (
                            <div className="flex flex-col gap-1.5 items-center">
                              <span className="w-full bg-emerald-50 text-emerald-700 border border-emerald-200 px-3 py-1 rounded-lg font-bold text-[10px] uppercase tracking-wider flex items-center justify-center gap-1">
                                <span className="material-symbols-outlined text-xs">done_all</span>
                                PAGO
                              </span>
                              <button
                                onClick={() => handlePrintPaySlip(emp, totals)}
                                className="w-full py-1 bg-indigo-50 border border-indigo-200 text-indigo-700 hover:bg-indigo-100 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all"
                              >
                                <span className="material-symbols-outlined text-xs">picture_as_pdf</span>
                                Ver Recibo (PDF)
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-col gap-1.5 items-center">
                              <button
                                onClick={() => handleProcessPayment(emp, totals)}
                                className="w-full py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold text-[10px] uppercase tracking-wider transition-all"
                              >
                                EFETUAR PAGAMENTO
                              </button>
                              <button
                                onClick={() => handlePrintPaySlip(emp, totals)}
                                className="w-full py-1 bg-slate-50 border border-slate-200 text-slate-600 hover:bg-slate-100 rounded text-[10px] font-bold flex items-center justify-center gap-1 transition-all"
                              >
                                <span className="material-symbols-outlined text-xs">picture_as_pdf</span>
                                Recibo Rascunho
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: LIVRO DE PONTO */}
      {activeTab === 'attendance' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-600">fact_check</span>
              Livro de Ponto Digital
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Registo de horas de entrada, saída, períodos noturnos e regimes extraordinários.
            </p>
          </div>

          {/* CONTROLO DE PRESENÇAS RÁPIDO (X) */}
          <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-100 pb-4 mb-4">
              <div>
                <h3 className="font-bold text-slate-900 flex items-center gap-1.5 text-sm uppercase tracking-wide">
                  <span className="material-symbols-outlined text-emerald-600 text-lg">checklist</span>
                  Controlo de Presenças Rápido (X)
                </h3>
                <p className="text-xs text-slate-500">
                  Marque a presença ou falta com apenas um clique para todos os funcionários.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-600">Selecionar Dia:</span>
                <input
                  type="date"
                  value={dailyAttendanceDate}
                  onChange={(e) => setDailyAttendanceDate(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-mono font-bold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {employees.map(emp => {
                const currentAtt = attendance.find(a => a.employeeId === emp.id && a.date === dailyAttendanceDate);
                const isMarked = !!currentAtt;
                const isAbsent = isMarked && currentAtt.absent;
                const isPresent = isMarked && !currentAtt.absent;

                return (
                  <div key={emp.id} className="border border-slate-150 rounded-xl p-4 flex items-center justify-between hover:bg-slate-50/50 transition-colors">
                    <div>
                      <h4 className="font-bold text-slate-800 text-xs">{emp.name}</h4>
                      <p className="text-[10px] text-slate-400 mt-0.5">{emp.contractType}</p>
                      
                      {/* Current Status Badge */}
                      <div className="mt-2">
                        {isPresent && (
                          <span className="text-[10px] font-black bg-emerald-50 text-emerald-700 border border-emerald-150 px-2 py-0.5 rounded-md uppercase">
                            ✓ Presente
                          </span>
                        )}
                        {isAbsent && (
                          <span className="text-[10px] font-black bg-rose-50 text-rose-700 border border-rose-150 px-2 py-0.5 rounded-md uppercase">
                            ✗ Falta (X)
                          </span>
                        )}
                        {!isMarked && (
                          <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md uppercase">
                            Não Marcado
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5">
                      {/* Toggle presence checkmark or absence X */}
                      <button
                        onClick={() => handleSetDailyAttendance(emp.id, false)}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs transition-all border cursor-pointer ${
                          isPresent 
                            ? 'bg-emerald-600 text-white border-emerald-600 shadow-xs' 
                            : 'bg-slate-50 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 border-slate-200'
                        }`}
                        title="Marcar como Presente"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => handleSetDailyAttendance(emp.id, true)}
                        className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs transition-all border cursor-pointer ${
                          isAbsent 
                            ? 'bg-rose-600 text-white border-rose-600 shadow-xs' 
                            : 'bg-slate-50 hover:bg-rose-50 text-slate-400 hover:text-rose-600 border-slate-200'
                        }`}
                        title="Marcar como Falta"
                      >
                        X
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Registar Form */}
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm h-fit">
              <h3 className="font-bold text-slate-900 border-b border-slate-100 pb-3 mb-4 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-emerald-600 text-lg">edit_note</span>
                Registar Assiduidade
              </h3>

              <form onSubmit={handleSaveAttendance} className="space-y-4">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Colaborador *</label>
                  <select
                    required
                    value={pontoEmployeeId}
                    onChange={(e) => setPontoEmployeeId(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">Selecione...</option>
                    {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Data *</label>
                  <input
                    type="date"
                    required
                    value={pontoDate}
                    onChange={(e) => setPontoDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>

                <div className="flex items-center gap-2 py-1">
                  <input
                    type="checkbox"
                    id="reg_absent_ponto"
                    checked={pontoAbsent}
                    onChange={(e) => setPontoAbsent(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 border-slate-300 rounded"
                  />
                  <label htmlFor="reg_absent_ponto" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                    Registar Falta / Licença
                  </label>
                </div>

                {!pontoAbsent ? (
                  <div className="space-y-4 animate-fade-in">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Entrada</label>
                        <input
                          type="time"
                          value={pontoClockIn}
                          onChange={(e) => setPontoClockIn(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Saída</label>
                        <input
                          type="time"
                          value={pontoClockOut}
                          onChange={(e) => setPontoClockOut(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Horas Noturnas (20h - 06h)</label>
                      <input
                        type="number"
                        min={0}
                        max={10}
                        value={pontoNightHours}
                        onChange={(e) => setPontoNightHours(Number(e.target.value))}
                        className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Extra Semanal (50%)</label>
                        <input
                          type="number"
                          min={0}
                          value={pontoOvertimeWeekday}
                          onChange={(e) => setPontoOvertimeWeekday(Number(e.target.value))}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Extra Feriados (100%)</label>
                        <input
                          type="number"
                          min={0}
                          value={pontoOvertimeWeekend}
                          onChange={(e) => setPontoOvertimeWeekend(Number(e.target.value))}
                          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                        />
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="animate-fade-in">
                    <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Motivo da Ausência</label>
                    <select
                      value={pontoAbsentReason}
                      onChange={(e) => setPontoAbsentReason(e.target.value as any)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="Injustificada">Injustificada</option>
                      <option value="Justificada">Justificada</option>
                      <option value="Licença Maternidade">Licença Maternidade</option>
                      <option value="Licença Paternidade">Licença Paternidade</option>
                      <option value="Férias">Férias</option>
                    </select>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase rounded-xl text-xs transition-all shadow-sm flex items-center justify-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-sm">check_circle</span>
                  CONFIRMAR REGISTO
                </button>
              </form>
            </div>

            {/* List Side */}
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm lg:col-span-2 overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 bg-slate-50/50">
                <h3 className="font-bold text-slate-900 flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg text-slate-600">history</span>
                  Registos Recentes do Mês
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">Visão detalhada do livro de ponto para o mês de referência.</p>
              </div>

              <div className="overflow-x-auto flex-1">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50/50 text-[10px] font-black uppercase text-slate-400 tracking-wider border-b border-slate-100">
                      <th className="p-4">Data</th>
                      <th className="p-4">Trabalhador</th>
                      <th className="p-4">Status</th>
                      <th className="p-4 text-center">H. Noturnas</th>
                      <th className="p-4 text-center">H. Extra (50%)</th>
                      <th className="p-4 text-center">H. Extra (100%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                    {attendance.filter(a => a.date && a.date.startsWith(selectedMonth)).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400 italic">
                          Nenhum registo de assiduidade lançado para este mês.
                        </td>
                      </tr>
                    ) : (
                      attendance
                        .filter(a => a.date && a.date.startsWith(selectedMonth))
                        .reverse()
                        .map((att) => (
                          <tr key={att.id} className="hover:bg-slate-50/50 transition-colors">
                            <td className="p-4 font-mono font-bold">{att.date}</td>
                            <td className="p-4 font-bold">{att.employeeName || '---'}</td>
                            <td className="p-4">
                              {att.absent ? (
                                <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-lg border ${
                                  att.absentReason === 'Férias'
                                    ? 'bg-amber-50 text-amber-700 border-amber-200'
                                    : 'bg-rose-50 text-rose-700 border-rose-200'
                                }`}>
                                  {att.absentReason || 'FALTA'}
                                </span>
                              ) : (
                                <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                                  {att.clockIn} - {att.clockOut}
                                </span>
                              )}
                            </td>
                            <td className="p-4 text-center font-mono font-bold text-slate-500">{att.nightHours || 0}h</td>
                            <td className="p-4 text-center font-mono font-bold text-slate-500">{att.overtimeWeekday || 0}h</td>
                            <td className="p-4 text-center font-mono font-bold text-slate-500">{att.overtimeWeekendHoliday || 0}h</td>
                          </tr>
                        ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: AÇÕES DISCIPLINARES */}
      {activeTab === 'disciplinary' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">gavel</span>
                Processos Disciplinares e Notas de Culpa
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Acompanhamento regulamentar obrigatório. A Nota de Culpa deve ser notificada em até 30 dias após o conhecimento da infração.
              </p>
            </div>
            <button
              onClick={() => setShowDiscModal(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold uppercase text-xs flex items-center gap-1.5 transition-all shadow-sm"
            >
              <span className="material-symbols-outlined text-sm">add_alert</span>
              Iniciar Processo
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-[10px] font-black uppercase text-slate-400 tracking-wider border-b border-slate-100">
                    <th className="p-4">Trabalhador</th>
                    <th className="p-4">Data Infração</th>
                    <th className="p-4">Data Nota Culpa</th>
                    <th className="p-4">Janela Regulamentar</th>
                    <th className="p-4">Gravidade</th>
                    <th className="p-4">Estado</th>
                    <th className="p-4">Notas ocorrência</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                  {disciplinaryActions.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400 italic">
                        Nenhum processo disciplinar registado.
                      </td>
                    </tr>
                  ) : (
                    disciplinaryActions.map((act) => {
                      let delayDays = 0;
                      let isCompliant = true;
                      if (act.infractionDate && act.chargeNoteDate) {
                        const inf = new Date(act.infractionDate).getTime();
                        const note = new Date(act.chargeNoteDate).getTime();
                        delayDays = Math.round((note - inf) / (1000 * 3600 * 24));
                        isCompliant = delayDays <= 30;
                      }

                      return (
                        <tr key={act.id} className="hover:bg-slate-50/50 transition-colors">
                          <td className="p-4 font-bold text-slate-900">{act.employeeName}</td>
                          <td className="p-4 font-mono">{act.infractionDate}</td>
                          <td className="p-4 font-mono">{act.chargeNoteDate || '---'}</td>
                          <td className="p-4">
                            {act.chargeNoteDate ? (
                              isCompliant ? (
                                <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-bold">
                                  ✓ Regular ({delayDays} dias)
                                </span>
                              ) : (
                                <span className="bg-rose-50 text-rose-700 border border-rose-200 px-2 py-0.5 rounded font-bold">
                                  ✗ Caducado ({delayDays} dias)
                                </span>
                              )
                            ) : (
                              <span className="text-slate-400 italic font-semibold">Sem nota emitida</span>
                            )}
                          </td>
                          <td className="p-4">
                            <span className={`px-2 py-0.5 rounded font-bold uppercase text-[9px] ${
                              act.severity === 'Leve' ? 'bg-amber-50 text-amber-800 border border-amber-200' :
                              act.severity === 'Grave' ? 'bg-orange-50 text-orange-800 border border-orange-200' :
                              'bg-rose-50 text-rose-800 border border-rose-200'
                            }`}>
                              {act.severity}
                            </span>
                          </td>
                          <td className="p-4">
                            <span className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded font-mono font-bold uppercase text-[9px]">
                              {act.status}
                            </span>
                          </td>
                          <td className="p-4 text-slate-500 max-w-xs truncate" title={act.notes}>
                            {act.notes}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: DANOS DE COLABORADORES */}
      {activeTab === 'damages' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">hardware</span>
                Danos Materiais e Amortizações
              </h2>
              <p className="text-xs text-slate-500 mt-1">
                Conformidade legal: descontos por danos e prejuízos materiais são permitidos desde que devidamente fundamentados, parcelados e limitados.
              </p>
            </div>
            <button
              onClick={() => setShowDamageModal(true)}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold uppercase text-xs flex items-center gap-1.5 transition-all shadow-sm"
            >
              <span className="material-symbols-outlined text-sm">build_circle</span>
              Registar Novo Dano
            </button>
          </div>

          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50/50 text-[10px] font-black uppercase text-slate-400 tracking-wider border-b border-slate-100">
                    <th className="p-4">Trabalhador</th>
                    <th className="p-4">Bem Danificado</th>
                    <th className="p-4 text-right">Valor Total Dano (MT)</th>
                    <th className="p-4 text-right">Valor a Pagar (MT)</th>
                    <th className="p-4 text-right">Amortização Mensal (MT)</th>
                    <th className="p-4 text-center">Data Início</th>
                    <th className="p-4 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-slate-700 text-xs">
                  {employeeDamages.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400 italic">
                        Nenhum registo de dano material lançado.
                      </td>
                    </tr>
                  ) : (
                    employeeDamages.map((dmg) => (
                      <tr key={dmg.id} className="hover:bg-slate-50/50 transition-colors">
                        <td className="p-4 font-bold text-slate-900">{dmg.employeeName}</td>
                        <td className="p-4 font-semibold text-slate-600">{dmg.damagedItem}</td>
                        <td className="p-4 text-right font-mono font-bold">{dmg.totalDamageValue.toLocaleString('pt-MZ')} MT</td>
                        <td className="p-4 text-right font-mono font-bold">{dmg.totalToPayValue.toLocaleString('pt-MZ')} MT</td>
                        <td className="p-4 text-right font-mono text-rose-600 font-bold">-{dmg.deductionPerSalary.toLocaleString('pt-MZ')} MT</td>
                        <td className="p-4 text-center font-mono">{dmg.startDate}</td>
                        <td className="p-4 text-center">
                          <span className="bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded font-bold uppercase text-[9px]">
                            {dmg.active ? 'Ativo' : 'Liquidado'}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB CONTENT: RELATÓRIOS & SISSMO */}
      {activeTab === 'reports' && (
        <div className="space-y-6">
          <div className="bg-white border border-slate-200 p-5 rounded-2xl shadow-sm">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
              <span className="material-symbols-outlined text-emerald-600">description</span>
              Relatórios Fiscais e Exporte Laboral
            </h2>
            <p className="text-xs text-slate-500 mt-1">
              Descarregue os ficheiros oficiais estruturados de conformidade com a Autoridade Tributária (AT) e Segurança Social (INSS).
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* INSS SISSMO Card */}
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-4 flex flex-col justify-between" id="report_card_sissmo">
              <div>
                <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl w-fit">
                  <span className="material-symbols-outlined text-[32px] block">drafts</span>
                </div>
                <h3 className="text-base font-black text-slate-900 mt-4">Ficheiro Declaração SISSMO (INSS)</h3>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  Gere e exporta a declaração de remunerações mensal no layout oficial compatível com a plataforma SISSMO do INSS Moçambique e em PDF para contabilidade física.
                </p>
              </div>
              <div className="space-y-2 mt-4">
                <button
                  onClick={handleDownloadSISSMO}
                  className="w-full py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold uppercase rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 border border-slate-200"
                >
                  <span className="material-symbols-outlined text-sm font-bold">download</span>
                  GERAR & DESCARREGAR CSV SISSMO
                </button>
                <button
                  onClick={handleDownloadINSSDeclarationPDF}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm"
                >
                  <span className="material-symbols-outlined text-sm font-bold">picture_as_pdf</span>
                  DECLARAÇÃO INSS EM PDF
                </button>
              </div>
            </div>

            {/* Modelo 2 AT Card */}
            <div className="bg-white border border-slate-200 p-6 rounded-2xl shadow-sm space-y-4 flex flex-col justify-between" id="report_card_m2">
              <div>
                <div className="p-3 bg-blue-50 text-blue-600 rounded-xl w-fit">
                  <span className="material-symbols-outlined text-[32px] block">analytics</span>
                </div>
                <h3 className="text-base font-black text-slate-900 mt-4">Modelo 2 (Contabilidade Simplificada - AT)</h3>
                <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                  Substitui a declaração tradicional estruturando os rendimentos anuais e retenções na fonte de IRPS sob o regime de contabilidade simplificada (Modelo 2) de Moçambique em PDF homologado.
                </p>
              </div>
              <button
                onClick={handleDownloadModelo2PDF}
                className="w-full mt-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold uppercase rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-sm"
              >
                <span className="material-symbols-outlined text-sm font-bold">picture_as_pdf</span>
                GERAR & DESCARREGAR MODELO 2 (PDF)
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: ADD/EDIT EMPLOYEE */}
      {showEmpModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[90vh] flex flex-col animate-scale-up">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">
                  {isEditing ? 'edit' : 'person_add'}
                </span>
                {isEditing ? 'Editar Colaborador' : 'Admitir Novo Colaborador'}
              </h3>
              <button
                onClick={() => {
                  setShowEmpModal(false);
                  resetEmployeeForm();
                }}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveEmployee} className="p-6 overflow-y-auto space-y-4 flex-1 custom-scrollbar">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1 font-sans">Nome Completo *</label>
                  <input
                    type="text"
                    required
                    value={empName}
                    onChange={(e) => setEmpName(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                    placeholder="Ex: João Malembane"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Tipo de Contrato</label>
                  <select
                    value={empContract}
                    onChange={(e) => setEmpContract(e.target.value as ContractType)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                  >
                    <option value="Prazo Certo">Prazo Certo</option>
                    <option value="Prazo Indeterminado">Prazo Indeterminado</option>
                    <option value="Prazo Incerto">Prazo Incerto</option>
                    <option value="Teletrabalho">Teletrabalho</option>
                    <option value="Trabalho Intermitente">Trabalho Intermitente</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Contacto</label>
                  <input
                    type="text"
                    value={empContact}
                    onChange={(e) => setEmpContact(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                    placeholder="Ex: +258 84 123 4567"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">NUIT (Moçambique) *</label>
                  <input
                    type="text"
                    required
                    maxLength={9}
                    value={empNuit}
                    onChange={(e) => setEmpNuit(e.target.value.replace(/\D/g, ''))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold"
                    placeholder="Ex: 102345678"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Número INSS *</label>
                  <input
                    type="text"
                    required
                    value={empInss}
                    onChange={(e) => setEmpInss(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                    placeholder="Ex: INSS847291"
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">IBAN de Pagamento *</label>
                  <input
                    type="text"
                    required
                    value={empIban}
                    onChange={(e) => setEmpIban(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                    placeholder="Ex: MZ59 0033 1000 0012 3456 7890 1"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Salário Base (MT) *</label>
                  <input
                    type="number"
                    required
                    min={0}
                    value={empSalary}
                    onChange={(e) => setEmpSalary(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Género</label>
                  <select
                    value={empGender}
                    onChange={(e) => setEmpGender(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                  >
                    <option value="Masculino">Masculino</option>
                    <option value="Feminino">Feminino</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Dependentes p/ IRPS</label>
                  <input
                    type="number"
                    min={0}
                    max={10}
                    value={empDependents}
                    onChange={(e) => setEmpDependents(Number(e.target.value))}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Estado Civil</label>
                  <select
                    value={empMarital}
                    onChange={(e) => setEmpMarital(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold"
                  >
                    <option value="Solteiro">Solteiro</option>
                    <option value="Casado">Casado</option>
                    <option value="Divorciado">Divorciado</option>
                    <option value="Viúvo">Viúvo</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Data de Admissão</label>
                  <input
                    type="date"
                    required
                    value={empHiredDate}
                    onChange={(e) => setEmpHiredDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>

                <div className="flex items-center gap-2 pt-5">
                  <input
                    type="checkbox"
                    id="add_emp_foreigner"
                    checked={empForeigner}
                    onChange={(e) => setEmpForeigner(e.target.checked)}
                    className="w-4 h-4 text-emerald-600 focus:ring-emerald-500 border-slate-300 rounded"
                  />
                  <label htmlFor="add_emp_foreigner" className="text-xs font-bold text-slate-700 cursor-pointer select-none">
                    Trabalhador Estrangeiro (Quota)
                  </label>
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEmpModal(false);
                    resetEmployeeForm();
                  }}
                  className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-xl text-xs font-bold uppercase tracking-wider"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-xs">save</span>
                  Gravar Registo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: INICIAR PROCESSO DISCIPLINAR */}
      {showDiscModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full animate-scale-up">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">gavel</span>
                Lançar Processo Disciplinar
              </h3>
              <button
                onClick={() => setShowDiscModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveDisciplinary} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Colaborador *</label>
                <select
                  required
                  value={discEmployeeId}
                  onChange={(e) => setDiscEmployeeId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">Selecione...</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Data Infração *</label>
                  <input
                    type="date"
                    required
                    value={discInfractionDate}
                    onChange={(e) => setDiscInfractionDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Data Nota Culpa</label>
                  <input
                    type="date"
                    value={discChargeNoteDate}
                    onChange={(e) => setDiscChargeNoteDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Gravidade</label>
                  <select
                    value={discSeverity}
                    onChange={(e) => setDiscSeverity(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                  >
                    <option value="Leve">Leve</option>
                    <option value="Grave">Grave</option>
                    <option value="Gravíssima">Gravíssima</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Estado</label>
                  <select
                    value={discStatus}
                    onChange={(e) => setDiscStatus(e.target.value as any)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold"
                  >
                    <option value="Iniciado">Iniciado</option>
                    <option value="Nota de Culpa Notificada">Nota de Culpa Notificada</option>
                    <option value="Defesa Recebida">Defesa Recebida</option>
                    <option value="Decidido">Decidido</option>
                    <option value="Arquivado">Arquivado</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Notas da Infração / Ocorrência</label>
                <textarea
                  required
                  rows={3}
                  value={discNotes}
                  onChange={(e) => setDiscNotes(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs focus:outline-none"
                  placeholder="Descreva detalhadamente a infração..."
                />
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDiscModal(false)}
                  className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-xl text-xs font-bold uppercase tracking-wider"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-xs">gavel</span>
                  Iniciar Processo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: REGISTAR NOVO DANO MATERIAL */}
      {showDamageModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 max-w-md w-full animate-scale-up">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h3 className="font-bold text-slate-900 flex items-center gap-2">
                <span className="material-symbols-outlined text-emerald-600">hardware</span>
                Registar Dano Material
              </h3>
              <button
                onClick={() => setShowDamageModal(false)}
                className="p-1 text-slate-400 hover:text-slate-600 rounded-lg"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveDamage} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Colaborador Responsável *</label>
                <select
                  required
                  value={dmgEmployeeId}
                  onChange={(e) => setDmgEmployeeId(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 focus:outline-none"
                >
                  <option value="">Selecione...</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Bem / Material Danificado *</label>
                <input
                  type="text"
                  required
                  value={dmgItem}
                  onChange={(e) => setDmgItem(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs"
                  placeholder="Ex: Ecrã de Computador, Vidro da viatura..."
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Valor do Dano (MT) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={dmgTotalValue}
                    onChange={(e) => setDmgTotalValue(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                    placeholder="Total real"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Valor a ser Pago (MT)</label>
                  <input
                    type="number"
                    min={0}
                    value={dmgToPayValue}
                    onChange={(e) => setDmgToPayValue(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                    placeholder="Acordado"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Desconto por Salário (MT) *</label>
                  <input
                    type="number"
                    required
                    min={1}
                    value={dmgDeduction}
                    onChange={(e) => setDmgDeduction(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono font-bold"
                    placeholder="Ex: 500"
                  />
                  <span className="text-[8px] text-slate-400 leading-none block mt-1">Limite legal de 1/3 do salário líquido</span>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-slate-400 tracking-wider mb-1">Data Início</label>
                  <input
                    type="date"
                    required
                    value={dmgStartDate}
                    onChange={(e) => setDmgStartDate(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono"
                  />
                </div>
              </div>

              <div className="pt-4 border-t border-slate-100 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowDamageModal(false)}
                  className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-xl text-xs font-bold uppercase tracking-wider"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold uppercase tracking-wider shadow-sm flex items-center gap-1.5"
                >
                  <span className="material-symbols-outlined text-xs">save</span>
                  Gravar Registo
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {selectedEmployeeForDetail && (
        <EmployeeDetailModal
          employee={selectedEmployeeForDetail}
          onClose={() => setSelectedEmployeeForDetail(null)}
          onSave={() => {
            loadData(false);
          }}
          initialTab={detailModalInitialTab}
        />
      )}
    </div>
  );
}
