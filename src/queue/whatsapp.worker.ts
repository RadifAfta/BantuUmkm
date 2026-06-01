import { Worker, Job } from 'bullmq';
import redisConnection from '../config/redis';
import { WHATSAPP_QUEUE_NAME } from './whatsapp.queue';
import { extractOrderFromChat } from '../services/ai.service';
import { appendOrderToSheet } from '../services/sheets.service';
import client from '../config/whatsapp';

// Definisikan bentuk interface data yang ditangani oleh Job
interface ChatJobData {
  sender: string;
  message: string;
}

// Inisialisasi Worker BullMQ (Consumer)
export const whatsappWorker = new Worker<ChatJobData>(
  WHATSAPP_QUEUE_NAME,
  async (job: Job<ChatJobData>) => {
    const { sender, message } = job.data;

    console.log(`\n👷 [Worker] Mulai memproses job #${job.id} dari pengirim: ${sender}`);
    console.log(`👷 [Worker] Sedang menganalisis chat dengan AI Groq...`);
    
    // Panggil AI Service untuk mengekstraksi pesanan terstruktur secara asinkronus
    const extractedOrder = await extractOrderFromChat(message);
    
    console.log(`👷 [Worker] Hasil Rekap AI (Structured JSON):`);
    console.log(JSON.stringify(extractedOrder, null, 2));
    
    // Kirim data hasil ekstraksi ke Google Sheets API secara asinkronus
    await appendOrderToSheet(extractedOrder);

    // Kirimkan pesan konfirmasi otomatis ke nomor pengirim menggunakan whatsapp-web.js
    try {
      console.log(`💬 [Worker] Mengirim chat konfirmasi otomatis ke ${sender}...`);
      
      const pembeli = extractedOrder.nama_pembeli || 'Pelanggan';
      const replyText = `Halo! Pesanan kamu atas nama *${pembeli}* sudah berhasil direkap otomatis ke Google Sheets toko kami. Terima kasih! 😊`;
      
      await client.sendMessage(sender, replyText);
      console.log(`✅ [Worker] Chat konfirmasi sukses terkirim ke ${sender}.`);
    } catch (replyError: any) {
      // Catatan: Kegagalan mengirim balasan WA tidak kita throw agar status job utama (AI & Google Sheets) tetap sukses.
      console.error(`❌ [Worker] Gagal mengirim chat konfirmasi otomatis ke ${sender}:`, replyError.message || replyError);
    }
    
    console.log(`👷 [Worker] Analisis AI & sinkronisasi Google Sheets selesai untuk job #${job.id}.\n`);
  },
  {
    connection: redisConnection,
    concurrency: 1, // Memproses 1 job dalam satu waktu untuk mencegah limit rate API OpenAI / Google Sheets
  }
);

// Event Listener untuk memonitor job yang berhasil selesai
whatsappWorker.on('completed', (job) => {
  console.log(`✅ [Worker] Job #${job?.id} SELESAI diproses secara sukses.`);
});

// Event Listener untuk mendeteksi job yang gagal (untuk retry/alert)
whatsappWorker.on('failed', (job, err) => {
  console.error(`🚨 [Worker] Job #${job?.id} GAGAL diproses! Alasan:`, err.message);
});

console.log(`⚙️ [Worker] Worker '${WHATSAPP_QUEUE_NAME}' aktif & mendengarkan antrean...`);
export default whatsappWorker;
