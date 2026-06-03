import Groq from 'groq-sdk';
import { env } from '../config/env';

// Inisialisasi Groq client menggunakan API Key yang sudah divalidasi Zod
const groq = new Groq({
  apiKey: env.GROQ_API_KEY,
});

// Tipe Niat (Intent) pesan WhatsApp masuk
export type IntentType = 'ORDER' | 'INQUIRY' | 'COMPLAINT' | 'OTHER';

// Interface untuk respons deteksi intent
export interface IntentResult {
  intent: IntentType;
  explanation: string;
}

// Interface untuk bentuk data hasil ekstraksi AI yang sudah tercocokkan dengan katalog
export interface ExtractedOrder {
  nama_pembeli: string;
  nomor_hp: string;
  pesanan: Array<{
    nama_produk: string;
    jumlah: number;
    harga_satuan: number;
    subtotal: number;
  }>;
  total_harga: number;
  alamat_pengiriman: string;
}

/**
 * Service untuk mendeteksi niat (intent) dari chat pelanggan WhatsApp.
 */
export const classifyIntent = async (message: string): Promise<IntentType> => {
  try {
    const systemPrompt = `Kamu adalah AI Router cerdas yang bertugas mengklasifikasi kategori pesan dari pelanggan toko online UMKM.
Tentukan kategori pesan dari daftar berikut:
- ORDER: Jika pesan berisi niat untuk membeli produk, memesan makanan/barang, atau menanyakan total tagihan belanjaan mereka. Contoh: "mau beli sate kambing 2", "pesen nasi goreng satu", "rekap sate ayam 5 porsi".
- INQUIRY: Jika pesan berisi pertanyaan umum tentang harga barang, daftar menu/katalog, jam buka toko, ketersediaan stok produk, atau lokasi fisik toko. Contoh: "sate porsinya berapa ya?", "buka jam berapa kak?", "menu sate kambing ready?", "ada rasa apa aja?".
- COMPLAINT: Jika pesan berisi komplain, protes barang rusak/kurang, keluhan keterlambatan pengiriman, atau permintaan refund. Contoh: "kok pesanan saya belum sampai ya?", "makanan kemarin rasanya kurang enak, tolong perbaiki".
- OTHER: Jika pesan hanya berisi salam pembuka (halo, p, pagi, siang), basa-basi, ucapan terima kasih, atau teks acak yang tidak jelas tujuannya.

Kamu WAJIB mengembalikan respon HANYA berupa objek JSON mentah yang valid, tanpa teks basa-basi, tanpa tanda backticks (\`\`\`json), dan tanpa penjelasan apa pun.
Struktur JSON yang wajib kamu kembalikan harus memiliki key berikut:
{
  "intent": "ORDER" | "INQUIRY" | "COMPLAINT" | "OTHER",
  "explanation": "alasan singkat klasifikasi dalam bahasa indonesia"
}`;

    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: message,
        },
      ],
      response_format: {
        type: 'json_object',
      },
      temperature: 0.0, // Suhu 0 agar klasifikasi sangat deterministik dan konsisten
    });

    const rawJsonString = response.choices[0]?.message?.content || '{}';
    const parsedData: IntentResult = JSON.parse(rawJsonString);
    return parsedData.intent || 'OTHER';
  } catch (error) {
    console.error('❌ [AI Service] Gagal mengklasifikasikan intent chat:', error);
    return 'OTHER'; // Default fallback
  }
};

/**
 * Service untuk menjawab pertanyaan umum pelanggan (INQUIRY / FAQ) secara ramah & kontekstual berdasarkan katalog produk aktif.
 */
export const answerInquiry = async (message: string, catalogContext: string): Promise<string> => {
  try {
    const systemPrompt = `Kamu adalah Customer Service AI yang ramah, sopan, dan profesional untuk toko online UMKM.
Tugasmu adalah menjawab pertanyaan pelanggan (Inquiry/FAQ) secara singkat, jelas, dan membantu berdasarkan konteks katalog produk berikut:

Katalog Produk Aktif Toko Kami:
${catalogContext}

Informasi Toko Umum:
- Jam Operasional: Setiap hari, 09:00 - 21:00 WIB
- Lokasi Pengiriman: Jakarta Selatan
- Metode Pembayaran: Transfer Bank & QRIS Otomatis

Aturan Keamanan & Komunikasi:
- Gunakan bahasa Indonesia yang santun, akrab, dan bersahabat (gunakan sapaan "Kak" atau "Kakak").
- Jika menanyakan harga/stok, jawab secara presisi sesuai katalog aktif di atas.
- Jika menanyakan produk yang tidak ada di katalog, katakan dengan sopan bahwa produk tersebut saat ini belum tersedia.
- Jangan memberikan jawaban yang terlalu panjang atau bertele-tele. Maksimal 3-4 kalimat. Akhiri dengan emotikon yang ramah.`;

    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: message,
        },
      ],
      temperature: 0.4,
    });

    return response.choices[0]?.message?.content || 'Halo! Ada yang bisa kami bantu seputar pemesanan produk? 😊';
  } catch (error) {
    console.error('❌ [AI Service] Gagal menyusun balasan inquiry:', error);
    return 'Halo! Pertanyaan Kakak telah kami terima. Admin kami akan segera membalas pesan Kakak ya! 😊';
  }
};

/**
 * Service untuk mengekstrak pesanan terstruktur dari pesan chat WhatsApp dengan validasi katalog produk resmi.
 */
export const extractOrderFromChat = async (message: string, catalogContext: string): Promise<ExtractedOrder> => {
  try {
    const systemPrompt = `Kamu adalah sistem kecerdasan buatan untuk rekap otomatis toko online. Tugasmu adalah mengekstrak teks chat pesanan yang berantakan menjadi data JSON yang bersih, terstruktur, dan tervalidasi terhadap Katalog Produk resmi.

Katalog Produk Resmi Toko Kami:
${catalogContext}

Tugasmu:
1. Ekstrak nama pembeli, nomor HP (jika disebutkan dalam chat), pesanan produk, dan alamat pengiriman.
2. Setiap produk yang dipesan pembeli wajib dicocokkan (fuzzy match) dengan Nama Produk yang ada di Katalog Produk Resmi di atas. JANGAN gunakan nama produk di luar katalog jika tidak ada kemiripan yang masuk akal.
3. Untuk setiap produk yang berhasil dicocokkan, isi detail berikut:
   - nama_produk: Gunakan nama produk resmi dari Katalog Produk Resmi.
   - jumlah: Jumlah unit yang dibeli (harus berupa angka/number).
   - harga_satuan: Harga satuan resmi dari Katalog Produk Resmi (harus berupa angka/number).
   - subtotal: Hasil kali dari jumlah dan harga_satuan (harus berupa angka/number).
4. Hitung total_harga: Jumlah akumulasi dari seluruh subtotal pesanan (harus berupa angka/number).
5. Jika pembeli memesan sesuatu yang sama sekali tidak ada di Katalog, abaikan item tersebut dan jangan masukkan ke dalam array 'pesanan'.

Struktur JSON yang wajib kamu kembalikan:
- nama_pembeli (string, kosongkan "" jika tidak ada)
- nomor_hp (string, kosongkan "" jika tidak ada)
- pesanan (array of object, masing-masing memiliki key: 'nama_produk', 'jumlah', 'harga_satuan', 'subtotal')
- total_harga (number, jumlah dari seluruh subtotal)
- alamat_pengiriman (string, kosongkan "" jika tidak ada)

Kamu WAJIB mengembalikan respon HANYA berupa objek JSON mentah yang valid, tanpa teks basa-basi, tanpa tanda backticks (\`\`\`json), dan tanpa penjelasan apa pun.`;

    const response = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: message,
        },
      ],
      response_format: {
        type: 'json_object',
      },
      temperature: 0.1, // Suhu rendah agar AI lebih konsisten dan presisi dalam ekstraksi & kalkulasi harga
    });

    const rawJsonString = response.choices[0]?.message?.content || '{}';
    const parsedData: ExtractedOrder = JSON.parse(rawJsonString);
    return parsedData;
  } catch (error) {
    console.error('❌ [AI Service] Gagal mengekstrak pesanan dari chat menggunakan Groq:', error);
    // Kembalikan struktur kosong standar jika terjadi kegagalan agar sistem antrean tidak langsung crash total
    return {
      nama_pembeli: '',
      nomor_hp: '',
      pesanan: [],
      total_harga: 0,
      alamat_pengiriman: '',
    };
  }
};

