package com.inkandkin.lanchat.media

import android.content.Context
import android.media.MediaRecorder
import android.os.Build
import android.util.Base64
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.io.File
import kotlin.math.roundToInt

data class RecordedVoicePayload(
    val audioBase64: String,
    val durationSeconds: Int
)

class VoiceRecorderManager(private val context: Context) {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var recorder: MediaRecorder? = null
    private var outputFile: File? = null
    private var startedAtMs: Long = 0L
    private var meterJob: Job? = null

    private val _isRecording = MutableStateFlow(false)
    val isRecording: StateFlow<Boolean> = _isRecording.asStateFlow()

    private val _amplitude = MutableStateFlow(0f)
    val amplitude: StateFlow<Float> = _amplitude.asStateFlow()

    private val _elapsedSeconds = MutableStateFlow(0)
    val elapsedSeconds: StateFlow<Int> = _elapsedSeconds.asStateFlow()

    fun startRecording(): Boolean {
        cancelRecording()
        val targetFile = File(context.cacheDir, "ink_and_kin_voice_${System.currentTimeMillis()}.m4a")
        return try {
            val mr = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                MediaRecorder(context)
            } else {
                @Suppress("DEPRECATION")
                MediaRecorder()
            }
            mr.setAudioSource(MediaRecorder.AudioSource.MIC)
            mr.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            mr.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            mr.setAudioSamplingRate(44100)
            mr.setAudioEncodingBitRate(96000)
            mr.setAudioChannels(1)
            mr.setOutputFile(targetFile.absolutePath)
            mr.prepare()
            mr.start()

            recorder = mr
            outputFile = targetFile
            startedAtMs = System.currentTimeMillis()
            _isRecording.value = true
            _elapsedSeconds.value = 0
            _amplitude.value = 0.12f

            meterJob = scope.launch {
                while (isActive && _isRecording.value) {
                    val amp = runCatching { recorder?.maxAmplitude ?: 0 }.getOrDefault(0)
                    val normalized = (amp / 18000f).coerceIn(0.08f, 1f)
                    _amplitude.value = normalized
                    _elapsedSeconds.value = ((System.currentTimeMillis() - startedAtMs) / 1000L).toInt()
                    delay(80L)
                }
            }
            true
        } catch (_: Exception) {
            runCatching { targetFile.delete() }
            cleanupInternal()
            false
        }
    }

    suspend fun stopAndEncode(): Result<RecordedVoicePayload> = withContext(Dispatchers.IO) {
        val mr = recorder
        val file = outputFile
        val durationMs = System.currentTimeMillis() - startedAtMs
        cleanupStateOnly()

        if (mr == null || file == null) {
            return@withContext Result.failure(IllegalStateException("录音尚未开始"))
        }

        val stoppedCleanly = try {
            mr.stop()
            true
        } catch (_: Exception) {
            false
        } finally {
            runCatching { mr.reset() }
            runCatching { mr.release() }
        }

        if (!stoppedCleanly || durationMs < 750L || !file.exists() || file.length() < 256L) {
            runCatching { file.delete() }
            return@withContext Result.failure(IllegalStateException("说话时间太短"))
        }

        return@withContext try {
            val bytes = file.readBytes()
            runCatching { file.delete() }
            val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
            val secs = (durationMs / 1000.0).roundToInt().coerceAtLeast(1)
            Result.success(RecordedVoicePayload(audioBase64 = b64, durationSeconds = secs))
        } catch (e: Exception) {
            runCatching { file.delete() }
            Result.failure(e)
        }
    }

    fun cancelRecording() {
        val mr = recorder
        val file = outputFile
        cleanupStateOnly()
        if (mr != null) {
            runCatching { mr.stop() }
            runCatching { mr.reset() }
            runCatching { mr.release() }
        }
        if (file != null) {
            runCatching { file.delete() }
        }
    }

    private fun cleanupStateOnly() {
        meterJob?.cancel()
        meterJob = null
        recorder = null
        outputFile = null
        _isRecording.value = false
        _amplitude.value = 0f
        _elapsedSeconds.value = 0
    }

    private fun cleanupInternal() {
        val mr = recorder
        cleanupStateOnly()
        runCatching { mr?.release() }
    }
}
