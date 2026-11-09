import { companyNuit, companyName } from './companyInfo';
import { safeStorage, safeSessionStorage } from "./safeStorage";
﻿import { Sale, SystemSettings } from '../types';

let activeSerialPort: any | null = null;
let virtualPrinterActive: boolean = safeStorage.getItem('pos_virtual_printer') === 'true';

/**
 * Attempts to connect to a Web Serial device (e.g. Xprinter or Epson Thermal Printer)
 */
export async function connectSerialPrinter(): Promise<{ success: boolean; portName?: string; error?: string; isIframeError?: boolean }> {
  try {
    if (!('serial' in navigator)) {
      return { success: false, error: 'A API Web Serial não é suportada neste navegador. Use o Google Chrome ou Edge.' };
    }

    const port = await (navigator as any).serial.requestPort();
    await port.open({ baudRate: 9600 });
    activeSerialPort = port;
    virtualPrinterActive = false;
    safeStorage.setItem('pos_virtual_printer', 'false');
    
    return { success: true, portName: 'Impressora Térmica POS (COM / USB)' };
  } catch (err: any) {
    console.error('Web Serial Connection error:', err);
    const msg = err.message || '';
    const isIframe = msg.toLowerCase().includes('permissions policy') || msg.toLowerCase().includes('disallowed') || msg.toLowerCase().includes('iframe');
    return { 
      success: false, 
      error: err.message || 'Conexão cancelada ou falhou.',
      isIframeError: isIframe
    };
  }
}

/**
 * Disconnects the active serial printer
 */
export async function disconnectSerialPrinter() {
  if (activeSerialPort) {
    try {
      await activeSerialPort.close();
    } catch (e) {
      console.error(e);
    }
    activeSerialPort = null;
  }
  virtualPrinterActive = false;
  safeStorage.setItem('pos_virtual_printer', 'false');
}

/**
 * Toggles the Virtual / Simulated POS Hardware Mode
 */
export function setVirtualPrinterMode(active: boolean) {
  virtualPrinterActive = active;
  safeStorage.setItem('pos_virtual_printer', active ? 'true' : 'false');
  if (active && activeSerialPort) {
    activeSerialPort = null; // deactivate physical if simulating
  }
}

/**
 * Checks if the virtual simulator is currently active
 */
export function isVirtualPrinterActive(): boolean {
  return virtualPrinterActive;
}

/**
 * Checks if a serial printer is connected (either real physical or virtual simulation)
 */
export function isSerialPrinterConnected(): boolean {
  return activeSerialPort !== null || virtualPrinterActive;
}

/**
 * Sends a pulse trigger to open the cash drawer (ESC p m t1 t2)
 * ESC/POS Command: Decimal [27, 112, 48, 25, 250]
 */
export async function sendCashDrawerPulse(): Promise<boolean> {
  if (virtualPrinterActive && !activeSerialPort) {
    console.log('[Virtual POS Hardware] Simulated cash drawer kicker pulse sent successfully!');
    return true; // Virtual drawer pulse simulation is instant success
  }

  const kickerBytes = new Uint8Array([27, 112, 48, 25, 250]);

  // Try Web Serial if connected
  if (activeSerialPort && activeSerialPort.writable) {
    try {
      const writer = activeSerialPort.writable.getWriter();
      await writer.write(kickerBytes);
      writer.releaseLock();
      console.log('ESC/POS kicker signal sent successfully via Web Serial!');
      return true;
    } catch (err) {
      console.error('Failed to send kicker signal via Web Serial, using fallback:', err);
    }
  }

  // Fallback: download direct binary ESC/POS file for local print routing
  try {
    const blob = new Blob([kickerBytes], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'abrir_gaveta.bin';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    return false; // returned false indicating fallback was used
  } catch (e) {
    console.error('Fallback downloader failed:', e);
    return false;
  }
}

/**
 * Synthesizes a realistic metallic cash register "cha-ching" sound using Web Audio API
 */
export function playChachingSound() {
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContextClass) return;
    
    const audioCtx = new AudioContextClass();
    
    // Part 1: Latch Release (metallic noise burst)
    const bufferSize = audioCtx.sampleRate * 0.12; // 120ms
    const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    
    const noiseNode = audioCtx.createBufferSource();
    noiseNode.buffer = buffer;
    
    const noiseFilter = audioCtx.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.setValueAtTime(1200, audioCtx.currentTime);
    
    const noiseGain = audioCtx.createGain();
    noiseGain.gain.setValueAtTime(0.18, audioCtx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.005, audioCtx.currentTime + 0.12);
    
    noiseNode.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(audioCtx.destination);
    
    // Part 2: Metallic coins clinking (exponential decaying high sine bell waves)
    const bellFrequencies = [1600, 2150, 3120, 4400];
    bellFrequencies.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      
      osc.type = 'sine';
      // Stagger slightly for a chain clink effect
      const startOffset = idx * 0.022; 
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + startOffset);
      
      gain.gain.setValueAtTime(0.12, audioCtx.currentTime + startOffset);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.45 + idx * 0.08);
      
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      
      osc.start(audioCtx.currentTime + startOffset);
      osc.stop(audioCtx.currentTime + 0.75);
    });
    
    noiseNode.start();
    noiseNode.stop(audioCtx.currentTime + 0.12);
  } catch (error) {
    console.warn('Web Audio synthesis failed:', error);
  }
}

/**
 * Converts a Sale object to raw ESC/POS thermal command bytes and prints directly if Serial connected
 */
export async function printDirectThermalESC_POS(sale: Sale, settings: SystemSettings): Promise<boolean> {
  if (virtualPrinterActive && !activeSerialPort) {
    console.log('[Virtual POS Hardware] Simulating real thermal print for:', sale.invoiceNumber);
    return true; // Simulates successful direct printing
  }

  if (!activeSerialPort || !activeSerialPort.writable) {
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const list: Uint8Array[] = [];

    // Initialize printer (ESC @)
    list.push(new Uint8Array([27, 64]));

    // Center Alignment (ESC a 1)
    list.push(new Uint8Array([27, 97, 1]));

    // Bold ON (ESC E 1), Double Height & Width (GS ! 17)
    list.push(new Uint8Array([27, 69, 1, 29, 33, 17]));
    list.push(encoder.encode((settings.companyName || 'AGRO - XICOMO & SERVIÇOS, LDA').toUpperCase() + '\n'));
    
    // Regular text (GS ! 0), Bold OFF
    list.push(new Uint8Array([29, 33, 0, 27, 69, 0]));
    list.push(encoder.encode(`NUIT: ${companyNuit(settings.companyNuit)}\n`));
    list.push(encoder.encode('Maputo, Mocambique\n'));
    list.push(encoder.encode('--------------------------------\n'));

    // Left Alignment (ESC a 0)
    list.push(new Uint8Array([27, 97, 0]));
    list.push(encoder.encode(`Factura: ${sale.invoiceNumber}\n`));
    list.push(encoder.encode(`Data: ${new Date(sale.date).toLocaleDateString('pt-MZ')} ${new Date(sale.date).toLocaleTimeString('pt-MZ')}\n`));
    list.push(encoder.encode(`Operador: ${sale.operatorName}\n`));
    list.push(encoder.encode(`Cliente: ${sale.customerName}\n`));
    list.push(encoder.encode('--------------------------------\n'));

    // Column Headers
    list.push(encoder.encode('Item           Qtd   Preco  Total\n'));
    list.push(encoder.encode('--------------------------------\n'));

    sale.items.forEach(item => {
      // Format product name to max 14 chars
      const name = (item.name.substring(0, 14)).padEnd(14, ' ');
      const qty = item.quantity.toString().padStart(4, ' ');
      const price = Math.round(item.unitPrice).toString().padStart(6, ' ');
      const total = Math.round(item.unitPrice * item.quantity).toString().padStart(6, ' ');
      list.push(encoder.encode(`${name} ${qty} ${price} ${total}\n`));
    });

    list.push(encoder.encode('--------------------------------\n'));

    // Align right (ESC a 2)
    list.push(new Uint8Array([27, 97, 2]));
    list.push(encoder.encode(`Subtotal: ${sale.subtotal.toLocaleString('pt-MZ')} MT\n`));
    if (sale.discount > 0) {
      list.push(encoder.encode(`Desconto: -${sale.discount.toLocaleString('pt-MZ')} MT\n`));
    }
    list.push(encoder.encode(`Total: ${sale.total.toLocaleString('pt-MZ')} MT\n`));
    list.push(encoder.encode(`Forma Pag.: ${sale.paymentMethod || 'Dinheiro'}\n`));
    list.push(encoder.encode('--------------------------------\n'));

    // Center alignment
    list.push(new Uint8Array([27, 97, 1]));
    list.push(new Uint8Array([27, 69, 1])); // Bold ON
    list.push(encoder.encode('OBRIGADO PELA SUA PREFERENCIA!\n\n\n\n'));

    // Paper Cut (GS V 66 0)
    list.push(new Uint8Array([29, 86, 66, 0]));

    // Join all buffers
    const totalLength = list.reduce((acc, arr) => acc + arr.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    list.forEach(arr => {
      combined.set(arr, offset);
      offset += arr.length;
    });

    const writer = activeSerialPort.writable.getWriter();
    await writer.write(combined);
    writer.releaseLock();
    console.log('ESC/POS direct receipt printed successfully via Web Serial!');
    return true;
  } catch (err) {
    console.error('Error writing thermal print bytes:', err);
    return false;
  }
}
