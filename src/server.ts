import app from './app';
import { env } from './config/env';
import './queue/whatsapp.worker';

const startServer = () => {
  try {
    // Jalankan server Express menggunakan port dari environment variable yang sudah divalidasi Zod
    app.listen(env.PORT, () => {
      console.log(`🚀 Server berjalan pada port ${env.PORT} dalam mode '${env.NODE_ENV}'`);
      console.log(`🔗 Cek status server di: http://localhost:${env.PORT}/api/health`);
    });
  } catch (error) {
    console.error('💥 Gagal menyalakan server:', error);
    process.exit(1);
  }
};

startServer();
