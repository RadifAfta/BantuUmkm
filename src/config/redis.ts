import { ConnectionOptions } from 'bullmq';
import { env } from './env';

/**
 * Konfigurasi koneksi Redis yang dibagikan secara global ke modul Queue dan Worker.
 */
export const redisConnection: ConnectionOptions = {
  host: env.REDIS_HOST,
  port: env.REDIS_PORT,
  // Di masa depan, Anda bisa menambahkan options lain di sini seperti 'password', 'db', atau 'tls'
};
export default redisConnection;
