package com.inkandkin.lanchat.media

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.net.Uri
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

data class CompressedImagePayload(
    val imageBase64: String,
    val mimeType: String = "image/jpeg",
    val fileName: String,
    val localCacheUri: String
)

object ImageCompressor {

    private const val MAX_EDGE_PX = 1600
    private const val JPEG_QUALITY = 85

    suspend fun compressUriToJpegBase64(context: Context, uri: Uri): Result<CompressedImagePayload> =
        withContext(Dispatchers.IO) {
            runCatching {
                val resolver = context.contentResolver

                // 1. 读取原始尺寸
                val boundsOpts = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                resolver.openInputStream(uri)?.use { stream ->
                    BitmapFactory.decodeStream(stream, null, boundsOpts)
                } ?: throw IllegalArgumentException("无法读取所选图片")

                val rawW = boundsOpts.outWidth
                val rawH = boundsOpts.outHeight
                if (rawW <= 0 || rawH <= 0) {
                    throw IllegalArgumentException("不支持的图片格式")
                }

                // 2. 计算采样比例防止大图 OOM
                var sampleSize = 1
                while (max(rawW / sampleSize, rawH / sampleSize) > MAX_EDGE_PX * 2) {
                    sampleSize *= 2
                }

                val decodeOpts = BitmapFactory.Options().apply {
                    inSampleSize = sampleSize
                    inPreferredConfig = Bitmap.Config.ARGB_8888
                }
                val decoded = resolver.openInputStream(uri)?.use { stream ->
                    BitmapFactory.decodeStream(stream, null, decodeOpts)
                } ?: throw IllegalArgumentException("解码图片失败")

                // 3. 读取 EXIF 旋转角
                val rotationDegrees = resolver.openInputStream(uri)?.use { stream ->
                    val exif = ExifInterface(stream)
                    when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
                        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
                        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
                        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
                        else -> 0f
                    }
                } ?: 0f

                val rotated = if (rotationDegrees != 0f) {
                    val m = Matrix().apply { postRotate(rotationDegrees) }
                    Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, m, true).also {
                        if (it !== decoded) decoded.recycle()
                    }
                } else {
                    decoded
                }

                // 4. 精确等比缩放到最长边 <= 1600px
                val longest = max(rotated.width, rotated.height)
                val finalBitmap = if (longest > MAX_EDGE_PX) {
                    val ratio = MAX_EDGE_PX.toFloat() / longest.toFloat()
                    val targetW = (rotated.width * ratio).roundToInt().coerceAtLeast(1)
                    val targetH = (rotated.height * ratio).roundToInt().coerceAtLeast(1)
                    Bitmap.createScaledBitmap(rotated, targetW, targetH, true).also {
                        if (it !== rotated) rotated.recycle()
                    }
                } else {
                    rotated
                }

                // 5. 编码 JPEG + 保存临时预览缓存供乐观气泡即时渲染
                val baos = ByteArrayOutputStream()
                finalBitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, baos)
                finalBitmap.recycle()

                val bytes = baos.toByteArray()
                val previewFile = File(context.cacheDir, "sent_img_${System.currentTimeMillis()}.jpg")
                previewFile.writeBytes(bytes)

                val base64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                CompressedImagePayload(
                    imageBase64 = base64,
                    mimeType = "image/jpeg",
                    fileName = "photo_${System.currentTimeMillis()}.jpg",
                    localCacheUri = Uri.fromFile(previewFile).toString()
                )
            }
        }
}
