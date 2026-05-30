import { Worker, Job } from 'bullmq';
import redisConnection from '../config/redis';
import { WHATSAPP_QUEUE_NAME } from './whatsapp.queue';

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

    console.log(`👷 [Worker] Mulai memproses job #${job.id} dari pengirim: ${sender}`);
    console.log(`👷 [Worker] Sedang memproses antrean chat dari ${sender}...`);
    
    // Simulasi proses asinkronus berat (misal: panggil OpenAI API) selama 1.5 detik
    await new Promise((resolve) => setTimeout(resolve, 1500));
    
    // Catatan: Di Fase berikutnya, logika OpenAI dan Google Sheets akan dimasukkan di sini.
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
