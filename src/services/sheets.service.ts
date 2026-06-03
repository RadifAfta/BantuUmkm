import { google } from 'googleapis';
import { env } from '../config/env';
import { ExtractedOrder } from './ai.service';

// Interface untuk item katalog produk
export interface CatalogItem {
  nama: string;
  harga: number;
  stok?: string;
}

// Katalog cadangan (fallback) jika tab 'Katalog' di Google Sheet belum dibuat merchant
const FALLBACK_CATALOG: CatalogItem[] = [
  { nama: 'Sate Kambing', harga: 25000 },
  { nama: 'Sate Ayam', harga: 20000 },
  { nama: 'Es Teh', harga: 5000 },
  { nama: 'Es Jeruk', harga: 7000 },
  { nama: 'Nasi Putih', harga: 4000 }
];

// Bersihkan Private Key dari string escape character "\\n" (menjadi baris baru sesungguhnya)
const sanitizePrivateKey = (key: string): string => {
  return key.replace(/\\n/g, '\n');
};

// Inisialisasi Google Auth Service Account JWT
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
 * Service untuk mengambil data katalog produk aktif dari Google Sheets tab 'Katalog'.
 * Mendukung graceful fallback ke default catalog jika tab belum dibuat merchant.
 */
export const getCatalogFromSheet = async (): Promise<CatalogItem[]> => {
  try {
    const spreadsheetId = env.GOOGLE_SPREADSHEET_ID;
    const range = 'Katalog!A2:C'; // Kolom: Nama Produk, Harga, Stok (Abaikan baris 1 header)

    console.log(`📊 [Sheets Service] Mencoba memuat katalog produk dari Google Sheets...`);
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range,
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.warn('⚠️ [Sheets Service] Tab "Katalog" kosong atau tidak memiliki baris data. Menggunakan katalog default (fallback).');
      return FALLBACK_CATALOG;
    }

    // Map data dari array baris Sheets ke CatalogItem
    const catalog: CatalogItem[] = rows
      .map((row) => ({
        nama: row[0]?.trim() || '',
        harga: parseInt(row[1]?.replace(/[^0-9]/g, '') || '0', 10), // Hapus simbol non-angka jika diinput manual
        stok: row[2]?.trim() || 'Tersedia',
      }))
      .filter((item) => item.nama !== ''); // Bersihkan baris kosong

    console.log(`✅ [Sheets Service] Sukses memuat ${catalog.length} produk dari Google Sheets.`);
    return catalog;
  } catch (error: any) {
    console.error('⚠️ [Sheets Service] Gagal mengambil katalog dari Google Sheets (mungkin tab "Katalog" belum dibuat):', error.message || error);
    console.log('ℹ️ Menggunakan katalog default (fallback) agar sistem bot tetap berjalan.');
    return FALLBACK_CATALOG;
  }
};

/**
 * Service untuk menyisipkan data pesanan terstruktur ke Google Sheets target secara otomatis.
 */
export const appendOrderToSheet = async (order: ExtractedOrder): Promise<void> => {
  try {
    const spreadsheetId = env.GOOGLE_SPREADSHEET_ID;
    const range = 'Sheet1!A:F'; // Target menulis di Sheet1 dari kolom A sampai F (ditambah Kolom F: Total Harga)

    // 1. Format rincian produk pesanan menjadi deskripsi terperinci dengan harga
    // Misal: [{ nama_produk: "Sate Kambing", jumlah: 2, harga_satuan: 25000, subtotal: 50000 }] 
    // -> "Sate Kambing (2 x Rp25.000 = Rp50.000)"
    const orderDetails = order.pesanan
      .map((p) => `${p.nama_produk} (${p.jumlah} x Rp${p.harga_satuan.toLocaleString('id-ID')} = Rp${p.subtotal.toLocaleString('id-ID')})`)
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
      order.total_harga || 0, // Ditulis di kolom F
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
    console.error('❌ [Sheets Service] Gagal menulis data ke Google Sheets API:', error.message || error);
    // Kita sengaja melemparkan error kembali agar BullMQ tahu job ini gagal dan memicu mekanisme Retry otomatis!
    throw error;
  }
};

