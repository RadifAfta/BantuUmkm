import { Queue } from 'bullmq';
import redisConnection from './config/redis';
import { WHATSAPP_QUEUE_NAME } from './queue/whatsapp.queue';

const checkQueue = async () => {
  try {
    const queue = new Queue(WHATSAPP_QUEUE_NAME, { connection: redisConnection });
    const jobs = await queue.getJobs(['waiting', 'active', 'failed', 'completed']);
    
    console.log('\n=============================================');
    console.log('       STATUS ANTREAN REDIS BULLMQ          ');
    console.log('=============================================');
    console.log(`Total Job Terdaftar: ${jobs.length}\n`);

    if (jobs.length === 0) {
      console.log('ℹ️ Tidak ada job apapun di dalam antrean Redis.');
    }

    for (const job of jobs) {
      const state = await job.getState();
      console.log(`▶️ Job #${job.id}:`);
      console.log(`   - Status: ${state.toUpperCase()}`);
      console.log(`   - Pengirim: ${job.data?.sender || '-'}`);
      console.log(`   - Teks Pesan: "${job.data?.message || '-'}"`);
      console.log(`   - Jumlah Percobaan: ${job.attemptsMade}`);
      if (job.failedReason) {
        console.log(`   - ❌ Alasan Gagal: ${job.failedReason}`);
      }
      console.log('---------------------------------------------');
    }
    
    await queue.close();
  } catch (error) {
    console.error('❌ Gagal memeriksa antrean Redis:', error);
  }
  process.exit(0);
};

checkQueue();
