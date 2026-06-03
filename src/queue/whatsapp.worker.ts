import { Worker, Job } from 'bullmq';
import redisConnection from '../config/redis';
import { WHATSAPP_QUEUE_NAME } from './whatsapp.queue';
import { classifyIntent, extractOrderFromChat, answerInquiry } from '../services/ai.service';
import { appendOrderToSheet, getCatalogFromSheet } from '../services/sheets.service';
import { WhatsAppProviderFactory } from '../services/whatsapp-provider.service';
import { sessionService } from '../services/session.service';

// Definisikan bentuk interface data yang ditangani oleh Job
interface ChatJobData {
  sender: string;
  message: string;
}

// Inisialisasi WhatsApp Provider dari Factory (Provider Agnostic)
const whatsappProvider = WhatsAppProviderFactory.getProvider();

// Inisialisasi Worker BullMQ (Consumer)
export const whatsappWorker = new Worker<ChatJobData>(
  WHATSAPP_QUEUE_NAME,
  async (job: Job<ChatJobData>) => {
    const { sender, message } = job.data;
    const cleanSenderPhone = sender.split('@')[0]; // Ekstrak nomor HP pengirim

    console.log(`\n👷 [Worker] Mulai memproses job #${job.id} dari pengirim: ${sender}`);
    
    // ------------------------------------------------------------------------
    // PERIKSA SESI MULTI-TURN CLARIFICATION AKTIF
    // ------------------------------------------------------------------------
    const session = await sessionService.getSession(sender);
    
    if (session) {
      console.log(`👷 [Worker] Sesi aktif terdeteksi untuk ${sender} (Langkah: ${session.step})`);
      
      if (session.step === 'AWAITING_NAME') {
        const inputName = message.trim();
        session.order.nama_pembeli = inputName;
        
        // Cek apakah alamat pengiriman juga masih kosong
        const isAddressMissing = !session.order.alamat_pengiriman || 
                                 session.order.alamat_pengiriman.trim() === '-' || 
                                 session.order.alamat_pengiriman.trim() === '';
                                 
        if (isAddressMissing) {
          // Beralih meminta alamat
          session.step = 'AWAITING_ADDRESS';
          await sessionService.setSession(sender, session);
          
          const replyText = `🤖 Terima kasih, Kak *${inputName}*! Selanjutnya, mohon infokan **Alamat Pengiriman** Kakak ya agar pesanan bisa segera kami rekap. 😊`;
          await whatsappProvider.sendMessage(sender, replyText);
          console.log(`👷 [Worker] Sesi diperbarui ke AWAITING_ADDRESS untuk ${sender}`);
        } else {
          // Lengkap semua! Tulis ke Google Sheets
          session.order.nomor_hp = session.order.nomor_hp || cleanSenderPhone;
          await appendOrderToSheet(session.order);
          
          // Kirim nota belanja
          const detailPesananStr = session.order.pesanan
            .map((p) => `- *${p.nama_produk}* (x${p.jumlah}): Rp${p.subtotal.toLocaleString('id-ID')}`)
            .join('\n');
          
          let replyText = `🤖 *📋 NOTA PESANAN OTOMATIS* \n\nHalo Kak *${session.order.nama_pembeli}*! Pesanan Kakak telah berhasil direkap otomatis ke Google Sheets toko kami:\n\n${detailPesananStr}\n\n*💰 Total Tagihan:* *Rp${session.order.total_harga.toLocaleString('id-ID')}*\n`;
          if (session.order.alamat_pengiriman) {
            replyText += `*📍 Alamat Pengiriman:* ${session.order.alamat_pengiriman}\n`;
          }
          replyText += `\nTerima kasih telah berbelanja! Admin kami akan segera menghubungi Kakak untuk konfirmasi pembayaran. 😊`;
          
          await whatsappProvider.sendMessage(sender, replyText);
          await sessionService.deleteSession(sender);
          console.log(`👷 [Worker] Transaksi sukses diselesaikan & sesi dihapus untuk ${sender}`);
        }
        return;
      }
      
      if (session.step === 'AWAITING_ADDRESS') {
        const inputAddress = message.trim();
        session.order.alamat_pengiriman = inputAddress;
        session.order.nomor_hp = session.order.nomor_hp || cleanSenderPhone;
        
        // Lengkap semua! Tulis ke Google Sheets
        await appendOrderToSheet(session.order);
        
        // Kirim nota belanja
        const detailPesananStr = session.order.pesanan
          .map((p) => `- *${p.nama_produk}* (x${p.jumlah}): Rp${p.subtotal.toLocaleString('id-ID')}`)
          .join('\n');
        
        let replyText = `🤖 *📋 NOTA PESANAN OTOMATIS* \n\nHalo Kak *${session.order.nama_pembeli}*! Pesanan Kakak telah berhasil direkap otomatis ke Google Sheets toko kami:\n\n${detailPesananStr}\n\n*💰 Total Tagihan:* *Rp${session.order.total_harga.toLocaleString('id-ID')}*\n`;
        replyText += `*📍 Alamat Pengiriman:* ${session.order.alamat_pengiriman}\n`;
        replyText += `\nTerima kasih telah berbelanja! Admin kami akan segera menghubungi Kakak untuk konfirmasi pembayaran. 😊`;
        
        await whatsappProvider.sendMessage(sender, replyText);
        await sessionService.deleteSession(sender);
        console.log(`👷 [Worker] Transaksi sukses diselesaikan & sesi dihapus untuk ${sender}`);
        return;
      }
    }

    // ------------------------------------------------------------------------
    // ALUR PERCAKAPAN STANDAR (TIDAK ADA SESI AKTIF)
    // ------------------------------------------------------------------------
    console.log(`👷 [Worker] Sedang menganalisis niat (intent) chat dengan AI...`);
    const intent = await classifyIntent(message);
    console.log(`👷 [Worker] Niat terdeteksi: ${intent.toUpperCase()}`);

    // Ambil data katalog produk aktif dari Google Sheets
    const catalog = await getCatalogFromSheet();
    const catalogContext = catalog
      .map((item) => `- ${item.nama} (Harga: Rp${item.harga.toLocaleString('id-ID')})`)
      .join('\n');

    // Routing berdasarkan niat
    if (intent !== 'ORDER') {
      console.log(`👷 [Worker] Memproses chat NON-ORDER (Niat: ${intent.toUpperCase()})...`);
      
      let replyText = '';
      if (intent === 'INQUIRY') {
        replyText = await answerInquiry(message, catalogContext);
        replyText = `🤖 ${replyText}`;
      } else if (intent === 'COMPLAINT') {
        replyText = `🤖 Halo Kak! Terima kasih atas masukannya. Keluhan Kakak telah kami catat di sistem. Admin toko kami akan segera membalas chat Kakak secara manual secepat mungkin ya. Mohon maaf atas ketidaknyamanannya! 🙏`;
      } else {
        replyText = `🤖 Halo Kak! Selamat datang di Toko Kami. 😊\n\nAda yang bisa kami bantu? Kakak bisa menanyakan daftar menu/harga, atau bisa langsung mengetikkan detail pesanan Kakak untuk direkap otomatis.\n\n*Contoh Format Pesanan:*\n_\"Pesen sate kambing 2 porsi dan es teh manis 1 ya kak\"_`;
      }

      await whatsappProvider.sendMessage(sender, replyText);
      console.log(`👷 [Worker] Selesai memproses job #${job.id} (Pesan non-order dilewati untuk Google Sheets).\n`);
      return;
    }

    // Jika niat adalah ORDER
    console.log(`👷 [Worker] Memproses pesanan. Menganalisis detail pesanan terhadap katalog...`);
    const extractedOrder = await extractOrderFromChat(message, catalogContext);
    
    console.log(`👷 [Worker] Hasil Rekap AI (Structured JSON):`);
    console.log(JSON.stringify(extractedOrder, null, 2));

    // Validasi: Jika pelanggan berniat memesan tapi tidak ada produk yang cocok
    if (!extractedOrder.pesanan || extractedOrder.pesanan.length === 0) {
      console.log(`⚠️ [Worker] Pembeli berniat memesan tetapi tidak ada item yang cocok dengan katalog.`);
      const replyText = `🤖 Halo Kak! Kami mendeteksi Kakak ingin melakukan pemesanan, tetapi produk yang dipesan belum tersedia atau tidak cocok dengan menu aktif kami.\n\n*Berikut Menu yang Tersedia:* \n${catalogContext}\n\nSilakan ketik ulang pesanan Kakak sesuai menu di atas ya! Terima kasih! 😊`;
      await whatsappProvider.sendMessage(sender, replyText);
      console.log(`👷 [Worker] Selesai memproses job #${job.id} (Batal menulis karena produk tidak cocok).\n`);
      return;
    }
    
    // Auto-fill nomor HP pengirim
    extractedOrder.nomor_hp = extractedOrder.nomor_hp || cleanSenderPhone;

    // ------------------------------------------------------------------------
    // VALIDASI PARAMETER WAJIB (NAMA & ALAMAT) - MULTI-TURN FLOW
    // ------------------------------------------------------------------------
    const isNameMissing = !extractedOrder.nama_pembeli || 
                          extractedOrder.nama_pembeli.trim() === '-' || 
                          extractedOrder.nama_pembeli.trim() === '';
                          
    const isAddressMissing = !extractedOrder.alamat_pengiriman || 
                             extractedOrder.alamat_pengiriman.trim() === '-' || 
                             extractedOrder.alamat_pengiriman.trim() === '';

    if (isNameMissing) {
      // Masuk ke sesi AWAITING_NAME
      console.log(`👷 [Worker] Nama pembeli kosong. Mengaktifkan sesi AWAITING_NAME untuk ${sender}`);
      await sessionService.setSession(sender, { step: 'AWAITING_NAME', order: extractedOrder });
      
      const replyText = `🤖 Terima kasih pesanan Kakak! Mohon infokan **Nama Lengkap Pembeli** Kakak ya agar pesanan bisa kami catat dengan benar. 😊`;
      await whatsappProvider.sendMessage(sender, replyText);
      console.log(`👷 [Worker] Selesai memproses job #${job.id} (Menunggu klarifikasi nama).\n`);
      return;
    }

    if (isAddressMissing) {
      // Masuk ke sesi AWAITING_ADDRESS
      console.log(`👷 [Worker] Alamat pengiriman kosong. Mengaktifkan sesi AWAITING_ADDRESS untuk ${sender}`);
      await sessionService.setSession(sender, { step: 'AWAITING_ADDRESS', order: extractedOrder });
      
      const replyText = `🤖 Terima kasih pesanan Kakak! Mohon infokan **Alamat Pengiriman** Kakak ya agar pesanan bisa kami rekap dan hitung ongkirnya. 😊`;
      await whatsappProvider.sendMessage(sender, replyText);
      console.log(`👷 [Worker] Selesai memproses job #${job.id} (Menunggu klarifikasi alamat).\n`);
      return;
    }

    // Jika seluruh data valid dan lengkap, langsung tulis ke Google Sheets
    await appendOrderToSheet(extractedOrder);

    // Kirimkan pesan rincian nota belanja otomatis ke nomor pengirim
    try {
      console.log(`💬 [Worker] Mengirim nota konfirmasi belanja otomatis ke ${sender}...`);
      const pembeli = extractedOrder.nama_pembeli || 'Pelanggan';
      const detailPesananStr = extractedOrder.pesanan
        .map((p) => `- *${p.nama_produk}* (x${p.jumlah}): Rp${p.subtotal.toLocaleString('id-ID')}`)
        .join('\n');
      
      let replyText = `🤖 *📋 NOTA PESANAN OTOMATIS* \n\nHalo Kak *${pembeli}*! Pesanan Kakak telah berhasil direkap otomatis ke Google Sheets toko kami:\n\n${detailPesananStr}\n\n*💰 Total Tagihan:* *Rp${extractedOrder.total_harga.toLocaleString('id-ID')}*\n`;
      if (extractedOrder.alamat_pengiriman) {
        replyText += `*📍 Alamat Pengiriman:* ${extractedOrder.alamat_pengiriman}\n`;
      }
      replyText += `\nTerima kasih telah berbelanja! Admin kami akan segera menghubungi Kakak untuk konfirmasi pembayaran. 😊`;
      
      await whatsappProvider.sendMessage(sender, replyText);
      console.log(`✅ [Worker] Nota belanja sukses terkirim ke ${sender}.`);
    } catch (replyError: any) {
      console.error(`❌ [Worker] Gagal mengirim nota belanja ke ${sender}:`, replyError.message || replyError);
    }
    
    console.log(`👷 [Worker] Analisis AI & sinkronisasi Google Sheets selesai untuk job #${job.id}.\n`);
  },
  {
    connection: redisConnection,
    concurrency: 1, // Memproses 1 job dalam satu waktu untuk mencegah limit rate API
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


