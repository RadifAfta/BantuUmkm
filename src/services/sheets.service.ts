import { google } from 'googleapis';
import { env } from '../config/env';
import { ExtractedOrder } from './ai.service';

// Bersihkan Private Key dari string escape character "\\n" (menjadi baris baru sesungguhnya)
const sanitizePrivateKey = (key: string): string => {
  return key.replace(/\\n/g, '\n');
};

// Inisialisasi Google Auth Service Account JWT menggunakan objek opsi modern (JWTOptions)
const auth = new google.auth.JWT({
  email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: sanitizePrivateKey(env.GOOGLE_PRIVATE_KEY),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'], // Scope akses hanya ke Google Sheets
});

// Inisialisasi Google Sheets API client (versi v4)
const sheets = google.sheets({
  version: 'v4',
  auth,
});

/**
 * Service untuk menyisipkan data pesanan terstruktur ke Google Sheets target secara otomatis.
 */
export const appendOrderToSheet = async (order: ExtractedOrder): Promise<void> => {
  try {
    const spreadsheetId = env.GOOGLE_SPREADSHEET_ID;
    const range = 'Sheet1!A:E'; // Target menulis di Sheet1 dari kolom A sampai E

    // 1. Format pesanan dari array object menjadi satu teks string deskriptif
    // Misal: [{ nama_produk: "Sate Kambing", jumlah: 5 }] -> "Sate Kambing (5)"
    const orderDetails = order.pesanan
      .map((p) => `${p.nama_produk} (${p.jumlah})`)
      .join(', ');

    // 2. Buat timestamp rekap dengan zona waktu Jakarta
    const timestamp = new Date().toLocaleString('id-ID', {
      timeZone: 'Asia/Jakarta',
      dateStyle: 'medium',
      timeStyle: 'medium',
    });

    // 3. Susun data baris baru yang akan ditambahkan ke Google Sheets
    const rowValues = [
      order.nama_pembeli || '-',
      order.nomor_hp || '-',
      orderDetails || '-',
      order.alamat_pengiriman || '-',
      timestamp,
    ];

    console.log(`📊 [Sheets Service] Menulis data ke Google Sheets...`);
    console.log(`📊 [Sheets Service] Data Baris:`, rowValues);

    // 4. Lakukan penulisan asinkronus ke Google Sheets API
    const response = await sheets.spreadsheets.values.append({
      spreadsheetId,
      range,
      valueInputOption: 'USER_ENTERED', // Agar tipe data diformat otomatis seperti ketikan pengguna biasa
      requestBody: {
        values: [rowValues],
      },
    });

    console.log(`✅ [Sheets Service] Data berhasil ditulis! Status HTTP: ${response.status}`);
  } catch (error: any) {
    // Tangani error secara anggun agar tidak merusak siklus queue BullMQ job lainnya
    console.error('❌ [Sheets Service] Gagal menulis data ke Google Sheets API:', error.message || error);
    // Kita sengaja melemparkan error kembali agar BullMQ tahu job ini gagal dan memicu mekanisme Retry otomatis!
    throw error;
  }
};
