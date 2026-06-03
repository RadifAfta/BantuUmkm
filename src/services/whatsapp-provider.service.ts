import client from '../config/whatsapp';

export interface WhatsAppProvider {
  sendMessage(to: string, message: string): Promise<void>;
}

/**
 * Mengonversi string Unicode escape sequence (seperti \ud83d\ude05) menjadi karakter emoji asli.
 */
const decodeUnicodeEscapes = (str: string): string => {
  try {
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (match, grp) => {
      return String.fromCharCode(parseInt(grp, 16));
    });
  } catch (error) {
    console.error('⚠️ [Provider Helper] Gagal mendecode Unicode escapes:', error);
    return str;
  }
};

/**
 * Provider untuk WhatsApp Web (whatsapp-web.js) dengan simulasi mengetik manusiawi
 */
export class WhatsAppWebProvider implements WhatsAppProvider {
  async sendMessage(to: string, message: string): Promise<void> {
    try {
      const decodedMessage = decodeUnicodeEscapes(message);
      
      // Ambil instance chat untuk memicu status sedang mengetik
      const chat = await client.getChatById(to);
      
      // Nyalakan status mengetik
      await chat.sendStateTyping();
      
      // Simulasi delay mengetik proporsional terhadap panjang teks
      // 35ms per karakter, batas bawah 2 detik, batas atas 5.5 detik
      const delayMs = Math.min(Math.max(decodedMessage.length * 35, 2000), 5500);
      
      console.log(`💬 [WA Web Provider] Mensimulasikan mengetik ke ${to} selama ${delayMs}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      
      // Kirim pesan asli & matikan status mengetik
      await client.sendMessage(to, decodedMessage);
      await chat.clearState();
      console.log(`✅ [WA Web Provider] Pesan berhasil dikirim ke: ${to}`);
    } catch (error: any) {
      console.warn(`⚠️ [WA Web Provider] Gagal mengirim dengan efek mengetik, mengirim instan ke ${to}:`, error.message || error);
      // Fallback: Kirim instan tanpa delay jika terjadi kendala Puppeteer
      const decodedMessage = decodeUnicodeEscapes(message);
      await client.sendMessage(to, decodedMessage);
    }
  }
}

/**
 * Factory untuk mengatur instansiasi WhatsApp Provider (mendukung decoupling arsitektur)
 */
export class WhatsAppProviderFactory {
  private static providerInstance: WhatsAppProvider;

  public static getProvider(): WhatsAppProvider {
    if (!this.providerInstance) {
      // Mengembalikan WhatsAppWebProvider sebagai provider default.
      // Di masa mendatang, jika beralih ke Official Cloud API, tinggal buat class baru dan switch di sini.
      this.providerInstance = new WhatsAppWebProvider();
    }
    return this.providerInstance;
  }
}
