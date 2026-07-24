import { Worker, Job } from 'bullmq';
import redisConnection from '../config/redis';
import { WHATSAPP_QUEUE_NAME } from './whatsapp.queue';
import { classifyIntent, extractOrderFromChat, answerInquiry, ChatMessage } from '../services/ai.service';
import { appendOrderToSheet, getCatalogFromSheet } from '../services/sheets.service';
import { WhatsAppProviderFactory } from '../services/whatsapp-provider.service';
import { sessionService, OrderSession } from '../services/session.service';

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
    // AMBIL ATAU INISIALISASI SESI DENGAN RIWAYAT CHAT
    // ------------------------------------------------------------------------
    let session = await sessionService.getSession(sender);
    if (!session) {
      session = {
        step: 'IDLE',
        history: [],
      };
    }

    // 1. Simpan pesan pengguna ke riwayat chat
    session.history.push({ role: 'user', content: message });

    // Batasi panjang riwayat chat (maksimal 6 pesan terakhir) agar hemat token & fokus
    if (session.history.length > 6) {
      session.history.shift();
    }

    console.log(`👷 [Worker] Status Sesi ${sender}: ${session.step}, Riwayat Chat: ${session.history.length} pesan`);

    // 2. Klasifikasi niat dengan riwayat chat
    const intent = await classifyIntent(message, session.history);
    console.log(`👷 [Worker] Niat terdeteksi: ${intent.toUpperCase()}`);

    // Ambil data katalog produk aktif dari Google Sheets
    const catalog = await getCatalogFromSheet();
    const catalogContext = catalog
      .map((item) => `- ${item.nama} (Harga: Rp${item.harga.toLocaleString('id-ID')})`)
      .join('\n');

    let replyText = '';

    // ------------------------------------------------------------------------
    // HANDLING GLOBAL INTENT: CANCEL (BISA DIJALANKAN KAPAN SAJA)
    // ------------------------------------------------------------------------
    if (intent === 'CANCEL') {
      console.log(`👷 [Worker] Menerima permintaan pembatalan dari ${sender}`);
      session.step = 'IDLE';
      session.order = undefined;
      replyText = `🤖 Baik Kak, pesanan Anda saat ini telah dibatalkan. Jika ingin memesan lagi di lain waktu, cukup ketik kembali menu pesanan Kakak ya. Terima kasih! 😊`;
      await whatsappProvider.sendMessage(sender, replyText);
      session.history.push({ role: 'assistant', content: replyText });
      await sessionService.setSession(sender, session);
      console.log(`👷 [Worker] Pesanan dibatalkan & sesi direset ke IDLE untuk ${sender}\n`);
      return;
    }

    // ------------------------------------------------------------------------
    // STATE MACHINE FLOW
    // ------------------------------------------------------------------------

    // A. STATE: AWAITING_NAME
    if (session.step === 'AWAITING_NAME') {
      // Jika pengguna mengajukan pertanyaan di tengah jalan alih-alih memberikan nama
      if (intent === 'INQUIRY') {
        replyText = await answerInquiry(message, catalogContext, session.history);
        replyText = `${replyText}\n\n*Catatan:* Mohon infokan **Nama Lengkap Pembeli** terlebih dahulu ya Kak agar pesanan bisa kami catat. 😊`;
        await whatsappProvider.sendMessage(sender, replyText);
        session.history.push({ role: 'assistant', content: replyText });
        await sessionService.setSession(sender, session);
        return;
      }

      // Simpan input sebagai nama
      const inputName = message.trim();
      if (session.order) {
        session.order.nama_pembeli = inputName;
        
        // Cek kelengkapan alamat
        const isAddressMissing = !session.order.alamat_pengiriman || 
                                 session.order.alamat_pengiriman.trim() === '-' || 
                                 session.order.alamat_pengiriman.trim() === '';
                                 
        if (isAddressMissing) {
          session.step = 'AWAITING_ADDRESS';
          replyText = `🤖 Terima kasih Kak *${inputName}*! Selanjutnya, mohon infokan **Alamat Pengiriman** Kakak ya agar kami bisa hitung ongkirnya. 😊`;
        } else {
          session.step = 'AWAITING_CONFIRMATION';
          const detailPesananStr = session.order.pesanan
            .map((p) => `- *${p.nama_produk}* (x${p.jumlah}): Rp${p.subtotal.toLocaleString('id-ID')}`)
            .join('\n');
          replyText = `🤖 *📋 REKAP PESANAN* \n\nBerikut rincian pesanan Kakak:\n\n- *Nama:* ${session.order.nama_pembeli}\n- *Nomor HP:* ${session.order.nomor_hp || cleanSenderPhone}\n- *Alamat:* ${session.order.alamat_pengiriman}\n\n*Item Pesanan:*\n${detailPesananStr}\n\n*💰 Total Tagihan:* *Rp${session.order.total_harga.toLocaleString('id-ID')}*\n\nApakah pesanan di atas sudah benar? (Ketik **Ya** untuk konfirmasi, atau ketik jika ada perubahan/tambahan). 😊`;
        }
        await whatsappProvider.sendMessage(sender, replyText);
        session.history.push({ role: 'assistant', content: replyText });
        await sessionService.setSession(sender, session);
      }
      return;
    }

    // B. STATE: AWAITING_ADDRESS
    if (session.step === 'AWAITING_ADDRESS') {
      // Jika pengguna malah bertanya di tengah jalan alih-alih memberikan alamat
      if (intent === 'INQUIRY') {
        replyText = await answerInquiry(message, catalogContext, session.history);
        replyText = `${replyText}\n\n*Catatan:* Mohon infokan **Alamat Pengiriman** Kakak terlebih dahulu ya agar kami bisa hitung ongkirnya. 😊`;
        await whatsappProvider.sendMessage(sender, replyText);
        session.history.push({ role: 'assistant', content: replyText });
        await sessionService.setSession(sender, session);
        return;
      }

      const inputAddress = message.trim();
      if (session.order) {
        session.order.alamat_pengiriman = inputAddress;
        session.order.nomor_hp = session.order.nomor_hp || cleanSenderPhone;
        
        session.step = 'AWAITING_CONFIRMATION';
        const detailPesananStr = session.order.pesanan
          .map((p) => `- *${p.nama_produk}* (x${p.jumlah}): Rp${p.subtotal.toLocaleString('id-ID')}`)
          .join('\n');
        replyText = `🤖 *📋 REKAP PESANAN* \n\nBerikut rincian pesanan Kakak:\n\n- *Nama:* ${session.order.nama_pembeli}\n- *Nomor HP:* ${session.order.nomor_hp}\n- *Alamat:* ${session.order.alamat_pengiriman}\n\n*Item Pesanan:*\n${detailPesananStr}\n\n*💰 Total Tagihan:* *Rp${session.order.total_harga.toLocaleString('id-ID')}*\n\nApakah pesanan di atas sudah benar? (Ketik **Ya** untuk konfirmasi, atau ketik jika ada perubahan/tambahan). 😊`;
        
        await whatsappProvider.sendMessage(sender, replyText);
        session.history.push({ role: 'assistant', content: replyText });
        await sessionService.setSession(sender, session);
      }
      return;
    }

    // C. STATE: AWAITING_CONFIRMATION
    if (session.step === 'AWAITING_CONFIRMATION') {
      // Jika user mengonfirmasi
      if (intent === 'CONFIRM') {
        if (session.order) {
          console.log(`📊 [Sheets Service] Menulis data ke Google Sheets...`);
          await appendOrderToSheet(session.order);
          
          replyText = `🤖 *Nota Berhasil Direkap!* \n\nHalo Kak *${session.order.nama_pembeli}*, pesanan Anda telah resmi terdaftar di sistem toko kami. Admin kami akan segera menghubungi nomor Kakak untuk proses pembayaran dan pengiriman. Terima kasih telah berbelanja! 🙏😊`;
          
          await whatsappProvider.sendMessage(sender, replyText);
          session.history.push({ role: 'assistant', content: replyText });
          
          // Bersihkan pesanan dan kembalikan state ke IDLE
          session.step = 'IDLE';
          session.order = undefined;
          await sessionService.setSession(sender, session);
          console.log(`👷 [Worker] Transaksi selesai & ditulis ke Google Sheets untuk ${sender}`);
        }
        return;
      }
      
      // Jika user bermaksud menambah atau mengubah item pesanan
      if (intent === 'ORDER') {
        console.log(`👷 [Worker] Mendeteksi perubahan/tambahan pesanan dalam state AWAITING_CONFIRMATION`);
        const updatedOrder = await extractOrderFromChat(message, catalogContext, session.history, session.order);
        
        if (updatedOrder && updatedOrder.pesanan && updatedOrder.pesanan.length > 0) {
          session.order = updatedOrder;
          
          // Tampilkan rekap terbaru
          const detailPesananStr = session.order.pesanan
            .map((p) => `- *${p.nama_produk}* (x${p.jumlah}): Rp${p.subtotal.toLocaleString('id-ID')}`)
            .join('\n');
          replyText = `🤖 *📋 REKAP PESANAN (DIPERBARUI)* \n\nBerikut rincian pesanan terbaru Kakak:\n\n- *Nama:* ${session.order.nama_pembeli || 'Pelanggan'}\n- *Nomor HP:* ${session.order.nomor_hp || cleanSenderPhone}\n- *Alamat:* ${session.order.alamat_pengiriman || '-'}\n\n*Item Pesanan:*\n${detailPesananStr}\n\n*💰 Total Tagihan:* *Rp${session.order.total_harga.toLocaleString('id-ID')}*\n\nApakah pesanan di atas sudah benar? (Ketik **Ya** untuk konfirmasi, atau ketik jika ada perubahan/tambahan). 😊`;
        } else {
          replyText = `🤖 Maaf Kak, perubahan pesanan tidak valid atau produk tidak cocok dengan menu kami. Silakan ketik kembali menu tambahan yang diinginkan sesuai katalog aktif.`;
        }
        
        await whatsappProvider.sendMessage(sender, replyText);
        session.history.push({ role: 'assistant', content: replyText });
        await sessionService.setSession(sender, session);
        return;
      }

      // Jika user menanyakan hal lain (Inquiry)
      if (intent === 'INQUIRY') {
        replyText = await answerInquiry(message, catalogContext, session.history);
        replyText = `${replyText}\n\n*Catatan:* Konfirmasi pesanan Kakak di atas masih menggantung. Apakah rincian pesanan sudah benar? (Ketik **Ya** jika benar, atau ketik tambahan Anda). 😊`;
        await whatsappProvider.sendMessage(sender, replyText);
        session.history.push({ role: 'assistant', content: replyText });
        await sessionService.setSession(sender, session);
        return;
      }
    }

    // D. STATE: IDLE (TIDAK ADA PESANAN AKTIF)
    if (session.step === 'IDLE') {
      if (intent === 'ORDER') {
        console.log(`👷 [Worker] Memproses pesanan baru...`);
        const extractedOrder = await extractOrderFromChat(message, catalogContext, session.history);
        
        if (!extractedOrder.pesanan || extractedOrder.pesanan.length === 0) {
          console.log(`⚠️ [Worker] Pembeli berniat memesan tetapi tidak ada item yang cocok dengan katalog.`);
          replyText = `🤖 Halo Kak! Kami mendeteksi Kakak ingin melakukan pemesanan, tetapi produk yang dipesan belum tersedia atau tidak cocok dengan menu aktif kami.\n\n*Berikut Menu yang Tersedia:* \n${catalogContext}\n\nSilakan ketik ulang pesanan Kakak sesuai menu di atas ya! Terima kasih! 😊`;
          await whatsappProvider.sendMessage(sender, replyText);
          session.history.push({ role: 'assistant', content: replyText });
          await sessionService.setSession(sender, session);
          return;
        }

        // Auto-fill nomor HP
        extractedOrder.nomor_hp = extractedOrder.nomor_hp || cleanSenderPhone;
        session.order = extractedOrder;

        // Tentukan step berikutnya berdasarkan kelengkapan parameter
        const isNameMissing = !extractedOrder.nama_pembeli || 
                              extractedOrder.nama_pembeli.trim() === '-' || 
                              extractedOrder.nama_pembeli.trim() === '';
                              
        const isAddressMissing = !extractedOrder.alamat_pengiriman || 
                                 extractedOrder.alamat_pengiriman.trim() === '-' || 
                                 extractedOrder.alamat_pengiriman.trim() === '';

        if (isNameMissing) {
          session.step = 'AWAITING_NAME';
          replyText = `🤖 Terima kasih pesanan Kakak! Mohon infokan **Nama Lengkap Pembeli** Kakak ya agar pesanan bisa kami catat dengan benar. 😊`;
        } else if (isAddressMissing) {
          session.step = 'AWAITING_ADDRESS';
          replyText = `🤖 Terima kasih Kak *${extractedOrder.nama_pembeli}*! Mohon infokan **Alamat Pengiriman** Kakak ya agar pesanan bisa kami rekap dan hitung ongkirnya. 😊`;
        } else {
          session.step = 'AWAITING_CONFIRMATION';
          const detailPesananStr = extractedOrder.pesanan
            .map((p) => `- *${p.nama_produk}* (x${p.jumlah}): Rp${p.subtotal.toLocaleString('id-ID')}`)
            .join('\n');
          replyText = `🤖 *📋 REKAP PESANAN* \n\nBerikut rincian pesanan Kakak:\n\n- *Nama:* ${extractedOrder.nama_pembeli}\n- *Nomor HP:* ${extractedOrder.nomor_hp}\n- *Alamat:* ${extractedOrder.alamat_pengiriman}\n\n*Item Pesanan:*\n${detailPesananStr}\n\n*💰 Total Tagihan:* *Rp${extractedOrder.total_harga.toLocaleString('id-ID')}*\n\nApakah pesanan di atas sudah benar? (Ketik **Ya** untuk konfirmasi, atau ketik jika ada perubahan/tambahan). 😊`;
        }
        
        await whatsappProvider.sendMessage(sender, replyText);
        session.history.push({ role: 'assistant', content: replyText });
        await sessionService.setSession(sender, session);
        return;
      }

      // Handling INQUIRY
      if (intent === 'INQUIRY') {
        replyText = await answerInquiry(message, catalogContext, session.history);
        replyText = `🤖 ${replyText}`;
        await whatsappProvider.sendMessage(sender, replyText);
        session.history.push({ role: 'assistant', content: replyText });
        await sessionService.setSession(sender, session);
        return;
      }

      // Handling COMPLAINT
      if (intent === 'COMPLAINT') {
        replyText = `🤖 Halo Kak! Terima kasih atas masukannya. Keluhan Kakak telah kami catat di sistem. Admin toko kami akan segera membalas chat Kakak secara manual secepat mungkin ya. Mohon maaf atas ketidaknyamanannya! 🙏`;
        await whatsappProvider.sendMessage(sender, replyText);
        session.history.push({ role: 'assistant', content: replyText });
        await sessionService.setSession(sender, session);
        return;
      }

      // Default (OTHER / Greetings)
      replyText = `🤖 Halo Kak! Selamat datang di Toko Kami. 😊\n\nAda yang bisa kami bantu? Kakak bisa menanyakan daftar menu/harga, atau bisa langsung mengetikkan detail pesanan Kakak untuk direkap otomatis.\n\n*Contoh Format Pesanan:*\n_\"Pesen sate kambing 2 porsi dan es teh manis 1 ya kak\"_`;
      await whatsappProvider.sendMessage(sender, replyText);
      session.history.push({ role: 'assistant', content: replyText });
      await sessionService.setSession(sender, session);
      return;
    }
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


