import app from './app';
import { env } from './config/env';
import './queue/whatsapp.worker';
import client from './config/whatsapp';

const startServer = () => {
  try {
    // Jalankan server Express menggunakan port dari environment variable yang sudah divalidasi Zod
    app.listen(env.PORT, async () => {
      console.log(`🚀 Server berjalan pada port ${env.PORT} dalam mode '${env.NODE_ENV}'`);
      console.log(`🔗 Cek status server di: http://localhost:${env.PORT}/api/health`);

      // Inisialisasi bot WhatsApp secara asinkronus
      try {
        console.log('⚙️ [Server] Menginisialisasi bot WhatsApp...');
        await client.initialize();
      } catch (waError) {
        console.error('❌ [Server] Gagal menginisialisasi bot WhatsApp:', waError);
      }
    });
  } catch (error) {
    console.error('💥 Gagal menyalakan server:', error);
    process.exit(1);
  }
};

startServer();
