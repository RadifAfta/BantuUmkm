import { google } from 'googleapis';
import { env } from './config/env';

console.log('--- RAW KEY INFO ---');
console.log('Key length:', env.GOOGLE_PRIVATE_KEY ? env.GOOGLE_PRIVATE_KEY.length : 0);
console.log('Starts with "-----BEGIN PRIVATE KEY-----":', env.GOOGLE_PRIVATE_KEY ? env.GOOGLE_PRIVATE_KEY.startsWith('-----BEGIN PRIVATE KEY-----') : false);
console.log('Ends with "-----END PRIVATE KEY-----":', env.GOOGLE_PRIVATE_KEY ? env.GOOGLE_PRIVATE_KEY.trim().endsWith('-----END PRIVATE KEY-----') : false);
console.log('Contains literal \\n (escaped):', env.GOOGLE_PRIVATE_KEY ? env.GOOGLE_PRIVATE_KEY.includes('\\n') : false);
console.log('Contains actual newline characters:', env.GOOGLE_PRIVATE_KEY ? env.GOOGLE_PRIVATE_KEY.includes('\n') : false);

const sanitizePrivateKey = (k: string) => {
  if (!k) return '';
  let cleaned = k;
  // Jika kunci privat masih dibungkus tanda kutip ganda akibat pembacaan env, bersihkan
  if (cleaned.startsWith('"') && cleaned.endsWith('"')) {
    cleaned = cleaned.substring(1, cleaned.length - 1);
  }
  // Ubah escaped newline \\n menjadi newline sesungguhnya \n
  return cleaned.replace(/\\n/g, '\n');
};

const cleanedKey = sanitizePrivateKey(env.GOOGLE_PRIVATE_KEY);
console.log('--- CLEANED KEY INFO ---');
console.log('Cleaned length:', cleanedKey.length);
console.log('Starts with -----BEGIN PRIVATE KEY-----:', cleanedKey.startsWith('-----BEGIN PRIVATE KEY-----'));
console.log('Ends with -----END PRIVATE KEY-----:', cleanedKey.trim().endsWith('-----END PRIVATE KEY-----'));

try {
  const auth = new google.auth.JWT({
    email: env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: cleanedKey,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  console.log('JWT object created.');
  
  // Test signing menggunakan authorize (memicu verifikasi OpenSSL terhadap RSA Private Key)
  auth.authorize((err: any, tokens: any) => {
    if (err) {
      console.error('❌ Signing test failed:', err.message || err);
    } else {
      console.log('✅ Signing test succeeded! Token generated.');
    }
  });
} catch (e: any) {
  console.error('💥 Error creating JWT or signing:', e.message || e);
}
