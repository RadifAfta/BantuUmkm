import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { addChatToQueue } from '../queue/whatsapp.queue';

// Skema validasi untuk request body WhatsApp Chat menggunakan Zod
const whatsappChatSchema = z.object({
  sender: z.string({
    required_error: 'Field "sender" (nomor HP) wajib diisi.',
    invalid_type_error: 'Field "sender" harus berupa text (string).',
  }).min(1, 'Field "sender" tidak boleh kosong.'),
  
  message: z.string({
    required_error: 'Field "message" (isi chat) wajib diisi.',
    invalid_type_error: 'Field "message" harus berupa text (string).',
  }).min(1, 'Field "message" tidak boleh kosong.'),
});

/**
 * Controller untuk menangani incoming chat/webhook dari WhatsApp.
 * Menangani parsing, validasi, memasukkan ke antrean Redis, dan langsung merespon dengan cepat (non-blocking).
 */
export const receiveWhatsappChat = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Lakukan validasi aman (safeParse tidak melempar error langsung, tapi mengembalikan objek status)
    const result = whatsappChatSchema.safeParse(req.body);

    // Jika validasi gagal, kembalikan respons 400 (Bad Request) beserta detail errornya
    if (!result.success) {
      res.status(400).json({
        status: 'error',
        message: 'Validasi data WhatsApp chat gagal.',
        errors: result.error.format(), // Mengembalikan struktur error yang rapi
      });
      return;
    }

    // Ambil data yang berhasil divalidasi dan di-parsing (type-safe)
    const { sender, message } = result.data;

    // Mencetak log chat masuk ke console server
    console.log(`\n📥 [WhatsApp Webhook] Pesan Baru Masuk!`);
    console.log(`📱 Pengirim: ${sender}`);
    console.log(`💬 Isi Chat: "${message}"\n`);

    // Tambahkan data chat ke antrean Redis asinkronus (BullMQ)
    const job = await addChatToQueue(sender, message);

    // Kirimkan respons sukses cepat (non-blocking) ke WhatsApp Gateway
    res.status(200).json({
      status: 'queued',
      message: 'Chat berhasil masuk antrean pemrosesan.',
      jobId: job.id,
    });
  } catch (error) {
    // Teruskan ke error handler Express jika terjadi error tak terduga
    next(error);
  }
};
