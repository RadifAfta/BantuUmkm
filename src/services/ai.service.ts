import Groq from 'groq-sdk';
import { env } from '../config/env';

// Inisialisasi Groq client menggunakan API Key yang sudah divalidasi Zod
const groq = new Groq({
  apiKey: env.GROQ_API_KEY,
});

// Interface untuk bentuk data hasil ekstraksi AI
export interface ExtractedOrder {
  nama_pembeli: string;
  nomor_hp: string;
  pesanan: Array<{
    nama_produk: string;
    jumlah: number;
  }>;
  alamat_pengiriman: string;
}

/**
 * Service untuk mengekstrak pesanan terstruktur dari pesan chat WhatsApp menggunakan model LLaMA-3 di Groq Cloud.
 */
export const extractOrderFromChat = async (message: string): Promise<ExtractedOrder> => {
  try {
    const systemPrompt = `Kamu adalah sistem kecerdasan buatan untuk rekap otomatis toko online. Tugasmu adalah mengekstrak teks chat pesanan yang berantakan menjadi data JSON yang bersih dan terukuran.

Struktur JSON yang wajib kamu kembalikan harus memiliki key berikut:
- nama_pembeli (string, kosongkan jika tidak ada)
- nomor_hp (string, kosongkan jika tidak ada)
- pesanan (array of object, masing-masing memiliki 'nama_produk' dan 'jumlah')
- alamat_pengiriman (string, kosongkan jika tidak ada)

Kamu WAJIB mengembalikan respon HANYA berupa objek JSON mentah yang valid, tanpa teks basa-basi, tanpa tanda backticks (\`\`\`json), dan tanpa penjelasan apa pun.`;

    // Kirim request ke Groq API
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
      // Paksa API mengembalikan respons bertipe JSON Object yang valid
      response_format: {
        type: 'json_object',
      },
      temperature: 0.1, // Suhu rendah agar AI lebih konsisten dan tidak terlalu kreatif
    });

    const rawJsonString = response.choices[0]?.message?.content || '{}';

    // Parse string JSON menjadi objek TypeScript tipe-safe
    const parsedData: ExtractedOrder = JSON.parse(rawJsonString);
    return parsedData;
  } catch (error) {
    console.error('❌ [AI Service] Gagal mengekstrak pesanan dari chat menggunakan Groq:', error);
    // Kembalikan struktur kosong standar jika terjadi kegagalan agar sistem antrean tidak langsung crash total
    return {
      nama_pembeli: '',
      nomor_hp: '',
      pesanan: [],
      alamat_pengiriman: '',
    };
  }
};
