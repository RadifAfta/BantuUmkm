import { Worker, Job } from 'bullmq';
import redisConnection from '../config/redis';
import { WHATSAPP_QUEUE_NAME } from './whatsapp.queue';
import { extractOrderFromChat } from '../services/ai.service';

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
    console.log(`👷 [Worker] Analisis AI selesai untuk job #${job.id}.\n`);
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
