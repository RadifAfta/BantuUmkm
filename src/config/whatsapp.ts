/// <reference path="../types/global.d.ts" />
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode-terminal';
import { addChatToQueue } from '../queue/whatsapp.queue';

// Inisialisasi Client WhatsApp Web JS menggunakan strategi LocalAuth
// LocalAuth akan menyimpan data sesi di folder lokal '.wwebjs_auth/' agar tidak perlu scan QR lagi
export const client = new Client({
  authStrategy: new LocalAuth(),
  puppeteer: {
    handleSIGINT: false, // Penting agar Puppeteer menutup browser dengan bersih saat server berhenti
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled', // Menyembunyikan tanda-tanda otomatisasi (bot) Puppeteer
      '--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', // Memakai User Agent browser Chrome asli & modern
    ],
  },
});

// Event Listener 'qr': Menampilkan QR Code langsung di dalam console/terminal server
client.on('qr', (qr: string) => {
  console.log('\n📡 [WhatsApp Bot] Sesi baru terdeteksi! Silakan pindai QR code berikut menggunakan WhatsApp di HP Anda untuk login:\n');
  qrcode.generate(qr, { small: true });
});

// Event Listener 'ready': Terpanggil ketika bot sudah terautentikasi dan siap digunakan
client.on('ready', () => {
  console.log('\n✅ [WhatsApp Bot] Koneksi sukses! Bot WhatsApp siap digunakan & mendengarkan pesan masuk.\n');
});

// Event Listener 'authenticated': Terpanggil saat proses autentikasi berhasil
client.on('authenticated', () => {
  console.log('📡 [WhatsApp Bot] Autentikasi sukses! Memuat sesi...');
});

// Event Listener 'auth_failure': Terpanggil jika proses autentikasi gagal
client.on('auth_failure', (msg: string) => {
  console.error('❌ [WhatsApp Bot] Autentikasi gagal! Pesan:', msg);
});

// Event Listener 'disconnected': Terpanggil ketika bot terputus dari WhatsApp Web
client.on('disconnected', (reason: string) => {
  console.warn('⚠️ [WhatsApp Bot] Koneksi terputus! Alasan:', reason);
});

// ====== EVENT UTAMA UNTUK PROSESING ANTRIAN ======

// Event Listener 'message_create': Menangkap semua pesan personal (baik dari orang lain maupun dari diri sendiri)
// Kita menggunakan 'message_create' agar mendukung fitur pengujian Self-Chat (mengirim pesan ke nomor sendiri untuk testing)
client.on('message_create', async (msg: any) => {
  // DEBUG LOG MENTAH: Selalu cetak setiap kali ada pesan masuk/keluar untuk mempermudah diagnosa
  console.log(`🔍 [Debug WA] Event 'message_create' terdeteksi!`);
  console.log(`   - Dari (From): ${msg.from}`);
  console.log(`   - Ke (To): ${msg.to}`);
  console.log(`   - Dari Saya (fromMe): ${msg.fromMe}`);
  console.log(`   - Teks Pesan: "${msg.body}"`);

  // Hanya proses chat personal (Direct Message) dan abaikan jika pesan berasal dari Grup Chat
  // Pada wweb.js modern, chat personal diakhiri '@c.us' atau '@lid' (Linked Identity format baru dari Meta)
  const isPersonalChat = msg.from.endsWith('@c.us') || msg.from.endsWith('@lid');
  if (isPersonalChat) {
    // 1. Cegah infinite loop dengan mengabaikan pesan balasan otomatis dari bot kita sendiri
    const isAutomatedReply = msg.body.startsWith('Halo! Pesanan kamu');
    if (isAutomatedReply) {
      console.log('   ℹ️ Mengabaikan pesan balasan otomatis untuk mencegah loop.');
      return;
    }

    // 2. Terima jika pesan berasal dari orang lain (Incoming)
    // Skenario pesan masuk dari orang lain selalu memiliki 'fromMe: false'
    const isIncoming = !msg.fromMe;
    
    // Untuk mempermudah pengujian, kita juga mengizinkan jika pesan dikirim dari akun kita sendiri ke nomor kita sendiri (Self-Chat)
    // Jika self-chat, pengirim atau penerima biasanya adalah nomor kita sendiri
    const isSelfChat = msg.fromMe && (msg.to === msg.from || msg.to.endsWith('@lid') || msg.to.endsWith('@c.us'));

    if (isIncoming || isSelfChat) {
      const sender = isSelfChat ? msg.to : msg.from; // Tetapkan pengirim dengan tepat
      const message = msg.body;  // Isi pesan teks chat

      console.log(`\n📥 [WhatsApp Bot] Chat Diterima (${isSelfChat ? 'Self-Chat Test' : 'Pesan Masuk'}): ${sender}`);
      console.log(`💬 Isi Pesan: "${message}"`);

      try {
        // Masukkan data chat ke antrean Redis secara asinkronus (BullMQ)
        await addChatToQueue(sender, message);
      } catch (error) {
        console.error('❌ [WhatsApp Bot] Gagal memasukkan pesan masuk ke antrean Redis:', error);
      }
    } else {
      console.log('   ℹ️ Pesan diabaikan karena bukan pesan masuk baru atau self-chat test.');
    }
  } else {
    console.log('   ℹ️ Pesan diabaikan karena bukan dari chat personal (diakhiri @c.us).');
  }
});

// Event Listener Cadangan 'message': Menangkap pesan masuk sebagai pengaman tambahan jika 'message_create' terhambat
client.on('message', async (msg: any) => {
  console.log(`🔍 [Debug WA] Event 'message' (Incoming Only) terdeteksi dari: ${msg.from}`);
  if (msg.from.endsWith('@c.us') && !msg.fromMe) {
    const sender = msg.from;
    const message = msg.body;
    
    // Cek apakah data ini sudah ditangani (untuk menghindari duplikasi jika keduanya aktif)
    console.log(`📥 [WhatsApp Bot] Chat Masuk Cadangan dari ${sender}: "${message}"`);
  }
});

export default client;
