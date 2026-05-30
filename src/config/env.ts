import dotenv from 'dotenv';
import { z } from 'zod';

// Muat variabel dari file .env
dotenv.config();

// Definisikan skema validasi menggunakan Zod
const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  REDIS_HOST: z.string().default('127.0.0.1'),
  REDIS_PORT: z.coerce.number().default(6379),
  GROQ_API_KEY: z.string({
    required_error: 'GROQ_API_KEY wajib diisi di .env!',
  }).min(1, 'GROQ_API_KEY tidak boleh kosong!'),
});

// Fungsi untuk memvalidasi dan mem-parsing process.env
const parseEnv = () => {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('❌ Validasi environment variables gagal:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1); // Stop aplikasi secepatnya (fail-fast)
  }

  return result.data;
};

// Ekspor variabel yang sudah divalidasi dan memiliki tipe data yang statis (type-safe)
export const env = parseEnv();
export type EnvType = z.infer<typeof envSchema>;
